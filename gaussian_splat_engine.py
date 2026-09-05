"""
3D Gaussian Splatting Engine for Drone Photogrammetry & DUSt3R Integration
Converts dense neural 3D pointmaps, surface normals, and camera poses into
anisotropic 3D Gaussian Splats (.ply) and high-performance WebGL (.splat) models.
"""

import os
import struct
import math
import numpy as np
from typing import Tuple, Optional, Dict, List
from scipy.spatial import cKDTree


class GaussianSplatEngine:
    """Generates, optimizes, and exports anisotropic 3D Gaussian Splats from dense 3D points."""

    # Spherical Harmonics 0-th order basis constant
    SH_C0 = 0.28209479177387814

    @staticmethod
    def rgb_to_sh(rgb: np.ndarray) -> np.ndarray:
        """Converts RGB colors [0, 1] to 0-th order Spherical Harmonics DC coefficients."""
        return (rgb - 0.5) / GaussianSplatEngine.SH_C0

    @staticmethod
    def sh_to_rgb(sh: np.ndarray) -> np.ndarray:
        """Converts 0-th order Spherical Harmonics DC coefficients back to RGB [0, 1]."""
        return np.clip(sh * GaussianSplatEngine.SH_C0 + 0.5, 0.0, 1.0)

    @staticmethod
    def compute_local_covariance_and_normals(
        points: np.ndarray,
        k_neighbors: int = 12,
        anisotropy_ratio: float = 0.20,
        min_scale: float = 1e-4,
        max_scale: float = 0.45
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Computes anisotropic scales, orientations (quaternions), and surface normals
        for each 3D point using Principal Component Analysis (PCA) on local k-NN neighborhoods.
        
        Returns:
            scales: (N, 3) [s_tangent1, s_tangent2, s_normal]
            rotations: (N, 4) unit quaternions [w, x, y, z]
            normals: (N, 3) estimated unit surface normal vectors
        """
        N = len(points)
        tree = cKDTree(points)
        k = min(k_neighbors, max(4, N - 1))
        
        # Query k nearest neighbors
        dists, idxs = tree.query(points, k=k)
        
        scales = np.zeros((N, 3), dtype=np.float32)
        rotations = np.zeros((N, 4), dtype=np.float32)
        normals = np.zeros((N, 3), dtype=np.float32)
        
        # Default identity quaternion
        rotations[:, 0] = 1.0  # w = 1.0
        
        # Vectorized / batch PCA estimation for local neighborhoods
        neighbors = points[idxs]  # (N, k, 3)
        means = np.mean(neighbors, axis=1, keepdims=True)  # (N, 1, 3)
        centered = neighbors - means  # (N, k, 3)
        
        # Covariance matrices: (N, 3, 3)
        cov = np.matmul(centered.transpose(0, 2, 1), centered) / (k - 1)
        
        # Eigendecomposition of covariance matrices
        # eigh returns eigenvalues in ascending order and corresponding eigenvectors as columns
        eigenvalues, eigenvectors = np.linalg.eigh(cov)
        
        # Smallest eigenvalue corresponds to normal direction (axis 0)
        # Tangent directions correspond to axes 1 and 2
        for i in range(N):
            evals = eigenvalues[i]
            evecs = eigenvectors[i]
            
            # Mean distance to k nearest neighbors for base metric scale
            base_scale = np.mean(dists[i, 1:])
            base_scale = np.clip(base_scale, min_scale, max_scale)
            
            # Compute anisotropic scales
            # Tangential spread along surface vs thin normal thickness
            lambda_sum = evals.sum() + 1e-8
            rel_thickness = np.sqrt(max(1e-8, evals[0] / lambda_sum))
            thickness_factor = np.clip(rel_thickness * 2.0, anisotropy_ratio, 0.6)
            
            s_tangent1 = float(base_scale * 1.15)
            s_tangent2 = float(base_scale * 0.95)
            s_normal = float(base_scale * thickness_factor)
            
            scales[i] = [s_tangent1, s_tangent2, s_normal]
            
            # Normal vector is eigenvector for smallest eigenvalue
            norm_vec = evecs[:, 0]
            normals[i] = norm_vec
            
            # Rotation matrix from eigenvectors: [v_tangent1, v_tangent2, v_normal]
            R = np.column_stack([evecs[:, 2], evecs[:, 1], evecs[:, 0]])
            # Ensure proper right-handed coordinate system (det = +1)
            if np.linalg.det(R) < 0:
                R[:, 2] = -R[:, 2]
                
            # Convert 3x3 rotation matrix R to unit quaternion [w, x, y, z]
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
                
            quat = np.array([w, x, y, z], dtype=np.float32)
            norm_q = np.linalg.norm(quat)
            rotations[i] = quat / (norm_q if norm_q > 1e-6 else 1.0)
            
        return scales, rotations, normals

    @staticmethod
    def create_gaussians_from_points(
        points: np.ndarray,
        colors: np.ndarray,
        confidences: Optional[np.ndarray] = None,
        k_neighbors: int = 12,
        anisotropy: bool = True,
        min_scale: float = 1e-4,
        max_scale: float = 0.45,
        default_opacity: float = 0.90
    ) -> Dict[str, np.ndarray]:
        """
        Creates 3D Gaussians from a dense point cloud with anisotropic surface alignment.
        - Position: (N, 3)
        - Scale: (N, 3) estimated from local PCA eigenvectors/eigenvalues
        - Rotation: (N, 4) unit quaternions [w, x, y, z]
        - Opacity: (N, 1) confidence-weighted alpha
        - Spherical Harmonics: (N, 3) DC color coefficients
        """
        N = len(points)
        if N == 0:
            raise ValueError("Cannot create Gaussians from empty point set.")

        points = np.asarray(points, dtype=np.float32)
        colors = np.asarray(colors, dtype=np.float32)
        if colors.max() > 1.0:
            colors = colors / 255.0

        if confidences is not None:
            conf = np.asarray(confidences, dtype=np.float32).reshape(N, 1)
            # Map confidence into high opacity range [0.75, 0.98]
            opacities = np.clip(0.70 + 0.28 * conf, 0.50, 0.98).astype(np.float32)
        else:
            opacities = np.full((N, 1), default_opacity, dtype=np.float32)

        if anisotropy and N >= 4:
            scales, rotations, normals = GaussianSplatEngine.compute_local_covariance_and_normals(
                points=points,
                k_neighbors=k_neighbors,
                anisotropy_ratio=0.18,
                min_scale=min_scale,
                max_scale=max_scale
            )
        else:
            # Fallback to isotropic scales
            tree = cKDTree(points)
            k = min(4, max(2, N - 1))
            dists, _ = tree.query(points, k=k)
            mean_dists = np.mean(dists[:, 1:], axis=1, keepdims=True)
            mean_dists = np.clip(mean_dists, min_scale, max_scale)
            scales = np.repeat(mean_dists, 3, axis=1).astype(np.float32)
            rotations = np.zeros((N, 4), dtype=np.float32)
            rotations[:, 0] = 1.0
            normals = np.zeros((N, 3), dtype=np.float32)
            normals[:, 1] = 1.0

        # Spherical Harmonics DC coefficients from RGB
        sh_dc = GaussianSplatEngine.rgb_to_sh(colors).astype(np.float32)

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
        """
        Exports 3D Gaussians to standard binary PLY format compatible with 3DGS viewers (SIBR, SuperSplat, WebGL).
        """
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        positions = gaussians["positions"]
        scales = np.log(np.maximum(gaussians["scales"], 1e-6))  # 3DGS stores log(scale)
        rotations = gaussians["rotations"]
        
        # Inverse sigmoid for opacity: logit(alpha) = log(alpha / (1 - alpha))
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
        """
        Exports 3D Gaussians to fast WebGL .splat binary format (32 bytes per Gaussian).
        Format per splat:
        - 3x float32 position (12 bytes)
        - 3x float32 scale (12 bytes)
        - 4x uint8 RGBA color (4 bytes)
        - 4x uint8 normalized quaternion (4 bytes)
        """
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        positions = gaussians["positions"].astype(np.float32)
        scales = gaussians["scales"].astype(np.float32)
        colors = (np.clip(gaussians["colors"], 0.0, 1.0) * 255).astype(np.uint8)
        opacities = (np.clip(gaussians["opacities"], 0.0, 1.0) * 255).astype(np.uint8)
        
        # Pack RGBA
        rgba = np.hstack([colors, opacities]).astype(np.uint8)
        
        # Pack rotations to uint8 range [0, 255] for [-1, 1]
        rot_uint8 = ((gaussians["rotations"] * 127.5) + 128.0).clip(0, 255).astype(np.uint8)

        N = len(positions)
        with open(output_path, "wb") as f:
            for i in range(N):
                f.write(positions[i].tobytes())
                f.write(scales[i].tobytes())
                f.write(rgba[i].tobytes())
                f.write(rot_uint8[i].tobytes())

        return output_path
