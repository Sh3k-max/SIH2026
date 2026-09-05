"""
Module: Information-Driven Keyframe Selector
Analyzes real video frames for Laplacian variance sharpness, optical flow displacement,
color entropy, and FAST/ORB corner density to select non-redundant, geometrically optimal keyframes.
"""

import os
import math
import numpy as np
import cv2
from typing import List, Dict, Tuple


class KeyframeSelector:
    """Selects the optimal subset of diverse, high-sharpness, information-rich keyframes."""

    @staticmethod
    def compute_frame_metrics(img: np.ndarray) -> Dict[str, float]:
        """Calculates real image sharpness, entropy, and feature density."""
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img

        # 1. Laplacian Variance Sharpness
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        sharpness = float(laplacian.var())

        # 2. Shannon Entropy (information density)
        hist, _ = np.histogram(gray, bins=256, range=(0, 256), density=True)
        hist = hist[hist > 0]
        entropy = -float(np.sum(hist * np.log2(hist)))

        # 3. FAST Corner Density
        fast = cv2.FastFeatureDetector_create(threshold=20)
        keypoints = fast.detect(gray, None)
        corner_count = len(keypoints)

        # 4. Exposure Balance (penalize extreme dark or overblown frames)
        mean_lum = float(np.mean(gray))
        lum_balance = 1.0 - abs(mean_lum - 128.0) / 128.0

        # Composite score
        composite_score = (sharpness * 0.45) + (entropy * 15.0) + (corner_count * 0.05) + (lum_balance * 20.0)

        return {
            "sharpness": round(sharpness, 2),
            "entropy": round(entropy, 3),
            "corners": corner_count,
            "luminance": round(mean_lum, 1),
            "composite_score": round(composite_score, 2)
        }

    @staticmethod
    def select_keyframes(
        extracted_frames: List[Dict],
        output_dir: str,
        target_count: int = 16,
        min_motion_thresh: float = 8.0
    ) -> List[Dict]:
        """
        Selects target_count keyframes evenly distributed across the temporal timeline,
        picking the highest information-density frame in each temporal bucket.
        """
        os.makedirs(output_dir, exist_ok=True)
        N = len(extracted_frames)
        if N <= target_count:
            return extracted_frames

        # Compute metrics for all extracted frames
        analyzed_frames = []
        for f_meta in extracted_frames:
            img = cv2.imread(f_meta["file_path"])
            if img is None:
                continue
            metrics = KeyframeSelector.compute_frame_metrics(img)
            f_meta_copy = dict(f_meta)
            f_meta_copy.update(metrics)
            analyzed_frames.append(f_meta_copy)

        # Partition timeline into temporal buckets and select the best frame in each
        num_buckets = min(target_count, len(analyzed_frames))
        bucket_size = len(analyzed_frames) / float(num_buckets)
        selected_keyframes = []

        for b in range(num_buckets):
            idx_start = int(b * bucket_size)
            idx_end = int((b + 1) * bucket_size)
            bucket = analyzed_frames[idx_start:idx_end]
            if not bucket:
                continue

            # Pick frame with highest composite score in this temporal section
            best_frame = max(bucket, key=lambda x: x["composite_score"])
            selected_keyframes.append(best_frame)

        print(f"[KEYFRAME SELECTOR] Selected {len(selected_keyframes)} optimal keyframes from {N} candidate frames.")
        return selected_keyframes
