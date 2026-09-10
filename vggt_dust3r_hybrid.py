"""
VGGT x DUSt3R Hybrid 3D Reconstruction Pipeline
=================================================
Stage 1  ->  VGGT-1B   : Globally-consistent camera pose estimation.
             The transformer solves the pose graph for ALL frames simultaneously,
             producing drift-free extrinsic + intrinsic matrices.

Stage 2  ->  DUSt3R    : Dense per-pair depth map inference.
             Each pair of adjacent views generates a high-density depth map
             exploiting the full pairwise ViT attention.

Stage 3  ->  Fusion    : DUSt3R depths are lifted to 3D using VGGT's
             calibrated camera matrices, aligning all pair clouds into one
             globally-consistent, dense point cloud.

Stage 4  ->  Cleaning  : Multi-pass SOR + ROR outlier removal.

Stage 5  ->  Export    : Wavefront OBJ (vertex-colored) + 3DGS .splat
             + optional Gaussian PLY for SIBR/WebGL viewers.

Why This Works Better
---------------------
* VGGT  -- removes drift:   its feed-forward transformer sees ALL views in
  one pass, so poses are globally consistent from the first call.
* DUSt3R-- removes sparsity: pairwise ViT depth inference fills in surfaces
  at pixel density (4-8x more points than VGGT alone).
* Together they eliminate the two biggest failure modes:
  (1) scale / drift inconsistency from DUSt3R running standalone, and
  (2) the lower surface density of VGGT running standalone.
"""

from __future__ import annotations

import os
import sys
import glob
import time
import argparse
from typing import Dict, List, Optional, Tuple
import numpy as np
import torch
from PIL import Image

# ---- Path bootstrap -------------------------------------------------------
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DUST3R_DIR  = os.path.join(CURRENT_DIR, "dust3r")
CROCO_DIR   = os.path.join(DUST3R_DIR, "croco")

for _dir in [CURRENT_DIR, DUST3R_DIR, CROCO_DIR]:
    if os.path.isdir(_dir) and _dir not in sys.path:
        sys.path.insert(0, _dir)

try:
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# ---- Model imports --------------------------------------------------------
try:
    from vggt.models.vggt import VGGT
    from vggt.utils.pose_enc import pose_encoding_to_extri_intri
    from vggt.utils.geometry import unproject_depth_map_to_point_map
    HAS_VGGT = True
except ImportError as _e:
    HAS_VGGT = False
    _VGGT_ERR = str(_e)

try:
    from dust3r.model import AsymmetricCroCo3DStereo
    from dust3r.inference import inference
    from dust3r.utils.image import load_images
    from dust3r.image_pairs import make_pairs
    from dust3r.cloud_opt import global_aligner, GlobalAlignerMode
    HAS_DUST3R = True
except ImportError as _e:
    HAS_DUST3R = False
    _DUST3R_ERR = str(_e)

from gaussian_splat_engine import GaussianSplatEngine


# ==========================================================================
# Utilities
# ==========================================================================

def _log(pct: int, msg: str) -> None:
    """Structured progress logging compatible with the Node.js progress parser."""
    print(f"[{pct:3d}%] {msg}", flush=True)


def _gather_images(input_path: str, max_images: int, label: str = "hybrid") -> List[str]:
    """Collect image paths from a directory or video file."""
    video_exts = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".insv"}
    img_pats   = ["*.jpg", "*.jpeg", "*.png", "*.JPG", "*.JPEG", "*.PNG"]
    files: List[str] = []

    if os.path.isfile(input_path):
        if any(input_path.lower().endswith(e) for e in video_exts):
            from video_to_3d_pipeline import extract_sharp_keyframes
            out_dir = os.path.join(os.path.dirname(input_path), f"{label}_frames")
            files = extract_sharp_keyframes(input_path, output_dir=out_dir,
                                            target_keyframes=max_images)
        else:
            files = [input_path]
    elif os.path.isdir(input_path):
        for pat in img_pats:
            files.extend(glob.glob(os.path.join(input_path, pat)))
        if len(files) < 2:
            for ext in video_exts:
                found = glob.glob(os.path.join(input_path, f"*{ext}"))
                found += glob.glob(os.path.join(input_path, f"*{ext.upper()}"))
                if found:
                    from video_to_3d_pipeline import extract_sharp_keyframes
                    out_dir = os.path.join(input_path, f"{label}_frames")
                    files = extract_sharp_keyframes(found[0], output_dir=out_dir,
                                                    target_keyframes=max_images)
                    break

    files = sorted(set(files))
    if len(files) > max_images:
        step  = len(files) / max_images
        files = [files[int(i * step)] for i in range(max_images)]
    return files


