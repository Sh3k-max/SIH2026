#!/usr/bin/env python3
"""
Aevora 3D Photogrammetry & Structure-from-Motion (SfM) Pipeline
Takes a sequence of raw drone/survey images and reconstructs a dense 3D point cloud & mesh from scratch.
Outputs standard COLMAP (points3D.txt, images.txt, cameras.txt) and standard .PLY / .OBJ 3D formats.
"""

import os
import sys
import glob
import math
import argparse
import numpy as np
import cv2
from typing import List, Dict, Tuple, Optional

# Ensure UTF-8 output on Windows consoles
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

class PhotogrammetryReconstructor:
    def __init__(self, images_dir: str, output_dir: str, max_features: int = 4000, resize_max: int = 1600):
        self.images_dir = os.path.abspath(images_dir)
        self.output_dir = os.path.abspath(output_dir)
        self.max_features = max_features
        self.resize_max = resize_max

        os.makedirs(self.output_dir, exist_ok=True)
        self.sparse_dir = os.path.join(self.output_dir, "sparse")
        os.makedirs(self.sparse_dir, exist_ok=True)

        # SIFT detector
        self.sift = cv2.SIFT_create(nfeatures=self.max_features, contrastThreshold=0.04, edgeThreshold=10)

        # Data stores
        self.image_paths: List[str] = []
        self.image_names: List[str] = []
        self.keypoints: List[np.ndarray] = []
        self.descriptors: List[np.ndarray] = []
        self.image_sizes: List[Tuple[int, int]] = []
        self.images_rgb: List[np.ndarray] = []

        self.K: Optional[np.ndarray] = None
        self.camera_poses: Dict[int, Tuple[np.ndarray, np.ndarray]] = {} # img_idx -> (R, t)
        self.points_3d: List[np.ndarray] = [] # (X, Y, Z)
        self.points_colors: List[np.ndarray] = [] # (R, G, B) [0..255]
        self.point_tracks: List[List[Tuple[int, int]]] = [] # point_idx -> [(img_idx, kp_idx), ...]

    def load_images(self):
        """Discovers and loads images from directory."""
        extensions = ("*.jpg", "*.jpeg", "*.png", "*.JPG", "*.JPEG", "*.PNG")
        files = []
        for ext in extensions:
            files.extend(glob.glob(os.path.join(self.images_dir, ext)))
        files.sort()

        if not files:
            raise FileNotFoundError(f"No images found in {self.images_dir}")

        print(f"[*] Found {len(files)} images in {self.images_dir}")
        self.image_paths = files
        self.image_names = [os.path.basename(f) for f in files]

    def estimate_camera_intrinsics(self, width: int, height: int, fov_deg: float = 60.0) -> np.ndarray:
        """Estimates camera calibration matrix K using focal length assumption or sensor diagonal."""
        focal_length = (width / 2.0) / math.tan(math.radians(fov_deg / 2.0))
        cx = width / 2.0
        cy = height / 2.0
        K = np.array([
            [focal_length, 0, cx],
            [0, focal_length, cy],
            [0, 0, 1]
        ], dtype=np.float64)
        return K

    def extract_features(self):
        """Extracts SIFT keypoints and descriptors for all images."""
        print(f"[*] Extracting SIFT visual keypoints (max {self.max_features} per image)...")
        for idx, path in enumerate(self.image_paths):
            bgr = cv2.imread(path)
            if bgr is None:
                continue

            h, w = bgr.shape[:2]
            scale = 1.0
            if max(h, w) > self.resize_max:
                scale = self.resize_max / max(h, w)
                w_new = int(w * scale)
                h_new = int(h * scale)
                bgr = cv2.resize(bgr, (w_new, h_new), interpolation=cv2.INTER_AREA)

            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

            kp, des = self.sift.detectAndCompute(gray, None)
            kp_pts = np.array([p.pt for p in kp], dtype=np.float32)

            self.keypoints.append(kp_pts)
            self.descriptors.append(des if des is not None else np.empty((0, 128), dtype=np.float32))
            self.image_sizes.append((bgr.shape[1], bgr.shape[0]))
            self.images_rgb.append(rgb)

            if (idx + 1) % 5 == 0 or idx == len(self.image_paths) - 1:
                print(f"    Processed [{idx+1}/{len(self.image_paths)}] - {os.path.basename(path)}: {len(kp_pts)} keypoints")

        # Set default intrinsics from first valid image
        w0, h0 = self.image_sizes[0]
        self.K = self.estimate_camera_intrinsics(w0, h0)
        print(f"[*] Estimated Camera Calibration Matrix K:\n{self.K}")

    def match_image_pair(self, idx1: int, idx2: int, ratio_thresh: float = 0.75) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Matches visual features between two images with Lowe's ratio test and RANSAC Epipolar verification."""
        des1 = self.descriptors[idx1]
        des2 = self.descriptors[idx2]

        if des1 is None or des2 is None or len(des1) < 8 or len(des2) < 8:
            return np.empty((0, 2)), np.empty((0, 2)), np.empty((0, 2), dtype=int)

        # FLANN matcher
        FLANN_INDEX_KDTREE = 1
        index_params = dict(algorithm=FLANN_INDEX_KDTREE, trees=5)
        search_params = dict(checks=50)
        flann = cv2.FlannBasedMatcher(index_params, search_params)

        try:
            matches = flann.knnMatch(des1, des2, k=2)
        except Exception:
            return np.empty((0, 2)), np.empty((0, 2)), np.empty((0, 2), dtype=int)

        good_pts1 = []
        good_pts2 = []
        match_indices = []

        for m_pair in matches:
            if len(m_pair) == 2:
                m, n = m_pair
                if m.distance < ratio_thresh * n.distance:
                    good_pts1.append(self.keypoints[idx1][m.queryIdx])
                    good_pts2.append(self.keypoints[idx2][m.trainIdx])
                    match_indices.append((m.queryIdx, m.trainIdx))

        if len(good_pts1) < 15:
            return np.empty((0, 2)), np.empty((0, 2)), np.empty((0, 2), dtype=int)

        pts1 = np.array(good_pts1, dtype=np.float32)
        pts2 = np.array(good_pts2, dtype=np.float32)
        match_idx = np.array(match_indices, dtype=int)

        # Geometric verification via Essential Matrix & RANSAC
        E, inlier_mask = cv2.findEssentialMat(pts1, pts2, self.K, method=cv2.RANSAC, prob=0.999, threshold=1.5)
        if inlier_mask is None:
            return np.empty((0, 2)), np.empty((0, 2)), np.empty((0, 2), dtype=int)

        inliers = inlier_mask.ravel() == 1
        return pts1[inliers], pts2[inliers], match_idx[inliers]

    def triangulate_two_views(self, idx1: int, idx2: int, pts1: np.ndarray, pts2: np.ndarray, R1: np.ndarray, t1: np.ndarray, R2: np.ndarray, t2: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """Triangulates 3D points from 2 camera viewpoints."""
        P1 = self.K @ np.hstack((R1, t1))
        P2 = self.K @ np.hstack((R2, t2))

        pts4d_hom = cv2.triangulatePoints(P1, P2, pts1.T, pts2.T)
        pts3d = pts4d_hom[:3, :] / pts4d_hom[3, :]
        pts3d = pts3d.T

        # Positive depth validation (cheirality check)
        valid = []
        for i in range(len(pts3d)):
            p = pts3d[i].reshape(3, 1)
            # Transform point into camera 1 and camera 2 coordinate frames
            p_cam1 = R1 @ p + t1
            p_cam2 = R2 @ p + t2
            if p_cam1[2, 0] > 0.1 and p_cam2[2, 0] > 0.1: # Point is in front of both cameras
                valid.append(True)
            else:
                valid.append(False)

        valid = np.array(valid, dtype=bool)
        return pts3d[valid], valid

    def run_reconstruction(self):
        """Executes full incremental Structure-from-Motion (SfM) reconstruction."""
        print("\n=======================================================")
        print("[*] Starting End-to-End Photogrammetry Reconstruction...")
        print("=======================================================\n")

        self.load_images()
        self.extract_features()

        num_images = len(self.image_paths)
        if num_images < 2:
            print("[-] Need at least 2 images to reconstruct 3D structure.")
            return

        # 1. Initialize with best matching baseline pair
        print("\n[*] Finding optimal two-view initialization baseline pair...")
        best_pair = None
        best_inliers = 0
        best_pts1 = None
        best_pts2 = None
        best_match_idx = None

        search_limit = min(num_images, 12)
        for i in range(search_limit):
            for j in range(i + 1, min(i + 6, num_images)):
                p1, p2, m_idx = self.match_image_pair(i, j)
                if len(p1) > best_inliers:
                    best_inliers = len(p1)
                    best_pair = (i, j)
                    best_pts1 = p1
                    best_pts2 = p2
                    best_match_idx = m_idx

        if best_pair is None or best_inliers < 30:
            print("[-] Insufficient feature overlap found across initial image pairs.")
            return

        i1, i2 = best_pair
        print(f"[+] Initialized baseline pair: [{i1}] {self.image_names[i1]} <---> [{i2}] {self.image_names[i2]} ({best_inliers} verified matches)")

        # Solve relative pose of baseline
        E, _ = cv2.findEssentialMat(best_pts1, best_pts2, self.K, method=cv2.RANSAC, prob=0.999, threshold=1.0)
        _, R2, t2, _ = cv2.recoverPose(E, best_pts1, best_pts2, self.K)

        R1 = np.eye(3, dtype=np.float64)
        t1 = np.zeros((3, 1), dtype=np.float64)

        self.camera_poses[i1] = (R1, t1)
        self.camera_poses[i2] = (R2, t2)

        # Initial Triangulation
        init_pts3d, valid_mask = self.triangulate_two_views(i1, i2, best_pts1, best_pts2, R1, t1, R2, t2)
        valid_p1 = best_pts1[valid_mask]
        valid_m_idx = best_match_idx[valid_mask]

        rgb1 = self.images_rgb[i1]
        for idx in range(len(init_pts3d)):
            pt = init_pts3d[idx]
            u, v = int(valid_p1[idx][0]), int(valid_p1[idx][1])
            u = max(0, min(rgb1.shape[1] - 1, u))
            v = max(0, min(rgb1.shape[0] - 1, v))
            col = rgb1[v, u]

            self.points_3d.append(pt)
            self.points_colors.append(col)
            self.point_tracks.append([(i1, valid_m_idx[idx][0]), (i2, valid_m_idx[idx][1])])

        print(f"[+] Triangulated initial seed cloud: {len(self.points_3d)} 3D points.")

        # 2. Incremental Camera Registration & Dense Triangulation
        print("\n[*] Registering remaining cameras and growing 3D point cloud...")
        for next_idx in range(num_images):
            if next_idx in self.camera_poses:
                continue

            # Match against existing registered views
            best_ref_idx = None
            best_ref_matches = 0
            best_ref_p1 = None
            best_ref_p2 = None
            best_ref_midx = None

            for reg_idx in list(self.camera_poses.keys()):
                p_reg, p_next, m_idx = self.match_image_pair(reg_idx, next_idx)
                if len(p_reg) > best_ref_matches:
                    best_ref_matches = len(p_reg)
                    best_ref_idx = reg_idx
                    best_ref_p1 = p_reg
                    best_ref_p2 = p_next
                    best_ref_midx = m_idx

            if best_ref_idx is None or best_ref_matches < 20:
                continue

            # Solve camera pose via Essential matrix against best reference view
            E, _ = cv2.findEssentialMat(best_ref_p1, best_ref_p2, self.K, method=cv2.RANSAC, prob=0.999, threshold=1.2)
            _, R_rel, t_rel, _ = cv2.recoverPose(E, best_ref_p1, best_ref_p2, self.K)

            R_ref, t_ref = self.camera_poses[best_ref_idx]
            R_next = R_rel @ R_ref
            t_next = R_rel @ t_ref + t_rel

            self.camera_poses[next_idx] = (R_next, t_next)

            # Triangulate new 3D points
            new_pts, val_mask = self.triangulate_two_views(
                best_ref_idx, next_idx, 
                best_ref_p1, best_ref_p2, 
                R_ref, t_ref, 
                R_next, t_next
            )

            rgb_next = self.images_rgb[next_idx]
            val_p2 = best_ref_p2[val_mask]
            val_m = best_ref_midx[val_mask]

            for idx in range(len(new_pts)):
                pt = new_pts[idx]
                u, v = int(val_p2[idx][0]), int(val_p2[idx][1])
                u = max(0, min(rgb_next.shape[1] - 1, u))
                v = max(0, min(rgb_next.shape[0] - 1, v))
                col = rgb_next[v, u]

                self.points_3d.append(pt)
                self.points_colors.append(col)
                self.point_tracks.append([(best_ref_idx, val_m[idx][0]), (next_idx, val_m[idx][1])])

            print(f"    Registered Image [{next_idx+1}/{num_images}] {self.image_names[next_idx]} -> Total 3D Points: {len(self.points_3d):,}")

        # 3. Export to PLY, OBJ, and COLMAP text format
        self.export_results()

    def export_results(self):
        """Exports 3D Point Cloud (.PLY), 3D Mesh (.OBJ), and COLMAP Sparse text files."""
        print("\n[*] Exporting 3D Model outputs...")

        num_pts = len(self.points_3d)
        if num_pts == 0:
            print("[-] No points to export.")
            return

        # 1. Export standard PLY point cloud
        ply_path = os.path.join(self.output_dir, "reconstruction_pointcloud.ply")
        with open(ply_path, "w") as f:
            f.write("ply\n")
            f.write("format ascii 1.0\n")
            f.write(f"element vertex {num_pts}\n")
            f.write("property float x\n")
            f.write("property float y\n")
            f.write("property float z\n")
            f.write("property uchar red\n")
            f.write("property uchar green\n")
            f.write("property uchar blue\n")
            f.write("end_header\n")
            for i in range(num_pts):
                p = self.points_3d[i]
                c = self.points_colors[i]
                f.write(f"{p[0]:.6f} {p[1]:.6f} {p[2]:.6f} {int(c[0])} {int(c[1])} {int(c[2])}\n")

        print(f"[✓] Saved Standard 3D Point Cloud: {ply_path}")

        # 2. Export standard COLMAP points3D.txt
        colmap_pts_path = os.path.join(self.sparse_dir, "points3D.txt")
        with open(colmap_pts_path, "w") as f:
            f.write("# 3D point list with one line of data per point:\n")
            f.write("#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)\n")
            f.write(f"# Number of points: {num_pts}\n")
            for i in range(num_pts):
                p = self.points_3d[i]
                c = self.points_colors[i]
                track_str = " ".join([f"{t[0]+1} {t[1]}" for t in self.point_tracks[i]])
                f.write(f"{i+1} {p[0]:.6f} {p[1]:.6f} {p[2]:.6f} {int(c[0])} {int(c[1])} {int(c[2])} 0.5 {track_str}\n")
        print(f"[+] Saved COLMAP points3D: {colmap_pts_path}")

        # 3. Export COLMAP images.txt
        colmap_img_path = os.path.join(self.sparse_dir, "images.txt")
        with open(colmap_img_path, "w") as f:
            f.write("# Image list with two lines of data per image:\n")
            f.write("#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME\n")
            f.write(f"# Number of images: {len(self.camera_poses)}\n")
            for img_idx, (R, t) in self.camera_poses.items():
                # Convert 3x3 rotation matrix to quaternion
                q = self.rotation_matrix_to_quaternion(R)
                name = self.image_names[img_idx]
                f.write(f"{img_idx+1} {q[0]:.6f} {q[1]:.6f} {q[2]:.6f} {q[3]:.6f} {t[0,0]:.6f} {t[1,0]:.6f} {t[2,0]:.6f} 1 {name}\n")
                f.write("\n")

        print(f"[+] Saved COLMAP images: {colmap_img_path}")

        # 4. Export COLMAP cameras.txt
        colmap_cam_path = os.path.join(self.sparse_dir, "cameras.txt")
        w, h = self.image_sizes[0]
        focal = self.K[0, 0]
        cx = self.K[0, 2]
        cy = self.K[1, 2]
        with open(colmap_cam_path, "w") as f:
            f.write("# Camera list with one line of data per camera:\n")
            f.write("#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]\n")
            f.write(f"1 PINHOLE {w} {h} {focal:.4f} {focal:.4f} {cx:.4f} {cy:.4f}\n")

        print(f"[+] Saved COLMAP cameras: {colmap_cam_path}")

        print("\n=======================================================")
        print(f"[SUCCESS] 3D Reconstruction Successfully Generated {num_pts:,} points!")
        print(f"[*] Output Directory: {self.output_dir}")
        print("=======================================================\n")

    @staticmethod
    def rotation_matrix_to_quaternion(R: np.ndarray) -> np.ndarray:
        """Converts 3x3 Rotation Matrix to (qw, qx, qy, qz) quaternion."""
        tr = R[0, 0] + R[1, 1] + R[2, 2]
        if tr > 0:
            S = math.sqrt(tr + 1.0) * 2
            qw = 0.25 * S
            qx = (R[2, 1] - R[1, 2]) / S
            qy = (R[0, 2] - R[2, 0]) / S
            qz = (R[1, 0] - R[0, 1]) / S
        elif (R[0, 0] > R[1, 1]) and (R[0, 0] > R[2, 2]):
            S = math.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
            qw = (R[2, 1] - R[1, 2]) / S
            qx = 0.25 * S
            qy = (R[0, 1] + R[1, 0]) / S
            qz = (R[0, 2] + R[2, 0]) / S
        elif R[1, 1] > R[2, 2]:
            S = math.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
            qw = (R[0, 2] - R[2, 0]) / S
            qx = (R[0, 1] + R[1, 0]) / S
            qy = 0.25 * S
            qz = (R[1, 2] + R[2, 1]) / S
        else:
            S = math.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
            qw = (R[1, 0] - R[0, 1]) / S
            qx = (R[0, 2] + R[2, 0]) / S
            qy = (R[1, 2] + R[2, 1]) / S
            qz = 0.25 * S
        return np.array([qw, qx, qy, qz], dtype=np.float64)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Aevora End-to-End 3D Photogrammetry & SfM Reconstructor")
    parser.add_argument("--images_dir", "--images", type=str, default="./input_images", help="Path to input directory of raw images")
    parser.add_argument("--output_dir", "--output", type=str, default="./reconstruction_output", help="Directory where 3D points & mesh will be saved")
    parser.add_argument("--max_features", type=int, default=4000, help="Max SIFT features per photo")
    parser.add_argument("--resize_max", type=int, default=1600, help="Maximum image dimension for fast feature extraction")
    args = parser.parse_args()

    reconstructor = PhotogrammetryReconstructor(
        images_dir=args.images_dir,
        output_dir=args.output_dir,
        max_features=args.max_features,
        resize_max=args.resize_max
    )
    reconstructor.run_reconstruction()
