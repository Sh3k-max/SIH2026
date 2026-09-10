"""
Test script for Full Volumetric 3D World Completion
Extends the ground plane continuously under all buildings and solidifies building rears and roofs.
"""

import os
import sys
import numpy as np
from scipy.spatial import cKDTree

def complete_full_world(input_obj: str, output_obj: str):
    print(f"Loading {input_obj}...")
    with open(input_obj, "r", encoding="utf-8", errors="ignore") as f:
        lines = [l.strip().split()[1:] for l in f if l.startswith("v ")]

    pts = np.array([[float(p[0]), float(p[1]), float(p[2])] for p in lines], dtype=np.float32)
    cols = np.array([[float(p[3]), float(p[4]), float(p[5])] if len(p) >= 6 else [0.85, 0.85, 0.85] for p in lines], dtype=np.float32)

    N_orig = len(pts)
    print(f"Original vertices: {N_orig:,}")

    # =========================================================================
    # 1. Continuous Ground Plane Infilling & Extension
    # =========================================================================
    y_ground_thresh = float(np.percentile(pts[:, 1], 16))
    ground_mask = pts[:, 1] <= (y_ground_thresh + 0.008)
    ground_pts = pts[ground_mask]
    ground_cols = cols[ground_mask]

    # Fit smooth ground plane
    A = np.column_stack([ground_pts[:, 0], ground_pts[:, 2], np.ones(len(ground_pts))])
    coeffs, _, _, _ = np.linalg.lstsq(A, ground_pts[:, 1], rcond=None)

    # Grid across entire scene bounds with a slight perimeter margin
    x_min, x_max = float(pts[:, 0].min() - 0.025), float(pts[:, 0].max() + 0.025)
    z_min, z_max = float(pts[:, 2].min() - 0.025), float(pts[:, 2].max() + 0.025)
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
    new_ground_pts = np.column_stack([missing_xz[:, 0], new_gy, missing_xz[:, 1]])
    
    # Ground color sampling from nearest captured ground with subtle texture
    new_ground_cols = ground_cols[idxs[need_ground]]
    new_ground_cols = np.clip(new_ground_cols + np.random.normal(0, 0.015, new_ground_cols.shape), 0.0, 1.0)
    print(f"Synthesized continuous ground: {len(new_ground_pts):,} points")

    # =========================================================================
    # 2. Volumetric Building Solidification (Roofs & Rear Walls)
    # =========================================================================
    b_mask = pts[:, 1] > (y_ground_thresh + 0.015)
    b_pts = pts[b_mask]
    b_cols = cols[b_mask]

    b_tree_2d = cKDTree(b_pts[:, [0, 2]])
    
    # 2a. Building Roof Capping (solidify open tops)
    # For every high facade point, extrude the roof backwards across building depth
    roof_pts = []
    roof_cols = []
    
    top_mask = b_pts[:, 1] > (y_ground_thresh + 0.035)
    top_pts = b_pts[top_mask]
    top_cols = b_cols[top_mask]
    
    # Subsample top perimeter points
    step_roof = 16
    sample_top_pts = top_pts[::step_roof]
    sample_top_cols = top_cols[::step_roof]
    
    for pt, col in zip(sample_top_pts, sample_top_cols):
        # Extrude roof backwards from front edge into building depth
        for z_off in np.linspace(0.006, 0.045, 5):
            r_pt = [pt[0], pt[1], pt[2] + z_off]
            roof_pts.append(r_pt)
            # Roof texture: realistic architectural dark gray/slate
            roof_c = np.clip(col * 0.70 + np.array([0.08, 0.08, 0.08]), 0.0, 1.0)
            roof_cols.append(roof_c)

    print(f"Synthesized solid roof caps: {len(roof_pts):,} points")

    # 2b. Building Rear Facade & Solid Backside Closure
    # Extrude back walls for front-facing facades
    rear_pts = []
    rear_cols = []
    
    sample_stride = 18
    sample_b_pts = b_pts[::sample_stride]
    sample_b_cols = b_cols[::sample_stride]
    
    for pt, col in zip(sample_b_pts, sample_b_cols):
        wall_depth = 0.045
        rear_z = pt[2] + wall_depth
        
        # Check if rear location is currently empty
        d_rear, _ = b_tree_2d.query([pt[0], rear_z], k=1)
        if d_rear > 0.012:
            # Generate vertical column on rear wall down to ground
            curr_y = pt[1]
            ground_at_pt = coeffs[0] * pt[0] + coeffs[1] * rear_z + coeffs[2]
            
            y_steps = np.arange(ground_at_pt, curr_y, grid_res * 1.6)
            for y in y_steps:
                rear_pts.append([pt[0], y, rear_z])
                mod_c = np.clip(col * 0.86 + np.random.normal(0, 0.01, 3), 0.0, 1.0)
                rear_cols.append(mod_c)

    print(f"Synthesized rear facades & side walls: {len(rear_pts):,} points")

    # =========================================================================
    # 3. Assemble Unified Solid World Model
    # =========================================================================
    added_pts_parts = [new_ground_pts]
    added_cols_parts = [new_ground_cols]

    if roof_pts:
        added_pts_parts.append(np.array(roof_pts, dtype=np.float32))
        added_cols_parts.append(np.array(roof_cols, dtype=np.float32))

    if rear_pts:
        added_pts_parts.append(np.array(rear_pts, dtype=np.float32))
        added_cols_parts.append(np.array(rear_cols, dtype=np.float32))

    all_added_pts = np.vstack(added_pts_parts)
    all_added_cols = np.vstack(added_cols_parts)

    total_pts = np.vstack([pts, all_added_pts])
    total_cols = np.vstack([cols, all_added_cols])

    print(f"Total Unified World Vertices: {len(total_pts):,} (+{len(all_added_pts):,} points added)")

    # Export to OBJ
    print(f"Writing complete 3D world to {output_obj}...")
    with open(output_obj, "w", encoding="utf-8") as f:
        f.write("# Fully Solid Traversable 3D World Model\n")
        f.write(f"# Total vertices: {len(total_pts)}\n")
        f.write(f"# Infilled Ground Points: {len(new_ground_pts)}\n")
        f.write(f"# Solid Roof Points: {len(roof_pts)}\n")
        f.write(f"# Rear Facade Points: {len(rear_pts)}\n")
        for p, c in zip(total_pts, total_cols):
            f.write(f"v {p[0]:.5f} {p[1]:.5f} {p[2]:.5f} {c[0]:.4f} {c[1]:.4f} {c[2]:.4f}\n")

    print("Done! Solid 3D World Exported Successfully!")

if __name__ == "__main__":
    complete_full_world(
        "ui/public/models/video_3d_world.obj",
        "output/video_3d_world_solid_completed.obj"
    )
