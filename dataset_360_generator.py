"""
Chinese Temple / Pavilion Landmark Complex 360 Demonstration Dataset Generator
Creates a realistic 360 single-pass flight dataset over an ancient temple complex with:
- Multi-tier Pagoda / Main Sanctuary Hall with curved golden tile eaves
- Red lacquer wooden pillars & stone courtyard floor
- Pine trees, courtyard walls, stone lanterns
- Simulated single-pass 360 camera flight path
- Precomputed keyframes, cubemap views, 3DGS splats, and AI completed rears
"""

import os
import sys
import json
import cv2
import numpy as np

try:
    if sys.stdout.encoding != 'utf-8':
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from gaussian_splat_engine import GaussianSplatEngine
from coverage_engine import CoverageAnalysisEngine
from ai_completion_engine import AISceneCompletionEngine


def generate_chinese_temple_demo(output_dir: str = "output/demo_temple"):
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(os.path.join(output_dir, "keyframes_360"), exist_ok=True)
    os.makedirs(os.path.join(output_dir, "cubemap_views"), exist_ok=True)

    print("\n" + "=" * 75)
    print("[INFO] GENERATING CHINESE TEMPLE 360 DEMONSTRATION DATASET")
    print("=" * 75)

    np.random.seed(42)
    captured_pts = []
    captured_cols = []

    # 1. Stone Courtyard Ground (Captured from above)
    for x in np.linspace(-30, 30, 90):
        for z in np.linspace(-30, 30, 90):
            # Stone tile variations
            c_val = np.random.uniform(0.55, 0.68)
            captured_pts.append([x, np.random.normal(-0.05, 0.02), z])
            captured_cols.append([c_val * 0.95, c_val, c_val * 0.92])

    # 2. Main Temple Hall (Front & Sides Captured, Rear Occluded)
    # Foundation Base
    for x in np.linspace(-12, 12, 40):
        for z in np.linspace(-8, 8, 30):
            for y in np.linspace(0, 1.2, 5):
                captured_pts.append([x, y, z])
                captured_cols.append([0.72, 0.70, 0.65]) # Granite

    # Red Lacquer Pillars (Front Facade)
    pillar_x_coords = [-10, -6, -2, 2, 6, 10]
    for px in pillar_x_coords:
        for pz in [-7.5, 7.5]:
            for y in np.linspace(1.2, 6.5, 30):
                for angle in np.linspace(0, 2*np.pi, 8):
                    rad = 0.45
                    captured_pts.append([px + rad*np.cos(angle), y, pz + rad*np.sin(angle)])
                    captured_cols.append([0.85, 0.18, 0.12]) # Imperial Red

    # Temple Front Wall & Golden Lattice Doors
    for x in np.linspace(-9.5, 9.5, 50):
        for y in np.linspace(1.2, 5.8, 25):
            captured_pts.append([x, y, -7.0])
            captured_cols.append([0.78, 0.55, 0.15]) # Gold / Wood

    # Multi-Tier Curved Golden Roof (Front Slope Captured)
    # Tier 1 Eaves
    for x in np.linspace(-15, 15, 60):
        for z in np.linspace(-10, 0, 25): # Only front half captured
            # Curve up at corners
            curve = 0.008 * (x**2 + z**2)
            y = 6.2 + curve - 0.15 * z
            captured_pts.append([x, y, z])
            captured_cols.append([0.95, 0.72, 0.12]) # Imperial Gold Glazed Tiles

    # Tier 2 Upper Sanctuary Roof
    for x in np.linspace(-9, 9, 40):
        for z in np.linspace(-6, 0, 20):
            curve = 0.012 * (x**2 + z**2)
            y = 9.0 + curve - 0.2 * z
            captured_pts.append([x, y, z])
            captured_cols.append([0.98, 0.75, 0.15])

    # 3. Pine Trees & Garden Vegetation
    tree_centers = [(-20, -15), (-22, 10), (22, -12), (20, 15), (-18, 20)]
    for tx, tz in tree_centers:
        # Trunk
        for y in np.linspace(0, 4.5, 15):
            captured_pts.append([tx + np.random.normal(0, 0.15), y, tz + np.random.normal(0, 0.15)])
            captured_cols.append([0.35, 0.25, 0.18]) # Bark
        # Foliage Canopy
        for _ in range(400):
            rx = np.random.normal(0, 2.5)
            ry = np.random.normal(5.5, 1.2)
            rz = np.random.normal(0, 2.5)
            captured_pts.append([tx + rx, ry, tz + rz])
            g = np.random.uniform(0.35, 0.65)
            captured_cols.append([0.15, g, 0.18]) # Pine Green

    # 4. Courtyard Perimeter Wall
    for x in np.linspace(-28, 28, 70):
        for y in np.linspace(0, 3.2, 10):
            captured_pts.append([x, y, -28])
            captured_cols.append([0.88, 0.86, 0.82]) # White Plaster Wall
            # Gray Wall Cap Tiles
            if y > 3.0:
                captured_cols[-1] = [0.28, 0.30, 0.34]

    captured_pts = np.array(captured_pts, dtype=np.float32)
    captured_cols = np.array(captured_cols, dtype=np.float32)

    # 5. Simulated Single-Pass 360 Drone Flight Trajectory (Curved arc in front of temple)
    trajectory = []
    cam_positions = []
    t_vals = np.linspace(-np.pi * 0.45, np.pi * 0.45, 16)
    for i, t in enumerate(t_vals):
        # Drone flies in an arc at altitude 8m overlooking the temple front
        cam_x = float(32 * np.sin(t))
        cam_z = float(-24 - 10 * np.cos(t))
        cam_y = float(7.5 + 2.0 * np.sin(t * 2))
        cam_pos = [cam_x, cam_y, cam_z]
        cam_positions.append(cam_pos)

        trajectory.append({
            "frame_idx": i * 30,
            "timestamp": round(i * 1.0, 2),
            "position": [round(c, 3) for c in cam_pos],
            "rotation": [0.0, float(round(np.degrees(-t), 1)), 0.0],
            "fov": 360.0
        })

    cam_positions = np.array(cam_positions, dtype=np.float32)

    # 6. Compute 3D Visibility & Coverage Confidence
    coverage_result = CoverageAnalysisEngine.compute_point_coverage_confidence(
        points=captured_pts,
        camera_positions=cam_positions,
        max_view_distance=48.0
    )
    confidences = coverage_result["confidences"]

    # 7. AI Generative Gap Completion (Completing the occluded rear half of temple & roofs)
    completion_result = AISceneCompletionEngine.complete_scene_gaps(
        captured_points=captured_pts,
        captured_colors=captured_cols,
        coverage_confidences=confidences,
        grid_resolution=0.55
    )

    total_pts = completion_result["total_points"]
    total_cols = completion_result["total_colors"]
    total_conf = completion_result["confidences"]
    sources = completion_result["sources"]

    # 8. Generate 3D Gaussian Splats with Confidence Tagging
    gaussians = GaussianSplatEngine.create_gaussians_from_points(
        points=total_pts,
        colors=total_cols,
        k_neighbors=4,
        default_opacity=0.88
    )

    # Export Formats
    splat_path = os.path.join(output_dir, "temple_world.splat")
    ply_path = os.path.join(output_dir, "temple_world_3dgs.ply")
    obj_path = os.path.join(output_dir, "temple_world.obj")
    meta_path = os.path.join(output_dir, "scene_metadata.json")

    GaussianSplatEngine.export_splat(gaussians, splat_path)
    GaussianSplatEngine.export_ply(gaussians, ply_path)

    # Export clean OBJ with confidence RGB vertex colors
    with open(obj_path, "w", encoding="utf-8") as f:
        f.write("# Chinese Temple 360 AI-Completed 3D World\n")
        for p, c in zip(total_pts, total_cols):
            f.write(f"v {p[0]:.4f} {p[1]:.4f} {p[2]:.4f} {c[0]:.4f} {c[1]:.4f} {c[2]:.4f}\n")

    # Generate Synthetic 360 Keyframe Thumbnails for UI Timeline
    keyframe_timeline = []
    for rank, cam in enumerate(trajectory):
        kf_name = f"keyframe_{rank:03d}_t{cam['timestamp']}s.jpg"
        kf_path = os.path.join(output_dir, "keyframes_360", kf_name)

        # Create simulated 360 equirectangular image (sky on top, temple in center, stone floor bottom)
        eq_img = np.zeros((256, 512, 3), dtype=np.uint8)
        eq_img[:100, :] = [200, 140, 60]  # Sky (BGR)
        eq_img[100:180, :] = [40, 50, 160] # Temple Red/Gold
        eq_img[180:, :] = [140, 140, 135] # Stone Floor
        # Add frame marker
        cv2.putText(eq_img, f"360 VIEW #{rank+1} (t={cam['timestamp']}s)", (20, 40),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        cv2.imwrite(kf_path, eq_img, [cv2.IMWRITE_JPEG_QUALITY, 90])

        info_score = round(0.72 + 0.25 * np.sin(rank * 0.5)**2, 3)
        keyframe_timeline.append({
            "rank": rank,
            "frame_index": cam["frame_idx"],
            "timestamp": cam["timestamp"],
            "filename": kf_name,
            "file_url": f"/output/demo_temple/keyframes_360/{kf_name}",
            "sharpness": round(180 + 60 * np.cos(rank * 0.4), 1),
            "info_score": info_score,
            "motion_diff": round(0.12 + 0.08 * np.sin(rank * 0.6), 3)
        })

    # Save complete metadata
    metadata = {
        "scene_name": "Ancient Temple Sanctuary Complex",
        "video_duration_sec": 15.0,
        "resolution": "3840x1920 (4K 360°)",
        "total_extracted_frames": 450,
        "selected_keyframes_count": len(keyframe_timeline),
        "redundancy_eliminated_pct": 96.4,
        "total_gaussians": len(total_pts),
        "captured_count": completion_result["captured_count"],
        "generated_count": completion_result["generated_count"],
        "captured_pct": completion_result["captured_pct"],
        "generated_pct": completion_result["generated_pct"],
        "avg_confidence": completion_result["avg_confidence"],
        "coverage_stats": {
            "high_pct": coverage_result["high_coverage_pct"],
            "partial_pct": coverage_result["partial_coverage_pct"],
            "low_pct": coverage_result["low_coverage_pct"]
        },
        "trajectory": trajectory,
        "keyframes": keyframe_timeline,
        "model_urls": {
            "splat": "/output/demo_temple/temple_world.splat",
            "ply": "/output/demo_temple/temple_world_3dgs.ply",
            "obj": "/output/demo_temple/temple_world.obj"
        }
    }

    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    print(f"[SUCCESS] Chinese Temple 360 Dataset created successfully!")
    print(f"   -> Total Gaussians: {len(total_pts):,} (Captured: {completion_result['captured_pct']}%, AI Inpainted: {completion_result['generated_pct']}%)")
    print(f"   -> Average Confidence: {completion_result['avg_confidence'] * 100:.1f}%")
    return metadata


if __name__ == "__main__":
    generate_chinese_temple_demo()
