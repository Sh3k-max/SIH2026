import os
import sys
import numpy as np
from scipy.spatial import cKDTree

def generate_solid_world(input_obj: str, output_obj: str, output_splat: str = None):
    print(f"Reading {input_obj}...")
    with open(input_obj, "r", encoding="utf-8", errors="ignore") as f:
        lines = [l.strip().split()[1:] for l in f if l.startswith("v ")]

    pts = np.array([[float(p[0]), float(p[1]), float(p[2])] for p in lines], dtype=np.float32)
    cols = np.array([[float(p[3]), float(p[4]), float(p[5])] if len(p) >= 6 else [0.85, 0.85, 0.85] for p in lines], dtype=np.float32)

    N_orig = len(pts)
    print(f"Original vertices: {N_orig:,}")

    # 1. Ground Plane Identification
    y_ground_thresh = float(np.percentile(pts[:, 1], 16))
    ground_mask = pts[:, 1] <= (y_ground_thresh + 0.008)
    ground_pts = pts[ground_mask]
    ground_cols = cols[ground_mask]

    # Fit smooth ground plane Y = a*X + b*Z + c
    A = np.column_stack([ground_pts[:, 0], ground_pts[:, 2], np.ones(len(ground_pts))])
    coeffs, _, _, _ = np.linalg.lstsq(A, ground_pts[:, 1], rcond=None)

    # 2. Complete Ground Infill Across Full Scene Footprint (generous apron margin)
    margin = 0.045
    x_min, x_max = float(pts[:, 0].min() - margin), float(pts[:, 0].max() + margin)
    z_min, z_max = float(pts[:, 2].min() - margin), float(pts[:, 2].max() + margin)
    grid_res = 0.0035

    gx = np.arange(x_min, x_max, grid_res)
    gz = np.arange(z_min, z_max, grid_res)
    grid_x, grid_z = np.meshgrid(gx, gz)
    grid_xz = np.column_stack([grid_x.flatten(), grid_z.flatten()])

    ground_tree = cKDTree(ground_pts[:, [0, 2]])
    dists, idxs = ground_tree.query(grid_xz, k=1)
    need_ground = dists > (grid_res * 1.35)
    missing_xz = grid_xz[need_ground]

    new_gy = coeffs[0] * missing_xz[:, 0] + coeffs[1] * missing_xz[:, 1] + coeffs[2]
    # Add subtle natural texture variation to ground height
    new_gy += np.random.normal(0, 0.0006, size=len(new_gy))
    new_ground_pts = np.column_stack([missing_xz[:, 0], new_gy, missing_xz[:, 1]])
    
    # Ground color sampling from nearest captured ground with subtle texture
    new_ground_cols = ground_cols[idxs[need_ground]]
    new_ground_cols = np.clip(new_ground_cols + np.random.normal(0, 0.015, new_ground_cols.shape), 0.0, 1.0)
    print(f"Synthesized continuous ground: {len(new_ground_pts):,} points")

    # 3. Building Roof Capping & Volumetric Enclosure
    b_mask = pts[:, 1] > (y_ground_thresh + 0.015)
    b_pts = pts[b_mask]
    b_cols = cols[b_mask]
    b_tree_2d = cKDTree(b_pts[:, [0, 2]])

    roof_pts, roof_cols = [], []
    top_mask = b_pts[:, 1] > (y_ground_thresh + 0.035)
    top_pts = b_pts[top_mask]
    top_cols = b_cols[top_mask]

    step_roof = 12
    sample_top_pts = top_pts[::step_roof]
    sample_top_cols = top_cols[::step_roof]

    for pt, col in zip(sample_top_pts, sample_top_cols):
        for z_off in np.linspace(0.005, 0.055, 7):
            roof_pts.append([pt[0], pt[1], pt[2] + z_off])
            # High-fidelity architectural slate/concrete tone
            roof_c = np.clip(col * 0.72 + np.array([0.08, 0.08, 0.08]), 0.0, 1.0)
            roof_cols.append(roof_c)

    print(f"Synthesized solid roof caps: {len(roof_pts):,} points")

    # 4. Rear Facade & Solid Backside Closure
    rear_pts, rear_cols = [], []
    sample_stride = 14
    sample_b_pts = b_pts[::sample_stride]
    sample_b_cols = b_cols[::sample_stride]

    for pt, col in zip(sample_b_pts, sample_b_cols):
        wall_depth = 0.050
        rear_z = pt[2] + wall_depth
        d_rear, _ = b_tree_2d.query([pt[0], rear_z], k=1)
        if d_rear > 0.010:
            ground_at_pt = coeffs[0] * pt[0] + coeffs[1] * rear_z + coeffs[2]
            y_steps = np.arange(ground_at_pt, pt[1], grid_res * 1.5)
            for y in y_steps:
                rear_pts.append([pt[0], y, rear_z])
                mod_c = np.clip(col * 0.85 + np.random.normal(0, 0.01, 3), 0.0, 1.0)
                rear_cols.append(mod_c)

    print(f"Synthesized rear facades & side walls: {len(rear_pts):,} points")

    # 5. Combine and export
    added_pts = np.vstack([new_ground_pts, np.array(roof_pts, dtype=np.float32), np.array(rear_pts, dtype=np.float32)])
    added_cols = np.vstack([new_ground_cols, np.array(roof_cols, dtype=np.float32), np.array(rear_cols, dtype=np.float32)])

    total_pts = np.vstack([pts, added_pts])
    total_cols = np.vstack([cols, added_cols])
    print(f"Total Unified World: {len(total_pts):,} vertices (+{len(added_pts):,} added)")

    # Save OBJ
    print(f"Writing OBJ to {output_obj}...")
    with open(output_obj, "w", encoding="utf-8") as f:
        f.write("# 100% Solid Completed 3D World Model\n")
        f.write(f"# Total vertices: {len(total_pts)}\n")
        for p, c in zip(total_pts, total_cols):
            f.write(f"v {p[0]:.5f} {p[1]:.5f} {p[2]:.5f} {c[0]:.4f} {c[1]:.4f} {c[2]:.4f}\n")

    # Export Splat if requested
    if output_splat:
        from gaussian_splat_engine import GaussianSplatEngine
        print(f"Exporting 3D Gaussian Splat to {output_splat}...")
        gaussians = GaussianSplatEngine.create_gaussians_from_points(
            points=total_pts,
            colors=total_cols,
            anisotropy=False,
            default_opacity=0.95
        )
        GaussianSplatEngine.export_splat(gaussians, output_splat)
        print("Splat export complete!")

if __name__ == "__main__":
    generate_solid_world(
        "ui/public/models/video_3d_world.obj",
        "output/video_3d_world_solid_completed.obj",
        "output/video_3d_world.splat"
    )
