"""
Module: Multi-Stage Outlier & Floater Filter
Applies Statistical Outlier Removal (SOR) and Radius Outlier Removal (ROR)
to eliminate floating noise, boundary card artifacts, and isolated stray points.
"""

import numpy as np
from typing import Tuple, Optional
from scipy.spatial import cKDTree


class OutlierFilter:
    """Filters noisy floating particles, boundary card artifacts, and isolated outliers."""

    @staticmethod
    def filter_statistical_outliers(
        points: np.ndarray,
        colors: np.ndarray,
        confidences: Optional[np.ndarray] = None,
        nb_neighbors: int = 30,
        std_ratio: float = 1.5
    ) -> Tuple[np.ndarray, np.ndarray, Optional[np.ndarray]]:
        """
        Removes points whose average distance to k nearest neighbors is greater than (mean + std_ratio * std).
        """
        N = len(points)
        if N < nb_neighbors + 2:
            return points, colors, confidences

        # High-performance Open3D implementation if installed
        try:
            import open3d as o3d
            pcd = o3d.geometry.PointCloud()
            pcd.points = o3d.utility.Vector3dVector(points)
            cols_norm = colors if colors.max() <= 1.0 else colors / 255.0
            pcd.colors = o3d.utility.Vector3dVector(cols_norm)
            
            _, ind = pcd.remove_statistical_outlier(nb_neighbors=nb_neighbors, std_ratio=std_ratio)
            valid_idx = np.asarray(ind)
            
            pts_clean = np.asarray(pcd.select_by_index(valid_idx).points)
            cols_clean = np.asarray(pcd.select_by_index(valid_idx).colors)
            confs_clean = confidences[valid_idx] if confidences is not None else None
            return pts_clean, cols_clean, confs_clean
        except Exception:
            pass

        # SciPy cKDTree pure NumPy fallback
        tree = cKDTree(points)
        dists, _ = tree.query(points, k=nb_neighbors + 1)
        mean_d = np.mean(dists[:, 1:], axis=1)
        global_mean = np.mean(mean_d)
        global_std = np.std(mean_d)

        thresh = global_mean + std_ratio * global_std
        mask = mean_d <= thresh

        pts_clean = points[mask]
        cols_clean = colors[mask]
        confs_clean = confidences[mask] if confidences is not None else None

        return pts_clean, cols_clean, confs_clean

    @staticmethod
    def filter_radius_outliers(
        points: np.ndarray,
        colors: np.ndarray,
        confidences: Optional[np.ndarray] = None,
        min_neighbors: int = 4,
        radius: float = 0.5
    ) -> Tuple[np.ndarray, np.ndarray, Optional[np.ndarray]]:
        """Removes points that have fewer than min_neighbors within the given search radius."""
        N = len(points)
        if N < min_neighbors + 2:
            return points, colors, confidences

        tree = cKDTree(points)
        counts = tree.query_ball_point(points, r=radius, return_length=True)
        # Exclude self count
        mask = np.array(counts) >= (min_neighbors + 1)

        pts_clean = points[mask]
        cols_clean = colors[mask]
        confs_clean = confidences[mask] if confidences is not None else None

        return pts_clean, cols_clean, confs_clean
