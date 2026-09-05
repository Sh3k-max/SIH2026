"""
Module: Scene & Asset Exporter
Exports standard 3D assets: dense PLY point clouds, 3DGS binary PLY & SPLAT,
geometry OBJ/PLY, camera trajectories, coverage analysis, and scene metadata.
"""

import os
import json
import numpy as np
from typing import Dict, List, Optional
from gaussian_splatting import GaussianSplattingEngine


from surface_mesher import SurfaceMesher


class SceneExporter:
    """Exports structured photogrammetry & Gaussian Splatting assets into standard directories."""

    @staticmethod
    def export_all_assets(
        output_dir: str,
        points: np.ndarray,
        colors: np.ndarray,
        normals: np.ndarray,
        confidences: np.ndarray,
        camera_poses: List[Dict],
        coverage_stats: Dict,
        metadata_extra: Optional[Dict] = None
    ) -> Dict[str, str]:
        """
        Exports all reconstructed assets into structured folders.
        Returns dictionary of exported file paths.
        """
        # Create standard folders
        dirs = {
            "pointcloud": os.path.join(output_dir, "pointcloud"),
            "gaussians": os.path.join(output_dir, "gaussians"),
            "geometry": os.path.join(output_dir, "geometry"),
            "poses": os.path.join(output_dir, "poses"),
            "coverage": os.path.join(output_dir, "coverage"),
            "metadata": os.path.join(output_dir, "metadata"),
        }
        for d in dirs.values():
            os.makedirs(d, exist_ok=True)

        # 1. Generate Continuous 3D Mesh with Solid Triangle Faces
        mesh_data = SurfaceMesher.generate_continuous_mesh(
            points=points,
            colors=colors,
            normals=normals,
            extend_terrain=False
        )
        m_verts = mesh_data["vertices"]
        m_cols = mesh_data["colors"]
        m_norms = mesh_data["normals"]
        m_faces = mesh_data["faces"]

        obj_path = os.path.join(dirs["geometry"], "mesh.obj")
        with open(obj_path, "w", encoding="utf-8") as f:
            f.write("# Game-Ready Continuous 3D World Geometry\n")
            f.write(f"# Vertices: {len(m_verts)}\n")
            f.write(f"# Faces: {len(m_faces)}\n")
            for p, c in zip(m_verts, m_cols):
                f.write(f"v {p[0]:.5f} {p[1]:.5f} {p[2]:.5f} {c[0]:.4f} {c[1]:.4f} {c[2]:.4f}\n")
            for n in m_norms:
                f.write(f"vn {n[0]:.4f} {n[1]:.4f} {n[2]:.4f}\n")
            for face in m_faces:
                f.write(f"f {face[0]+1}//{face[0]+1} {face[1]+1}//{face[1]+1} {face[2]+1}//{face[2]+1}\n")

        # Binary Mesh PLY with Triangle Faces
        mesh_ply_path = os.path.join(dirs["geometry"], "mesh.ply")
        if len(m_faces) > 0:
            nV = len(m_verts)
            nF = len(m_faces)
            h_mesh_ply = (
                "ply\n"
                "format binary_little_endian 1.0\n"
                f"element vertex {nV}\n"
                "property float x\n"
                "property float y\n"
                "property float z\n"
                "property float nx\n"
                "property float ny\n"
                "property float nz\n"
                "property uchar red\n"
                "property uchar green\n"
                "property uchar blue\n"
                f"element face {nF}\n"
                "property list uchar int vertex_indices\n"
                "end_header\n"
            )
            cols_m_u8 = (np.clip(m_cols, 0.0, 1.0) * 255).astype(np.uint8)
            d_v = np.empty(nV, dtype=[
                ("x", "f4"), ("y", "f4"), ("z", "f4"),
                ("nx", "f4"), ("ny", "f4"), ("nz", "f4"),
                ("red", "u1"), ("green", "u1"), ("blue", "u1")
            ])
            d_v["x"] = m_verts[:, 0]
            d_v["y"] = m_verts[:, 1]
            d_v["z"] = m_verts[:, 2]
            d_v["nx"] = m_norms[:, 0]
            d_v["ny"] = m_norms[:, 1]
            d_v["nz"] = m_norms[:, 2]
            d_v["red"] = cols_m_u8[:, 0]
            d_v["green"] = cols_m_u8[:, 1]
            d_v["blue"] = cols_m_u8[:, 2]

            d_f = np.empty(nF, dtype=[("nverts", "u1"), ("i0", "i4"), ("i1", "i4"), ("i2", "i4")])
            d_f["nverts"] = 3
            d_f["i0"] = m_faces[:, 0]
            d_f["i1"] = m_faces[:, 1]
            d_f["i2"] = m_faces[:, 2]

            with open(mesh_ply_path, "wb") as f:
                f.write(h_mesh_ply.encode("ascii"))
                f.write(d_v.tobytes())
                f.write(d_f.tobytes())

        # 2. Export Dense Point Cloud PLY
        dense_ply_path = os.path.join(dirs["pointcloud"], "dense.ply")
        N = len(points)
        header_ply = (
            "ply\n"
            "format binary_little_endian 1.0\n"
            f"element vertex {N}\n"
            "property float x\n"
            "property float y\n"
            "property float z\n"
            "property float nx\n"
            "property float ny\n"
            "property float nz\n"
            "property uchar red\n"
            "property uchar green\n"
            "property uchar blue\n"
            "property float confidence\n"
            "end_header\n"
        )
        cols_u8 = (np.clip(colors, 0.0, 1.0) * 255).astype(np.uint8)
        dtype_ply = [
            ("x", "f4"), ("y", "f4"), ("z", "f4"),
            ("nx", "f4"), ("ny", "f4"), ("nz", "f4"),
            ("red", "u1"), ("green", "u1"), ("blue", "u1"),
            ("confidence", "f4")
        ]
        data_ply = np.empty(N, dtype=dtype_ply)
        data_ply["x"] = points[:, 0]
        data_ply["y"] = points[:, 1]
        data_ply["z"] = points[:, 2]
        data_ply["nx"] = normals[:, 0]
        data_ply["ny"] = normals[:, 1]
        data_ply["nz"] = normals[:, 2]
        data_ply["red"] = cols_u8[:, 0]
        data_ply["green"] = cols_u8[:, 1]
        data_ply["blue"] = cols_u8[:, 2]
        data_ply["confidence"] = confidences

        with open(dense_ply_path, "wb") as f:
            f.write(header_ply.encode("ascii"))
            f.write(data_ply.tobytes())

        # 3. Export 3D Gaussian Splats (.ply and .splat)
        gaussians = GaussianSplattingEngine.create_gaussians(
            points=points,
            colors=colors,
            confidences=confidences
        )
        gs_ply_path = os.path.join(dirs["gaussians"], "scene.ply")
        gs_splat_path = os.path.join(dirs["gaussians"], "scene.splat")
        GaussianSplattingEngine.export_ply(gaussians, gs_ply_path)
        GaussianSplattingEngine.export_splat(gaussians, gs_splat_path)

        # 4. Export Camera Poses
        cameras_json_path = os.path.join(dirs["poses"], "cameras.json")
        with open(cameras_json_path, "w", encoding="utf-8") as f:
            json.dump(camera_poses, f, indent=2)

        # 5. Export Coverage Analysis
        coverage_json_path = os.path.join(dirs["coverage"], "coverage.json")
        with open(coverage_json_path, "w", encoding="utf-8") as f:
            json.dump({
                "high_count": coverage_stats.get("high_count", 0),
                "med_count": coverage_stats.get("med_count", 0),
                "low_count": coverage_stats.get("low_count", 0),
                "high_pct": coverage_stats.get("high_pct", 0.0),
                "med_pct": coverage_stats.get("med_pct", 0.0),
                "low_pct": coverage_stats.get("low_pct", 0.0),
                "overall_coverage": coverage_stats.get("overall_coverage", 0.0)
            }, f, indent=2)

        # 6. Export Master Scene Metadata
        clean_cov = {
            "high_count": int(coverage_stats.get("high_count", 0)),
            "med_count": int(coverage_stats.get("med_count", 0)),
            "low_count": int(coverage_stats.get("low_count", 0)),
            "high_pct": float(coverage_stats.get("high_pct", 0.0)),
            "med_pct": float(coverage_stats.get("med_pct", 0.0)),
            "low_pct": float(coverage_stats.get("low_pct", 0.0)),
            "overall_coverage": float(coverage_stats.get("overall_coverage", 0.0))
        }

        scene_json_path = os.path.join(dirs["metadata"], "scene.json")
        scene_meta = {
            "coordinate_system": "Right-Handed (+Y Up, Y=0 Ground)",
            "total_points": len(points),
            "camera_views_count": len(camera_poses),
            "bounding_box": {
                "min": points.min(axis=0).tolist(),
                "max": points.max(axis=0).tolist(),
                "center": points.mean(axis=0).tolist()
            },
            "coverage": clean_cov,
            "assets": {
                "mesh_obj": os.path.relpath(obj_path, output_dir),
                "dense_ply": os.path.relpath(dense_ply_path, output_dir),
                "gaussian_ply": os.path.relpath(gs_ply_path, output_dir),
                "gaussian_splat": os.path.relpath(gs_splat_path, output_dir),
                "cameras_json": os.path.relpath(cameras_json_path, output_dir),
                "coverage_json": os.path.relpath(coverage_json_path, output_dir)
            }
        }
        if metadata_extra:
            scene_meta.update(metadata_extra)

        with open(scene_json_path, "w", encoding="utf-8") as f:
            json.dump(scene_meta, f, indent=2)

        return {
            "mesh_obj": obj_path,
            "dense_ply": dense_ply_path,
            "gaussian_ply": gs_ply_path,
            "gaussian_splat": gs_splat_path,
            "cameras_json": cameras_json_path,
            "coverage_json": coverage_json_path,
            "scene_json": scene_json_path
        }
