import os
import sys
import numpy as np

# Ensure parent HMM directory is in sys.path to access GenPCCompletionEngine
current_dir = os.path.dirname(os.path.abspath(__file__))
hmm_dir = os.path.abspath(os.path.join(current_dir, "..", "..", ".."))
if hmm_dir not in sys.path:
    sys.path.insert(0, hmm_dir)

try:
    from genpc_engine import GenPCCompletionEngine
    HAS_REAL_GENPC = True
    print("[GenPC] Real GenPC Zero-Shot Completion Engine successfully imported.")
except Exception as e:
    print(f"[GenPC] Notice importing GenPC engine: {e}")
    HAS_REAL_GENPC = False


class GenPCEngine:
    """
    GenPC Inference Engine wrapper for AeroMap / Aevora AI Service.
    Applies Depth Prompting and Geometric Preserving Fusion to repair missing pixels and holes.
    """

    def __init__(self):
        self.is_ready = True
        print("[GenPC] GenPC AI Completion Service initialized and ready.")

    def complete_points(self, points_list, colors_list=None, inpaint_ratio=0.35):
        """
        Takes raw points dictionary or arrays, applies GenPC missing pixel completion,
        and returns enriched point cloud.
        """
        if not points_list or len(points_list) < 10:
            return points_list

        if isinstance(points_list[0], dict):
            pts = np.array([[p["x"], p["y"], p["z"]] for p in points_list], dtype=np.float32)
            cols = np.array([[p.get("r", 200) / 255.0, p.get("g", 200) / 255.0, p.get("b", 200) / 255.0] for p in points_list], dtype=np.float32)
        else:
            pts = np.asarray(points_list, dtype=np.float32)
            cols = np.asarray(colors_list, dtype=np.float32) if colors_list is not None else None

        res = GenPCCompletionEngine.complete_missing_pixels(
            points=pts,
            colors=cols,
            inpaint_ratio=inpaint_ratio
        )

        formatted_points = []
        for i in range(len(res["total_points"])):
            p = res["total_points"][i]
            c = res["total_colors"][i]
            conf = float(res["confidences"][i])
            src = res["sources"][i]
            formatted_points.append({
                "x": float(p[0]),
                "y": float(p[1]),
                "z": float(p[2]),
                "r": int(c[0] * 255),
                "g": int(c[1] * 255),
                "b": int(c[2] * 255),
                "confidence": conf,
                "source": src
            })

        return {
            "points": formatted_points,
            "captured_count": res["captured_count"],
            "generated_count": res["generated_count"],
            "missing_pixels_inpainted": res["missing_pixels_inpainted"],
            "total_count": res["total_count"]
        }
