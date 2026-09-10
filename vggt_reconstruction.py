"""
VGGT (Visual Geometry Grounded Transformer) Dense 3D Reconstruction Engine
Meta AI / Oxford CVPR 2025 Architecture

Uses facebook/VGGT-1B foundation model to directly infer camera extrinsics, intrinsics, 
depth maps, and dense 3D pointmaps directly from multi-view images or video keyframes.
Includes depth unprojection, confidence filtering, Statistical Outlier Removal (SOR),
and colored Wavefront OBJ export.
"""

import os
import sys
import argparse
import glob
import time
from typing import Optional, Tuple, Dict, List
import numpy as np
import torch
from PIL import Image

try:
    if sys.stdout.encoding != 'utf-8':
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

# Ensure local vggt module is on path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from vggt.models.vggt import VGGT
from vggt.utils.pose_enc import pose_encoding_to_extri_intri
from vggt.utils.geometry import unproject_depth_map_to_point_map


def filter_point_cloud_outliers(
    points: np.ndarray,
    colors: np.ndarray,
    nb_neighbors: int = 25,
    std_ratio: float = 1.4
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Cleans noisy floaters using Statistical Outlier Removal (SOR).
    """
    if len(points) < nb_neighbors + 2:
        return points, colors

    try:
        import open3d as o3d
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(points)
        cols_norm = colors if colors.max() <= 1.0 else colors / 255.0
        pcd.colors = o3d.utility.Vector3dVector(cols_norm)
        
        cl, ind = pcd.remove_statistical_outlier(nb_neighbors=nb_neighbors, std_ratio=std_ratio)
        valid_idx = np.asarray(ind)
        return np.asarray(pcd.select_by_index(valid_idx).points), np.asarray(pcd.select_by_index(valid_idx).colors)
    except Exception:
        pass

    # SciPy cKDTree fallback
    try:
        from scipy.spatial import cKDTree
        tree = cKDTree(points)
        dists, _ = tree.query(points, k=nb_neighbors + 1)
        mean_d = np.mean(dists[:, 1:], axis=1)
        thresh = np.mean(mean_d) + std_ratio * np.std(mean_d)
        mask = mean_d <= thresh
        return points[mask], colors[mask]
    except Exception:
        return points, colors


def run_vggt_reconstruction(
    image_dir: str,
    output_path: Optional[str] = "output/vggt_model.obj",
    max_images: int = 6,
    conf_thresh: float = 1.5,
    device: Optional[str] = None
) -> Dict[str, np.ndarray]:
    """
    Executes real VGGT-1B visual geometry grounded transformer reconstruction.
    Produces a true 3D point cloud (.obj) with RGB vertex colors.
    """
    start_time = time.time()
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    print("\n" + "=" * 70, flush=True)
    print("[INFO] VGGT Transformer 3D World Reconstruction Engine (facebook/VGGT-1B)", flush=True)
    print(f"   Input Path      : {image_dir}", flush=True)
    print(f"   Device          : {device.upper()}", flush=True)
    print(f"   Max Keyframes   : {max_images}", flush=True)
    print(f"   Confidence Thr  : {conf_thresh}", flush=True)
    print("=" * 70, flush=True)

    # 1. Video or Image Intake
    video_extensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".insv"]
    image_files: List[str] = []

    if os.path.isfile(image_dir) and any(image_dir.lower().endswith(ve) for ve in video_extensions):
        from video_to_3d_pipeline import extract_sharp_keyframes
        frames_dir = os.path.join(os.path.dirname(image_dir), "vggt_extracted_frames")
        print(f"[ 10%] Input is a direct video file. Extracting sharp keyframes to '{frames_dir}'...", flush=True)
        image_files = extract_sharp_keyframes(image_dir, output_dir=frames_dir, target_keyframes=max_images)
    elif os.path.isdir(image_dir):
        # Look for images first
        for ext in ["*.jpg", "*.jpeg", "*.png", "*.JPG", "*.JPEG", "*.PNG", "*.tif", "*.tiff"]:
            image_files.extend(glob.glob(os.path.join(image_dir, ext)))
        
        # If no or too few images, check if directory contains a video
        if len(image_files) < 2:
            found_videos = []
            for ve in video_extensions:
                found_videos.extend(glob.glob(os.path.join(image_dir, f"*{ve}")))
                found_videos.extend(glob.glob(os.path.join(image_dir, f"*{ve.upper()}")))
            if found_videos:
                from video_to_3d_pipeline import extract_sharp_keyframes
                vid_path = found_videos[0]
                frames_dir = os.path.join(image_dir, "vggt_extracted_frames")
                print(f"[ 10%] Found video file '{os.path.basename(vid_path)}'. Extracting sharp keyframes...", flush=True)
                image_files = extract_sharp_keyframes(vid_path, output_dir=frames_dir, target_keyframes=max_images)

    image_files = sorted(list(set(image_files)))
    if len(image_files) < 2:
        raise ValueError(f"Insufficient inputs in '{image_dir}'. Need at least 2 images or 1 video file.")

    # Subsample keyframes if exceeding max_images
    if len(image_files) > max_images:
        step = len(image_files) / max_images
        image_files = [image_files[int(i * step)] for i in range(max_images)]

    print(f"[ 15%] Selected {len(image_files)} keyframes for VGGT transformer processing.", flush=True)

    # 2. Preprocess images to VGGT native 518x518 resolution
    vggt_res = 518
    print(f"[ 25%] Loading and normalizing {len(image_files)} views to {vggt_res}x{vggt_res}...", flush=True)
    loaded_imgs_rgb = []
    loaded_imgs_tensors = []

    for img_path in image_files:
        try:
            im = Image.open(img_path).convert("RGB")
            im_resized = im.resize((vggt_res, vggt_res), Image.Resampling.BILINEAR)
            arr = np.array(im_resized, dtype=np.float32) / 255.0
            loaded_imgs_rgb.append(arr)
            t = torch.from_numpy(arr).permute(2, 0, 1)
            loaded_imgs_tensors.append(t)
        except Exception as e:
            print(f"[WARN] Failed to load frame {img_path}: {e}", flush=True)

    if len(loaded_imgs_rgb) < 2:
        raise RuntimeError("Failed to load sufficient images for VGGT reconstruction.")

    # 3. Load VGGT-1B Foundation Model
    print(f"[ 35%] Loading VGGT-1B transformer foundation model on {device.upper()}...", flush=True)
    model = VGGT.from_pretrained("facebook/VGGT-1B")
    model = model.to(device)
    model.eval()

    # 4. Execute VGGT Forward Pass
    print(f"[ 50%] Running VGGT forward pass (camera pose grounding & depth estimation)...", flush=True)
    imgs_tensor = torch.stack(loaded_imgs_tensors).to(device) # [S, 3, H, W]
    batch = imgs_tensor.unsqueeze(0) # [1, S, 3, H, W]

    with torch.no_grad():
        preds = model(batch)

    print(f"[ 70%] Extracting camera poses and unprojecting depth maps to 3D world geometry...", flush=True)
    pose_enc = preds["pose_enc"]
    extrinsic, intrinsic = pose_encoding_to_extri_intri(pose_enc, batch.shape[-2:])
    depth_map = preds["depth"] # [1, S, H, W, 1]
    depth_conf = preds["depth_conf"].squeeze(0).cpu().numpy() # [S, H, W]

    # Convert to NumPy
    ext_np = extrinsic.squeeze(0).cpu().numpy()
    int_np = intrinsic.squeeze(0).cpu().numpy()
    depth_np = depth_map.squeeze(0).cpu().numpy()

    # Unproject depth maps to world coordinates via camera matrices
    # point_map_unproj shape: [S, H, W, 3]
    point_map = unproject_depth_map_to_point_map(depth_np, ext_np, int_np)

    # 5. Extract and Filter Valid 3D Points
    print(f"[ 80%] Filtering valid 3D points with confidence mask...", flush=True)
    pts3d_list = []
    colors_list = []

    # Calculate adaptive confidence threshold
    median_conf = float(np.median(depth_conf))
    effective_thresh = max(conf_thresh, median_conf * 0.8)

    stride = 2 # downsample factor for speed and dense balance
    for i in range(len(loaded_imgs_rgb)):
        pts_frame = point_map[i][::stride, ::stride].reshape(-1, 3)
        rgb_frame = loaded_imgs_rgb[i][::stride, ::stride].reshape(-1, 3)
        conf_frame = depth_conf[i][::stride, ::stride].reshape(-1)

        # Filter points by finite coordinates and confidence
        valid_mask = (
            np.isfinite(pts_frame).all(axis=-1) &
            (conf_frame >= effective_thresh) &
            (pts_frame[:, 2] > 0.05) & 
            (pts_frame[:, 2] < 20.0)
        )
        
        # In Three.js / photogrammetry viewer, rotate to standard upright view: (x, -z, y)
        if valid_mask.sum() > 200:
            frame_pts_aligned = pts_frame[valid_mask].copy()
            # Standard camera-to-world upright rotation
            # OpenCV: X right, Y down, Z forward
            # Three.js: X right, Y up, Z forward (or depth)
            aligned_pts = np.stack([
                frame_pts_aligned[:, 0],
                -frame_pts_aligned[:, 1],
                -frame_pts_aligned[:, 2]
            ], axis=-1)
            pts3d_list.append(aligned_pts)
            colors_list.append(rgb_frame[valid_mask])

    if len(pts3d_list) == 0:
        # Fallback to lower confidence if threshold was too strict
        for i in range(len(loaded_imgs_rgb)):
            pts_frame = point_map[i][::stride, ::stride].reshape(-1, 3)
            rgb_frame = loaded_imgs_rgb[i][::stride, ::stride].reshape(-1, 3)
            valid_mask = np.isfinite(pts_frame).all(axis=-1)
            aligned_pts = np.stack([
                pts_frame[valid_mask, 0],
                -pts_frame[valid_mask, 1],
                -pts_frame[valid_mask, 2]
            ], axis=-1)
            pts3d_list.append(aligned_pts)
            colors_list.append(rgb_frame[valid_mask])

    pts_all = np.concatenate(pts3d_list, axis=0)
    cols_all = np.concatenate(colors_list, axis=0)

    print(f"[ 85%] Reconstructed {len(pts_all):,} raw 3D points directly from VGGT Transformer.", flush=True)

    # 6. Apply Statistical Outlier Removal (SOR)
    print(f"[ 90%] Eliminating floaters via Statistical Outlier Removal (SOR)...", flush=True)
    pts_clean, cols_clean = filter_point_cloud_outliers(
        points=pts_all,
        colors=cols_all,
        nb_neighbors=25,
        std_ratio=1.4
    )

    print(f"[ 95%] Cleaned point cloud contains {len(pts_clean):,} high-quality 3D vertices.", flush=True)

    # 7. Export to Wavefront OBJ
    if output_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write("# VGGT (Visual Geometry Grounded Transformer) Dense 3D Point Cloud\n")
            f.write(f"# Input Source: {image_dir}\n")
            f.write(f"# Total vertices: {len(pts_clean)}\n")
            for p, c in zip(pts_clean, cols_clean):
                f.write(f"v {p[0]:.5f} {p[1]:.5f} {p[2]:.5f} {c[0]:.4f} {c[1]:.4f} {c[2]:.4f}\n")
        print(f"           Saved output model to: {os.path.abspath(output_path)}", flush=True)

    elapsed = time.time() - start_time
    print(f"[100%] [SUCCESS] VGGT 3D model generated in {elapsed:.1f}s ({elapsed/60:.2f} min)!", flush=True)
    print("=" * 70, flush=True)

    return {
        "points": pts_clean,
        "colors": cols_clean,
        "count": len(pts_clean)
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="VGGT Visual Geometry Grounded Transformer 3D Reconstruction")
    parser.add_argument("--input_dir", "-i", type=str, default="sample_drone_flight", help="Folder with input images or video file path")
    parser.add_argument("--output", "-o", type=str, default="output/vggt_model.obj", help="Output 3D OBJ file path")
    parser.add_argument("--max_images", type=int, default=4, help="Max views or keyframes to process (default: 4 for CPU)")
    parser.add_argument("--conf_thresh", type=float, default=1.5, help="Confidence threshold (default: 1.5)")
    args = parser.parse_args()

    run_vggt_reconstruction(
        image_dir=args.input_dir,
        output_path=args.output,
        max_images=args.max_images,
        conf_thresh=args.conf_thresh
    )
