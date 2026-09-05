"""
Module: Video Decoder
Handles real video stream decoding, frame extraction, metadata parsing, and exact timestamp recording.
Zero synthetic or placeholder frames.
"""

import os
import cv2
from typing import List, Dict, Tuple, Optional


class VideoDecoder:
    """Decodes real video files and extracts authentic video frames with metadata."""

    @staticmethod
    def get_video_metadata(video_path: str) -> Dict:
        """Retrieves real video container properties (resolution, FPS, duration, frame count)."""
        if not os.path.isfile(video_path):
            raise FileNotFoundError(f"Video file not found at path: {video_path}")

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise IOError(f"Failed to open video file: {video_path}")

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 0.0
        cap.release()

        return {
            "path": video_path,
            "filename": os.path.basename(video_path),
            "width": width,
            "height": height,
            "fps": fps,
            "total_frames": total_frames,
            "duration_seconds": round(duration, 2),
            "is_360_aspect": (width / max(1, height)) >= 1.95  # 2:1 equirectangular standard
        }

    @staticmethod
    def extract_raw_frames(
        video_path: str,
        output_dir: str,
        target_fps: float = 6.0,
        max_total_frames: int = 120
    ) -> List[Dict]:
        """
        Extracts real raw frames from video subsampled at target_fps.
        Returns list of frame metadata objects with path, timestamp_ms, and frame_idx.
        """
        os.makedirs(output_dir, exist_ok=True)
        meta = VideoDecoder.get_video_metadata(video_path)
        
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise IOError(f"Could not open video stream for {video_path}")

        source_fps = meta["fps"]
        frame_interval = max(1, int(round(source_fps / target_fps)))

        extracted_frames = []
        frame_idx = 0
        saved_count = 0

        while cap.isOpened() and saved_count < max_total_frames:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % frame_interval == 0:
                timestamp_ms = (frame_idx / source_fps) * 1000.0
                frame_filename = f"frame_{saved_count:05d}_t{int(timestamp_ms)}ms.jpg"
                frame_path = os.path.join(output_dir, frame_filename)
                
                cv2.imwrite(frame_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
                
                extracted_frames.append({
                    "frame_id": saved_count,
                    "source_frame_idx": frame_idx,
                    "timestamp_ms": round(timestamp_ms, 2),
                    "timestamp_sec": round(timestamp_ms / 1000.0, 3),
                    "file_path": frame_path,
                    "width": frame.shape[1],
                    "height": frame.shape[0]
                })
                saved_count += 1

            frame_idx += 1

        cap.release()

        if not extracted_frames:
            raise RuntimeError(f"Zero valid frames could be decoded from {video_path}")

        print(f"[VIDEO DECODER] Extracted {len(extracted_frames)} authentic frames at {target_fps} FPS to {output_dir}")
        return extracted_frames
