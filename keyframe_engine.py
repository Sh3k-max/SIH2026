"""
Intelligent Keyframe Selection Module for 360 Video
Extracts non-redundant, information-dense keyframes based on:
- Camera motion & visual flow
- Image sharpness (Laplacian variance)
- Viewpoint diversity & entropy
- Feature density
Calculates an explicit Information Score [0.0 - 1.0] for every candidate frame.
"""

import os
import sys
import glob
import cv2
import numpy as np
from typing import List, Dict, Tuple


class IntelligentKeyframeSelector:
    @staticmethod
    def compute_sharpness(frame_gray: np.ndarray) -> float:
        """Calculates sharpness using variance of the Laplacian."""
        return float(cv2.Laplacian(frame_gray, cv2.CV_64F).var())

    @staticmethod
    def compute_color_entropy(frame: np.ndarray) -> float:
        """Calculates visual complexity/entropy across color channels."""
        hist_h = cv2.calcHist([frame], [0], None, [32], [0, 180])
        hist_s = cv2.calcHist([frame], [1], None, [32], [0, 256])
        hist = np.concatenate([hist_h, hist_s]).flatten()
        prob = hist / (hist.sum() + 1e-7)
        prob = prob[prob > 0]
        entropy = -np.sum(prob * np.log2(prob))
        return float(entropy)

    @staticmethod
    def compute_motion_difference(prev_gray: np.ndarray, curr_gray: np.ndarray) -> float:
        """Computes structural frame difference indicating drone translation/rotation."""
        if prev_gray is None:
            return 1.0
        diff = cv2.absdiff(prev_gray, curr_gray)
        return float(np.mean(diff) / 255.0)

    @classmethod
    def analyze_and_extract_keyframes(
        cls,
        video_path: str,
        output_dir: str = "output/keyframes_360",
        target_keyframes: int = 16,
        min_sharpness_threshold: float = 40.0
    ) -> Dict:
        """
        Processes a 360 video stream, computes information gain per frame,
        and saves the top-scoring keyframes.
        """
        os.makedirs(output_dir, exist_ok=True)
        # Clean previous
        for f in glob.glob(os.path.join(output_dir, "*.jpg")):
            try:
                os.remove(f)
            except Exception:
                pass

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Unable to open video: {video_path}")

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = total_frames / fps if fps > 0 else 0.0

        # Sample every Nth frame to evaluate
        sample_step = max(1, total_frames // (target_keyframes * 4))
        candidates = []

        prev_small_gray = None
        frame_idx = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % sample_step == 0:
                timestamp = frame_idx / fps if fps > 0 else 0.0
                small = cv2.resize(frame, (320, 160))
                small_gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
                hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)

                sharpness = cls.compute_sharpness(small_gray)
                entropy = cls.compute_color_entropy(hsv)
                motion = cls.compute_motion_difference(prev_small_gray, small_gray)
                prev_small_gray = small_gray

                # Feature count proxy (FAST corner detector)
                fast = cv2.FastFeatureDetector_create(threshold=25)
                kp = fast.detect(small_gray, None)
                feature_density = min(1.0, len(kp) / 400.0)

                # Normalized scores
                norm_sharp = min(1.0, sharpness / 300.0)
                norm_entropy = min(1.0, entropy / 5.0)
                norm_motion = min(1.0, motion * 4.0)

                # Composite Information Score:
                # Prioritizes high motion (new viewpoint), sharp images, and feature-rich environments
                info_score = (
                    0.35 * norm_motion +
                    0.30 * norm_sharp +
                    0.20 * feature_density +
                    0.15 * norm_entropy
                )

                candidates.append({
                    "frame_index": frame_idx,
                    "timestamp": round(timestamp, 2),
                    "frame": frame,
                    "sharpness": round(sharpness, 1),
                    "entropy": round(entropy, 2),
                    "motion_diff": round(motion, 3),
                    "feature_count": len(kp),
                    "info_score": round(info_score, 3)
                })

            frame_idx += 1

        cap.release()

        if not candidates:
            raise RuntimeError("No valid frames could be read from video.")

        # Window-based non-maximum suppression to ensure even distribution along flight trajectory
        window_size = max(1, len(candidates) // target_keyframes)
        selected = []

        for i in range(0, len(candidates), window_size):
            chunk = candidates[i : i + window_size]
            if chunk:
                # Pick the highest information score frame in this time window
                best = max(chunk, key=lambda x: x["info_score"])
                selected.append(best)

        # Truncate to exact target count
        selected = selected[:target_keyframes]

        # Save selected frames to disk
        timeline = []
        for rank, item in enumerate(selected):
            filename = f"keyframe_{rank:03d}_t{item['timestamp']}s.jpg"
            filepath = os.path.join(output_dir, filename)
            cv2.imwrite(filepath, item["frame"], [cv2.IMWRITE_JPEG_QUALITY, 95])

            timeline.append({
                "rank": rank,
                "frame_index": item["frame_index"],
                "timestamp": item["timestamp"],
                "filename": filename,
                "file_url": f"/output/keyframes_360/{filename}",
                "sharpness": item["sharpness"],
                "feature_count": item["feature_count"],
                "info_score": item["info_score"],
                "motion_diff": item["motion_diff"]
            })

        # Calculate dataset compression metric
        compression_ratio = round((1.0 - (len(timeline) / max(1, total_frames))) * 100, 1)
        avg_info_score = round(float(np.mean([t["info_score"] for t in timeline])), 3)

        return {
            "total_video_frames": total_frames,
            "fps": fps,
            "resolution": f"{width}x{height}",
            "duration_sec": round(duration, 2),
            "selected_count": len(timeline),
            "redundancy_eliminated_pct": compression_ratio,
            "avg_information_score": avg_info_score,
            "keyframes": timeline
        }
