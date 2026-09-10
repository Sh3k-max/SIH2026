"""
Point Cloud Adapter for standardized ingestion, boundary frontier detection,
and strict non-destructive provenance tagging.
"""

from dataclasses import dataclass, field
from enum import IntEnum
from typing import List, Optional, Tuple, Dict, Any, Union
import numpy as np
from scipy.spatial import KDTree
import os


class PointState(IntEnum):
    """Provenance tracking for every vertex in the 3D scene."""
    OBSERVED = 1   # Verified photogrammetric geometry (SACRED: never modified or overwritten)
    PREDICTED = 2  # Inferred geometry by semantic completion model
    UNKNOWN = 3    # Low-confidence or frontier boundary regions


@dataclass
class SceneCompletionInput:
    """Standardized input representation for the semantic 3D scene completion pipeline."""
    partial_point_cloud: np.ndarray  # Shape: (N, 3) float32
    rgb_colors: np.ndarray          # Shape: (N, 3) uint8 or float32 [0, 255]
    rgb_frames: List[Union[str, np.ndarray]] = field(default_factory=list)
    camera_poses: Optional[np.ndarray] = None    # Shape: (M, 4, 4) camera-to-world
    intrinsics: Optional[np.ndarray] = None      # Shape: (3, 3) or (M, 3, 3)
    gps_rtk: Optional[Dict[str, Any]] = None     # Optional sensor telemetry
    scale_info: float = 1.0
    coordinate_system: str = "world_y_up"
    semantic_labels: Optional[np.ndarray] = None # Optional prior semantic labels (N,)

    def __post_init__(self):
        if len(self.partial_point_cloud) == 0:
            raise ValueError("partial_point_cloud cannot be empty")
        if len(self.rgb_colors) != len(self.partial_point_cloud):
            # Default to neutral gray if colors mismatched
            self.rgb_colors = np.full((len(self.partial_point_cloud), 3), 180, dtype=np.uint8)


class PointCloudAdapter:
    """Utilities to ingest, sample, cluster frontiers, and safeguard point cloud geometry."""

    @staticmethod
    def load_from_file(file_path: str) -> SceneCompletionInput:
        """Loads partial point cloud from .obj or .ply without altering original file."""
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Model file not found: {file_path}")

        points = []
        colors = []

        if file_path.lower().endswith(".obj"):
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if line.startswith("v "):
                        parts = line.strip().split()
                        if len(parts) >= 4:
                            points.append([float(parts[1]), float(parts[2]), float(parts[3])])
                            if len(parts) >= 7:
                                r = float(parts[4])
                                g = float(parts[5])
                                b = float(parts[6])
                                if r <= 1.0 and g <= 1.0 and b <= 1.0:
                                    colors.append([int(r * 255), int(g * 255), int(b * 255)])
                                else:
                                    colors.append([int(r), int(g), int(b)])
                            else:
                                colors.append([180, 180, 180])

        elif file_path.lower().endswith(".ply"):
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                header = True
                for line in f:
                    if header:
                        if line.strip() == "end_header":
                            header = False
                        continue
                    parts = line.strip().split()
                    if len(parts) >= 3:
                        try:
                            points.append([float(parts[0]), float(parts[1]), float(parts[2])])
                            if len(parts) >= 6:
                                colors.append([int(float(parts[3])), int(float(parts[4])), int(float(parts[5]))])
                            else:
                                colors.append([180, 180, 180])
                        except ValueError:
                            continue
        else:
            raise ValueError(f"Unsupported file format: {file_path}. Expected .obj or .ply")

        pts_arr = np.array(points, dtype=np.float32)
        clr_arr = np.array(colors, dtype=np.uint8)
        return SceneCompletionInput(partial_point_cloud=pts_arr, rgb_colors=clr_arr)

    @staticmethod
    def detect_frontiers(
        points: np.ndarray,
        search_radius: Optional[float] = None,
        min_density_ratio: float = 0.35,
        max_frontiers: int = 150,
        kdtree: Optional[KDTree] = None,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Identifies frontier boundary points where the point cloud exhibits incomplete edges or cavities.
        Adapts search radius automatically to point cloud bounding box scale.
        """
        if len(points) < 50:
            return points.copy(), np.zeros_like(points)

        # Compute bounding box scale to ensure radius is geometrically proportional
        bbox_min = np.min(points, axis=0)
        bbox_max = np.max(points, axis=0)
        diag = float(np.linalg.norm(bbox_max - bbox_min))
        
        # Adaptive radius: default to 3% of scene diagonal if not specified or out of scale
        adaptive_r = diag * 0.035
        if search_radius is not None and search_radius > 0:
            actual_radius = min(search_radius, adaptive_r)
        else:
            actual_radius = adaptive_r
        actual_radius = max(actual_radius, 1e-4)

        if kdtree is None:
            kdtree = KDTree(points)

        # Sample subset to audit frontiers quickly and efficiently
        sample_step = max(1, len(points) // 1000)
        sample_indices = np.arange(0, len(points), sample_step)
        sample_pts = points[sample_indices]

        # Query local density within radius
        counts = kdtree.query_ball_point(sample_pts, r=actual_radius, return_sorted=False)
        densities = np.array([len(c) for c in counts])
        mean_density = np.median(densities)

        # Frontier condition: sparse edge where local density is significantly below median
        frontier_mask = densities < max(2, (mean_density * min_density_ratio))
        candidate_indices = sample_indices[frontier_mask]

        if len(candidate_indices) == 0:
            thresh = np.percentile(densities, 5)
            candidate_indices = sample_indices[densities <= thresh]

        candidate_pts = points[candidate_indices]

        # Cluster candidate points into distinct localized completion frontiers
        if len(candidate_pts) > max_frontiers:
            step = len(candidate_pts) // max_frontiers
            candidate_pts = candidate_pts[::step][:max_frontiers]

        # Estimate outward normal for each frontier by checking centroid offset
        frontier_normals = []
        for pt in candidate_pts:
            neighbors_idx = kdtree.query_ball_point(pt, r=actual_radius * 1.5)
            if len(neighbors_idx) > 3:
                local_centroid = np.mean(points[neighbors_idx], axis=0)
                outward = pt - local_centroid
                norm = np.linalg.norm(outward)
                if norm > 1e-6:
                    frontier_normals.append(outward / norm)
                else:
                    frontier_normals.append(np.array([0.0, 1.0, 0.0], dtype=np.float32))
            else:
                frontier_normals.append(np.array([0.0, 1.0, 0.0], dtype=np.float32))

        return candidate_pts, np.array(frontier_normals, dtype=np.float32)

    @staticmethod
    def extract_local_patch(
        points: np.ndarray,
        colors: np.ndarray,
        center: np.ndarray,
        radius: float,
        kdtree: Optional[KDTree] = None
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Extracts a localized spherical neighborhood around a frontier center.
        Returns:
            patch_points: (P, 3) centered coordinates (local frame)
            patch_colors: (P, 3) RGB colors
            global_indices: (P,) indices into the original points array
        """
        if kdtree is None:
            kdtree = KDTree(points)

        idx = np.array(kdtree.query_ball_point(center, r=radius))
        if len(idx) == 0:
            return np.zeros((0, 3), dtype=np.float32), np.zeros((0, 3), dtype=np.uint8), np.array([], dtype=int)

        patch_pts = points[idx] - center
        patch_clr = colors[idx]
        return patch_pts, patch_clr, idx
