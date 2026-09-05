"""
Module: Gravity & Ground Plane Aligner
Fits a dominant ground plane (Ax + By + Cz + D = 0) via RANSAC and computes a Rodrigues 3D rotation
to strictly align the scene coordinate frame with World Up (+Y) and ground at Y = 0.
"""

import math
import numpy as np
from typing import Tuple, Dict, Optional


class GravityAligner:
    """Aligns 3D points and camera trajectory so +Y is World Up and Ground is at Y = 0."""

    @staticmethod
    def fit_ransac_plane(
        points: np.ndarray,
        distance_thresh: float = 0.15,
        max_iters: int = 1500
    ) -> Tuple[np.ndarray, float, np.ndarray]:
        """
        Fits a 3D plane Ax + By + Cz + D = 0 using RANSAC.
        Returns: (normal_vector, D_offset, inlier_indices)
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
                if len(inliers) > 0.70 * N:
                    break

        return best_normal, best_d, np.asarray(best_inliers)

    @staticmethod
    def align_scene_to_world_y_up(
        points: np.ndarray,
        target_up: np.ndarray = np.array([0.0, 1.0, 0.0])
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Transforms 3D points so:
        1. Ground normal points strictly along +Y ([0, 1, 0]).
        2. Points extend in positive Y (buildings upright).
        3. Horizontal centroid (X, Z) is centered at (0, 0).
        4. Ground elevation is set to Y = 0.
        
        Returns: (aligned_points, 3x3_rotation_matrix, 3x1_translation_vector)
        """
        N = len(points)
        if N < 10:
            return points, np.eye(3), np.zeros(3)

        # 1. Detect dominant ground plane
        ground_normal, d, inliers = GravityAligner.fit_ransac_plane(points)

        # 2. Compute Rodrigues rotation from ground normal to target Up (+Y)
        v = np.cross(ground_normal, target_up)
        s = np.linalg.norm(v)
        c = np.dot(ground_normal, target_up)

        if s < 1e-6:
            if c > 0:
                R = np.eye(3)
            else:
                # 180 flip
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

        # 3. Uprightness verification: Scene elevation should spread along positive Y
        y_vals = rotated_pts[:, 1]
        y_median = np.median(y_vals)
        y_p15 = np.percentile(y_vals, 15)
        y_p85 = np.percentile(y_vals, 85)

        if (y_p85 - y_median) < (y_median - y_p15):
            # Inverted: flip around X/Z
            R_flip = np.array([[-1.0, 0.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, 1.0]])
            R = R_flip @ R
            rotated_pts = (R @ points.T).T

        # 4. Center horizontal origin (0, 0) and zero ground height (Y = 0)
        ground_y = float(np.percentile(rotated_pts[:, 1], 5))
        center_x = float(np.median(rotated_pts[:, 0]))
        center_z = float(np.median(rotated_pts[:, 2]))

        translation = np.array([-center_x, -ground_y, -center_z], dtype=np.float32)
        aligned_points = rotated_pts + translation

        return aligned_points, R, translation
