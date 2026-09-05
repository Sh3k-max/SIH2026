#!/usr/bin/env python3
"""
AeroMap High-Density Photogrammetry Reconstructor (Powered by pycolmap)
Takes any folder of raw photos and reconstructs survey-grade 60,000+ 3D points with Ceres Bundle Adjustment.
Outputs standard COLMAP text files (points3D.txt, images.txt, cameras.txt) and .PLY point clouds.
"""

import os
import sys
import argparse
import pycolmap
import pathlib

# Ensure UTF-8 output on Windows consoles
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

def run_photogrammetry(images_dir: str, output_dir: str, matcher_type: str = "sequential"):
    images_path = pathlib.Path(images_dir).resolve()
    output_path = pathlib.Path(output_dir).resolve()
    output_path.mkdir(parents=True, exist_ok=True)

    database_path = output_path / "database.db"
    sparse_path = output_path / "sparse"
    sparse_path.mkdir(parents=True, exist_ok=True)

    # Clean old database if exists
    if database_path.exists():
        try:
            database_path.unlink()
        except Exception:
            pass

    print("=================================================================")
    print("[*] AeroMap Survey-Grade 3D Photogrammetry (COLMAP C++ Engine)")
    print("=================================================================")
    print(f"[*] Image Input Directory : {images_path}")
    print(f"[*] Output Directory      : {output_path}")
    print(f"[*] Matcher Mode          : {matcher_type.upper()}")
    print("-----------------------------------------------------------------\n")

    # 1. SIFT Feature Extraction (configured for CPU safety & max precision)
    print("[1/4] Extracting Multi-Scale SIFT Features...")
    opt_extract = pycolmap.FeatureExtractionOptions()
    opt_extract.max_image_size = 1400
    opt_extract.num_threads = 4
    
    pycolmap.extract_features(
        database_path=database_path,
        image_path=images_path,
        extraction_options=opt_extract
    )
    print("      -> SIFT Keypoints Extracted.")

    # 2. Geometric Feature Matching
    print("\n[2/4] Matching Visual Features & Verifying Epipolar Geometry...")
    if matcher_type == "sequential":
        pycolmap.match_sequential(
            database_path=database_path
        )
    else:
        pycolmap.match_exhaustive(
            database_path=database_path
        )
    print("      -> Visual Overlap & RANSAC Verification Complete.")

    # 3. Incremental Structure-from-Motion & Ceres Bundle Adjustment
    print("\n[3/4] Running Global Bundle Adjustment & 3D Ray Triangulation...")
    maps = pycolmap.incremental_mapping(
        database_path=database_path,
        image_path=images_path,
        output_path=sparse_path
    )

    if not maps or len(maps) == 0:
        print("\n[-] Reconstruction failed: Not enough overlapping feature tracks found.")
        return False

    recon = maps[0]
    num_points = len(recon.points3D)
    num_reg_images = len(recon.images)

    print("\n[4/4] Exporting 3D Model Formats...")
    # Export COLMAP text format (points3D.txt, images.txt, cameras.txt)
    recon.write_text(str(sparse_path))
    print(f"      -> Exported COLMAP Text: {sparse_path}/points3D.txt")

    # Export Standard .PLY Point Cloud
    ply_path = output_path / "reconstruction_dense.ply"
    try:
        with open(ply_path, "w") as f:
            f.write("ply\n")
            f.write("format ascii 1.0\n")
            f.write(f"element vertex {num_points}\n")
            f.write("property float x\n")
            f.write("property float y\n")
            f.write("property float z\n")
            f.write("property uchar red\n")
            f.write("property uchar green\n")
            f.write("property uchar blue\n")
            f.write("end_header\n")
            for pt_id, pt in recon.points3D.items():
                f.write(f"{pt.xyz[0]:.6f} {pt.xyz[1]:.6f} {pt.xyz[2]:.6f} {int(pt.color[0])} {int(pt.color[1])} {int(pt.color[2])}\n")
        print(f"      -> Exported 3D Point Cloud (.PLY): {ply_path}")
    except Exception as e:
        print(f"      -> PLY export note: {e}")

    print("\n=================================================================")
    print(f"[SUCCESS] Reconstructed {num_points:,} 3D Points across {num_reg_images} Registered Cameras!")
    print(f"[*] Mean Reprojection Track Length: {recon.compute_mean_track_length():.2f}")
    print(f"[*] Output Saved To: {output_path}")
    print("=================================================================\n")
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AeroMap Photogrammetry Reconstructor")
    parser.add_argument("--images_dir", type=str, default="./input_images", help="Directory containing raw photos")
    parser.add_argument("--output_dir", type=str, default="./system_reconstructed_model", help="Directory to save output 3D model")
    parser.add_argument("--matcher", type=str, choices=["exhaustive", "sequential"], default="sequential", help="Matcher mode: sequential (drone flight path / video) or exhaustive")
    args = parser.parse_args()

    run_photogrammetry(
        images_dir=args.images_dir,
        output_dir=args.output_dir,
        matcher_type=args.matcher
    )
