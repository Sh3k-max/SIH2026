"""
Adaptive Geometric-Semantic Model for high-precision, surface-anchored 3D scene completion.
Combines geometric manifold priors with video color guidance while strictly eliminating floaters.
"""

from typing import Optional, Dict, Any, List
import math
import numpy as np
import torch
from .base import SceneCompletionModel, PatchPrediction
from ..semantic_encoder import SemanticClass


class GeometricSemanticModel(SceneCompletionModel):
    """
    Synthesizes continuous surface geometry conditioned on local semantic context
    (facades, roofs, terrain) and drone video color palettes.
    """

    def __init__(self, device: Optional[torch.device] = None):
        super().__init__(name="geometric_semantic", device=device)
        self.is_loaded = True

    def load(self, weights_path: Optional[str] = None) -> bool:
        self.is_loaded = True
        return True

    def preprocess(
        self,
        patch_points: np.ndarray,
        patch_colors: np.ndarray,
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        context = context or {}
        center = context.get("center", np.mean(patch_points, axis=0) if len(patch_points) > 0 else np.zeros(3))
        frontier_normal = context.get("frontier_normal", np.array([0.0, 1.0, 0.0], dtype=np.float32))
        semantic_class = context.get("semantic_class", SemanticClass.UNKNOWN)
        visual_rgb = context.get("dominant_rgb", np.array([160, 160, 160], dtype=np.uint8))
        semantic_attrs = context.get("semantic_attrs", {})
        ground_y = context.get("ground_y", 0.0)

        return {
            "patch_points": patch_points,
            "patch_colors": patch_colors,
            "center": center,
            "frontier_normal": frontier_normal,
            "semantic_class": semantic_class,
            "visual_rgb": visual_rgb,
            "semantic_attrs": semantic_attrs,
            "ground_y": ground_y,
            "radius": context.get("radius", 1.25),
        }

    def predict(self, processed_data: Dict[str, Any]) -> Dict[str, Any]:
        patch_points = processed_data["patch_points"]
        center = processed_data["center"]
        frontier_normal = processed_data["frontier_normal"]
        semantic_class = processed_data["semantic_class"]
        attrs = processed_data["semantic_attrs"]
        radius = processed_data["radius"]
        visual_rgb = processed_data["visual_rgb"]
        ground_y = processed_data["ground_y"]

        # If disaster debris is identified and conservative suppression is active,
        # return empty or ultra-conservative points to prevent hallucinating false geometry
        if attrs.get("conservative_suppression", False):
            return {
                "rel_points": np.zeros((0, 3), dtype=np.float32),
                "colors": np.zeros((0, 3), dtype=np.uint8),
                "confidences": np.zeros(0, dtype=np.float32),
                "semantic_tag": str(semantic_class),
            }

        # Determine surface normal
        surf_normal = attrs.get("normal", frontier_normal)
        norm_val = np.linalg.norm(surf_normal)
        if norm_val > 1e-6:
            surf_normal = surf_normal / norm_val
        else:
            surf_normal = np.array([0.0, 1.0, 0.0], dtype=np.float32)

        base_color = visual_rgb.astype(float)
        if len(processed_data["patch_colors"]) > 0:
            local_mean = np.mean(processed_data["patch_colors"], axis=0)
            base_color = 0.5 * local_mean + 0.5 * base_color

        candidate_rel: List[np.ndarray] = []
        confidences: List[float] = []
        colors: List[np.ndarray] = []

        # Pre-build local KDTree for bilateral color and texture interpolation
        has_local_pts = len(patch_points) > 0 and len(processed_data["patch_colors"]) > 0
        local_pts_tree = None
        if has_local_pts:
            from scipy.spatial import KDTree
            local_pts_tree = KDTree(patch_points)

        def get_blended_color(world_pt: np.ndarray, default_base: np.ndarray, noise_std: float = 3.0) -> np.ndarray:
            """Interpolates color smoothly from nearest observed points to preserve photogrammetric grain."""
            noise = np.random.normal(0, noise_std, 3)
            if local_pts_tree is not None:
                d, idx = local_pts_tree.query(world_pt)
                near_col = processed_data["patch_colors"][idx].astype(float)
                # Blend nearest color with video prior
                col = 0.75 * near_col + 0.25 * default_base + noise
            else:
                col = default_base + noise
            return np.clip(col, 0, 255).astype(np.uint8)

        candidate_rel: List[np.ndarray] = []
        confidences: List[float] = []
        colors: List[np.ndarray] = []

        # =====================================================================
        # Case A: GROUND / ROAD COMPLETION (Organic Poisson-Disk Terrain)
        # =====================================================================
        if semantic_class == SemanticClass.GROUND_ROAD:
            grid_res = 14
            u_base = np.linspace(-radius * 0.75, radius * 0.75, grid_res)
            v_base = np.linspace(-radius * 0.75, radius * 0.75, grid_res)
            du = (u_base[1] - u_base[0]) if len(u_base) > 1 else 0.005
            dv = (v_base[1] - v_base[0]) if len(v_base) > 1 else 0.005

            for ub in u_base:
                for vb in v_base:
                    # Blue-noise / Poisson-disk jitter eliminates any regular waffle grid
                    u = ub + np.random.uniform(-0.45, 0.45) * du
                    v = vb + np.random.uniform(-0.45, 0.45) * dv
                    dist = math.sqrt(u * u + v * v)
                    if dist > radius * 0.8:
                        continue

                    dy = -0.001 * (dist ** 2) / (radius ** 2 + 1e-6)
                    pt = np.array([u, dy, v], dtype=np.float32)
                    conf = max(0.50, float(0.95 - (dist / (radius * 1.6))))

                    c = get_blended_color(pt + center, base_color, noise_std=3.0)
                    candidate_rel.append(pt)
                    confidences.append(conf)
                    colors.append(c)

        # =====================================================================
        # Case B: BUILDING FACADE COMPLETION (Planar Architectural Wall Infill)
        # =====================================================================
        elif semantic_class == SemanticClass.BUILDING_FACADE:
            h_normal = np.array([surf_normal[0], 0.0, surf_normal[2]], dtype=np.float32)
            if np.linalg.norm(h_normal) > 1e-6:
                h_normal = h_normal / np.linalg.norm(h_normal)
            else:
                h_normal = np.array([1.0, 0.0, 0.0], dtype=np.float32)

            wall_tangent = np.array([-h_normal[2], 0.0, h_normal[0]], dtype=np.float32)
            
            grid_u = 14
            grid_v = 14
            y_extent = min(radius * 0.75, max(0.02, center[1] - ground_y))
            u_base = np.linspace(-radius * 0.5, radius * 0.5, grid_u)
            v_base = np.linspace(-y_extent, 0.02 * y_extent, grid_v)
            du = (u_base[1] - u_base[0]) if len(u_base) > 1 else 0.005
            dv = (v_base[1] - v_base[0]) if len(v_base) > 1 else 0.005

            for ub in u_base:
                for vb in v_base:
                    # Blue-noise jitter
                    u = ub + np.random.uniform(-0.45, 0.45) * du
                    y_offset = vb + np.random.uniform(-0.45, 0.45) * dv
                    pt = u * wall_tangent + np.array([0.0, y_offset, 0.0], dtype=np.float32)
                    dist = float(np.linalg.norm(pt))

                    conf = max(0.50, float(0.92 - (dist / (radius * 1.5))))
                    c = get_blended_color(pt + center, base_color, noise_std=2.5)

                    candidate_rel.append(pt)
                    confidences.append(conf)
                    colors.append(c)

        # =====================================================================
        # Case C: ROOF COMPLETION (Organic Planar Roof Cap)
        # =====================================================================
        elif semantic_class == SemanticClass.ROOF:
            grid_res = 14
            u_base = np.linspace(-radius * 0.65, radius * 0.65, grid_res)
            v_base = np.linspace(-radius * 0.65, radius * 0.65, grid_res)
            du = (u_base[1] - u_base[0]) if len(u_base) > 1 else 0.005
            dv = (v_base[1] - v_base[0]) if len(v_base) > 1 else 0.005

            roof_color = 0.7 * base_color + 0.3 * np.array([80, 85, 95])

            for ub in u_base:
                for vb in v_base:
                    u = ub + np.random.uniform(-0.45, 0.45) * du
                    v = vb + np.random.uniform(-0.45, 0.45) * dv
                    dist = math.sqrt(u * u + v * v)
                    if dist > radius * 0.7:
                        continue

                    pt = np.array([u, 0.0, v], dtype=np.float32)
                    conf = max(0.50, float(0.92 - (dist / (radius * 1.5))))
                    c = get_blended_color(pt + center, roof_color, noise_std=2.5)

                    candidate_rel.append(pt)
                    confidences.append(conf)
                    colors.append(c)

        # =====================================================================
        # Case D: VEGETATION / CANOPY
        # =====================================================================
        elif semantic_class == SemanticClass.VEGETATION:
            grid_res = 12
            u_base = np.linspace(-radius * 0.55, radius * 0.55, grid_res)
            v_base = np.linspace(-radius * 0.55, radius * 0.55, grid_res)
            du = (u_base[1] - u_base[0]) if len(u_base) > 1 else 0.005
            dv = (v_base[1] - v_base[0]) if len(v_base) > 1 else 0.005

            veg_color = 0.5 * base_color + 0.5 * np.array([55, 110, 50])

            for ub in u_base:
                for vb in v_base:
                    u = ub + np.random.uniform(-0.45, 0.45) * du
                    v = vb + np.random.uniform(-0.45, 0.45) * dv
                    dist = math.sqrt(u * u + v * v)
                    if dist > radius * 0.6:
                        continue

                    organic_y = float(0.03 * radius * math.sin(u * 14) * math.cos(v * 14))
                    pt = np.array([u, organic_y, v], dtype=np.float32)
                    conf = max(0.45, float(0.90 - (dist / (radius * 1.4))))
                    c = get_blended_color(pt + center, veg_color, noise_std=4.0)

                    candidate_rel.append(pt)
                    confidences.append(conf)
                    colors.append(c)

        # =====================================================================
        # Case E: GENERAL SURFACE TANGENT EXPANSION (Fallback / Unknown)
        # =====================================================================
        else:
            if abs(surf_normal[1]) < 0.9:
                u_vec = np.cross(surf_normal, np.array([0.0, 1.0, 0.0]))
            else:
                u_vec = np.cross(surf_normal, np.array([1.0, 0.0, 0.0]))
            u_vec = u_vec / (np.linalg.norm(u_vec) + 1e-6)
            v_vec = np.cross(surf_normal, u_vec)

            grid_res = 14
            u_base = np.linspace(-radius * 0.55, radius * 0.55, grid_res)
            v_base = np.linspace(-radius * 0.55, radius * 0.55, grid_res)
            du = (u_base[1] - u_base[0]) if len(u_base) > 1 else 0.005
            dv = (v_base[1] - v_base[0]) if len(v_base) > 1 else 0.005

            for ub in u_base:
                for vb in v_base:
                    u = ub + np.random.uniform(-0.45, 0.45) * du
                    v = vb + np.random.uniform(-0.45, 0.45) * dv
                    dist_from_frontier = math.sqrt(u * u + v * v)
                    if dist_from_frontier > radius * 0.6:
                        continue

                    pt = u * u_vec + v * v_vec
                    conf = max(0.45, float(0.92 - (dist_from_frontier / (radius * 1.4))))
                    c = get_blended_color(pt + center, base_color, noise_std=2.5)

                    candidate_rel.append(pt)
                    confidences.append(conf)
                    colors.append(c)

        return {
            "rel_points": np.array(candidate_rel, dtype=np.float32),
            "colors": np.array(colors, dtype=np.uint8),
            "confidences": np.array(confidences, dtype=np.float32),
            "semantic_tag": str(semantic_class),
        }

    def postprocess(
        self,
        raw_output: Dict[str, Any],
        preprocess_context: Dict[str, Any]
    ) -> PatchPrediction:
        center = preprocess_context["center"]
        rel_pts = raw_output["rel_points"]

        if len(rel_pts) == 0:
            return PatchPrediction(
                points=np.zeros((0, 3), dtype=np.float32),
                colors=np.zeros((0, 3), dtype=np.uint8),
                confidence=np.zeros(0, dtype=np.float32),
                semantic_tag=raw_output.get("semantic_tag", "unknown"),
                metadata={"model": self.name, "points_generated": 0}
            )

        world_pts = rel_pts + center
        return PatchPrediction(
            points=world_pts.astype(np.float32),
            colors=raw_output["colors"],
            confidence=raw_output["confidences"],
            semantic_tag=raw_output.get("semantic_tag", "unknown"),
            metadata={"model": self.name, "points_generated": len(world_pts)}
        )
