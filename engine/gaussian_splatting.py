"""
Module: Anisotropic 3D Gaussian Splatting Engine
Synthesizes anisotropic 3D Gaussians from dense 3D points, surface normals, and camera poses.
Derives surface-tangent aligned scale matrices and normal-aligned unit quaternions.
Exports standard binary 3DGS PLY and high-performance WebGL .splat formats.
"""

import os
import math
import numpy as np
from typing import Tuple, Optional, Dict
from scipy.spatial import cKDTree


class GaussianSplattingEngine:
    """Generates and exports anisotropic 3D Gaussian Splats from real photogrammetry points."""

    SH_C0 = 0.28209479177387814

    @staticmethod
    def rgb_to_sh(rgb: np.ndarray) -> np.ndarray:
        """Converts RGB in [0, 1] to 0-th order Spherical Harmonics DC coefficients."""
        return (rgb - 0.5) / GaussianSplattingEngine.SH_C0

    @staticmethod
    def compute_anisotropic_covariance(
        points: np.ndarray,
        k_neighbors: int = 12,
        anisotropy_ratio: float = 0.18,
        min_scale: float = 1e-4,
        max_scale: float = 0.50
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Computes PCA local neighborhood covariance for each point to derive:
        - Anisotropic scales [s_tangent1, s_tangent2, s_normal] (s_normal << s_tangent)
        - Normal-aligned unit quaternions [w, x, y, z]
        - Estimated surface normals
        """
        N = len(points)
        tree = cKDTree(points)
        k = min(k_neighbors, max(4, N - 1))
        dists, idxs = tree.query(points, k=k)

        scales = np.zeros((N, 3), dtype=np.float32)
        rotations = np.zeros((N, 4), dtype=np.float32)
        normals = np.zeros((N, 3), dtype=np.float32)

        neighbors = points[idxs]
        means = np.mean(neighbors, axis=1, keepdims=True)
        centered = neighbors - means

        cov = np.matmul(centered.transpose(0, 2, 1), centered) / (k - 1)
        eigenvalues, eigenvectors = np.linalg.eigh(cov)

        for i in range(N):
            evals = eigenvalues[i]
            evecs = eigenvectors[i]

            base_scale = float(np.mean(dists[i, 1:]))
            base_scale = np.clip(base_scale, min_scale, max_scale)

            lambda_sum = evals.sum() + 1e-8
            rel_thickness = math.sqrt(max(1e-8, evals[0] / lambda_sum))
            thickness = float(np.clip(rel_thickness * 2.0, anisotropy_ratio, 0.55))

            s_tangent1 = base_scale * 1.15
            s_tangent2 = base_scale * 0.95
            s_normal = base_scale * thickness

            scales[i] = [s_tangent1, s_tangent2, s_normal]
            normals[i] = evecs[:, 0]

            # 3x3 Rotation matrix [v_tangent1, v_tangent2, v_normal]
            R = np.column_stack([evecs[:, 2], evecs[:, 1], evecs[:, 0]])
            if np.linalg.det(R) < 0:
                R[:, 2] = -R[:, 2]

            # Convert to unit quaternion [w, x, y, z]
            trace = R[0, 0] + R[1, 1] + R[2, 2]
            if trace > 0:
                s = 0.5 / math.sqrt(trace + 1.0)
                w = 0.25 / s
                x = (R[2, 1] - R[1, 2]) * s
                y = (R[0, 2] - R[2, 0]) * s
                z = (R[1, 0] - R[0, 1]) * s
            elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
                s = 2.0 * math.sqrt(max(1e-8, 1.0 + R[0, 0] - R[1, 1] - R[2, 2]))
                w = (R[2, 1] - R[1, 2]) / s
                x = 0.25 * s
                y = (R[0, 1] + R[1, 0]) / s
                z = (R[0, 2] + R[2, 0]) / s
            elif R[1, 1] > R[2, 2]:
                s = 2.0 * math.sqrt(max(1e-8, 1.0 + R[1, 1] - R[0, 0] - R[2, 2]))
                w = (R[0, 2] - R[2, 0]) / s
                x = (R[0, 1] + R[1, 0]) / s
                y = 0.25 * s
                z = (R[1, 2] + R[2, 1]) / s
            else:
                s = 2.0 * math.sqrt(max(1e-8, 1.0 + R[2, 2] - R[0, 0] - R[1, 1]))
                w = (R[1, 0] - R[0, 1]) / s
                x = (R[0, 2] + R[2, 0]) / s
                y = (R[1, 2] + R[2, 1]) / s
                z = 0.25 * s

            q = np.array([w, x, y, z], dtype=np.float32)
            rotations[i] = q / max(1e-6, np.linalg.norm(q))

        return scales, rotations, normals

    @staticmethod
    def create_gaussians(
        points: np.ndarray,
        colors: np.ndarray,
        confidences: Optional[np.ndarray] = None,
        k_neighbors: int = 12
    ) -> Dict[str, np.ndarray]:
        """Creates anisotropic 3D Gaussians from points, colors, and confidences."""
        N = len(points)
        if N == 0:
            raise ValueError("Cannot create 3D Gaussians from empty point set.")

        points = np.asarray(points, dtype=np.float32)
        colors = np.asarray(colors, dtype=np.float32)
        if colors.max() > 1.0:
            colors = colors / 255.0

        if confidences is not None:
            conf = np.asarray(confidences, dtype=np.float32).reshape(N, 1)
            opacities = np.clip(0.70 + 0.28 * conf, 0.50, 0.98).astype(np.float32)
        else:
            opacities = np.full((N, 1), 0.90, dtype=np.float32)

        scales, rotations, normals = GaussianSplattingEngine.compute_anisotropic_covariance(
            points=points,
            k_neighbors=k_neighbors
        )

        sh_dc = GaussianSplattingEngine.rgb_to_sh(colors).astype(np.float32)

        return {
            "positions": points,
            "scales": scales,
            "rotations": rotations,
            "normals": normals,
            "opacities": opacities,
            "sh_dc": sh_dc,
            "colors": colors,
            "count": N
        }

    @staticmethod
    def export_ply(gaussians: Dict[str, np.ndarray], output_path: str) -> str:
        """Exports 3D Gaussians to standard binary PLY format."""
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        positions = gaussians["positions"]
        scales = np.log(np.maximum(gaussians["scales"], 1e-6))
        rotations = gaussians["rotations"]
        
        alpha = np.clip(gaussians["opacities"], 1e-4, 1.0 - 1e-4)
        opacities = np.log(alpha / (1.0 - alpha))
        sh_dc = gaussians["sh_dc"]
        normals = gaussians.get("normals", np.zeros_like(positions))
        N = len(positions)

        header = (
            "ply\n"
            "format binary_little_endian 1.0\n"
            f"element vertex {N}\n"
            "property float x\n"
            "property float y\n"
            "property float z\n"
            "property float nx\n"
            "property float ny\n"
            "property float nz\n"
            "property float f_dc_0\n"
            "property float f_dc_1\n"
            "property float f_dc_2\n"
            "property float opacity\n"
            "property float scale_0\n"
            "property float scale_1\n"
            "property float scale_2\n"
            "property float rot_0\n"
            "property float rot_1\n"
            "property float rot_2\n"
            "property float rot_3\n"
            "end_header\n"
        )

        dtype = [
            ("x", "f4"), ("y", "f4"), ("z", "f4"),
            ("nx", "f4"), ("ny", "f4"), ("nz", "f4"),
            ("f_dc_0", "f4"), ("f_dc_1", "f4"), ("f_dc_2", "f4"),
            ("opacity", "f4"),
            ("scale_0", "f4"), ("scale_1", "f4"), ("scale_2", "f4"),
            ("rot_0", "f4"), ("rot_1", "f4"), ("rot_2", "f4"), ("rot_3", "f4"),
        ]

        data = np.empty(N, dtype=dtype)
        data["x"] = positions[:, 0]
        data["y"] = positions[:, 1]
        data["z"] = positions[:, 2]
        data["nx"] = normals[:, 0]
        data["ny"] = normals[:, 1]
        data["nz"] = normals[:, 2]
        data["f_dc_0"] = sh_dc[:, 0]
        data["f_dc_1"] = sh_dc[:, 1]
        data["f_dc_2"] = sh_dc[:, 2]
        data["opacity"] = opacities[:, 0]
        data["scale_0"] = scales[:, 0]
        data["scale_1"] = scales[:, 1]
        data["scale_2"] = scales[:, 2]
        data["rot_0"] = rotations[:, 0]
        data["rot_1"] = rotations[:, 1]
        data["rot_2"] = rotations[:, 2]
        data["rot_3"] = rotations[:, 3]

        with open(output_path, "wb") as f:
            f.write(header.encode("ascii"))
            f.write(data.tobytes())

        return output_path

    @staticmethod
    def export_splat(gaussians: Dict[str, np.ndarray], output_path: str) -> str:
        """Exports 3D Gaussians to fast WebGL .splat binary format (32 bytes per splat)."""
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        positions = gaussians["positions"].astype(np.float32)
        scales = gaussians["scales"].astype(np.float32)
        colors = (np.clip(gaussians["colors"], 0.0, 1.0) * 255).astype(np.uint8)
        opacities = (np.clip(gaussians["opacities"], 0.0, 1.0) * 255).astype(np.uint8)

        rgba = np.hstack([colors, opacities]).astype(np.uint8)
        rot_uint8 = ((gaussians["rotations"] * 127.5) + 128.0).clip(0, 255).astype(np.uint8)

        N = len(positions)
        with open(output_path, "wb") as f:
            for i in range(N):
                f.write(positions[i].tobytes())
                f.write(scales[i].tobytes())
                f.write(rgba[i].tobytes())
                f.write(rot_uint8[i].tobytes())

        return output_path
