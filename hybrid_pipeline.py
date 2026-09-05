"""
Hybrid Drone Photogrammetry Pipeline: DUSt3R + 3D Gaussian Splatting + AI Gap Completion + Ground Alignment
Addresses:
1. Point cloud noise & floating artifacts via multi-stage SOR/ROR and confidence pruning.
2. Upside-down / misaligned coordinate systems via RANSAC ground plane & gravity alignment (+Y Up, Y=0 ground).
3. Blurry coverage / missing texture details via anisotropic surface-tangent Gaussian Splatting.
4. Incomplete video trajectory gaps via smart keyframe extraction and hierarchical AI completion.
"""

import os
import sys
import argparse
import time
import json
import math
import glob
from typing import Dict, Tuple, Optional, List
import numpy as np
import cv2
import torch

from gaussian_splat_engine import GaussianSplatEngine
from geofence_engine import GeofenceEngine
from ai_completion_engine import AISceneCompletionEngine
from coverage_engine import CoverageAnalysisEngine

# DUSt3R imports if available
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DUST3R_DIR = os.path.join(CURRENT_DIR, "dust3r")
if os.path.exists(DUST3R_DIR) and DUST3R_DIR not in sys.path:
    sys.path.insert(0, DUST3R_DIR)


class GroundPlaneGravityAligner:
    """
    Detects dominant ground plane via RANSAC and computes a 3D rotation and translation
    to strictly align the scene with World Up (+Y) and position the ground at Y = 0.
    """

    @staticmethod
    def fit_ransac_plane(points: np.ndarray, distance_thresh: float = 0.15, max_iters: int = 1500) -> Tuple[np.ndarray, float, np.ndarray]:
        """
        Fits a plane Ax + By + Cz + D = 0 using RANSAC.
        Returns: normal (3,), D (float), inlier_indices (np.ndarray)
        """
        N = len(points)
        if N < 3:
            return np.array([0.0, 1.0, 0.0]), 0.0, np.arange(N)

        best_inliers = []
        best_normal = np.array([0.0, 1.0, 0.0])
        best_d = 0.0

        for _ in range(max_iters):
            sample_idx = np.random.choice(N, 3, replace=False)
            p1, p2, p3 = points[sample_idx]

            v1 = p2 - p1
            v2 = p3 - p1
            normal = np.cross(v1, v2)
            norm = np.linalg.norm(normal)
            if norm < 1e-6:
                continue
            normal = normal / norm

            d = -np.dot(normal, p1)

            distances = np.abs(np.dot(points, normal) + d)
            inliers = np.where(distances < distance_thresh)[0]

            if len(inliers) > len(best_inliers):
                best_inliers = inliers
                best_normal = normal
                best_d = d
                if len(inliers) > 0.65 * N:
                    break

        return best_normal, best_d, np.asarray(best_inliers)

    @staticmethod
    def align_to_world_y_up(
        points: np.ndarray,
        target_up: np.ndarray = np.array([0.0, 1.0, 0.0])
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Rotates and translates the point cloud so:
        1. Dominant ground normal is aligned to +Y ([0, 1, 0]).
        2. Points are right-side up (majority of points at or above ground Y >= 0).
        3. Horizontal centroid (X, Z) is centered at (0, 0).
        4. Ground plane elevation is calibrated to Y = 0.
        
        Returns:
            aligned_points: (N, 3)
            rotation_matrix: (3, 3)
            translation_vector: (3,)
        """
        N = len(points)
        if N < 10:
            return points, np.eye(3), np.zeros(3)

        # 1. Detect ground plane
        ground_normal, d, inliers = GroundPlaneGravityAligner.fit_ransac_plane(points)

        # 2. Compute rotation from ground normal to target Up (+Y)
        v = np.cross(ground_normal, target_up)
        s = np.linalg.norm(v)
        c = np.dot(ground_normal, target_up)

        if s < 1e-6:
            if c > 0:
                R = np.eye(3)
            else:
                # 180 degree flip around X axis
                R = np.array([[1.0, 0.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, -1.0]])
        else:
            vx = np.array([
                [0.0, -v[2], v[1]],
                [v[2], 0.0, -v[0]],
                [-v[1], v[0], 0.0]
            ])
            R = np.eye(3) + vx + (vx @ vx) * ((1.0 - c) / (s ** 2))

        # Rotate points
        rotated_pts = (R @ points.T).T

        # 3. Uprightness check: Scene structures should extend in positive Y
        ground_y_candidates = rotated_pts[:, 1]
        y_median = np.median(ground_y_candidates)
        y_p15 = np.percentile(ground_y_candidates, 15)
        y_p85 = np.percentile(ground_y_candidates, 85)

        # If points predominantly extend downwards, flip 180 around Z/X axis
        if (y_p85 - y_median) < (y_median - y_p15):
            R_flip = np.array([[-1.0, 0.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, 1.0]])
            R = R_flip @ R
            rotated_pts = (R @ points.T).T

        # 4. Calibrate ground plane to Y = 0 and horizontal center to (0, 0)
        ground_y = np.percentile(rotated_pts[:, 1], 5)
        center_x = np.median(rotated_pts[:, 0])
        center_z = np.median(rotated_pts[:, 2])

        translation = np.array([-center_x, -ground_y, -center_z], dtype=np.float32)
        aligned_points = rotated_pts + translation

        return aligned_points, R, translation


def extract_keyframes_from_video(
    video_path: str,
    output_dir: str,
    max_frames: int = 24,
    min_sharpness: float = 40.0
) -> List[str]:
    """
    Extracts high-entropy, sharp, non-redundant keyframes from a video file.
    """
    os.makedirs(output_dir, exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise IOError(f"Cannot open video file: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    duration = total_frames / fps
    print(f"[KEYFRAMES] Analyzing video: {duration:.1f}s ({total_frames} frames)...")

    frame_candidates = []
    step = max(1, int(total_frames / (max_frames * 3)))

    curr_idx = 0
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        if curr_idx % step == 0:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            frame_candidates.append({
                "index": curr_idx,
                "sharpness": sharpness,
                "frame": frame
            })
        curr_idx += 1

    cap.release()

    if not frame_candidates:
        raise ValueError("No valid frames could be decoded from the video.")

    # Sort and pick top sharp keyframes distributed evenly across time
    num_bins = min(max_frames, len(frame_candidates))
    bin_size = len(frame_candidates) / num_bins
    selected = []

    for b in range(num_bins):
        start = int(b * bin_size)
        end = int((b + 1) * bin_size)
        bucket = frame_candidates[start:end]
        if bucket:
            best = max(bucket, key=lambda x: x["sharpness"])
            selected.append(best)

    # Save to disk
    saved_paths = []
    for i, item in enumerate(selected):
        out_f = os.path.join(output_dir, f"keyframe_{i:03d}.jpg")
        cv2.imwrite(out_f, item["frame"])
        saved_paths.append(out_f)

    print(f"[KEYFRAMES] Extracted {len(saved_paths)} high-sharpness keyframes to {output_dir}")
    return saved_paths


def run_hybrid_reconstruction(
    input_path: str,
    output_prefix: str = "output/drone_hybrid",
    conf_thresh: float = 4.5,
    enable_ai_completion: bool = True,
    geofence_type: str = "cylinder",
    geofence_radius: float = 25.0,
    max_images: int = 24,
    device: str = "cuda" if torch.cuda.is_available() else "cpu",
    progress_callback = None
) -> Dict:
    """
    Complete End-to-End Hybrid 3D Gaussian Splatting + DUSt3R + AI Completion Pipeline.
    """
    start_time = time.time()
    print("\n" + "=" * 80)
    print("[HYBRID RECONSTRUCTION] DUSt3R + 3D GAUSSIAN SPLATTING + AI COMPLETION")
    print(f"   Input Source    : {input_path}")
    print(f"   Output Prefix   : {output_prefix}")
    print(f"   Confidence Thr  : {conf_thresh}")
    print(f"   AI Completion   : {'ENABLED' if enable_ai_completion else 'DISABLED'}")
    print(f"   Geofence Radius : {geofence_radius}m ({geofence_type.upper()})")
    print(f"   Device          : {device.upper()}")
    print("=" * 80)

    os.makedirs(os.path.dirname(os.path.abspath(output_prefix)), exist_ok=True)

    if progress_callback:
        progress_callback(0.05, "Initializing hybrid pipeline & analyzing input media...")

    # 1. Determine input mode (Video file or Image Directory)
    image_dir = input_path
    if os.path.isfile(input_path) and input_path.lower().endswith((".mp4", ".mov", ".avi", ".mkv", ".insv")):
        print("\n[STEP 1] Video detected. Extracting information-optimal keyframes...")
        if progress_callback:
            progress_callback(0.12, "Extracting information-optimal keyframes from video...")
        keyframe_dir = f"{output_prefix}_keyframes"
        extract_keyframes_from_video(input_path, keyframe_dir, max_frames=max_images)
        image_dir = keyframe_dir
    else:
        print("\n[STEP 1] Ingesting multi-view aerial image dataset...")

    # 2. Run DUSt3R Dense Transformer Stereo or High-End SfM Fallback
    print("\n[STEP 2] Running Transformer Dense 3D Pointmap Prediction...")
    if progress_callback:
        progress_callback(0.25, "Running DUSt3R Dense Transformer 3D Reconstruction...")

    points = None
    colors = None
    confidences = None

    try:
        from dust3r_reconstruction import run_dust3r_reconstruction, HAS_DUST3R
        if HAS_DUST3R:
            dust3r_res = run_dust3r_reconstruction(
                image_dir=image_dir,
                output_path=f"{output_prefix}_raw_points.obj",
                confidence_thresh=conf_thresh,
                max_images=max_images,
                device=device
            )
            points = dust3r_res["points"]
            colors = dust3r_res["colors"]
            confidences = dust3r_res["confidences"]
        else:
            raise ImportError("DUSt3R library not loaded. Falling back to SIFT SfM engine.")
    except Exception as e:
        print(f"[WARN] Transformer direct inference notice ({e}). Using SfM Triangulation fallback...")
        if progress_callback:
            progress_callback(0.35, "Running Feature SfM & Dense Optical Triangulation...")
        from reconstruction_engine import Drone3DReconstructor
        reconstructor = Drone3DReconstructor(image_dir=image_dir, feature_type="SIFT", max_features=3500)
        sfm_res = reconstructor.run_sparse_reconstruction()
        points = sfm_res["points"]
        colors = sfm_res["colors"]
        confidences = np.ones(len(points), dtype=np.float32) * 0.88

    if points is None or len(points) == 0:
        raise RuntimeError("No 3D points could be generated from the provided media.")

    print(f"[SUCCESS] Recovered {len(points):,} raw 3D points with RGB color.")

    # 3. Ground Plane & Gravity Alignment
    print("\n[STEP 3] Performing RANSAC Ground Plane & Gravity Alignment (+Y Up, Y=0 Ground)...")
    if progress_callback:
        progress_callback(0.55, "Aligning scene coordinate frame & ground elevation (+Y Up)...")

    aligned_points, rot_matrix, trans_vec = GroundPlaneGravityAligner.align_to_world_y_up(points)
    print(f"[INFO] Coordinate Alignment: Center calibrated at (0, 0), Ground elevation adjusted to Y=0.")

    # 4. Optional AI-Based Hierarchical Gap Completion
    if enable_ai_completion and len(aligned_points) > 50:
        print("\n[STEP 4] Executing AI Hierarchical Scene Gap Completion on occluded zones...")
        if progress_callback:
            progress_callback(0.70, "Executing AI Scene Completion on occluded regions...")

        comp_res = AISceneCompletionEngine.complete_scene_gaps(
            captured_points=aligned_points,
            captured_colors=colors,
            coverage_confidences=confidences,
            grid_resolution=0.40
        )
        total_points = comp_res["total_points"]
        total_colors = comp_res["total_colors"]
        total_conf = comp_res["confidences"]
        sources = comp_res["sources"]
        print(f"[AI-COMPLETION] Final Unified Geometry: {len(total_points):,} points ({comp_res['captured_pct']}% captured, {comp_res['generated_pct']}% generated).")
    else:
        total_points = aligned_points
        total_colors = colors
        total_conf = confidences
        sources = ["captured"] * len(total_points)

    # 5. Generate Anisotropic 3D Gaussian Splats with PCA Tangent Alignment
    print("\n[STEP 5] Generating Anisotropic 3D Gaussian Splats with PCA Normal/Tangent Covariance...")
    if progress_callback:
        progress_callback(0.85, "Synthesizing anisotropic 3D Gaussian Splats & surface normals...")

    gaussians = GaussianSplatEngine.create_gaussians_from_points(
        points=total_points,
        colors=total_colors,
        confidences=total_conf,
        k_neighbors=12,
        anisotropy=True
    )
    print(f"[SUCCESS] Created {gaussians['count']:,} anisotropic 3D Gaussian Splats.")

    # 6. Apply Geofence Boundary Filtering
    print(f"\n[STEP 6] Applying 3D Geofence Boundary Filter ({geofence_type}, radius={geofence_radius}m)...")
    center = total_points.mean(axis=0)
    filtered_gaussians = GeofenceEngine.filter_gaussians(
        gaussians=gaussians,
        geofence_type=geofence_type,
        center=tuple(center),
        radius=geofence_radius,
        mode="keep_inside"
    )
    print(f"[INFO] Geofence Kept {filtered_gaussians['count']:,} / {gaussians['count']:,} Gaussians.")

    # 7. Multi-Format Model Exports
    print("\n[STEP 7] Exporting 3D Gaussian Splatting & Mesh Formats...")
    if progress_callback:
        progress_callback(0.92, "Exporting 3DGS PLY, fast .SPLAT, and OBJ models...")

    ply_path = f"{output_prefix}_gaussians.ply"
    splat_path = f"{output_prefix}.splat"
    clean_obj_path = f"{output_prefix}_clean.obj"

    GaussianSplatEngine.export_ply(filtered_gaussians, ply_path)
    print(f"   -> Standard 3DGS PLY : {os.path.abspath(ply_path)}")

    GaussianSplatEngine.export_splat(filtered_gaussians, splat_path)
    print(f"   -> WebGL Fast .SPLAT : {os.path.abspath(splat_path)}")

    # Clean OBJ output with normals and vertex colors
    pos = filtered_gaussians["positions"]
    cols = filtered_gaussians["colors"]
    norms = filtered_gaussians.get("normals", np.zeros_like(pos))
    with open(clean_obj_path, "w", encoding="utf-8") as f:
        f.write("# Aligned & Filtered Hybrid 3D Points\n")
        f.write(f"# Total vertices: {len(pos)}\n")
        for p, c, n in zip(pos, cols, norms):
            f.write(f"v {p[0]:.5f} {p[1]:.5f} {p[2]:.5f} {c[0]:.4f} {c[1]:.4f} {c[2]:.4f}\n")
            f.write(f"vn {n[0]:.4f} {n[1]:.4f} {n[2]:.4f}\n")
    print(f"   -> Clean Point/Mesh  : {os.path.abspath(clean_obj_path)}")

    elapsed = time.time() - start_time
    print("\n" + "=" * 80)
    print(f"[COMPLETED] Hybrid 3D Gaussian Splat generated in {elapsed:.1f}s ({elapsed/60:.2f} min)!")
    print("=" * 80)

    if progress_callback:
        progress_callback(1.0, "Reconstruction completed successfully!")

    return {
        "status": "completed",
        "splat_path": splat_path,
        "ply_path": ply_path,
        "obj_path": clean_obj_path,
        "gaussian_count": filtered_gaussians["count"],
        "elapsed_seconds": round(elapsed, 2)
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Hybrid DUSt3R + 3DGS + AI Gap Completion Pipeline")
    parser.add_argument("--input", "-i", type=str, default="sample_drone_flight", help="Folder with images or video path")
    parser.add_argument("--output", "-o", type=str, default="output/hybrid_world", help="Output prefix")
    parser.add_argument("--conf_thresh", type=float, default=4.5, help="Confidence threshold")
    parser.add_argument("--no_ai_completion", action="store_true", help="Disable AI scene gap completion")
    parser.add_argument("--geofence_radius", type=float, default=25.0, help="Geofence radius in meters")
    parser.add_argument("--max_images", type=int, default=24, help="Max images/keyframes to process")
    args = parser.parse_args()

    run_hybrid_reconstruction(
        input_path=args.input,
        output_prefix=args.output,
        conf_thresh=args.conf_thresh,
        enable_ai_completion=not args.no_ai_completion,
        geofence_radius=args.geofence_radius,
        max_images=args.max_images
    )