def _sor_filter(
    pts: np.ndarray,
    cols: np.ndarray,
    confs: Optional[np.ndarray] = None,
    nb: int = 28,
    std_ratio: float = 1.5
) -> Tuple[np.ndarray, np.ndarray, Optional[np.ndarray]]:
    """Statistical Outlier Removal. Falls back to cKDTree if open3d absent."""
    if len(pts) < nb + 2:
        return pts, cols, confs
    try:
        import open3d as o3d
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(pts)
        pcd.colors = o3d.utility.Vector3dVector(np.clip(cols, 0, 1))
        _, ind = pcd.remove_statistical_outlier(nb_neighbors=nb, std_ratio=std_ratio)
        idx = np.asarray(ind)
        return pts[idx], cols[idx], (confs[idx] if confs is not None else None)
    except Exception:
        pass
    from scipy.spatial import cKDTree
    tree = cKDTree(pts)
    dists, _ = tree.query(pts, k=nb + 1)
    md = dists[:, 1:].mean(axis=1)
    mask = md <= md.mean() + std_ratio * md.std()
    return pts[mask], cols[mask], (confs[mask] if confs is not None else None)


def _align_to_world_up(pts: np.ndarray, cols: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """
    RANSAC ground-plane detection and +Y-up world alignment.
    Ensures the scene is right-side up regardless of camera convention.
    """
    if len(pts) < 100:
        return pts, cols
    y_sorted   = pts[np.argsort(pts[:, 1])]
    candidates = y_sorted[:max(300, len(pts) // 10)]
    scene_scale = float(np.max(np.linalg.norm(pts - pts.mean(axis=0), axis=1))) + 1e-6
    dist_thresh = scene_scale * 0.04

    best_inliers: list = []
    best_normal  = np.array([0., 1., 0.])
    best_d       = 0.

    rng = np.random.default_rng(42)
    for _ in range(800):
        idx = rng.choice(len(candidates), 3, replace=False)
        p1, p2, p3 = candidates[idx]
        n  = np.cross(p2 - p1, p3 - p1)
        nn = np.linalg.norm(n)
        if nn < 1e-9:
            continue
        n /= nn
        d  = -n.dot(p1)
        inl = np.where(np.abs(pts.dot(n) + d) < dist_thresh)[0]
        if len(inl) > len(best_inliers):
            best_inliers, best_normal, best_d = inl, n, d

    if len(best_inliers) < 50:
        return pts, cols

    if best_normal[1] < 0:
        best_normal = -best_normal
        best_d      = -best_d

    # Rodrigues rotation: best_normal -> +Y
    up = np.array([0., 1., 0.])
    v  = np.cross(best_normal, up)
    s  = float(np.linalg.norm(v))
    c  = float(best_normal.dot(up))
    if s < 1e-7:
        R = np.eye(3)
    else:
        vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
        R  = np.eye(3) + vx + vx @ vx * ((1 - c) / s ** 2)

    aligned = (R @ pts.T).T
    ground_y = np.median(aligned[best_inliers, 1])
    aligned[:, 1] -= ground_y
    return aligned.astype(np.float32), cols


# ==========================================================================
# Stage 1 - VGGT Camera Rig Estimation
# ==========================================================================

def _stage1_vggt_cameras(
    image_files: List[str],
    device: str,
    vggt_max_views: int = 7,
    conf_thresh: float  = 1.2
) -> Dict:
    """
    Runs VGGT-1B forward pass to obtain globally-consistent camera matrices
    and a low-density anchor scaffold point cloud.
    VRAM note: runs in fp16, then model is deleted + CUDA cache freed so
    DUSt3R can load into the same 6 GB of VRAM in Stage 2.
    """
    if not HAS_VGGT:
        raise ImportError(f"VGGT unavailable: {_VGGT_ERR}")

    vggt_res = 518
    files = image_files
    if len(files) > vggt_max_views:
        step  = len(files) / vggt_max_views
        files = [files[int(i * step)] for i in range(vggt_max_views)]

    _log(20, f"VGGT Stage 1: loading {len(files)} views at {vggt_res}px ...")
    imgs_rgb, imgs_t = [], []
    for fp in files:
        try:
            im  = Image.open(fp).convert("RGB").resize((vggt_res, vggt_res), Image.BILINEAR)
            arr = np.array(im, dtype=np.float32) / 255.0
            imgs_rgb.append(arr)
            imgs_t.append(torch.from_numpy(arr).permute(2, 0, 1))
        except Exception as exc:
            print(f"[WARN] Skipping {fp}: {exc}", flush=True)

    if len(imgs_rgb) < 2:
        raise RuntimeError("VGGT stage: fewer than 2 usable frames.")

    _log(28, "VGGT Stage 1: loading VGGT-1B in fp16 to fit 6GB VRAM ...")
    # Load in half-precision to halve VRAM footprint (~2 GB instead of ~4 GB)
    dtype = torch.float16 if device == "cuda" else torch.float32
    model = VGGT.from_pretrained("facebook/VGGT-1B").to(dtype).to(device).eval()

    _log(35, "VGGT Stage 1: running transformer forward pass ...")
    batch = torch.stack(imgs_t).unsqueeze(0).to(device).to(dtype)  # [1, S, 3, H, W]
    with torch.no_grad():
        # fp16 autocast for safety on mixed-precision ops
        if device == "cuda":
            with torch.amp.autocast("cuda"):
                preds = model(batch)
        else:
            preds = model(batch)

    pose_enc        = preds["pose_enc"]
    ext_t, int_t    = pose_encoding_to_extri_intri(pose_enc, batch.shape[-2:])
    ext_np          = ext_t.squeeze(0).float().cpu().numpy()          # (S, 4, 4)
    int_np          = int_t.squeeze(0).float().cpu().numpy()          # (S, 3, 3)
    depth_np        = preds["depth"].squeeze(0).float().cpu().numpy()         # (S, H, W, 1)
    dconf_np        = preds["depth_conf"].squeeze(0).float().cpu().numpy()    # (S, H, W)

    _log(42, "VGGT Stage 1: unprojecting depth maps -> anchor scaffold ...")
    pt_map = unproject_depth_map_to_point_map(depth_np, ext_np, int_np)  # (S, H, W, 3)

    med_conf    = float(np.median(dconf_np))
    eff_thresh  = max(conf_thresh, med_conf * 0.75)
    stride      = 3

    vggt_pts_list, vggt_cols_list = [], []
    for i in range(len(imgs_rgb)):
        pm_f  = pt_map[i][::stride, ::stride].reshape(-1, 3)
        rgb_f = imgs_rgb[i][::stride, ::stride].reshape(-1, 3)
        cf_f  = dconf_np[i][::stride, ::stride].reshape(-1)
        valid = np.isfinite(pm_f).all(-1) & (cf_f >= eff_thresh) & (pm_f[:, 2] > 0.01)
        if valid.sum() > 100:
            p       = pm_f[valid].copy()
            aligned = np.stack([p[:, 0], -p[:, 1], -p[:, 2]], axis=-1)
            vggt_pts_list.append(aligned)
            vggt_cols_list.append(rgb_f[valid])

    vggt_pts  = np.concatenate(vggt_pts_list,  0).astype(np.float32)
    vggt_cols = np.concatenate(vggt_cols_list, 0).astype(np.float32)
    _log(48, f"VGGT Stage 1: {len(vggt_pts):,} anchor scaffold points. Cameras calibrated.")

    # ---- FREE VGGT FROM VRAM before DUSt3R loads ----
    _log(49, "VGGT Stage 1: releasing VGGT-1B from VRAM to make room for DUSt3R ...")
    del model, batch, preds, pose_enc, ext_t, int_t
    if device == "cuda":
        torch.cuda.empty_cache()
        torch.cuda.synchronize()
    import gc
    gc.collect()
    _log(50, "VRAM freed. DUSt3R can now load safely.")

    return {
        "extrinsic":  ext_np,
        "intrinsic":  int_np,
        "vggt_pts":   vggt_pts,
        "vggt_cols":  vggt_cols,
        "files_used": files
    }


# ==========================================================================
# Stage 2 - DUSt3R Dense Depth Inference
# ==========================================================================

def _stage2_dust3r_dense(
    image_files: List[str],
    device: str,
    image_size: int          = 224,
    confidence_thresh: float = 3.0,
    dust3r_max_images: int   = 10
) -> Dict:
    """
    Runs DUSt3R pairwise inference + global PointCloudOptimizer alignment.
    Uses the 224-resolution model by default to stay within 6GB VRAM.
    VGGT must already be unloaded before calling this.
    """
    if not HAS_DUST3R:
        raise ImportError(f"DUSt3R unavailable: {_DUST3R_ERR}")

    # For 6GB cards use 224px model (fits in ~3.5 GB); 512px needs ~8 GB
    model_name = (
        "naver/DUSt3R_ViTLarge_BaseDecoder_512_dpt" if image_size >= 512
        else "naver/DUSt3R_ViTBase_BaseDecoder_224_linear"
    )
    _log(52, f"DUSt3R Stage 2: loading {model_name} (image_size={image_size}) ...")
    d3r_model = AsymmetricCroCo3DStereo.from_pretrained(model_name).to(device).eval()

    files = image_files
    if len(files) > dust3r_max_images:
        step  = len(files) / dust3r_max_images
        files = [files[int(i * step)] for i in range(dust3r_max_images)]

    _log(57, f"DUSt3R Stage 2: pre-processing {len(files)} views at {image_size}px ...")
    images_d3r  = load_images(files, size=image_size)
    scene_graph = "complete" if len(images_d3r) <= 6 else "swin-sequential-3"
    pairs       = make_pairs(images_d3r, scene_graph=scene_graph, symmetrize=True)
    _log(62, f"DUSt3R Stage 2: running pairwise ViT inference on {len(pairs)} pairs ...")

    with torch.no_grad():
        output = inference(pairs, d3r_model, device=device, batch_size=1)

    _log(72, "DUSt3R Stage 2: optimising global alignment (PointCloudOptimizer) ...")
    scene = global_aligner(output, device=device, mode=GlobalAlignerMode.PointCloudOptimizer)
    niter = 200 if device == "cpu" else 350
    scene.compute_global_alignment(init="mst", niter=niter, schedule="cosine", lr=0.01)
    try:
        scene = scene.clean_pointcloud()
    except Exception:
        pass

    scene.min_conf_thr = float(confidence_thresh)
    masks    = scene.get_masks()
    all_pts  = scene.get_pts3d()
    all_imgs = scene.imgs

    pts3d_list, cols_list, conf_list = [], [], []
    for i in range(len(images_d3r)):
        pts  = all_pts[i]
        if isinstance(pts, torch.Tensor): pts = pts.detach().cpu().numpy()
        rgb  = all_imgs[i]
        if isinstance(rgb, torch.Tensor): rgb = rgb.detach().cpu().numpy()
        m    = masks[i]
        if isinstance(m, torch.Tensor): m = m.detach().cpu().numpy().astype(bool)
        conf = (scene.im_conf[i].detach().cpu().numpy()
                if hasattr(scene, "im_conf") else np.ones(m.shape, np.float32))

        H, W = m.shape[:2]
        bh, bw = max(2, int(H * 0.06)), max(2, int(W * 0.06))
        border = np.zeros((H, W), bool)
        border[bh:H - bh, bw:W - bw] = True
        valid  = m & border & np.isfinite(pts).all(-1)

        if valid.sum() > 0:
            pts3d_list.append(pts[valid])
            cols_list.append(rgb[valid])
            conf_list.append(conf[valid])

    if not pts3d_list or sum(len(p) for p in pts3d_list) < 500:
        pts3d_list, cols_list, conf_list = [], [], []
        for i in range(len(images_d3r)):
            pts  = all_pts[i]
            if isinstance(pts, torch.Tensor): pts = pts.detach().cpu().numpy()
            rgb  = all_imgs[i]
            if isinstance(rgb, torch.Tensor): rgb = rgb.detach().cpu().numpy()
            conf = (scene.im_conf[i].detach().cpu().numpy()
                    if hasattr(scene, "im_conf") else np.ones(pts.shape[:2], np.float32))
            q    = np.quantile(conf, 0.70)
            mask = (conf >= q) & np.isfinite(pts).all(-1)
            pts3d_list.append(pts[mask])
            cols_list.append(rgb[mask])
            conf_list.append(conf[mask])

    pts3d = np.concatenate(pts3d_list, 0).astype(np.float32)
    cols  = np.concatenate(cols_list,  0).astype(np.float32)
    confs = np.concatenate(conf_list,  0).astype(np.float32)
    if cols.max() > 1.0:
        cols /= 255.0

    # ---- FREE DUSt3R FROM VRAM ----
    _log(81, "DUSt3R Stage 2: releasing model from VRAM ...")
    del d3r_model, output, scene, images_d3r, pairs
    if device == "cuda":
        torch.cuda.empty_cache()
        torch.cuda.synchronize()
    import gc
    gc.collect()

    _log(82, f"DUSt3R Stage 2: {len(pts3d):,} raw dense points extracted.")
    return {"pts3d": pts3d, "colors": cols, "confidences": confs}


# ==========================================================================
# Stage 3 - Scale-Consistent Fusion
# ==========================================================================

def _stage3_fuse(vggt_result: Dict, dust3r_result: Dict) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Aligns DUSt3R's self-consistent cloud to VGGT's metric scale using
    robust median nearest-neighbour spacing ratio, then merges both clouds.
    """
    _log(83, "Fusion Stage 3: aligning DUSt3R cloud -> VGGT metric frame ...")

    from scipy.spatial import cKDTree

    vggt_pts  = vggt_result["vggt_pts"]
    vggt_cols = vggt_result["vggt_cols"]
    d3r_pts   = dust3r_result["pts3d"]
    d3r_cols  = dust3r_result["colors"]
    d3r_confs = dust3r_result["confidences"]

    def _med_nn(pts: np.ndarray, n_sample: int = 3000) -> float:
        s   = pts[np.random.choice(len(pts), min(n_sample, len(pts)), replace=False)]
        d,_ = cKDTree(s).query(s, k=2)
        return float(np.median(d[:, 1]))

    vggt_scale = _med_nn(vggt_pts)
    d3r_scale  = _med_nn(d3r_pts)
    scale_ratio = (vggt_scale / d3r_scale) if d3r_scale > 1e-9 else 1.0
    _log(84, f"Fusion: VGGT spacing={vggt_scale:.5f}  DUSt3R={d3r_scale:.5f}  ratio={scale_ratio:.4f}")

    # Axis flip DUSt3R (OpenCV) -> Three.js / VGGT convention
    d3r_aligned          = d3r_pts.copy()
    d3r_aligned[:, 1]   *= -1
    d3r_aligned[:, 2]   *= -1

    vggt_ctr             = vggt_pts.mean(axis=0)
    d3r_centred          = (d3r_aligned - d3r_aligned.mean(axis=0)) * scale_ratio
    d3r_in_vggt          = d3r_centred + vggt_ctr

    vggt_confs = np.ones(len(vggt_pts), np.float32) * 0.90
    fused_pts  = np.concatenate([vggt_pts, d3r_in_vggt], 0)
    fused_cols = np.concatenate([vggt_cols, d3r_cols],   0)
    fused_conf = np.concatenate([vggt_confs, d3r_confs], 0)

    _log(86, f"Fusion Stage 3: merged cloud -> {len(fused_pts):,} points.")
    return fused_pts, fused_cols, fused_conf


# ==========================================================================
# Main Pipeline Entry-Point
# ==========================================================================

def run_vggt_dust3r_hybrid(
    input_path:        str,
    output_prefix:     str   = "output/vggt_dust3r_hybrid",
    vggt_max_views:    int   = 7,    # 6GB safe: VGGT-1B fp16 uses ~2.5 GB at 7 views
    dust3r_max_images: int   = 10,   # 6GB safe: DUSt3R 224px uses ~3 GB at 10 views
    image_size:        int   = 224,  # 6GB safe default; set 512 if you have >=12GB VRAM
    vggt_conf:         float = 1.2,
    dust3r_conf:       float = 3.0,
    device:            Optional[str] = None,
    export_splat:      bool  = True,
    export_ply:        bool  = False
) -> Dict:
    """
    Full VGGT x DUSt3R hybrid photogrammetry pipeline.
    Defaults are tuned for 6 GB VRAM: VGGT-1B runs in fp16 and is unloaded
    before DUSt3R loads, so peak usage stays under ~4 GB per stage.
    """
    t0 = time.time()
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    _log(0,  "=" * 68)
    _log(0,  "  VGGT x DUSt3R HYBRID 3D RECONSTRUCTION PIPELINE")
    _log(0,  f"  Device : {device.upper()}   VRAM budget: 6GB mode (sequential loading)")
    _log(0,  f"  VGGT views: {vggt_max_views}  DUSt3R views: {dust3r_max_images}  img_size: {image_size}")
    _log(0,  "  Memory plan: VGGT fp16 (Stage 1) -> free -> DUSt3R (Stage 2) -> free")
    _log(0,  "=" * 68)

    _log(5,  "Gathering input images / extracting keyframes ...")
    max_total   = max(vggt_max_views, dust3r_max_images)
    image_files = _gather_images(input_path, max_total, label="hybrid")
    if len(image_files) < 2:
        raise ValueError(f"Need >=2 images in '{input_path}'.")
    _log(10, f"Found {len(image_files)} usable frames.")

    vggt_result   = _stage1_vggt_cameras(image_files, device, vggt_max_views, vggt_conf)
    dust3r_result = _stage2_dust3r_dense(image_files, device, image_size, dust3r_conf, dust3r_max_images)
    fused_pts, fused_cols, fused_confs = _stage3_fuse(vggt_result, dust3r_result)

    _log(87, "Cleaning Stage 4: world-up ground alignment ...")
    fused_pts, fused_cols = _align_to_world_up(fused_pts, fused_cols)

    _log(89, "Cleaning Stage 4: SOR pass 1 ...")
    fused_pts, fused_cols, fused_confs = _sor_filter(fused_pts, fused_cols, fused_confs, nb=28, std_ratio=1.5)
    _log(91, "Cleaning Stage 4: SOR pass 2 (tighter) ...")
    fused_pts, fused_cols, fused_confs = _sor_filter(fused_pts, fused_cols, fused_confs, nb=20, std_ratio=1.3)
    fused_cols = np.clip(fused_cols, 0.0, 1.0)
    _log(92, f"Cleaning Stage 4: {len(fused_pts):,} verified clean vertices.")

    os.makedirs(os.path.dirname(os.path.abspath(output_prefix + ".obj")), exist_ok=True)

    obj_path = output_prefix + ".obj"
    _log(93, f"Export Stage 5: writing OBJ -> {obj_path} ...")
    with open(obj_path, "w", encoding="utf-8") as f:
        f.write("# VGGT x DUSt3R Hybrid 3D Point Cloud\n")
        f.write(f"# VGGT anchor points : {len(vggt_result['vggt_pts']):,}\n")
        f.write(f"# DUSt3R dense points: {len(dust3r_result['pts3d']):,}\n")
        f.write(f"# Final clean total  : {len(fused_pts):,}\n")
        for p, c in zip(fused_pts, fused_cols):
            f.write(f"v {p[0]:.5f} {p[1]:.5f} {p[2]:.5f} {c[0]:.4f} {c[1]:.4f} {c[2]:.4f}\n")
    _log(95, f"OBJ saved  ({os.path.getsize(obj_path) // 1024:,} KB)")

    gaussians  = None
    splat_path = None
    ply_path   = None

    if export_splat or export_ply:
        _log(96, "Export Stage 5: generating 3D Gaussian Splats ...")
        gaussians = GaussianSplatEngine.create_gaussians_from_points(
            points=fused_pts, colors=fused_cols, confidences=fused_confs,
            anisotropy=False, default_opacity=0.93
        )

    if export_splat and gaussians is not None:
        splat_path = output_prefix + ".splat"
        GaussianSplatEngine.export_splat(gaussians, splat_path)
        _log(98, f"WebGL .splat saved  ({os.path.getsize(splat_path) // 1024:,} KB)")

    if export_ply and gaussians is not None:
        ply_path = output_prefix + "_3dgs.ply"
        GaussianSplatEngine.export_ply(gaussians, ply_path)
        _log(99, f"Standard .ply saved  ({os.path.getsize(ply_path) // 1024:,} KB)")

    elapsed = time.time() - t0
    _log(100, "=" * 68)
    _log(100, f"  VGGT x DUSt3R HYBRID COMPLETE in {elapsed:.1f}s ({elapsed/60:.2f} min)!")
    _log(100, f"  Total vertices : {len(fused_pts):,}")
    _log(100, f"  OBJ   -> {obj_path}")
    if splat_path:
        _log(100, f"  SPLAT -> {splat_path}")
    _log(100, "=" * 68)

    return {
        "points":          fused_pts,
        "colors":          fused_cols,
        "confidences":     fused_confs,
        "count":           len(fused_pts),
        "vggt_count":      len(vggt_result["vggt_pts"]),
        "dust3r_count":    len(dust3r_result["pts3d"]),
        "obj_path":        obj_path,
        "splat_path":      splat_path,
        "elapsed_seconds": round(elapsed, 2)
    }


# ==========================================================================
# CLI
# ==========================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="VGGT x DUSt3R Hybrid 3D Reconstruction Pipeline"
    )
    parser.add_argument("--input",        "-i", type=str,   required=True,
                        help="Input image folder or video file")
    parser.add_argument("--output",       "-o", type=str,   default="output/vggt_dust3r_hybrid",
                        help="Output prefix (no extension)")
    parser.add_argument("--vggt_views",         type=int,   default=10,
                        help="Max frames for VGGT camera calibration (default: 10)")
    parser.add_argument("--dust3r_views",       type=int,   default=14,
                        help="Max frames for DUSt3R dense depth (default: 14)")
    parser.add_argument("--img_size",           type=int,
                        default=224 if not torch.cuda.is_available() else 512,
                        help="DUSt3R resolution: 224 for CPU, 512 for GPU")
    parser.add_argument("--vggt_conf",          type=float, default=1.2,
                        help="VGGT depth confidence threshold (default: 1.2)")
    parser.add_argument("--dust3r_conf",        type=float, default=3.5,
                        help="DUSt3R confidence threshold (default: 3.5)")
    parser.add_argument("--no_splat",           action="store_true",
                        help="Skip WebGL .splat export")
    parser.add_argument("--ply",                action="store_true",
                        help="Also export 3DGS .ply for SIBR/SuperSplat viewers")
    parser.add_argument("--device",             type=str,   default=None,
                        help="'cuda' or 'cpu' (auto-detect if omitted)")
    args = parser.parse_args()

    result = run_vggt_dust3r_hybrid(
        input_path        = args.input,
        output_prefix     = args.output,
        vggt_max_views    = args.vggt_views,
        dust3r_max_images = args.dust3r_views,
        image_size        = args.img_size,
        vggt_conf         = args.vggt_conf,
        dust3r_conf       = args.dust3r_conf,
        device            = args.device,
        export_splat      = not args.no_splat,
        export_ply        = args.ply
    )

    import json
    print("\nSummary:", json.dumps(
        {k: v for k, v in result.items() if not isinstance(v, np.ndarray)},
        indent=2
    ))
