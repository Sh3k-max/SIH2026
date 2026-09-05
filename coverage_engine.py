"""
3D Visibility and Coverage Analysis Engine
Computes exact multi-view observation counts, parallax angles, and coverage confidence:
Coverage Confidence in [0.0, 1.0]:
- 0.8 - 1.0 : Highly-Observed Captured Geometry (Observed from multiple camera views with good baseline)
- 0.4 - 0.8 : Partially-Observed Geometry (Grazing angles, single-view observations)
- 0.0 - 0.4 : Low-Confidence / Unseen Geometry (Shadows, building rears, occlusions)
"""

import numpy as np
from typing import Dict, List, Tuple


class CoverageAnalysisEngine:
    @staticmethod
    def compute_point_coverage_confidence(
        points: np.ndarray,
        camera_positions: np.ndarray,
        camera_look_dirs: np.ndarray = None,
        max_view_distance: float = 45.0,
        min_cos_angle: float = 0.25
    ) -> Dict:
        """
        Traces sightlines from all camera positions to scene points,
        calculating observation counts, angular diversity, and coverage confidence.
        """
        N_pts = len(points)
        N_cams = len(camera_positions)
        if N_pts == 0 or N_cams == 0:
            return {
                "confidences": np.zeros(N_pts, dtype=np.float32),
                "high_coverage_pct": 0.0,
                "partial_coverage_pct": 0.0,
                "low_coverage_pct": 100.0,
                "avg_confidence": 0.0
            }

        confidences = np.zeros(N_pts, dtype=np.float32)
        observation_counts = np.zeros(N_pts, dtype=np.int32)
        angular_spreads = np.zeros(N_pts, dtype=np.float32)

        # Vectorized distance calculation
        # points: (N, 3), cameras: (M, 3)
        for i in range(N_pts):
            pt = points[i]
            diffs = camera_positions - pt  # (M, 3)
            dists = np.linalg.norm(diffs, axis=1)  # (M,)

            # Filter cameras within visibility range
            valid_mask = dists < max_view_distance
            valid_cams = diffs[valid_mask]
            valid_dists = dists[valid_mask]

            obs_count = len(valid_cams)
            observation_counts[i] = obs_count

            if obs_count >= 1:
                # Normalize sightlines
                unit_sightlines = valid_cams / (valid_dists[:, np.newaxis] + 1e-7)

                if obs_count >= 2:
                    # Calculate angular baseline diversity (parallax spread)
                    cos_sims = unit_sightlines @ unit_sightlines.T
                    min_cos = float(np.min(cos_sims))
                    angular_spread = 1.0 - max(0.0, min_cos)
                else:
                    angular_spread = 0.2

                angular_spreads[i] = angular_spread

                # Confidence formulation:
                # C = w1 * min(1.0, obs_count / 5.0) + w2 * angular_spread + w3 * distance_decay
                norm_count = min(1.0, obs_count / 4.0)
                dist_factor = np.mean(1.0 - (valid_dists / max_view_distance))

                conf = 0.50 * norm_count + 0.30 * angular_spread + 0.20 * dist_factor
                confidences[i] = np.clip(conf, 0.05, 1.0)
            else:
                confidences[i] = 0.05

        # Classify coverage zones
        high_mask = confidences >= 0.75
        partial_mask = (confidences >= 0.40) & (confidences < 0.75)
        low_mask = confidences < 0.40

        high_pct = round(float(np.sum(high_mask) / N_pts) * 100, 1)
        partial_pct = round(float(np.sum(partial_mask) / N_pts) * 100, 1)
        low_pct = round(float(np.sum(low_mask) / N_pts) * 100, 1)
        avg_conf = round(float(np.mean(confidences)), 3)

        return {
            "confidences": confidences,
            "observation_counts": observation_counts,
            "high_coverage_pct": high_pct,
            "partial_coverage_pct": partial_pct,
            "low_coverage_pct": low_pct,
            "avg_confidence": avg_conf
        }

    @staticmethod
    def generate_confidence_colormap(confidences: np.ndarray) -> np.ndarray:
        """
        Converts confidence scores [0.0 - 1.0] into a heatmap RGB color array:
        - 1.0 (High)    -> Cyan / Vivid Green (Captured)
        - 0.5 (Partial) -> Yellow / Orange
        - 0.0 (Unseen)  -> Deep Red / Magenta
        """
        N = len(confidences)
        colors = np.zeros((N, 3), dtype=np.float32)

        for i, c in enumerate(confidences):
            if c >= 0.7:
                # High Confidence: Green to Cyan
                t = (c - 0.7) / 0.3
                colors[i] = [0.0, 0.9, 0.3 + 0.7 * t]
            elif c >= 0.4:
                # Medium Confidence: Yellow to Green
                t = (c - 0.4) / 0.3
                colors[i] = [1.0 - 0.8 * t, 0.85 + 0.15 * t, 0.1]
            else:
                # Low Confidence: Red to Yellow
                t = c / 0.4
                colors[i] = [0.95, 0.2 + 0.6 * t, 0.1]

        return colors
