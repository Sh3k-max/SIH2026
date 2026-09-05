"""
Module: Unified 360° Drone Video to 3D World Reconstruction Pipeline
Orchestrates the complete 16-stage computer vision & Gaussian Splatting photogrammetry pipeline:
1. Video Decoding & Frame Extraction
2. 360° Equirectangular Calibration
3. Tangent Perspective Projection
4. Information-Driven Keyframe Selection
5. Feature Extraction & Epipolar Matching
6. Camera Pose Estimation & Trajectory Alignment
7. RANSAC Ground Plane & Gravity Alignment (+Y Up, Y=0)
8. Dense Multi-View Triangulation & RGB Pixel Sampling
9. Multi-Stage Outlier Removal (SOR/ROR)
10. Volumetric Coverage & Visibility Raycasting
11. Conditioned Generative Gap Completion
12. Anisotropic 3D Gaussian Splatting
13. Asset Export (PLY, SPLAT, OBJ, JSON)
"""

import os
import sys
import argparse
import time
import cv2
import numpy as np
from typing import Dict, List, Optional, Callable

# Add parent directory to path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from video_decoder import VideoDecoder
from projection_360 import EquirectangularProjector
from keyframe_selector import KeyframeSelector
from pose_estimator import CameraPoseEstimator
from gravity_aligner import GravityAligner
from dense_reconstructor import DenseReconstructor
from outlier_filter import OutlierFilter
from coverage_analyzer import CoverageAnalyzer
from generative_completion import GenerativeCompletionEngine
from gaussian_splatting import GaussianSplattingEngine
from scene_exporter import SceneExporter


