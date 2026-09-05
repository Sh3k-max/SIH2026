"""
Module: Dense 3D Reconstruction & DUSt3R Dense Neural Transformer Integration
Combines DUSt3R Foundation ViT dense multi-view pointmap prediction with
optical flow triangulation, direct video pixel RGB sampling, and PCA normal estimation.
"""

import os
import sys
import math
import numpy as np
import cv2
import torch
from typing import List, Dict, Tuple, Optional
from scipy.spatial import cKDTree

# Import DUSt3R & CroCo if available
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(CURRENT_DIR)
DUST3R_DIR = os.path.join(PARENT_DIR, "dust3r")
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
    DUST3R_ERR = str(e)


class DenseReconstructor:
    """Hybrid Dense 3D Reconstruction Engine using DUSt3R Transformers & Multi-View Stereo."""

    @staticmethod
    def run_dust3r_dense_reconstruction(
        image_paths: List[str],
        model_name: str = "naver/DUSt3R_ViTLarge_BaseDecoder_512_dpt",
        image_size: int = 512,
        confidence_thresh: float = 4.0,
        device: str = "cuda" if torch.cuda.is_available() else "cpu"
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Executes DUSt3R Transformer dense 3D point cloud prediction directly from keyframe views.
        Returns: (points_3d, colors_rgb, confidences)
        """
        if not HAS_DUST3R:
            raise ImportError(f"DUSt3R library could not be loaded: {DUST3R_ERR}")

        print("\n" + "=" * 75)
        print("[DUSt3R] Initializing Foundation Transformer Multi-View Dense Prediction...")
        print(f"   Views Count    : {len(image_paths)}")
        print(f"   Model          : {model_name}")
        print(f"   Device         : {device.upper()}")
        print(f"   Confidence Thr : {confidence_thresh}")
        print("=" * 75)

        # 1. Load Model
        model = AsymmetricCroCo3DStereo.from_pretrained(model_name).to(device)
        model.eval()

        # 2. Preprocess & Load Images
        images = load_images(image_paths, size=image_size)

        # 3. Create Overlapping Stereo Pairs
        scene_graph = "complete" if len(images) <= 6 else ("sequential" if device == "cpu" else "swin-sequential-2")
        pairs = make_pairs(images, scene_graph=scene_graph, symmetrize=(device != "cpu"))
        print(f"[DUSt3R] Formed {len(pairs)} stereo pairs. Running ViT forward inference on {device.upper()}...")

        # 4. Forward Inference
        with torch.no_grad():
            output = inference(pairs, model, device=device, batch_size=1)

        # 5. Global Multi-View Coordinate Alignment & Optimization
        print("[DUSt3R] Optimizing global multi-view coordinate alignment...")
        scene = global_aligner(output, device=device, mode=GlobalAlignerMode.PointCloudOptimizer)
        niter = 35 if device == "cpu" else 200
        scene.compute_global_alignment(init="mst", niter=niter, schedule="cosine", lr=0.01)

        # 6. Extract high-density 3D points and authentic RGB colors
        pts3d = []
        colors = []
        confs = []

        all_pts3d = scene.get_pts3d()
        imgs = scene.imgs

        for i in range(len(images)):
            pts = all_pts3d[i]
            if isinstance(pts, torch.Tensor):
                pts = pts.detach().cpu().numpy()
            pts = np.asarray(pts, dtype=np.float32)

            rgb = imgs[i]
            if isinstance(rgb, torch.Tensor):
                rgb = rgb.detach().cpu().numpy()
            rgb = np.asarray(rgb, dtype=np.float32)
            if rgb.max() > 1.0:
                rgb = rgb / 255.0

            c_map = scene.im_conf[i].detach().cpu().numpy() if hasattr(scene, "im_conf") else np.ones(pts.shape[:2], dtype=np.float32)

            H, W = pts.shape[:2]
            # Crop 4% peripheral camera border margin to prevent card artifacts
            b_h = max(2, int(H * 0.04))
            b_w = max(2, int(W * 0.04))
            border_mask = np.zeros((H, W), dtype=bool)
            border_mask[b_h:H-b_h, b_w:W-b_w] = True

            valid_pts = np.isfinite(pts).all(axis=-1)
            
            # Use adaptive confidence thresholding
            c_valid = c_map[valid_pts & border_mask]
            if len(c_valid) > 0:
                med_c = float(np.median(c_valid))
                effective_thr = max(1.0, min(float(confidence_thresh), med_c * 0.85))
            else:
                effective_thr = 1.0

            conf_mask = (c_map >= effective_thr) & valid_pts & border_mask

            # Subsample with stride 2 for dense, crisp point distribution
            stride_mask = np.zeros((H, W), dtype=bool)
            stride_mask[::2, ::2] = True
            final_mask = conf_mask & stride_mask

            if final_mask.sum() > 0:
                pts3d.append(pts[final_mask])
                colors.append(rgb[final_mask])
                confs.append(c_map[final_mask])

        if not pts3d or sum(len(p) for p in pts3d) < 1000:
            print("[DUSt3R] Fallback: sampling top confident valid points across views...")
            pts3d = []
            colors = []
            confs = []
            for i in range(len(images)):
                pts = all_pts3d[i]
                if isinstance(pts, torch.Tensor):
                    pts = pts.detach().cpu().numpy()
                rgb = imgs[i]
                if isinstance(rgb, torch.Tensor):
                    rgb = rgb.detach().cpu().numpy()
                if rgb.max() > 1.0:
                    rgb = rgb / 255.0
                c = scene.im_conf[i].detach().cpu().numpy() if hasattr(scene, "im_conf") else np.ones(pts.shape[:2], dtype=np.float32)
                q_thresh = np.quantile(c, 0.40)
                mask = (c >= q_thresh) & np.isfinite(pts).all(axis=-1)
                mask = mask & stride_mask
                if mask.sum() > 0:
                    pts3d.append(pts[mask])
                    colors.append(rgb[mask])
                    confs.append(c[mask])

        pts3d_arr = np.concatenate(pts3d, axis=0)
        colors_arr = np.concatenate(colors, axis=0)
        confs_arr = np.concatenate(confs, axis=0) if confs else np.ones(len(pts3d_arr), dtype=np.float32)

        if colors_arr.max() > 1.0:
            colors_arr = colors_arr / 255.0

        # Depth outlier filter: reject extreme distance points (> 3.5x median distance)
        dists = np.linalg.norm(pts3d_arr, axis=1)
        med_dist = np.median(dists)
        valid_dist = (dists >= med_dist * 0.1) & (dists <= med_dist * 3.5)
        if valid_dist.sum() > 1000:
            pts3d_arr = pts3d_arr[valid_dist]
            colors_arr = colors_arr[valid_dist]
            confs_arr = confs_arr[valid_dist]

        print(f"[DUSt3R] Successfully generated {len(pts3d_arr):,} dense neural 3D points from Transformer!")
        return pts3d_arr, colors_arr, confs_arr

    @staticmethod
    def sample_pixel_colors(img: np.ndarray, keypoints_2d: np.ndarray) -> np.ndarray:
        """Samples authentic RGB colors directly from source video image pixels."""
        H, W = img.shape[:2]
        u = np.clip(np.round(keypoints_2d[:, 0]).astype(int), 0, W - 1)
        v = np.clip(np.round(keypoints_2d[:, 1]).astype(int), 0, H - 1)
        bgr = img[v, u]
        rgb = bgr[:, [2, 1, 0]].astype(np.float32) / 255.0
        return rgb

    @staticmethod
    def triangulate_dense_multiview_video(
        keyframes_bgr: List[np.ndarray],
        camera_rotations: List[np.ndarray],
        camera_translations: List[np.ndarray],
        K: np.ndarray,
        step_small: int = 5
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Extracts tens of thousands of authentic 3D photogrammetric points directly from video frames
        using dense Farneback optical flow epipolar triangulation and pixel color sampling.
        """
        n_kf = len(keyframes_bgr)
        h, w = keyframes_bgr[0].shape[:2]

        all_3d_points = []
        all_rgb_colors = []
        all_confidences = []

        grays = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in keyframes_bgr]

        for i in range(n_kf - 1):
            R1, t1 = camera_rotations[i], camera_translations[i]
            R2, t2 = camera_rotations[i + 1], camera_translations[i + 1]

            # Projection matrices P = K [R | t]
            P1 = K @ np.hstack((R1.T, -R1.T @ t1.reshape(3, 1)))
            P2 = K @ np.hstack((R2.T, -R2.T @ t2.reshape(3, 1)))

            # Dense Farneback Optical Flow
            g1, g2 = grays[i], grays[i + 1]
            small_g1 = cv2.resize(g1, (640, 360))
            small_g2 = cv2.resize(g2, (640, 360))
            flow = cv2.calcOpticalFlowFarneback(small_g1, small_g2, None, 0.5, 3, 15, 3, 5, 1.2, 0)

            scale_x = w / 640.0
            scale_y = h / 360.0

            y_s, x_s = np.mgrid[0:360:step_small, 0:640:step_small].reshape(2, -1).astype(int)
            fx = flow[y_s, x_s, 0] * scale_x
            fy = flow[y_s, x_s, 1] * scale_y
            flow_mag = np.hypot(fx, fy)
            valid_flow = (flow_mag > 0.4) & (flow_mag < 80.0)

            valid_x1 = (x_s[valid_flow] * scale_x).astype(np.float32)
            valid_y1 = (y_s[valid_flow] * scale_y).astype(np.float32)
            valid_x2 = valid_x1 + fx[valid_flow]
            valid_y2 = valid_y1 + fy[valid_flow]

            if len(valid_x1) > 0:
                p_dense1 = np.vstack((valid_x1, valid_y1)).astype(np.float32)
                p_dense2 = np.vstack((valid_x2, valid_y2)).astype(np.float32)

                dense4d = cv2.triangulatePoints(P1, P2, p_dense1, p_dense2)
                dense3d = (dense4d[:3] / (dense4d[3] + 1e-7)).T

                for p3d, px, py in zip(dense3d, valid_x1, valid_y1):
                    if -35.0 < p3d[0] < 35.0 and -5.0 < p3d[1] < 30.0 and -35.0 < p3d[2] < 35.0:
                        ix = int(np.clip(px, 0, w - 1))
                        iy = int(np.clip(py, 0, h - 1))
                        bgr = keyframes_bgr[i][iy, ix]
                        rgb = [float(bgr[2]) / 255.0, float(bgr[1]) / 255.0, float(bgr[0]) / 255.0]

                        all_3d_points.append(p3d)
                        all_rgb_colors.append(rgb)
                        all_confidences.append(0.95)

        if not all_3d_points:
            return np.empty((0, 3), dtype=np.float32), np.empty((0, 3), dtype=np.float32), np.empty(0, dtype=np.float32)

        pts_arr = np.array(all_3d_points, dtype=np.float32)
        cols_arr = np.array(all_rgb_colors, dtype=np.float32)
        confs_arr = np.array(all_confidences, dtype=np.float32)

        # Ground alignment: set 5th percentile height to Y = 0
        ground_y = float(np.percentile(pts_arr[:, 1], 5))
        pts_arr[:, 1] -= ground_y

        # Center X and Z at origin
        med_x = float(np.median(pts_arr[:, 0]))
        med_z = float(np.median(pts_arr[:, 2]))
        pts_arr[:, 0] -= med_x
        pts_arr[:, 2] -= med_z

        print(f"[DENSE RECONSTRUCTOR] Successfully reconstructed {len(pts_arr):,} authentic video-sampled 3D Gaussian points!")
        return pts_arr, cols_arr, confs_arr

    @staticmethod
    def estimate_surface_normals(points: np.ndarray, k_neighbors: int = 12) -> np.ndarray:
        """Estimates surface normal vectors from local PCA neighborhood covariance."""
        N = len(points)
        if N < 4:
            return np.zeros_like(points)

        tree = cKDTree(points)
        k = min(k_neighbors, N - 1)
        _, idxs = tree.query(points, k=k)

        neighbors = points[idxs]
        means = np.mean(neighbors, axis=1, keepdims=True)
        centered = neighbors - means

        cov = np.matmul(centered.transpose(0, 2, 1), centered) / (k - 1)
        eigenvalues, eigenvectors = np.linalg.eigh(cov)

        normals = eigenvectors[:, :, 0]
        norms = np.linalg.norm(normals, axis=1, keepdims=True)
        normals = normals / np.maximum(norms, 1e-7)

        return normals.astype(np.float32)
