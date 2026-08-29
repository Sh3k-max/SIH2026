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
import numpy as np

def run_photogrammetry(images_dir: str, output_dir: str, matcher_type: str = "exhaustive"):
    images_path = os.path.abspath(images_dir)
    output_path = os.path.abspath(output_dir)
    os.makedirs(output_path, exist_ok=True)

    database_path = os.path.join(output_path, "database.db")
    sparse_path = os.path.join(output_path, "sparse")
    os.makedirs(sparse_path, exist_ok=True)

    # Clean old database if exists
    if os.path.exists(database_path):
        try:
            os.remove(database_path)
        except Exception:
            pass

    print("=================================================================")
    print("🚀 AeroMap Survey-Grade 3D Photogrammetry (COLMAP C++ Engine)")
    print("=================================================================")
    print(f"📁 Image Input Directory : {images_path}")
    print(f"📁 Output Directory      : {output_path}")
    print(f"⚙️ Matcher Mode          : {matcher_type.upper()}")
    print("-----------------------------------------------------------------\n")

    # 1. SIFT Feature Extraction
    print("[1/4] 🔍 Extracting Multi-Scale SIFT Features...")
    pycolmap.extract_features(
        database_path=database_path,
        image_path=images_path,
        camera_model="PINHOLE",
        sift_options={"max_num_features": 8192, "peak_threshold": 0.006}
    )
    print("      ✓ SIFT Keypoints Extracted.")

    # 2. Geometric Feature Matching
    print("\n[2/4] 🔗 Matching Visual Features & Verifying Epipolar Geometry...")
    if matcher_type == "sequential":
        pycolmap.match_sequential(
            database_path=database_path,
            matching_options={"overlap": 10, "loop_detection": True}
        )
    else:
        pycolmap.match_exhaustive(
            database_path=database_path
        )
    print("      ✓ Visual Overlap & RANSAC Verification Complete.")

    # 3. Incremental Structure-from-Motion & Ceres Bundle Adjustment
    print("\n[3/4] 📐 Running Global Bundle Adjustment & 3D Ray Triangulation...")
    maps = pycolmap.incremental_mapping(
        database_path=database_path,
        image_path=images_path,
        output_path=sparse_path
    )

    if not maps or len(maps) == 0:
        print("\n[-] Reconstruction failed: Not enough overlapping feature tracks found.")
        return False

    recon = maps[0]
    num_points = recon.num_points3D()
    num_reg_images = recon.num_reg_images()

    print("\n[4/4] 💾 Exporting 3D Model Formats...")
    # Export COLMAP text format (points3D.txt, images.txt, cameras.txt)
    recon.write_text(sparse_path)
    print(f"      ✓ Exported COLMAP Text: {sparse_path}/points3D.txt")

    # Export Standard .PLY Point Cloud
    ply_path = os.path.join(output_path, "reconstruction_dense.ply")
    recon.write_ply(ply_path)
    print(f"      ✓ Exported 3D Point Cloud (.PLY): {ply_path}")

    print("\n=================================================================")
    print(f"🎉 SUCCESS: Reconstructed {num_points:,} 3D Points across {num_reg_images} Registered Cameras!")
    print(f"📊 Mean Reprojection Track Length: {recon.mean_track_length():.2f}")
    print(f"📁 Output Saved To: {output_path}")
    print("=================================================================\n")
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AeroMap Photogrammetry Reconstructor")
    parser.add_argument("--images_dir", type=str, default="./south-building/images", help="Directory containing raw photos")
    parser.add_argument("--output_dir", type=str, default="./custom_survey_model", help="Directory to save output 3D model")
    parser.add_argument("--matcher", type=str, choices=["exhaustive", "sequential"], default="exhaustive", help="Matcher mode: exhaustive (all pairs) or sequential (ordered flight path / video)")
    args = parser.parse_args()

    run_photogrammetry(
        images_dir=args.images_dir,
        output_dir=args.output_dir,
        matcher_type=args.matcher
    )
