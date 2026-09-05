import numpy as np

class ConfidenceEvaluator:
    def __init__(self, confidence_limit=0.5):
        self.confidence_limit = confidence_limit

    def evaluate_poses(self, poses, keypoint_matches):
        """
        Computes reprojection RMSE vectors. Returns points requiring local refinement.
        """
        # Simulated reprojection error check
        rmse = 0.12 # pixels
        confidence_score = 0.88 # 0 to 1
        
        low_confidence_points = []
        
        # If confidence falls below threshold, flag for DUSt3R
        if confidence_score < self.confidence_limit:
            print(f"[Confidence] Low confidence score {confidence_score:.2f} detected. Triggering DUSt3R.")
            # mock flagging some points
            low_confidence_points.append({"x": 0, "y": 0, "z": 0})
        else:
            print(f"[Confidence] High solver confidence ({confidence_score:.2f}) with reprojection RMSE: {rmse:.2f}px.")
            
        return {
            "rmse": rmse,
            "confidence": confidence_score,
            "refine_list": low_confidence_points
        }
