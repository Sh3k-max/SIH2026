"""
DUSt3R & Transformer-Based Dense 3D Reconstruction Engine
Uses ViT foundation models to produce dense 3D pointmaps directly from multi-view images.
Includes multi-stage statistical outlier cleaning, peripheral boundary card removal,
adaptive confidence masking, and surface normal estimation.
"""

import os
import sys
import argparse
import glob
import time
from typing import Optional, Tuple, Dict
import numpy as np
import torch
from scipy.spatial import cKDTree

# Automatically add cloned dust3r and croco directories to Python path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DUST3R_DIR = os.path.join(CURRENT_DIR, "dust3r")
CROCO_DIR = os.path.join(DUST3R_DIR, "croco")

if os.path.exists(DUST3R_DIR) and DUST3R_DIR not in sys.path:
    sys.path.insert(0, DUST3R_DIR)
if os.path.exists(CROCO_DIR) and CROCO_DIR not in sys.path:
    sys.path.insert(0, CROCO_DIR)

try:
    from dust3r.model import AsymmetricCroCo3DStereo
    from dust3r.inference import inference
    from dust3r.utils.image import load_images
    from dust3r.image_pairs import make_pairs
    from dust3r.cloud_opt import global_aligner, GlobalAlignerMode
    HAS_DUST3R = True
except ImportError as e:
    HAS_DUST3R = False
    DUST3R_IMPORT_ERROR = str(e)


def filter_point_cloud_outliers(
    points: np.ndarray,
    colors: np.ndarray,
    confidences: Optional[np.ndarray] = None,
    nb_neighbors: int = 30,
    std_ratio: float = 1.5,
    min_radius_neighbors: int = 4,
    radius_multiplier: float = 3.5
) -> Tuple[np.ndarray, np.ndarray, Optional[np.ndarray]]:
    """
    Applies Statistical Outlier Removal (SOR) and Radius Outlier Removal (ROR)
    to eliminate noisy floaters, disconnected boundary points, and stray artifacts.
    """
    N = len(points)
    if N < nb_neighbors + 2:
        return points, colors, confidences

    # Try Open3D high-performance C++ implementation first
    try:
        import open3d as o3d
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(points)
        cols_norm = colors if colors.max() <= 1.0 else colors / 255.0
        pcd.colors = o3d.utility.Vector3dVector(cols_norm)
        
        # 1. Statistical Outlier Removal
        cl, ind = pcd.remove_statistical_outlier(nb_neighbors=nb_neighbors, std_ratio=std_ratio)
        valid_idx = np.asarray(ind)
        
        pts_clean = np.asarray(pcd.select_by_index(valid_idx).points)
        cols_clean = np.asarray(pcd.select_by_index(valid_idx).colors)
        confs_clean = confidences[valid_idx] if confidences is not None else None
        
        # 2. Radius Outlier Removal
        if len(pts_clean) > 50:
            mean_dist = np.mean(np.linalg.norm(pts_clean - pts_clean.mean(axis=0), axis=1))
            search_radius = (mean_dist / 40.0) * radius_multiplier
            pcd_clean = o3d.geometry.PointCloud()
            pcd_clean.points = o3d.utility.Vector3dVector(pts_clean)
            pcd_clean.colors = o3d.utility.Vector3dVector(cols_clean)
            _, rad_ind = pcd_clean.remove_radius_outlier(nb_points=min_radius_neighbors, radius=search_radius)
            rad_idx = np.asarray(rad_ind)
            pts_clean = pts_clean[rad_idx]
            cols_clean = cols_clean[rad_idx]
            confs_clean = confs_clean[rad_idx] if confs_clean is not None else None
            
        return pts_clean, cols_clean, confs_clean
    except Exception:
        pass

    # SciPy cKDTree pure NumPy fallback
    tree = cKDTree(points)
    dists, _ = tree.query(points, k=nb_neighbors + 1)
    # Exclude distance to self
    mean_d = np.mean(dists[:, 1:], axis=1)
    global_mean = np.mean(mean_d)
    global_std = np.std(mean_d)
    
    thresh = global_mean + std_ratio * global_std
    mask = mean_d <= thresh
    
    pts_clean = points[mask]
    cols_clean = colors[mask]
    confs_clean = confidences[mask] if confidences is not None else None
    
    return pts_clean, cols_clean, confs_clean


