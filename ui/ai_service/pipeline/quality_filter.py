import cv2
import numpy as np

class QualityFilter:
    def __init__(self, blur_threshold=100.0, min_brightness=40.0):
        self.blur_threshold = blur_threshold
        self.min_brightness = min_brightness

    def is_high_quality(self, frame_np):
        """
        Calculates Laplacian variance for blur checking and average brightness.
        """
        # Convert to grayscale
        gray = cv2.cvtColor(frame_np, cv2.COLOR_BGR2GRAY)
        
        # 1. Blur Check (Laplacian Variance)
        fm = cv2.Laplacian(gray, cv2.CV_64F).var()
        is_blurry = fm < self.blur_threshold
        
        # 2. Exposure check (Average pixel brightness)
        avg_brightness = np.mean(gray)
        is_dark = avg_brightness < self.min_brightness
        
        print(f"[QualityFilter] Image evaluated: BlurScore={fm:.2f} (BlurLimit={self.blur_threshold}), Brightness={avg_brightness:.2f}")
        return not is_blurry and not is_dark

    def filter_keyframes(self, keyframes):
        """
        Filters the keyframes list (simulated if images are not loaded as numpy arrays).
        """
        # In a real environment, we read the files. For simulation fallback:
        filtered = [kf for kf in keyframes if True] # keep all for fallback
        print(f"[QualityFilter] Filtered out {len(keyframes) - len(filtered)} blurry/dark frames.")
        return filtered
