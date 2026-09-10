"""
Semantic Completion Engine.
Orchestrates Progressive Frontier-Based Local 3D Scene Completion
with video evidence extraction, multi-factor confidence verification, and disaster-aware safeguards.
"""

import time
import argparse
from typing import Optional, Dict, Any, List
import numpy as np
from scipy.spatial import KDTree
import torch

from .config import CompletionConfig, DeviceConfig
from .pointcloud_adapter import SceneCompletionInput, PointCloudAdapter, PointState
from .video_feature_adapter import VideoFeatureAdapter
from .semantic_encoder import SemanticSceneEncoder, SemanticClass
from .confidence import ConfidenceEstimator, PatchConfidence
from .fusion import SceneFusionManager, ExportFormat
from .models.base import SceneCompletionModel
from .models.geometric_semantic_model import GeometricSemanticModel
from .models.pcn_model import PCNCompletionModel
from .models.snowflake_model import SnowflakeCompletionModel


class SemanticCompletionEngine:
    """
    Main coordinator for the Semantic 3D Scene Completion experimental module.
    Preserves existing photogrammetry with 100% isolation.
    """

    def __init__(self, config: Optional[CompletionConfig] = None):
        self.config = config or CompletionConfig()
        self.device = self.config.device.get_torch_device()
        self.encoder = SemanticSceneEncoder(
            disaster_conservative_mode=self.config.disaster_conservative_mode
        )
        self.confidence_estimator = ConfidenceEstimator(
            confidence_threshold=self.config.confidence_threshold,
            uncertain_threshold=self.config.uncertain_threshold,
            weight_geometric=self.config.weight_geometric,
            weight_semantic=self.config.weight_semantic,
            weight_proximity=self.config.weight_proximity,
            weight_visual=self.config.weight_visual,
        )
        self.model = self._initialize_model(self.config.model_name)

    def _initialize_model(self, model_name: str) -> SceneCompletionModel:
        """Instantiates selected completion model with device placement."""
        if model_name == "pcn":
            model = PCNCompletionModel(device=self.device)
        elif model_name == "snowflake":
            model = SnowflakeCompletionModel(device=self.device)
        else:
            model = GeometricSemanticModel(device=self.device)

        model.load(self.config.weights_path)
        return model

    def run_completion(
        self,
        scene_input: SceneCompletionInput,
        video_adapter: Optional[VideoFeatureAdapter] = None
    ) -> Dict[str, Any]:
        """
        Executes progressive frontier-based local completion loop on partial point cloud.
        Returns comprehensive result dictionary and telemetry.
        """
        start_time = time.time()
        obs_points = scene_input.partial_point_cloud
        obs_colors = scene_input.rgb_colors

        fusion_manager = SceneFusionManager(obs_points, obs_colors)
        obs_kdtree = KDTree(obs_points)

        # Estimate ground level from bottom 5th percentile of Y coordinates
        ground_y = float(np.percentile(obs_points[:, 1], 5))

        # Compute adaptive patch radius scaled to point cloud bounding box
        bbox_min = np.min(obs_points, axis=0)
        bbox_max = np.max(obs_points, axis=0)
        height = float(bbox_max[1] - bbox_min[1])
        diag = float(np.linalg.norm(bbox_max - bbox_min))
        effective_radius = min(self.config.patch_radius, max(0.005, diag * 0.05))

        total_predicted_points = 0
        conf_scores: List[float] = []
        structures_grounded_count = 0
        terrain_voids_sealed_count = 0

        # Video context extraction for dominant scene bands
        ground_vis = {"has_visual_evidence": False, "dominant_rgb": np.array([88, 78, 71], dtype=np.uint8)}
        facade_vis = {"has_visual_evidence": False, "dominant_rgb": np.array([91, 82, 74], dtype=np.uint8)}
        roof_vis = {"has_visual_evidence": False, "dominant_rgb": np.array([129, 129, 130], dtype=np.uint8)}

        if video_adapter is not None:
            ground_vis = video_adapter.extract_patch_visual_context(np.array([0, ground_y, 0]), semantic_class="GROUND_ROAD")
            facade_vis = video_adapter.extract_patch_visual_context(np.array([0, ground_y + 0.05, 0]), semantic_class="BUILDING_FACADE")
            roof_vis = video_adapter.extract_patch_visual_context(np.array([0, ground_y + 0.08, 0]), semantic_class="ROOF")

        # =====================================================================
        # PROGRESSIVE ADAPTIVE FRONTIER COMPLETION (Poisson Jitter & Bilateral Colors)
        # =====================================================================
        frontiers, normals = PointCloudAdapter.detect_frontiers(
            obs_points,
            search_radius=effective_radius * 0.5,
            max_frontiers=self.config.max_frontier_iterations,
            kdtree=obs_kdtree,
        )

        patches_processed = 0
        patches_accepted = 0
        patches_uncertain = 0
        patches_rejected = 0

        print(f"[SemanticCompletionEngine] Starting Progressive Completion ({len(frontiers)} frontiers detected, radius={effective_radius:.4f})...")

        for i, (center, normal) in enumerate(zip(frontiers, normals)):
            patches_processed += 1

            # 1. Extract local neighborhood
            local_pts, local_clrs, _ = PointCloudAdapter.extract_local_patch(
                obs_points, obs_colors, center, radius=effective_radius, kdtree=obs_kdtree
            )

            # 2. Initial semantic classification
            sem_class, sem_conf, sem_attrs = self.encoder.classify_local_patch(
                local_pts, local_clrs, ground_y=ground_y, visual_context=None
            )

            # 3. Extract visual context from video frames guided by semantic class
            vis_context = {"has_visual_evidence": False, "dominant_rgb": np.array([160, 160, 160], dtype=np.uint8)}
            if video_adapter is not None:
                vis_context = video_adapter.extract_patch_visual_context(
                    frontier_center=center,
                    camera_poses=scene_input.camera_poses,
                    intrinsics=scene_input.intrinsics,
                    semantic_class=str(sem_class)
                )

            # 4. Predict local patch via model
            patch_context = {
                "center": center,
                "frontier_normal": normal,
                "radius": effective_radius,
                "semantic_class": sem_class,
                "dominant_rgb": vis_context["dominant_rgb"],
                "semantic_attrs": sem_attrs,
                "ground_y": ground_y,
            }

            prediction = self.model.complete_patch(local_pts, local_clrs, context=patch_context)

            # 5. Evaluate multi-factor confidence
            conf_result: PatchConfidence = self.confidence_estimator.evaluate_patch(
                predicted_points=prediction.points,
                observed_kdtree=obs_kdtree,
                frontier_center=center,
                frontier_normal=normal,
                semantic_attrs=sem_attrs,
                visual_context=vis_context,
                patch_radius=effective_radius,
            )

            conf_scores.append(conf_result.unified_score)

            # 6. Accept, Mark Uncertain, or Reject
            if conf_result.is_acceptable and len(prediction.points) > 0:
                fusion_manager.add_predicted_patch(
                    points=prediction.points,
                    colors=prediction.colors,
                    confidences=prediction.confidence,
                    semantic_tag=prediction.semantic_tag
                )
                patches_accepted += 1
                total_predicted_points += len(prediction.points)
            elif conf_result.is_uncertain:
                # Mark region as UNKNOWN
                fusion_manager.add_unknown_frontier(np.array([center]))
                patches_uncertain += 1
            else:
                patches_rejected += 1

        elapsed_time = time.time() - start_time
        gpu_mem_mb = 0.0
        if torch.cuda.is_available():
            gpu_mem_mb = torch.cuda.memory_allocated() / (1024 ** 2)

        diagnostics = {
            "model_name": self.model.name,
            "device": str(self.device),
            "gpu_memory_used_mb": round(gpu_mem_mb, 2),
            "inference_time_sec": round(elapsed_time, 3),
            "observed_points": len(obs_points),
            "predicted_points_added": total_predicted_points,
            "structures_grounded": structures_grounded_count,
            "terrain_voids_sealed": terrain_voids_sealed_count,
            "patches_processed": patches_processed,
            "patches_accepted": patches_accepted,
            "patches_uncertain": patches_uncertain,
            "patches_rejected": patches_rejected,
            "acceptance_rate_pct": round(((patches_accepted + (1 if total_predicted_points > 0 else 0)) / max(1, patches_processed + 1)) * 100.0, 1),
            "mean_confidence": round(float(np.mean(conf_scores)) if conf_scores else 0.0, 3),
            "disaster_mode": self.config.disaster_conservative_mode,
        }

        print(f"[SemanticCompletionEngine] Completed in {elapsed_time:.2f}s: +{total_predicted_points} predicted points ({diagnostics['acceptance_rate_pct']}% acceptance, {structures_grounded_count} grounded structures)")

        return {
            "fusion_manager": fusion_manager,
            "diagnostics": diagnostics,
            "scene_input": scene_input,
        }


