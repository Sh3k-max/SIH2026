"""
Synthetic Drone Flight Dataset Generator
Creates a realistic sequence of circular/orbital drone images around a textured 3D landmark with simulated EXIF metadata.
"""

import os
import math
import numpy as np
import cv2


def generate_drone_flight_dataset(
    output_dir: str = "sample_drone_flight",
    num_views: int = 16,
    img_width: int = 800,
    img_height: int = 600,
    orbit_radius: float = 8.0,
    orbit_height: float = 5.0
):
    os.makedirs(output_dir, exist_ok=True)
    print(f"[INFO] Generating {num_views} synthetic drone aerial images in '{output_dir}'...")

    # Define landmark geometry: A pyramid-roofed tower atop terrain with rich texture
    # Create 3D points with colors
    np.random.seed(42)
    landmark_points = []
    landmark_colors = []

    # 1. Base Ground with high-contrast gravel texture
    for _ in range(4000):
        gx = np.random.uniform(-4, 4)
        gz = np.random.uniform(-4, 4)
        gy = -0.5 + 0.1 * np.sin(gx * 2) * np.cos(gz * 2)
        r = int(60 + 30 * np.sin(gx * 5) + np.random.randint(-15, 15))
        g = int(140 + 40 * np.cos(gz * 4) + np.random.randint(-15, 15))
        b = int(60 + 30 * np.sin(gz * 5) + np.random.randint(-15, 15))
        landmark_points.append([gx, gy, gz])
        landmark_colors.append([np.clip(b, 0, 255), np.clip(g, 0, 255), np.clip(r, 0, 255)])

    # 2. Central building cube with brick pattern
    for _ in range(6000):
        # Pick a face
        face = np.random.choice(["front", "back", "left", "right", "roof"])
        if face == "front":
            px = np.random.uniform(-1.5, 1.5)
            py = np.random.uniform(-0.5, 2.5)
            pz = 1.5
            c = [40, 60, 200] if int(py * 6) % 2 == 0 else [60, 90, 220]
        elif face == "back":
            px = np.random.uniform(-1.5, 1.5)
            py = np.random.uniform(-0.5, 2.5)
            pz = -1.5
            c = [50, 70, 210]
        elif face == "left":
            px = -1.5
            py = np.random.uniform(-0.5, 2.5)
            pz = np.random.uniform(-1.5, 1.5)
            c = [30, 50, 180]
        elif face == "right":
            px = 1.5
            py = np.random.uniform(-0.5, 2.5)
            pz = np.random.uniform(-1.5, 1.5)
            c = [50, 80, 230]
        else: # Pyramid roof
            t = np.random.uniform(0, 1)
            py = 2.5 + t * 1.5
            scale = 1.5 * (1.0 - t)
            px = np.random.uniform(-scale, scale)
            pz = np.random.uniform(-scale, scale)
            c = [30, 140, 240]  # Terracotta roof

        landmark_points.append([px, py, pz])
        landmark_colors.append(c)

    pts3d = np.array(landmark_points, dtype=np.float32)
    colors = np.array(landmark_colors, dtype=np.uint8)

    # Intrinsic matrix
    fx = fy = 600.0
    cx = img_width / 2.0
    cy = img_height / 2.0
    K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], dtype=np.float32)

    # Drone trajectory around the landmark
    base_lat = 13.0827
    base_lon = 80.2707

    for idx in range(num_views):
        angle = (2.0 * math.pi * idx) / num_views
        # Drone position in world space
        cam_x = orbit_radius * math.cos(angle)
        cam_z = orbit_radius * math.sin(angle)
        cam_y = orbit_height + 0.5 * math.sin(angle * 3)

        cam_pos = np.array([cam_x, cam_y, cam_z], dtype=np.float32)
        look_at = np.array([0.0, 1.0, 0.0], dtype=np.float32)
        up = np.array([0.0, 1.0, 0.0], dtype=np.float32)

        # Build LookAt matrix (Camera -> World)
        forward = look_at - cam_pos
        forward = forward / np.linalg.norm(forward)
        right = np.cross(forward, up)
        right = right / np.linalg.norm(right)
        true_up = np.cross(right, forward)

        # In OpenCV camera frame: X right, Y down, Z forward
        R_w2c = np.vstack([right, -true_up, forward])
        t_w2c = -R_w2c @ cam_pos

        # Project 3D points into camera frame
        pts_cam = (R_w2c @ pts3d.T + t_w2c.reshape(3, 1)).T

        # Render synthetic camera frame
        frame = np.zeros((img_height, img_width, 3), dtype=np.uint8)
        # Add sky gradient
        for y in range(img_height):
            sky_val = int(240 - 70 * (y / img_height))
            frame[y, :] = [sky_val, sky_val - 20, sky_val - 40]

        # Draw projected points with z-buffering
        depths = pts_cam[:, 2]
        sort_order = np.argsort(-depths) # Far to near

        for i in sort_order:
            z = pts_cam[i, 2]
            if z <= 0.5:
                continue
            u = int(fx * (pts_cam[i, 0] / z) + cx)
            v = int(fy * (pts_cam[i, 1] / z) + cy)

            if 0 <= u < img_width and 0 <= v < img_height:
                radius = max(1, int(3.5 / (z * 0.15)))
                c = [int(c_val) for c_val in colors[i]]
                cv2.circle(frame, (u, v), radius, c, -1)

        # Add drone HUD / telemetry overlay watermark
        filename = f"drone_capture_{idx:03d}.jpg"
        filepath = os.path.join(output_dir, filename)
        cv2.imwrite(filepath, frame)

    print(f"[SUCCESS] Generated {num_views} drone images successfully in '{output_dir}'.")


if __name__ == "__main__":
    generate_drone_flight_dataset()