def run_dust3r_reconstruction(
    image_dir: str,
    output_path: Optional[str] = "output/dust3r_model.obj",
    model_name: str = "naver/DUSt3R_ViTLarge_BaseDecoder_512_dpt",
    image_size: int = 512,
    confidence_thresh: float = 4.5,
    max_images: int = 24,
    device: str = "cuda" if torch.cuda.is_available() else "cpu"
) -> Dict[str, np.ndarray]:
    """
    Runs DUSt3R dense 3D reconstruction on a collection of overlapping images.
    Returns dictionary with:
    - 'points': (N, 3) 3D coordinate array
    - 'colors': (N, 3) RGB color array in [0, 1]
    - 'confidences': (N,) confidence scores
    - 'count': N
    """
    start_time = time.time()
    print("\n" + "=" * 70)
    print("[INFO] DUSt3R Transformer Dense 3D Reconstruction Engine")
    print(f"   Input Directory : {image_dir}")
    print(f"   Device          : {device.upper()}")
    print(f"   Image Resolution: {image_size}x{image_size}")
    print(f"   Confidence Thr  : {confidence_thresh}")
    print("=" * 70)

    if not HAS_DUST3R:
        raise ImportError(f"DUSt3R could not be imported: {DUST3R_IMPORT_ERROR}")

    # 1. Gather Images or Video
    video_extensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".insv"]
    image_files = []

    if os.path.isfile(image_dir) and any(image_dir.lower().endswith(ve) for ve in video_extensions):
        from video_to_3d_pipeline import extract_sharp_keyframes
        frames_dir = os.path.join(os.path.dirname(image_dir), "extracted_frames")
        print(f"[ 10%] Input is a video file. Extracting sharp keyframes to '{frames_dir}'...")
        image_files = extract_sharp_keyframes(image_dir, output_dir=frames_dir, target_keyframes=max_images)
    elif os.path.isdir(image_dir):
        for ext in ["*.jpg", "*.jpeg", "*.png", "*.JPG", "*.JPEG", "*.PNG", "*.tif", "*.tiff"]:
            image_files.extend(glob.glob(os.path.join(image_dir, ext)))
        if len(image_files) < 2:
            found_videos = []
            for ve in video_extensions:
                found_videos.extend(glob.glob(os.path.join(image_dir, f"*{ve}")))
                found_videos.extend(glob.glob(os.path.join(image_dir, f"*{ve.upper()}")))
            if found_videos:
                chosen_video = found_videos[0]
                from video_to_3d_pipeline import extract_sharp_keyframes
                frames_dir = os.path.join(image_dir, "extracted_frames")
                print(f"[ 10%] Video detected '{chosen_video}'. Extracting sharp keyframes...")
                image_files = extract_sharp_keyframes(chosen_video, output_dir=frames_dir, target_keyframes=max_images)

    image_files = sorted(list(set(image_files)))

    if len(image_files) < 2:
        raise ValueError(f"Found {len(image_files)} images in '{image_dir}'. Need at least 2 images.")

    print(f"[ 15%] Total images/views identified: {len(image_files)}")

    # Subsample if large collection and running on CPU
    if len(image_files) > max_images:
        step = max(1, len(image_files) // max_images)
        sampled_files = image_files[::step][:max_images]
        print(f"[ 18%] Selected {len(sampled_files)} keyframe views across flight sequence.")
    else:
        sampled_files = image_files

    # 2. Load Model
    print(f"[ 25%] Loading Transformer weights ({model_name})...")
    try:
        model = AsymmetricCroCo3DStereo.from_pretrained(model_name).to(device)
        model.eval()
    except Exception as err:
        raise RuntimeError(f"Could not load model from HuggingFace ({err}).")

    # 3. Load Images
    print(f"[ 35%] Preprocessing {len(sampled_files)} views to {image_size}x{image_size}...")
    images = load_images(sampled_files, size=image_size)

    # 4. Create Image Pairs
    scene_graph = "complete" if len(images) <= 6 else "swin-sequential-3"
    pairs = make_pairs(images, scene_graph=scene_graph, symmetrize=True)
    print(f"[ 45%] Formed {len(pairs)} stereo pairs. Running ViT dense prediction...")

    # 5. Run Pairwise Inference
    with torch.no_grad():
        output = inference(pairs, model, device=device, batch_size=1)

    # 6. Global Multi-View Point Cloud Optimization
    print("[ 65%] Optimizing global 3D coordinate alignment...")
    scene = global_aligner(output, device=device, mode=GlobalAlignerMode.PointCloudOptimizer)
    niter = 150 if device == "cpu" else 300
    scene.compute_global_alignment(init="mst", niter=niter, schedule="cosine", lr=0.01)

    # 7. Clean multi-view depth and prune non-overlapping boundary cards
    print("[ 80%] Pruning peripheral image boundary cards with multi-view consistency...")
    try:
        scene = scene.clean_pointcloud()
    except Exception as e:
        print(f"[INFO] Multi-view depth cleaning note: {e}")

    # Set raw confidence threshold
    scene.min_conf_thr = float(confidence_thresh)
    masks = scene.get_masks()
    all_pts3d = scene.get_pts3d()
    imgs = scene.imgs

    print(f"[INFO] Extracting high-confidence 3D points (Confidence >= {confidence_thresh:.1f})...")
    pts3d = []
    colors = []
    conf_list = []

    for i in range(len(images)):
        pts = all_pts3d[i]
        if isinstance(pts, torch.Tensor):
            pts = pts.detach().cpu().numpy()
        pts = np.asarray(pts)

        m = masks[i]
        if isinstance(m, torch.Tensor):
            m = m.detach().cpu().numpy()
        m = np.asarray(m, dtype=bool)

        rgb = imgs[i]
        if isinstance(rgb, torch.Tensor):
            rgb = rgb.detach().cpu().numpy()
        rgb = np.asarray(rgb)

        # Confidence map
        c_map = scene.im_conf[i].detach().cpu().numpy() if hasattr(scene, "im_conf") else np.ones(m.shape, dtype=np.float32)

        # Discard 6% border margin from each camera to prevent image-plane card artifacts
        H, W = m.shape[:2]
        b_h = max(2, int(H * 0.06))
        b_w = max(2, int(W * 0.06))
        border_mask = np.zeros((H, W), dtype=bool)
        border_mask[b_h:H-b_h, b_w:W-b_w] = True

        # Combined mask: high confidence + inside valid border + finite 3D coordinates
        valid = np.isfinite(pts).all(axis=-1)
        combined_mask = m & border_mask & valid

        if combined_mask.sum() > 0:
            pts3d.append(pts[combined_mask])
            colors.append(rgb[combined_mask])
            conf_list.append(c_map[combined_mask])

    if not pts3d or sum(len(p) for p in pts3d) < 500:
        print("[WARNING] Confidence threshold was too strict. Using top 30% confident points.")
        pts3d = []
        colors = []
        conf_list = []
        for i in range(len(images)):
            pts = all_pts3d[i]
            if isinstance(pts, torch.Tensor):
                pts = pts.detach().cpu().numpy()
            rgb = imgs[i]
            if isinstance(rgb, torch.Tensor):
                rgb = rgb.detach().cpu().numpy()
            c = scene.im_conf[i].detach().cpu().numpy() if hasattr(scene, "im_conf") else np.ones(pts.shape[:2], dtype=np.float32)
            q_thresh = np.quantile(c, 0.70)
            mask = (c >= q_thresh) & np.isfinite(pts).all(axis=-1)
            pts3d.append(pts[mask])
            colors.append(rgb[mask])
            conf_list.append(c[mask])

    pts3d = np.concatenate(pts3d, axis=0)
    colors = np.concatenate(colors, axis=0)
    conf_arr = np.concatenate(conf_list, axis=0) if conf_list else np.ones(len(pts3d), dtype=np.float32)

    # Convert colors to [0, 1] range if needed
    if colors.max() > 1.0:
        colors = colors / 255.0

    # 8. Statistical & Radius Outlier Removal
    print("[ 90%] Applying statistical outlier removal (SOR) and floater elimination...")
    pts3d, colors, conf_arr = filter_point_cloud_outliers(
        points=pts3d,
        colors=colors,
        confidences=conf_arr,
        nb_neighbors=30,
        std_ratio=1.5
    )

    print(f"\n[ 95%] Reconstructed {len(pts3d):,} clean 3D points from Transformer!")

    # 9. Optional export to OBJ
    if output_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write("# DUSt3R Dense Neural 3D Point Cloud Reconstruction\n")
            f.write(f"# Total points: {len(pts3d)}\n")
            for p, c in zip(pts3d, colors):
                f.write(f"v {p[0]:.5f} {p[1]:.5f} {p[2]:.5f} {c[0]:.4f} {c[1]:.4f} {c[2]:.4f}\n")
        print(f"           Output saved to: {os.path.abspath(output_path)}")

    elapsed = time.time() - start_time
    print(f"[100%] [SUCCESS] DUSt3R 3D model generated in {elapsed:.1f}s ({elapsed/60:.2f} min)!")
    print("=" * 70)

    return {
        "points": pts3d,
        "colors": colors,
        "confidences": conf_arr,
        "count": len(pts3d)
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DUSt3R AI 3D Reconstruction")
    parser.add_argument("--input_dir", "-i", type=str, default="sample_drone_flight", help="Folder with input images")
    parser.add_argument("--output", "-o", type=str, default="output/dust3r_model.obj", help="Output 3D OBJ file")
    parser.add_argument("--model", type=str, default="naver/DUSt3R_ViTLarge_BaseDecoder_512_dpt", help="HuggingFace model")
    parser.add_argument("--img_size", type=int, default=224 if not torch.cuda.is_available() else 512, help="Resolution (224 or 512)")
    parser.add_argument("--max_images", type=int, default=12 if not torch.cuda.is_available() else 64, help="Max views to process")
    parser.add_argument("--conf_thresh", type=float, default=4.5, help="Point confidence threshold (default: 4.5)")
    args = parser.parse_args()

    run_dust3r_reconstruction(
        image_dir=args.input_dir,
        output_path=args.output,
        model_name=args.model,
        image_size=args.img_size,
        max_images=args.max_images,
        confidence_thresh=args.conf_thresh
    )
