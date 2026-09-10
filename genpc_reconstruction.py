#!/usr/bin/env python3
"""
GenPC End-to-End Photogrammetry Reconstruction & Missing Pixel Completion Runner
CVPR 2025: Zero-Shot Point Cloud Completion via 3D Generative Priors.

Workflow:
1. Ingests raw drone/survey images, video, or partial 3D scan.
2. Extracts high-confidence sparse / dense point cloud baseline.
3. Applies GenPC Depth Prompting to detect missing pixels, occlusion holes, and blind spots.
4. Synthesizes 3D surface geometry using generative priors with Geometric Preserving Fusion.
5. Exports complete 3D model (.OBJ and .PLY) with true RGB color fidelity.
"""

import os
import sys
import argparse
import time
import numpy as np

# Ensure UTF-8 output
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from genpc_engine import GenPCCompletionEngine


def run_genpc_pipeline(
    input_path: str,
    output_path: str,
    inpaint_ratio: float = 0.35,
    target_res: int = 256,
    num_views: int = 8
):
    start_time = time.time()
    print("\n" + "=" * 75)
    print("  GenPC: Zero-Shot 3D Reconstruction & Missing Pixel Completion")
    print("=" * 75 + "\n")
    print(f"[*] Input Path:  {input_path}")
    print(f"[*] Output Path: {output_path}")

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    # Check if input is a 3D model (.obj / .ply) or an image directory
    if os.path.isfile(input_path) and input_path.lower().endswith(('.obj', '.ply', '.txt')):
        print("[Stage 1/2] Ingesting existing partial 3D scan...")
        result = GenPCCompletionEngine.complete_obj_file(
            input_obj_path=input_path,
            output_obj_path=output_path,
            inpaint_ratio=inpaint_ratio
        )
    else:
        # Image directory: First run DUSt3R or SIFT SfM baseline
        print("[Stage 1/2] Reconstructing baseline geometry from multi-view images...")
        image_dir = input_path
        if not os.path.exists(image_dir):
            raise FileNotFoundError(f"Input path not found: {image_dir}")

        # Check for DUSt3R or SfM reconstructor
        dust3r_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dust3r_reconstruction.py")
        temp_baseline_obj = os.path.join(os.path.dirname(output_path), "temp_baseline.obj")
        baseline_success = False
        if os.path.exists(dust3r_script):
            print("[INFO] Using DUSt3R ViT for baseline partial surface reconstruction...")
            try:
                from dust3r_reconstruction import run_dust3r_reconstruction
                run_dust3r_reconstruction(image_dir=image_dir, output_path=temp_baseline_obj, image_size=224, max_images=12)
                if os.path.exists(temp_baseline_obj) and os.path.getsize(temp_baseline_obj) > 100:
                    baseline_success = True
            except Exception as e:
                print(f"[WARN] DUSt3R baseline notice ({e}). Falling back to SIFT SfM...")

        if not baseline_success:
            print("[INFO] Using SIFT Photogrammetry for baseline sparse reconstruction...")
            from reconstruction_engine import Drone3DReconstructor
            recon = Drone3DReconstructor(feature_type="SIFT", max_features=3000)
            images = [os.path.join(image_dir, f) for f in os.listdir(image_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
            res = recon.reconstruct(images)
            pts = res["points"]
            cols = res["colors"]
            GenPCCompletionEngine.export_obj(pts, cols, temp_baseline_obj)

        print("[Stage 2/2] Applying GenPC Missing Pixel Completion & Geometric Preserving Fusion...")
        result = GenPCCompletionEngine.complete_obj_file(
            input_obj_path=temp_baseline_obj,
            output_obj_path=output_path,
            inpaint_ratio=inpaint_ratio
        )

        if os.path.exists(temp_baseline_obj):
            try:
                os.remove(temp_baseline_obj)
            except Exception:
                pass

    elapsed = time.time() - start_time
    print("\n" + "=" * 75)
    print(f"[SUCCESS] GenPC Model Successfully Generated in {elapsed:.2f} seconds!")
    print(f"[*] Total 3D Points:        {result['total_count']:,}")
    print(f"[*] Missing Pixels Repaired: {result['missing_pixels_inpainted']:,}")
    print(f"[*] Synthesized GenPC Pts:  {result['generated_count']:,} ({result['generated_pct']}%)")
    print(f"[*] Output Model:           {output_path}")
    print("=" * 75 + "\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GenPC Zero-Shot 3D Point Cloud Completion & Missing Pixel Inpainting")
    parser.add_argument("--input", "--input_dir", type=str, required=True, help="Input directory of images or path to partial .obj model")
    parser.add_argument("--output", type=str, default="output/genpc_completed_model.obj", help="Path for completed output .obj")
    parser.add_argument("--inpaint_ratio", type=float, default=0.35, help="Sampling density ratio for missing pixels")
    parser.add_argument("--res", type=int, default=256, help="Depth buffer projection resolution")
    parser.add_argument("--views", type=int, default=8, help="Number of virtual depth prompting camera views")
    args = parser.parse_args()

    run_genpc_pipeline(
        input_path=args.input,
        output_path=args.output,
        inpaint_ratio=args.inpaint_ratio,
        target_res=args.res,
        num_views=args.views
    )
