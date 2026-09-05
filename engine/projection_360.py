"""
Module: 360° Tangent Perspective Projection
Converts 360° equirectangular panoramic video frames into calibrated tangent perspective camera rigs
with rigorous pinhole camera intrinsics (fx, fy, cx, cy) for multi-view stereo and feature matching.
"""

import os
import math
import numpy as np
import cv2
from typing import List, Dict, Tuple, Optional


class EquirectangularProjector:
    """Projects 360° equirectangular images to calibrated perspective pinhole camera views."""

    @staticmethod
    def compute_pinhole_intrinsics(fov_deg: float, out_width: int, out_height: int) -> np.ndarray:
        """Computes 3x3 camera intrinsics matrix K from horizontal Field of View (FoV)."""
        fov_rad = math.radians(fov_deg)
        fx = (out_width / 2.0) / math.tan(fov_rad / 2.0)
        fy = (out_height / 2.0) / math.tan(fov_rad / 2.0)
        cx = out_width / 2.0
        cy = out_height / 2.0
        
        K = np.array([
            [fx, 0.0, cx],
            [0.0, fy, cy],
            [0.0, 0.0, 1.0]
        ], dtype=np.float64)
        return K

    @staticmethod
    def extract_perspective_view(
        equirect_img: np.ndarray,
        yaw_deg: float,
        pitch_deg: float,
        roll_deg: float = 0.0,
        fov_deg: float = 90.0,
        out_w: int = 512,
        out_h: int = 512
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Unwarps equirectangular image into a single calibrated perspective pinhole camera view.
        Returns: (perspective_rgb_image, 3x3_intrinsics_matrix_K)
        """
        H_eq, W_eq = equirect_img.shape[:2]
        K = EquirectangularProjector.compute_pinhole_intrinsics(fov_deg, out_w, out_h)
        fx = K[0, 0]
        fy = K[1, 1]
        cx = K[0, 2]
        cy = K[1, 2]

        # 1. Pixel grid for output perspective image
        u, v = np.meshgrid(np.arange(out_w, dtype=np.float32), np.arange(out_h, dtype=np.float32))

        # 2. Ray directions in camera coordinate frame (Z forward, X right, Y down)
        x_c = (u - cx) / fx
        y_c = (v - cy) / fy
        z_c = np.ones_like(x_c)

        rays = np.stack([x_c, y_c, z_c], axis=-1)  # (out_h, out_w, 3)
        rays_norm = rays / np.linalg.norm(rays, axis=-1, keepdims=True)

        # 3. Rotation matrix for yaw, pitch, roll
        yaw = math.radians(yaw_deg)
        pitch = math.radians(pitch_deg)
        roll = math.radians(roll_deg)

        R_yaw = np.array([
            [math.cos(yaw), 0, math.sin(yaw)],
            [0, 1, 0],
            [-math.sin(yaw), 0, math.cos(yaw)]
        ])
        R_pitch = np.array([
            [1, 0, 0],
            [0, math.cos(pitch), -math.sin(pitch)],
            [0, math.sin(pitch), math.cos(pitch)]
        ])
        R_roll = np.array([
            [math.cos(roll), -math.sin(roll), 0],
            [math.sin(roll), math.cos(roll), 0],
            [0, 0, 1]
        ])
        R = R_yaw @ R_pitch @ R_roll

        # Rotate rays into world equirectangular coordinates
        rays_world = np.matmul(rays_norm, R.T)

        # 4. Convert 3D world rays to spherical longitude (theta) and latitude (phi)
        x_w = rays_world[..., 0]
        y_w = rays_world[..., 1]
        z_w = rays_world[..., 2]

        # Longitude in [-pi, pi], Latitude in [-pi/2, pi/2]
        theta = np.arctan2(x_w, z_w)
        phi = np.arcsin(np.clip(-y_w, -1.0, 1.0))

        # 5. Map spherical coordinates to equirectangular pixel coordinates
        map_x = ((theta / (2.0 * np.pi)) + 0.5) * W_eq
        map_y = (0.5 - (phi / np.pi)) * H_eq

        map_x = np.clip(map_x, 0, W_eq - 1).astype(np.float32)
        map_y = np.clip(map_y, 0, H_eq - 1).astype(np.float32)

        # Remap using bilinear interpolation
        perspective_img = cv2.remap(
            equirect_img,
            map_x,
            map_y,
            interpolation=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_WRAP
        )

        return perspective_img, K

    @staticmethod
    def project_frame_to_tangent_rig(
        frame_meta: Dict,
        output_dir: str,
        fov_deg: float = 90.0,
        out_dim: int = 512
    ) -> List[Dict]:
        """
        Projects a single 360° frame into 6 orthogonal tangent perspective camera views:
        - Front (yaw=0, pitch=0)
        - Right (yaw=90, pitch=0)
        - Back  (yaw=180, pitch=0)
        - Left  (yaw=-90, pitch=0)
        - Up    (yaw=0, pitch=60)
        - Down  (yaw=0, pitch=-60)
        """
        os.makedirs(output_dir, exist_ok=True)
        frame_path = frame_meta["file_path"]
        frame_id = frame_meta["frame_id"]

        equirect_img = cv2.imread(frame_path)
        if equirect_img is None:
            raise IOError(f"Could not read frame from {frame_path}")

        H, W = equirect_img.shape[:2]
        aspect_ratio = W / float(H)

        # If standard perspective video (e.g. 16:9, 4:3, or < 1.9 aspect ratio)
        if aspect_ratio < 1.9:
            # Native calibrated perspective camera
            K = EquirectangularProjector.compute_pinhole_intrinsics(fov_deg=78.0, out_width=W, out_height=H)
            out_filename = f"frame_{frame_id:04d}_front.jpg"
            out_filepath = os.path.join(output_dir, out_filename)
            cv2.imwrite(out_filepath, equirect_img, [cv2.IMWRITE_JPEG_QUALITY, 95])

            return [{
                "parent_frame_id": frame_id,
                "view_name": "front",
                "yaw_deg": 0.0,
                "pitch_deg": 0.0,
                "fov_deg": 78.0,
                "file_path": out_filepath,
                "intrinsics_K": K.tolist(),
                "width": W,
                "height": H
            }]

        # Equirectangular 360° spherical projection to 6 tangent perspective views
        rig_angles = [
            ("front", 0.0, 0.0),
            ("right", 90.0, 0.0),
            ("back", 180.0, 0.0),
            ("left", -90.0, 0.0),
            ("up", 0.0, 50.0),
            ("down", 0.0, -50.0)
        ]

        tangent_views = []
        for name, yaw, pitch in rig_angles:
            view_img, K = EquirectangularProjector.extract_perspective_view(
                equirect_img=equirect_img,
                yaw_deg=yaw,
                pitch_deg=pitch,
                fov_deg=fov_deg,
                out_w=out_dim,
                out_h=out_dim
            )

            out_filename = f"frame_{frame_id:04d}_{name}.jpg"
            out_filepath = os.path.join(output_dir, out_filename)
            cv2.imwrite(out_filepath, view_img, [cv2.IMWRITE_JPEG_QUALITY, 95])

            tangent_views.append({
                "parent_frame_id": frame_id,
                "view_name": name,
                "yaw_deg": yaw,
                "pitch_deg": pitch,
                "fov_deg": fov_deg,
                "file_path": out_filepath,
                "intrinsics_K": K.tolist(),
                "width": out_dim,
                "height": out_dim
            })

        return tangent_views
