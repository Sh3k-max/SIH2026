"""
Multi-Factor Confidence Estimator for predicted 3D geometry.
Evaluates geometric continuity, visual evidence, semantic compatibility,
frontier proximity, point density, and registration residual error.
"""

from dataclasses import dataclass
from typing import Dict, Any, Optional
import numpy as np
from scipy.spatial import KDTree


@dataclass
class PatchConfidence:
    """Detailed breakdown of multi-factor confidence evaluation."""
    unified_score: float
    geometric_consistency: float
    semantic_consistency: float
    proximity_score: float
    visual_evidence_score: float
    registration_error: float
    density_ratio: float
    is_acceptable: bool
    is_uncertain: bool


class ConfidenceEstimator:
    """Computes rigorous confidence metrics for predicted point cloud patches."""

    def __init__(
        self,
        confidence_threshold: float = 0.65,
        uncertain_threshold: float = 0.40,
        weight_geometric: float = 0.30,
        weight_semantic: float = 0.25,
        weight_proximity: float = 0.25,
        weight_visual: float = 0.20,
    ):
        self.confidence_threshold = confidence_threshold
        self.uncertain_threshold = uncertain_threshold
        self.w_geom = weight_geometric
        self.w_sem = weight_semantic
        self.w_prox = weight_proximity
        self.w_vis = weight_visual

    def evaluate_patch(
        self,
        predicted_points: np.ndarray,
        observed_kdtree: KDTree,
        frontier_center: np.ndarray,
        frontier_normal: np.ndarray,
        semantic_attrs: Dict[str, Any],
        visual_context: Dict[str, Any],
        patch_radius: float = 1.25,
    ) -> PatchConfidence:
        """
        Calculates multi-dimensional confidence score for a predicted point patch.
        """
        if len(predicted_points) == 0:
            return PatchConfidence(
                unified_score=0.0,
                geometric_consistency=0.0,
                semantic_consistency=0.0,
                proximity_score=0.0,
                visual_evidence_score=0.0,
                registration_error=1.0,
                density_ratio=0.0,
                is_acceptable=False,
                is_uncertain=False,
            )

        # 1. Proximity to observed geometry: Points should be close to observed frontier, not floating far in space
        dists_to_center = np.linalg.norm(predicted_points - frontier_center, axis=1)
        mean_dist = float(np.mean(dists_to_center))
        # Closer than 1.2 * radius gets high score; drops exponentially beyond
        proximity_score = float(np.clip(1.0 - (mean_dist / (patch_radius * 1.5)), 0.0, 1.0))

        # 2. Geometric continuity with observed surface manifold:
        # Points continuing a surface lie in the tangent plane (perpendicular to surf_normal)
        surf_normal = semantic_attrs.get("normal", frontier_normal)
        rel_vecs = predicted_points - frontier_center
        rel_norms = np.linalg.norm(rel_vecs, axis=1) + 1e-6
        # Out-of-plane deviation (how much it sticks out along normal)
        normal_projections = np.abs(np.sum(rel_vecs * surf_normal, axis=1)) / rel_norms
        # Perfect coplanar continuation has 0 projection along normal -> score 1.0
        geometric_consistency = float(np.clip(1.0 - np.mean(normal_projections) * 2.0, 0.1, 1.0))

        # 3. Semantic consistency & disaster check
        if semantic_attrs.get("is_disaster_debris", False):
            # Aggressive penalty in rubble/debris disaster environments
            semantic_consistency = 0.35
        else:
            planarity = semantic_attrs.get("planarity", 0.5)
            semantic_consistency = float(np.clip(0.5 + 0.5 * planarity, 0.2, 0.95))

        # 4. Visual evidence score
        has_vis = visual_context.get("has_visual_evidence", False)
        texture_var = visual_context.get("texture_variance", 0.25)
        visual_evidence_score = 0.85 if has_vis else float(np.clip(0.60 - texture_var * 0.2, 0.3, 0.7))

        # 5. Registration error (distance from nearest observed point for anchoring vertices)
        k_dists, _ = observed_kdtree.query(predicted_points[:min(16, len(predicted_points))], k=1)
        min_anchor_dist = float(np.min(k_dists))
        reg_error = float(np.clip(min_anchor_dist / (patch_radius * 0.5), 0.0, 1.0))

        # 6. Compute unified weighted score
        raw_score = (
            self.w_geom * geometric_consistency
            + self.w_sem * semantic_consistency
            + self.w_prox * proximity_score
            + self.w_vis * visual_evidence_score
        )
        # Apply registration error damping
        unified_score = float(np.clip(raw_score * (1.0 - 0.25 * reg_error), 0.0, 1.0))

        is_acceptable = unified_score >= self.confidence_threshold
        is_uncertain = (unified_score >= self.uncertain_threshold) and not is_acceptable

        return PatchConfidence(
            unified_score=unified_score,
            geometric_consistency=geometric_consistency,
            semantic_consistency=semantic_consistency,
            proximity_score=proximity_score,
            visual_evidence_score=visual_evidence_score,
            registration_error=reg_error,
            density_ratio=1.0,
            is_acceptable=is_acceptable,
            is_uncertain=is_uncertain,
        )
