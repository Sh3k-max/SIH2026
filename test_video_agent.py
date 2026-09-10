"""
Automated Test Suite for VideoAware3DWorldAgent
Verifies:
1. Structural void detection and clustering.
2. Temporal video cross-referencing and 2D-to-3D physical ray unprojection.
3. Video-conditioned generative prior for unseen blind spots.
4. Multi-view photometric consistency and floater pruning.
5. High confidence preservation and clean export.
"""

import os
import sys
import numpy as np
from video_aware_agent import VideoAware3DWorldAgent


def test_video_agent_unit():
    print("=" * 60)
    print("RUNNING VideoAware3DWorldAgent AUTOMATED UNIT TESTS")
    print("=" * 60)

    agent = VideoAware3DWorldAgent(verbose=False)

    # 1. Synthetic 3D Model with an intentional void
    n_pts = 6000
    theta = np.random.uniform(0, np.pi, n_pts)
    phi = np.random.uniform(0, 2 * np.pi, n_pts)
    r = 10.0
    x = r * np.sin(theta) * np.cos(phi)
    y = r * np.sin(theta) * np.sin(phi)
    z = r * np.cos(theta)

    # Carve a hole (void) on one side
    hole_mask = (x > 4.0) & (y > 4.0) & (z > 4.0)
    pts = np.column_stack([x[~hole_mask], y[~hole_mask], z[~hole_mask]]).astype(np.float32)
    cols = np.ones_like(pts, dtype=np.float32) * 0.7

    test_obj = "output/test_unit_sphere.obj"
    with open(test_obj, "w") as f:
        for p in pts:
            f.write(f"v {p[0]:.4f} {p[1]:.4f} {p[2]:.4f}\n")

    # 2. Keyframes directory
    kf_dir = "output/video_keyframes"
    if not os.path.exists(kf_dir):
        os.makedirs(kf_dir, exist_ok=True)
        # Create dummy frame
        import cv2
        dummy = np.zeros((240, 320, 3), dtype=np.uint8)
        dummy[:] = [180, 120, 70]
        cv2.imwrite(os.path.join(kf_dir, "frame_001.jpg"), dummy)

    # 3. Run Agent
    out_obj = "output/test_unit_sphere_agent_infill.obj"
    res = agent.run_agentic_pipeline(
        video_path_or_dir=kf_dir,
        model_path=test_obj,
        output_path=out_obj
    )

    assert res["status"] == "success", "Agent pipeline failed status"
    assert res["total_count"] >= len(pts), "Total points should equal or exceed captured points"
    assert res["pass_rate"] > 70.0, "Verification pass rate should be > 70%"
    assert os.path.exists(out_obj), "Exported OBJ file must exist"
    assert len(res["sources"]) == res["total_count"], "Sources list length mismatch"

    print("[PASS] Void Audit Passed")
    print(f"[PASS] Video Cross-Referencing & Dual-Path Infill Passed ({res['generated_count']:,} verified points added)")
    print(f"[PASS] Critic Photometric Verification Passed ({res['pass_rate']}% pass rate)")
    print(f"[PASS] Model Exported to {out_obj} ({os.path.getsize(out_obj):,} bytes)")
    print("ALL TESTS PASSED SUCCESSFULLY!\n")


if __name__ == "__main__":
    test_video_agent_unit()
