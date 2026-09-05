"""
Equirectangular 360 to Multi-Perspective Projection Engine
Converts spherical (equirectangular) drone frames into 6 tangent virtual perspective camera views:
- Front (0 deg yaw)
- Right (+90 deg yaw)
- Back (180 deg yaw)
- Left (-90 deg yaw)
- Up (+90 deg pitch)
- Down (-90 deg pitch)
Optimized with vector lookup maps for rapid real-time processing.
"""

import os
import cv2
import numpy as np
from typing import Dict, List, Tuple


class EquirectangularProjector:
    def __init__(self, out_size: int = 512, fov_deg: float = 90.0):
        self.out_size = out_size
        self.fov_deg = fov_deg
        self.fov_rad = np.radians(fov_deg)
        self.focal = 0.5 * out_size / np.tan(0.5 * self.fov_rad)

    def _get_pixel_rays(self) -> np.ndarray:
        """Generates normalized 3D ray vectors for every pixel in a perspective view."""
        cx = (self.out_size - 1) / 2.0
        cy = (self.out_size - 1) / 2.0
        u = np.arange(self.out_size) - cx
        v = np.arange(self.out_size) - cy
        uu, vv = np.meshgrid(u, v)
        zz = np.full_like(uu, self.focal)

        rays = np.stack([uu, -vv, zz], axis=-1)
        norm = np.linalg.norm(rays, axis=-1, keepdims=True)
        return rays / norm

    def project_perspective(
        self,
        equirect_img: np.ndarray,
        yaw_deg: float,
        pitch_deg: float,
        roll_deg: float = 0.0
    ) -> np.ndarray:
        """
        Extracts a virtual pinhole camera view from an equirectangular 360 image
        at a specific rotation (yaw, pitch, roll).
        """
        h_eq, w_eq = equirect_img.shape[:2]
        rays = self._get_pixel_rays()

        # Rotation matrices
        yaw = np.radians(yaw_deg)
        pitch = np.radians(pitch_deg)
        roll = np.radians(roll_deg)

        R_yaw = np.array([
            [np.cos(yaw), 0, np.sin(yaw)],
            [0, 1, 0],
            [-np.sin(yaw), 0, np.cos(yaw)]
        ])
        R_pitch = np.array([
            [1, 0, 0],
            [0, np.cos(pitch), -np.sin(pitch)],
            [0, np.sin(pitch), np.cos(pitch)]
        ])
        R_roll = np.array([
            [np.cos(roll), -np.sin(roll), 0],
            [np.sin(roll), np.cos(roll), 0],
            [0, 0, 1]
        ])
        R = R_yaw @ R_pitch @ R_roll

        # Rotate rays
        rot_rays = rays @ R.T

        # Convert Cartesian (x, y, z) to spherical (longitude, latitude)
        x = rot_rays[..., 0]
        y = rot_rays[..., 1]
        z = rot_rays[..., 2]

        lon = np.arctan2(x, z)  # [-pi, pi]
        lat = np.arcsin(np.clip(y, -1.0, 1.0))  # [-pi/2, pi/2]

        # Map to equirectangular pixel coordinates
        map_x = ((lon + np.pi) / (2 * np.pi) * (w_eq - 1)).astype(np.float32)
        map_y = ((np.pi / 2 - lat) / np.pi * (h_eq - 1)).astype(np.float32)

        # Bilinear remap
        perspective_img = cv2.remap(
            equirect_img, map_x, map_y,
            interpolation=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_WRAP
        )
        return perspective_img

    def extract_cubemap_views(
        self,
        equirect_img: np.ndarray,
        output_dir: str,
        base_name: str
    ) -> List[Dict]:
        """
        Extracts 6 orthogonal camera directions from a single 360 frame:
        Front, Right, Back, Left, Up, Down.
        """
        os.makedirs(output_dir, exist_ok=True)
        directions = [
            {"name": "front", "yaw": 0.0, "pitch": 0.0, "icon": "⬆️"},
            {"name": "right", "yaw": 90.0, "pitch": 0.0, "icon": "➡️"},
            {"name": "back", "yaw": 180.0, "pitch": 0.0, "icon": "⬇️"},
            {"name": "left", "yaw": -90.0, "pitch": 0.0, "icon": "⬅️"},
            {"name": "up", "yaw": 0.0, "pitch": 90.0, "icon": "⛅"},
            {"name": "down", "yaw": 0.0, "pitch": -90.0, "icon": "🛬"}
        ]

        extracted = []
        for d in directions:
            persp = self.project_perspective(
                equirect_img,
                yaw_deg=d["yaw"],
                pitch_deg=d["pitch"]
            )
            out_filename = f"{base_name}_{d['name']}.jpg"
            out_filepath = os.path.join(output_dir, out_filename)
            cv2.imwrite(out_filepath, persp, [cv2.IMWRITE_JPEG_QUALITY, 95])

            extracted.append({
                "view": d["name"],
                "yaw": d["yaw"],
                "pitch": d["pitch"],
                "fov": self.fov_deg,
                "filename": out_filename,
                "file_url": f"/output/cubemap_views/{out_filename}",
                "icon": d["icon"]
            })

        return extracted
