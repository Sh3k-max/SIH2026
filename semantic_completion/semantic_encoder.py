"""
Semantic Scene Encoder for visual and geometric scene understanding.
Provides disaster-aware categorization (rubble, debris, collapsed structures vs planar architecture).
"""

from enum import Enum
from typing import Dict, Any, Tuple, Optional
import numpy as np


class SemanticClass(str, Enum):
    BUILDING_FACADE = "building_facade"
    ROOF = "roof"
    GROUND_ROAD = "ground_road"
    VEGETATION = "vegetation"
    RUBBLE_DEBRIS = "rubble_debris"
    UNKNOWN = "unknown"


class SemanticSceneEncoder:
    """Classifies local regions and generates structural priors to guide 3D completion."""

    def __init__(self, disaster_conservative_mode: bool = True):
        self.disaster_conservative_mode = disaster_conservative_mode

    def classify_local_patch(
        self,
        patch_points: np.ndarray,
        patch_colors: np.ndarray,
        ground_y: float = 0.0,
        visual_context: Optional[Dict[str, Any]] = None,
    ) -> Tuple[SemanticClass, float, Dict[str, Any]]:
        """
        Classifies a local point patch based on 3D geometry, elevation, normal entropy, and RGB.
        Returns:
            semantic_class: SemanticClass
            confidence: float [0.0, 1.0]
            attributes: dict with surface normal, roughness entropy, and guidance constraints
        """
        if len(patch_points) < 8:
            return SemanticClass.UNKNOWN, 0.3, {"roughness": 1.0, "is_planar": False}

        # 1. Compute local covariance and principal axes via SVD / PCA
        centered = patch_points - np.mean(patch_points, axis=0)
        cov = np.cov(centered, rowvar=False)
        eigenvalues, eigenvectors = np.linalg.eigh(cov)
        # Sort eigenvalues ascending: e0 <= e1 <= e2
        idx = np.argsort(eigenvalues)
        eigenvalues = np.maximum(0.0, eigenvalues[idx])
        eigenvectors = eigenvectors[:, idx]

        l0, l1, l2 = eigenvalues
        tot = l0 + l1 + l2 + 1e-8
        roughness = float(l0 / tot)  # High roughness indicates scattered/chaotic debris or vegetation
        planarity = float((l1 - l0) / tot)

        # Primary surface normal is eigenvector corresponding to smallest eigenvalue
        normal = eigenvectors[:, 0]
        if normal[1] < 0:  # Ensure normal has consistent upward alignment
            normal = -normal

        # 2. Elevation relative to ground
        mean_y = float(np.mean(patch_points[:, 1]))
        height_above_ground = mean_y - ground_y

        # 3. Color context analysis
        mean_rgb = np.mean(patch_colors, axis=0)
        r, g, b = mean_rgb[0], mean_rgb[1], mean_rgb[2]

        # Check vegetation: green dominance
        is_green = g > (r * 1.12) and g > (b * 1.12) and (g > 60)

        # 4. Disaster / Rubble Check
        # High roughness without clean planarity indicates rubble, collapsed ruins, or debris
        if roughness > 0.18 and not is_green:
            if self.disaster_conservative_mode:
                return SemanticClass.RUBBLE_DEBRIS, 0.85, {
                    "normal": normal,
                    "roughness": roughness,
                    "planarity": planarity,
                    "is_disaster_debris": True,
                    "conservative_suppression": True,
                }

        if is_green:
            return SemanticClass.VEGETATION, 0.78, {
                "normal": normal,
                "roughness": roughness,
                "planarity": planarity,
                "is_disaster_debris": False,
            }

        # Check Ground / Road: horizontal normal (pointing mostly Y-up) and low elevation
        vertical_alignment = abs(normal[1])  # 1.0 = perfectly horizontal plane facing Y
        if vertical_alignment > 0.75 and height_above_ground < 0.15:
            return SemanticClass.GROUND_ROAD, 0.90, {
                "normal": normal,
                "roughness": roughness,
                "planarity": planarity,
                "is_disaster_debris": False,
            }

        # Check Roof: horizontal normal with significant height above ground
        if vertical_alignment > 0.70 and height_above_ground >= 0.15:
            return SemanticClass.ROOF, 0.82, {
                "normal": normal,
                "roughness": roughness,
                "planarity": planarity,
                "is_disaster_debris": False,
            }

        # Check Building Facade: vertical wall (normal is mostly perpendicular to Y)
        if vertical_alignment < 0.40 and planarity > 0.20:
            return SemanticClass.BUILDING_FACADE, 0.88, {
                "normal": normal,
                "roughness": roughness,
                "planarity": planarity,
                "is_disaster_debris": False,
            }

        return SemanticClass.UNKNOWN, 0.50, {
            "normal": normal,
            "roughness": roughness,
            "planarity": planarity,
            "is_disaster_debris": False,
        }
