import os
import sys
import subprocess

def clone_repo(repo_url, target_dir):
    if os.path.exists(target_dir):
        print(f"[Setup] Target directory '{target_dir}' already exists. Skipping clone.")
        return True
    
    print(f"[Setup] Cloning {repo_url} into {target_dir}...")
    try:
        subprocess.run(["git", "clone", "--recursive", repo_url, target_dir], check=True)
        print(f"[Setup] Successfully cloned {repo_url}.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"[Setup] Error cloning {repo_url}: {e}", file=sys.stderr)
        return False

def main():
    # Base directory is d:\SIH2026\ai_service
    base_dir = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(base_dir, "models")
    
    os.makedirs(models_dir, exist_ok=True)
    
    dust3r_dir = os.path.join(models_dir, "dust3r")
    vggt_dir = os.path.join(models_dir, "vggt")
    
    success_dust3r = clone_repo("https://github.com/naver/dust3r.git", dust3r_dir)
    success_vggt = clone_repo("https://github.com/facebookresearch/vggt.git", vggt_dir)
    
    if success_dust3r and success_vggt:
        print("[Setup] Repositories cloned successfully.")
        print("[Setup] Note: Weight files will be loaded automatically via HuggingFace Hub during the first reconstruction run.")
    else:
        print("[Setup] Cloning failed for one or more repositories.", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