class ReconstructionPipeline:
    """End-to-end 360° Drone Video to 3D World Reconstruction Engine."""

    @staticmethod
    def execute(
        video_path: str,
        output_dir: str = "output/reconstruction_job",
        target_keyframes: int = 16,
        confidence_thresh: float = 1.15,
        enable_generative_completion: bool = True,
        engine_mode: str = "dust3r",
        progress_cb: Optional[Callable[[float, str], None]] = None
    ) -> Dict:
        """
        Executes the full real-data 3D reconstruction pipeline.
        engine_mode: 'fast' (15s MVS + 3DGS + Continuous Mesh) or 'dust3r' (Deep ViT Transformer)
        """
        start_time = time.time()
        print("\n" + "=" * 80)
        print("[RECONSTRUCTION ENGINE] 360 DEGREE DRONE VIDEO TO 3D WORLD PIPELINE")
        print(f"   Input Video     : {video_path}")
        print(f"   Output Root     : {output_dir}")
        print(f"   Engine Mode     : {engine_mode.upper()}")
        print(f"   Target Keyframes: {target_keyframes}")
        print(f"   AI Completion   : {'ENABLED' if enable_generative_completion else 'DISABLED'}")
        print("=" * 80)

        os.makedirs(output_dir, exist_ok=True)

        def report(pct: float, msg: str):
            print(f"[{int(pct*100):02d}%] {msg}")
            if progress_cb:
                progress_cb(pct, msg)

        # -------------------------------------------------------------
        # STAGE 1: Real Video Decoding & Frame Extraction
        # -------------------------------------------------------------
        report(0.05, "Stage 1: Decoding real video stream & parsing timestamps...")
        raw_frames_dir = os.path.join(output_dir, "raw_frames")
        extracted_frames = VideoDecoder.extract_raw_frames(
            video_path=video_path,
            output_dir=raw_frames_dir,
            target_fps=6.0,
            max_total_frames=120
        )

        # -------------------------------------------------------------
        # STAGE 2: Information-Driven Keyframe Selection
        # -------------------------------------------------------------
        report(0.15, "Stage 2: Analyzing Laplacian sharpness, entropy & selecting keyframes...")
        keyframes_dir = os.path.join(output_dir, "keyframes")
        selected_keyframes = KeyframeSelector.select_keyframes(
            extracted_frames=extracted_frames,
            output_dir=keyframes_dir,
            target_count=target_keyframes
        )

        # -------------------------------------------------------------
        # STAGE 3: 360° Tangent Perspective Projections
        # -------------------------------------------------------------
        report(0.25, "Stage 3: Projecting 360 equirectangular frames into calibrated tangent camera rigs...")
        tangent_dir = os.path.join(output_dir, "tangent_views")
        all_tangent_views = []
        for kf in selected_keyframes:
            views = EquirectangularProjector.project_frame_to_tangent_rig(
                frame_meta=kf,
                output_dir=tangent_dir,
                fov_deg=90.0,
                out_dim=512
            )
            all_tangent_views.extend(views)

        K_intrinsics = np.array(all_tangent_views[0]["intrinsics_K"], dtype=np.float64)

        # -------------------------------------------------------------
        # STAGE 4: Camera Pose Estimation & Localization
        # -------------------------------------------------------------
        report(0.40, "Stage 4: Matching features & estimating global 6-DoF camera poses (R, t)...")
        # Use primary front-facing perspective views for trajectory recovery
        front_views = [v for v in all_tangent_views if v["view_name"] == "front"]
        pose_estimator = CameraPoseEstimator(feature_type="SIFT", max_features=3500)
        camera_poses = pose_estimator.estimate_global_trajectory(
            keyframes=front_views,
            K=K_intrinsics
        )

        # -------------------------------------------------------------
        # STAGE 5: Hybrid Dense 3D Reconstruction
        # -------------------------------------------------------------
        pts3d_raw = None
        colors_raw = None
        confs_raw = None

        if engine_mode.lower() == "dust3r":
            report(0.50, "Stage 5: Running DUSt3R Transformer Multi-View Dense 3D Pointmap Prediction...")
            front_view_paths = [v["file_path"] for v in front_views]
            try:
                pts3d_raw, colors_raw, confs_raw = DenseReconstructor.run_dust3r_dense_reconstruction(
                    image_paths=front_view_paths,
                    confidence_thresh=confidence_thresh,
                    image_size=512
                )
            except Exception as err:
                print(f"[DUSt3R Notice] {err}. Falling back to Multi-View Epipolar Triangulation...")

        if pts3d_raw is None:
            report(0.50, "Stage 5: Running Dense Farneback Optical Flow Multi-View Video Triangulation...")
            kfs_imgs = [cv2.imread(v["file_path"]) for v in front_views]
            cam_R = [np.array(p["R"], dtype=np.float64) for p in camera_poses]
            cam_t = [np.array(p["t"], dtype=np.float64) for p in camera_poses]
            pts3d_raw, colors_raw, confs_raw = DenseReconstructor.triangulate_dense_multiview_video(
                keyframes_bgr=kfs_imgs,
                camera_rotations=cam_R,
                camera_translations=cam_t,
                K=K_intrinsics,
                step_small=5
            )

        # -------------------------------------------------------------
        # STAGE 6: Outlier Rejection & Floater Pruning (SOR/ROR)
        # -------------------------------------------------------------
        report(0.70, "Stage 6: Applying Statistical Outlier Removal (SOR) and floater elimination...")
        pts3d_clean, colors_clean, confs_clean = OutlierFilter.filter_statistical_outliers(
            points=pts3d_raw,
            colors=colors_raw,
            confidences=confs_raw,
            nb_neighbors=30,
            std_ratio=1.5
        )

        # -------------------------------------------------------------
        # STAGE 7: RANSAC Ground Plane & Gravity Alignment (+Y Up, Y=0)
        # -------------------------------------------------------------
        report(0.78, "Stage 7: Performing RANSAC ground plane & gravity alignment (+Y Up, Y=0 ground)...")
        pts3d_aligned, R_align, t_align = GravityAligner.align_scene_to_world_y_up(pts3d_clean)

        # -------------------------------------------------------------
        # STAGE 8: Volumetric Coverage & Visibility Raycasting
        # -------------------------------------------------------------
        report(0.84, "Stage 8: Raycasting 3D visibility & computing confidence coverage map...")
        cam_positions = np.array([p["position"] for p in camera_poses], dtype=np.float32)
        # Transform camera positions using ground alignment
        cam_positions_aligned = (R_align @ cam_positions.T).T + t_align

        coverage_stats = CoverageAnalyzer.analyze_scene_coverage(
            points=pts3d_aligned,
            camera_positions=cam_positions_aligned
        )

        # -------------------------------------------------------------
        # STAGE 9: Conditioned Generative Gap Completion
        # -------------------------------------------------------------
        if enable_generative_completion and len(pts3d_aligned) > 50:
            report(0.88, "Stage 9: Executing conditioned generative scene completion on occluded voids...")
            comp_result = GenerativeCompletionEngine.detect_and_complete_gaps(
                captured_points=pts3d_aligned,
                captured_colors=colors_clean,
                coverage_confidences=coverage_stats["confidences"],
                grid_resolution=0.40
            )
            final_points = comp_result["total_points"]
            final_colors = comp_result["total_colors"]
            final_confs = comp_result["confidences"]
        else:
            final_points = pts3d_aligned
            final_colors = colors_clean
            final_confs = coverage_stats["confidences"]

        # Estimate surface normals
        report(0.92, "Stage 10: Estimating PCA surface normals & synthesizing anisotropic 3D Gaussians...")
        surface_normals = DenseReconstructor.estimate_surface_normals(final_points, k_neighbors=12)

        # -------------------------------------------------------------
        # STAGE 10: Multi-Format Asset Export
        # -------------------------------------------------------------
        report(0.96, "Stage 11: Exporting 3DGS PLY, fast .SPLAT, clean OBJ, and metadata...")
        export_results = SceneExporter.export_all_assets(
            output_dir=output_dir,
            points=final_points,
            colors=final_colors,
            normals=surface_normals,
            confidences=final_confs,
            camera_poses=camera_poses,
            coverage_stats=coverage_stats,
            metadata_extra={
                "source_video": os.path.basename(video_path),
                "elapsed_seconds": round(time.time() - start_time, 2)
            }
        )

        elapsed = round(time.time() - start_time, 2)
        report(1.0, f"Reconstruction Completed in {elapsed}s ({elapsed/60:.2f} min)!")

        print("\n" + "=" * 80)
        print(f"[COMPLETED] 3D World Reconstructed from Video in {elapsed}s!")
        print(f"   -> 3DGS SPLAT : {export_results['gaussian_splat']}")
        print(f"   -> 3DGS PLY   : {export_results['gaussian_ply']}")
        print(f"   -> Clean OBJ  : {export_results['mesh_obj']}")
        print(f"   -> Metadata   : {export_results['scene_json']}")
        print("=" * 80 + "\n")

        return {
            "status": "completed",
            "point_count": len(final_points),
            "elapsed_seconds": elapsed,
            "assets": export_results,
            "coverage": coverage_stats
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="360 Drone Video 3D World Reconstruction Engine")
    parser.add_argument("--input", "-i", type=str, required=True, help="Path to 360 drone video (.mp4, .mov)")
    parser.add_argument("--output", "-o", type=str, default="output/reconstructed_scene", help="Output directory")
    parser.add_argument("--keyframes", "-k", type=int, default=16, help="Target keyframes count")
    parser.add_argument("--conf_thresh", "-c", type=float, default=4.0, help="Confidence threshold")
    parser.add_argument("--no_completion", action="store_true", help="Disable generative gap completion")
    args = parser.parse_args()

    ReconstructionPipeline.execute(
        video_path=args.input,
        output_dir=args.output,
        target_keyframes=args.keyframes,
        confidence_thresh=args.conf_thresh,
        enable_generative_completion=not args.no_completion
    )