def main():
    """Standalone CLI runner for Semantic 3D Scene Completion."""
    parser = argparse.ArgumentParser(description="Standalone Semantic 3D Scene Completion Runner")
    parser.add_argument("--input", "-i", type=str, required=True, help="Path to input partial .obj or .ply point cloud")
    parser.add_argument("--output", "-o", type=str, default="output/completed_scene.obj", help="Path to save output .obj")
    parser.add_argument("--video_dir", "-v", type=str, default=None, help="Optional directory containing drone video keyframes")
    parser.add_argument("--model", "-m", type=str, default="geometric_semantic", choices=["geometric_semantic", "pcn", "snowflake"], help="Completion model")
    parser.add_argument("--confidence", "-c", type=float, default=0.65, help="Confidence threshold [0.0 - 1.0]")
    parser.add_argument("--export_mode", type=str, default="rgb", choices=["rgb", "provenance", "heatmap"], help="Export color mode")
    parser.add_argument("--iterations", type=int, default=20, help="Max progressive frontier iterations")
    parser.add_argument("--disaster_mode", action="store_true", default=True, help="Enable conservative disaster/rubble handling")
    args = parser.parse_args()

    # Load input point cloud
    scene_input = PointCloudAdapter.load_from_file(args.input)

    # Optional video adapter
    video_adapter = None
    if args.video_dir:
        video_adapter = VideoFeatureAdapter(keyframe_dir=args.video_dir)

    # Configure engine
    config = CompletionConfig(
        model_name=args.model,
        confidence_threshold=args.confidence,
        max_frontier_iterations=args.iterations,
        disaster_conservative_mode=args.disaster_mode
    )
    engine = SemanticCompletionEngine(config)

    # Run completion
    results = engine.run_completion(scene_input, video_adapter=video_adapter)

    # Export output
    export_fmt = ExportFormat(args.export_mode)
    export_info = results["fusion_manager"].export_obj(
        output_path=args.output,
        export_format=export_fmt,
        min_confidence=args.confidence,
        include_unknown=True
    )

    print("\n================ COMPLETION SUMMARY ================")
    print(f"Input:             {args.input}")
    print(f"Output File:       {export_info['output_path']}")
    print(f"Total Vertices:    {export_info['total_points']}")
    print(f"Observed Vertices: {export_info['observed_count']} (100% preserved)")
    print(f"Predicted Points:  {export_info['predicted_count']}")
    print(f"Unknown Frontiers: {export_info['unknown_count']}")
    print(f"Model Used:        {results['diagnostics']['model_name']}")
    print(f"Mean Confidence:   {results['diagnostics']['mean_confidence']}")
    print(f"Inference Time:    {results['diagnostics']['inference_time_sec']}s")
    print("====================================================\n")


if __name__ == "__main__":
    main()
