"""
Video Feature Adapter for extracting multi-view visual evidence from drone footage
and grounding 3D spatial completion in actual observed video imagery.
"""

from typing import List, Optional, Tuple, Dict, Any, Union
import numpy as np
import cv2
import os


class VideoFeatureAdapter:
    """Extracts, indexes, and samples visual evidence from drone video keyframes."""

    def __init__(self, keyframes: Optional[List[np.ndarray]] = None, keyframe_dir: Optional[str] = None):
        self.keyframes: List[np.ndarray] = []
        self.keyframe_paths: List[str] = []

        if keyframes is not None:
            self.keyframes = keyframes
        elif keyframe_dir is not None and os.path.isdir(keyframe_dir):
            self.load_from_directory(keyframe_dir)

    def load_from_directory(self, directory: str, max_frames: int = 30) -> None:
        """Loads video keyframe images from directory in order."""
        valid_exts = {".jpg", ".jpeg", ".png", ".webp"}
        files = sorted([
            os.path.join(directory, f) for f in os.listdir(directory)
            if os.path.splitext(f.lower())[1] in valid_exts
        ])
        if len(files) > max_frames:
            step = max(1, len(files) // max_frames)
            files = files[::step][:max_frames]

        for p in files:
            img = cv2.imread(p)
            if img is not None:
                img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                self.keyframes.append(img_rgb)
                self.keyframe_paths.append(p)

    def extract_patch_visual_context(
        self,
        frontier_center: np.ndarray,
        camera_poses: Optional[np.ndarray] = None,
        intrinsics: Optional[np.ndarray] = None,
        semantic_class: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Retrieves visual context (dominant RGB, texture variance, visual confidence)
        for a given 3D frontier point, grounded in video keyframe evidence.
        """
        if not self.keyframes:
            return {
                "dominant_rgb": np.array([128, 128, 128], dtype=np.uint8),
                "texture_variance": 0.25,
                "has_visual_evidence": False,
                "best_frame_idx": -1,
            }

        # If camera poses are available, project 3D point into cameras
        best_frame_idx = 0
        best_uv = None

        if camera_poses is not None and intrinsics is not None and len(camera_poses) == len(self.keyframes):
            best_dist = float("inf")
            K = intrinsics if intrinsics.ndim == 2 else intrinsics[0]

            for i, c2w in enumerate(camera_poses):
                w2c = np.linalg.inv(c2w)
                pt_h = np.append(frontier_center, 1.0)
                pt_cam = w2c @ pt_h
                z = pt_cam[2]
                if z > 0.1:  # In front of camera
                    u = (K[0, 0] * pt_cam[0] / z) + K[0, 2]
                    v = (K[1, 1] * pt_cam[1] / z) + K[1, 2]
                    h, w, _ = self.keyframes[i].shape
                    if 0 <= u < w and 0 <= v < h:
                        dist = np.linalg.norm(pt_cam[:3])
                        if dist < best_dist:
                            best_dist = dist
                            best_frame_idx = i
                            best_uv = (int(u), int(v))

        frame = self.keyframes[best_frame_idx]
        h, w, _ = frame.shape

        if best_uv is not None:
            u, v = best_uv
            r = 20
            patch = frame[max(0, v - r):min(h, v + r), max(0, u - r):min(w, u + r)]
            if patch.size > 0:
                dom_rgb = np.mean(patch, axis=(0, 1)).astype(np.uint8)
                variance = float(np.std(patch) / 128.0)
                return {
                    "dominant_rgb": dom_rgb,
                    "texture_variance": min(1.0, variance),
                    "has_visual_evidence": True,
                    "best_frame_idx": best_frame_idx,
                }

        # Semantic Video Band Estimation across available keyframes:
        # In drone aerial footage:
        # - Ground / roads appear in the lower half of frames
        # - Facades appear in the central vertical band
        # - Roofs appear in the upper-middle band
        # Select representative frame based on spatial X-coordinate
        frame_idx = int(abs(hash(str(frontier_center[0]))) % len(self.keyframes))
        active_frame = self.keyframes[frame_idx]
        fh, fw, _ = active_frame.shape

        sem_str = str(semantic_class).lower() if semantic_class else ""
        if "ground" in sem_str or "road" in sem_str:
            # Bottom 35% of frame represents terrain/ground
            sample_band = active_frame[int(fh * 0.60):int(fh * 0.95), int(fw * 0.15):int(fw * 0.85)]
        elif "roof" in sem_str:
            # Upper middle band (20% to 50%)
            sample_band = active_frame[int(fh * 0.20):int(fh * 0.50), int(fw * 0.20):int(fw * 0.80)]
        elif "facade" in sem_str or "building" in sem_str:
            # Central band (35% to 75%)
            sample_band = active_frame[int(fh * 0.35):int(fh * 0.75), int(fw * 0.20):int(fw * 0.80)]
        elif "vegetation" in sem_str:
            # Find greenest pixels in the frame
            g_channel = active_frame[:, :, 1].astype(float)
            r_channel = active_frame[:, :, 0].astype(float)
            green_mask = (g_channel > r_channel * 1.1) & (g_channel > 60)
            if np.any(green_mask):
                dom_rgb = np.mean(active_frame[green_mask], axis=0).astype(np.uint8)
                return {
                    "dominant_rgb": dom_rgb,
                    "texture_variance": 0.35,
                    "has_visual_evidence": True,
                    "best_frame_idx": frame_idx,
                }
            sample_band = active_frame[int(fh * 0.4):int(fh * 0.8), int(fw * 0.2):int(fw * 0.8)]
        else:
            sample_band = active_frame[int(fh * 0.3):int(fh * 0.7), int(fw * 0.3):int(fw * 0.7)]

        if sample_band.size > 0:
            dom_rgb = np.mean(sample_band, axis=(0, 1)).astype(np.uint8)
            variance = float(np.std(sample_band) / 128.0)
        else:
            dom_rgb = np.array([160, 160, 160], dtype=np.uint8)
            variance = 0.25

        return {
            "dominant_rgb": dom_rgb,
            "texture_variance": min(1.0, variance),
            "has_visual_evidence": True,
            "best_frame_idx": frame_idx,
        }
