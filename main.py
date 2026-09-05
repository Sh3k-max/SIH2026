"""
Drone to 3D Model CLI Tool
Usage:
    python main.py --input_dir ./drone_images --output ./output/model.obj --format obj --method poisson
"""

import os
import sys
import argparse
import glob
import time
from reconstruction_engine import Drone3DReconstructor, MeshReconstructor, HAS_OPEN3D


def main():
    parser = argparse.ArgumentParser(
        description="Convert any number of drone aerial photos into a 3D point cloud or textured 3D mesh."
    )
    parser.add_argument(
        "--input_dir", "-i",
        type=str,
        required=True,
        help="Path to folder containing drone images (JPG, PNG, TIFF)"
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default="output/reconstructed_model.obj",
        help="Path to save output 3D file (e.g. output/model.obj or output/model.ply)"
    )
    parser.add_argument(
        "--format", "-f",
        type=str,
        choices=["obj", "ply", "glb", "stl"],
        default="obj",
        help="Output 3D mesh format (default: obj)"
    )
    parser.add_argument(
        "--feature_type",
        type=str,
        choices=["SIFT", "ORB"],
        default="SIFT",
        help="Feature detection algorithm (default: SIFT)"
    )
    parser.add_argument(
        "--max_features",
        type=int,
        default=4000,
        help="Max keypoints per image (default: 4000)"
    )
    parser.add_argument(
        "--mesh_method",
        type=str,
        choices=["poisson", "bpa", "pointcloud"],
        default="poisson",
        help="Meshing algorithm: poisson (Screened Poisson), bpa (Ball Pivoting), or pointcloud (point cloud only)"
    )
    parser.add_argument(
        "--poisson_depth",
        type=int,
        default=9,
        help="Octree depth for Poisson reconstruction (higher = more detail, default: 9)"
    )

    args = parser.parse_args()

    # Discover images
    supported_extensions = ["*.jpg", "*.jpeg", "*.png", "*.JPG", "*.JPEG", "*.PNG", "*.tif", "*.tiff"]
    image_paths = []
    for ext in supported_extensions:
        image_paths.extend(glob.glob(os.path.join(args.input_dir, ext)))

    # Sort to ensure sequential order if named sequentially
    image_paths = sorted(list(set(image_paths)))

    if len(image_paths) < 2:
        print(f"[ERROR] Found only {len(image_paths)} images in '{args.input_dir}'. At least 2 overlapping images are required.")
        sys.exit(1)

    print("=" * 65)
    print("[DRONE 3D PHOTOGRAMMETRY & RECONSTRUCTION PIPELINE]")
    print("=" * 65)
    print(f"  Input Directory   : {args.input_dir}")
    print(f"  Images Found      : {len(image_paths)}")
    print(f"  Feature Detector  : {args.feature_type} (Max {args.max_features} pts/img)")
    print(f"  Meshing Algorithm : {args.mesh_method}")
    print(f"  Output Destination: {args.output}")
    print("=" * 65)

    start_time = time.time()

    # Progress visualizer
    def print_progress(fraction: float, message: str):
        bar_len = 30
        filled = int(round(bar_len * fraction))
        bar = "#" * filled + "-" * (bar_len - filled)
        sys.stdout.write(f"\r[{bar}] {int(fraction * 100):3d}% | {message[:40]:<40}")
        sys.stdout.flush()

    try:
        reconstructor = Drone3DReconstructor(
            feature_type=args.feature_type,
            max_features=args.max_features
        )

        result = reconstructor.reconstruct(image_paths, progress_callback=print_progress)
        print("\n")

        points = result["points"]
        colors = result["colors"]
        print(f"[SUCCESS] Sparse to Dense SfM completed!")
        print(f"   * Reconstructed Points: {len(points):,}")
        print(f"   * Registered Views    : {result['registered_count']}/{result['total_images']}")

        # Meshing
        if args.mesh_method == "pointcloud" or not HAS_OPEN3D:
            print(f"[INFO] Exporting 3D Point Cloud to: {args.output}")
            MeshReconstructor.export_3d_model(result, args.output, format_type=args.format)
        else:
            print(f"[INFO] Generating 3D polygonal mesh surface using {args.mesh_method.upper()}...")
            mesh = MeshReconstructor.generate_mesh(
                points,
                colors,
                method=args.mesh_method,
                depth=args.poisson_depth
            )
            print(f"[INFO] Exporting 3D Mesh to: {args.output}")
            MeshReconstructor.export_3d_model(mesh, args.output, format_type=args.format)

        elapsed = time.time() - start_time
        print("=" * 65)
        print(f"[SUCCESS] 3D Reconstruction Finished Successfully in {elapsed:.2f}s!")
        print(f"Output saved to: {os.path.abspath(args.output)}")
        print("=" * 65)

    except Exception as e:
        print(f"\n[ERROR] Reconstruction failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
