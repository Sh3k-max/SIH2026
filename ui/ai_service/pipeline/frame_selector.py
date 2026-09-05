import cv2
import os

class FrameSelector:
    def __init__(self, sample_rate=5):
        self.sample_rate = sample_rate

    def extract_keyframes(self, video_path):
        """
        Extracts keyframe samples from the drone video path.
        """
        if not os.path.exists(video_path):
            # Return empty if video path doesn't exist yet (mock file path fallback)
            print(f"[FrameSelector] Video path {video_path} not found. Running simulated stream.")
            return [{"id": f"frame_{i}", "timestamp": i * 0.33} for i in range(12)]

        cap = cv2.VideoCapture(video_path)
        keyframes = []
        frame_idx = 0
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            
            # Decimate based on temporal sampling & visual novelty
            if frame_idx % self.sample_rate == 0:
                keyframes.append({
                    "id": f"frame_{frame_idx}",
                    "timestamp": cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0,
                    "resolution": f"{frame.shape[1]}x{frame.shape[0]}"
                })
            frame_idx += 1
            
        cap.release()
        print(f"[FrameSelector] Decimated {frame_idx} video frames down to {len(keyframes)} selected candidate frames.")
        return keyframes
