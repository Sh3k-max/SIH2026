"""
Video to 3D World Reconstruction Pipeline
Converts a drone/handheld video into a clean 3D neural world model with 3D Gaussian Splatting and Geofencing.
"""

import os
import sys
import argparse
import time
import glob
import cv2
import numpy as np
import torch

try:
    if sys.stdout.encoding != 'utf-8':
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from gaussian_splat_engine import GaussianSplatEngine
from geofence_engine import GeofenceEngine
from reconstruction_engine import MeshReconstructor

# DUSt3R directory setup
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DUST3R_DIR = os.path.join(CURRENT_DIR, "dust3r")
if os.path.exists(DUST3R_DIR) and DUST3R_DIR not in sys.path:
    sys.path.insert(0, DUST3R_DIR)


def extract_sharp_keyframes(
    video_path: str,
    output_dir: str = "output/video_keyframes",
    target_keyframes: int = 24,
    min_sharpness: float = 80.0
) -> list:
    """
    Extracts high-sharpness, evenly spaced keyframes from a video.
    Filters out motion-blurred frames using Laplacian variance.
    """
    os.makedirs(output_dir, exist_ok=True)
    # Clean previous frames if any
    for f in glob.glob(os.path.join(output_dir, "*.jpg")):
        try:
            os.remove(f)
        except Exception:
            pass

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video file: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    print(f"[INFO] Video loaded: {total_frames} frames @ {fps:.1f} FPS")

    step = max(1, total_frames // (target_keyframes * 2))
    candidate_frames = []

    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % step == 0:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()
            candidate_frames.append((frame_idx, frame, sharpness))

        frame_idx += 1

    cap.release()

    if not candidate_frames:
        raise RuntimeError("No valid frames could be read from the video.")

    # Select the sharpest keyframes distributed across the video timeline
    chunk_size = max(1, len(candidate_frames) // target_keyframes)
    selected_keyframes = []

    for i in range(0, len(candidate_frames), chunk_size):
        chunk = candidate_frames[i : i + chunk_size]
        if chunk:
            # Pick the sharpest frame in this time window
            best_frame = max(chunk, key=lambda x: x[2])
            selected_keyframes.append(best_frame)

    saved_paths = []
    for rank, (f_idx, frame, sharpness) in enumerate(selected_keyframes[:target_keyframes]):
        out_path = os.path.join(output_dir, f"frame_{rank:03d}_idx{f_idx:04d}.jpg")
        # Resize if very large for faster neural processing while preserving aspect ratio
        h, w = frame.shape[:2]
        if max(h, w) > 1280:
            scale = 1280.0 / max(h, w)
            frame = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(out_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
        saved_paths.append(out_path)

    print(f"[SUCCESS] Extracted {len(saved_paths)} sharp keyframes to '{output_dir}'.")
    return saved_paths


def process_video_to_3d_world(
    video_path: str = "inp/input.mp4",
    output_prefix: str = "output/video_3d_world",
    target_keyframes: int = 16,
    conf_thresh: float = 6.0,
    geofence_radius: float = 20.0,
    device: str = "cuda" if torch.cuda.is_available() else "cpu"
):
    """
    Complete end-to-end pipeline:
    Video -> Sharp Keyframes -> DUSt3R Transformer 3D -> 3D Gaussian Splats -> Geofenced 3D World
    """
    start_time = time.time()
    print("\n" + "=" * 75)
    print("[INFO] VIDEO TO 3D NEURAL WORLD GENERATOR")
    print(f"   Input Video     : {video_path}")
    print(f"   Output Prefix   : {output_prefix}")
    print(f"   Keyframe Count  : {target_keyframes}")
    print(f"   Confidence Thr  : {conf_thresh}")
    print(f"   Device          : {device.upper()}")
    print("=" * 75)

    if not os.path.exists(video_path):
        print(f"[ERROR] Video file not found: {video_path}")
        return

    # 1. Keyframe Extraction
    keyframes_dir = "output/video_keyframes"
    keyframes = extract_sharp_keyframes(
        video_path=video_path,
        output_dir=keyframes_dir,
        target_keyframes=target_keyframes
    )

    # 2. Neural 3D Dense Reconstruction
    print("\n[STEP 1/3] Running DUSt3R Dense Transformer 3D Reconstruction...")
    from dust3r_reconstruction import run_dust3r_reconstruction
    raw_points_obj = f"{output_prefix}_points.obj"

    run_dust3r_reconstruction(
        image_dir=keyframes_dir,
        output_path=raw_points_obj,
        confidence_thresh=conf_thresh,
        max_images=target_keyframes,
        device=device
    )

    if not os.path.exists(raw_points_obj):
        print("[ERROR] 3D Point reconstruction failed.")
        return

    # 3. Load Points & Generate 3D Gaussian Splats
    print("\n[STEP 2/3] Generating 3D Gaussian Splats from Neural Pointmaps...")
    points, colors = MeshReconstructor.load_points_from_file(raw_points_obj)
    print(f"[INFO] Processing {len(points):,} 3D coordinates...")

    gaussians = GaussianSplatEngine.create_gaussians_from_points(
        points=points,
        colors=colors,
        k_neighbors=4,
        default_opacity=0.85
    )

    # 4. Apply 3D Geofence
    print(f"\n[STEP 3/3] Applying 3D Geofence & boundary clipping ({geofence_radius}m)...")
    center = points.mean(axis=0)
    filtered_gaussians = GeofenceEngine.filter_gaussians(
        gaussians=gaussians,
        geofence_type="cylinder",
        center=tuple(center),
        radius=geofence_radius,
        mode="keep_inside"
    )

    # 5. Export All Formats
    splat_file = f"{output_prefix}.splat"
    ply_file = f"{output_prefix}_3dgs.ply"
    clean_obj_file = f"{output_prefix}.obj"

    GaussianSplatEngine.export_splat(filtered_gaussians, splat_file)
    GaussianSplatEngine.export_ply(filtered_gaussians, ply_file)

    # Export clean OBJ for standard web viewer
    with open(clean_obj_file, "w", encoding="utf-8") as f:
        f.write("# 3D World Model from Video\n")
        pos = filtered_gaussians["positions"]
        cols = filtered_gaussians["colors"]
        for p, c in zip(pos, cols):
            f.write(f"v {p[0]:.5f} {p[1]:.5f} {p[2]:.5f} {c[0]:.4f} {c[1]:.4f} {c[2]:.4f}\n")

    elapsed = time.time() - start_time
    print("\n" + "=" * 75)
    print(f"[SUCCESS] 3D WORLD GENERATED IN {elapsed:.1f}s ({elapsed/60:.2f} min)!")
    print(f"   -> WebGL 3DGS (.splat)  : {os.path.abspath(splat_file)}")
    print(f"   -> 3DGS Standard (.ply) : {os.path.abspath(ply_file)}")
    print(f"   -> 3D Model (.obj)      : {os.path.abspath(clean_obj_file)}")
    print("   -> Open http://localhost:8080 to explore the 3D world interactively!")
    print("=" * 75)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Video to 3D World Reconstruction")
    parser.add_argument("--video", "-v", type=str, default="inp/input.mp4", help="Path to input video")
    parser.add_argument("--output", "-o", type=str, default="output/video_3d_world", help="Output prefix")
    parser.add_argument("--keyframes", "-k", type=int, default=16, help="Number of sharp keyframes")
    parser.add_argument("--conf_thresh", "-c", type=float, default=6.0, help="Point confidence threshold")
    parser.add_argument("--radius", "-r", type=float, default=25.0, help="Geofence radius in meters")
    args = parser.parse_args()

    process_video_to_3d_world(
        video_path=args.video,
        output_prefix=args.output,
        target_keyframes=args.keyframes,
        conf_thresh=args.conf_thresh,
        geofence_radius=args.radius
    )
