"""
Provenance-Preserving Fusion Module.
Ensures zero-loss preservation of OBSERVED photogrammetric points,
separates PREDICTED geometry, flags UNKNOWN frontiers, and exports multi-mode representations.
"""

from enum import Enum
from typing import List, Dict, Any, Optional, Tuple
import numpy as np
import os
from .pointcloud_adapter import PointState


class ExportFormat(str, Enum):
    RGB = "rgb"                     # Natural RGB appearance
    PROVENANCE = "provenance"       # Green = Observed, Cyan = High Conf, Amber = Low Conf, Crimson = Unknown
    CONFIDENCE_HEATMAP = "heatmap"  # Heatmap based on confidence score (Blue -> Green -> Yellow -> Red)


class SceneFusionManager:
    """Manages separate layers of OBSERVED, PREDICTED, and UNKNOWN points."""

    def __init__(self, observed_points: np.ndarray, observed_colors: np.ndarray):
        # SACRED: Observed points must NEVER be modified or deleted
        self.observed_points = observed_points.copy()
        self.observed_colors = observed_colors.copy()
        self.observed_states = np.full(len(observed_points), PointState.OBSERVED, dtype=np.int8)

        # Separate predicted container
        self.predicted_points_list: List[np.ndarray] = []
        self.predicted_colors_list: List[np.ndarray] = []
        self.predicted_confidences_list: List[np.ndarray] = []
        self.predicted_semantics_list: List[str] = []

        # Separate unknown container
        self.unknown_points_list: List[np.ndarray] = []
        self.unknown_colors_list: List[np.ndarray] = []

    def add_predicted_patch(
        self,
        points: np.ndarray,
        colors: np.ndarray,
        confidences: np.ndarray,
        semantic_tag: str = "unknown"
    ) -> None:
        """Adds a verified predicted local 3D patch."""
        if len(points) == 0:
            return
        self.predicted_points_list.append(points.copy())
        self.predicted_colors_list.append(colors.copy())
        self.predicted_confidences_list.append(confidences.copy())
        self.predicted_semantics_list.append(semantic_tag)

    def add_unknown_frontier(self, points: np.ndarray) -> None:
        """Flags ambiguous or insufficiently confident frontier points as UNKNOWN."""
        if len(points) == 0:
            return
        self.unknown_points_list.append(points.copy())
        # Default unknown color: Crimson
        crimson = np.full((len(points), 3), [220, 20, 60], dtype=np.uint8)
        self.unknown_colors_list.append(crimson)

    def get_fused_scene(
        self,
        min_confidence: float = 0.60,
        include_unknown: bool = False
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """
        Merges observed and qualified predicted points while preserving full provenance.
        Returns:
            all_points: (Total_N, 3)
            all_colors: (Total_N, 3)
            all_states: (Total_N,) PointState enum values
            all_confidences: (Total_N,)
        """
        pts = [self.observed_points]
        clrs = [self.observed_colors]
        states = [self.observed_states]
        confs = [np.ones(len(self.observed_points), dtype=np.float32)]  # Observed has 1.0 confidence

        # Filter predicted points
        if self.predicted_points_list:
            pred_pts = np.vstack(self.predicted_points_list)
            pred_clrs = np.vstack(self.predicted_colors_list)
            pred_confs = np.concatenate(self.predicted_confidences_list)

            mask = pred_confs >= min_confidence
            if np.any(mask):
                pts.append(pred_pts[mask])
                clrs.append(pred_clrs[mask])
                states.append(np.full(np.sum(mask), PointState.PREDICTED, dtype=np.int8))
                confs.append(pred_confs[mask])

        # Include unknown if requested
        if include_unknown and self.unknown_points_list:
            unk_pts = np.vstack(self.unknown_points_list)
            unk_clrs = np.vstack(self.unknown_colors_list)
            pts.append(unk_pts)
            clrs.append(unk_clrs)
            states.append(np.full(len(unk_pts), PointState.UNKNOWN, dtype=np.int8))
            confs.append(np.zeros(len(unk_pts), dtype=np.float32))

        return np.vstack(pts), np.vstack(clrs), np.concatenate(states), np.concatenate(confs)

    def export_obj(
        self,
        output_path: str,
        export_format: ExportFormat = ExportFormat.RGB,
        min_confidence: float = 0.60,
        include_unknown: bool = False
    ) -> Dict[str, Any]:
        """
        Exports scene to Wavefront .obj format with specified color mode.
        """
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        # In natural RGB mode, never export crimson red unknown points
        actual_include_unknown = include_unknown and (export_format != ExportFormat.RGB)
        pts, clrs, states, confs = self.get_fused_scene(min_confidence, actual_include_unknown)

        # Determine RGB colors based on selected mode
        if export_format == ExportFormat.PROVENANCE:
            final_colors = np.zeros_like(clrs)
            # Observed: Forest Green
            final_colors[states == PointState.OBSERVED] = [50, 205, 50]
            # Predicted: High Conf -> Cyan, Low Conf -> Amber
            pred_mask = states == PointState.PREDICTED
            high_conf = pred_mask & (confs >= 0.75)
            low_conf = pred_mask & (confs < 0.75)
            final_colors[high_conf] = [0, 215, 255]
            final_colors[low_conf] = [255, 165, 0]
            # Unknown: Crimson
            final_colors[states == PointState.UNKNOWN] = [220, 20, 60]
        elif export_format == ExportFormat.CONFIDENCE_HEATMAP:
            # Colormap: 0.0 (blue) -> 0.5 (green) -> 1.0 (red)
            final_colors = np.zeros_like(clrs)
            for i, c in enumerate(confs):
                final_colors[i] = [int(255 * c), int(255 * (1.0 - abs(c - 0.5) * 2)), int(255 * (1.0 - c))]
        else:
            final_colors = clrs

        # Write .obj file
        with open(output_path, "w", encoding="utf-8") as f:
            f.write("# Semantic 3D Scene Completion Export\n")
            f.write(f"# Export Mode: {export_format.value}\n")
            f.write(f"# Total Points: {len(pts)}\n")
            f.write(f"# Observed Points: {len(self.observed_points)}\n")
            for p, c in zip(pts, final_colors):
                # Export with normalized 0.0-1.0 RGB colors
                f.write(f"v {p[0]:.5f} {p[1]:.5f} {p[2]:.5f} {c[0]/255.0:.4f} {c[1]/255.0:.4f} {c[2]/255.0:.4f}\n")

        return {
            "output_path": output_path,
            "total_points": len(pts),
            "observed_count": len(self.observed_points),
            "predicted_count": int(np.sum(states == PointState.PREDICTED)),
            "unknown_count": int(np.sum(states == PointState.UNKNOWN)),
            "export_format": export_format.value,
        }
