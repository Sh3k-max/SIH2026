import sys
import glob
import time
import numpy as np
import torch
from PIL import Image

sys.path.insert(0, ".")
from vggt.models.vggt import VGGT

print("[1] Loading VGGT-1B model from local cache...")
t0 = time.time()
model = VGGT.from_pretrained("facebook/VGGT-1B")
model.eval()
print(f"[1] Loaded in {time.time() - t0:.2f}s")

# Load 2 images
imgs = []
img_files = sorted(glob.glob("sample_drone_flight/*.jpg"))[:2]
for f in img_files:
    im = Image.open(f).convert("RGB").resize((518, 518))
    arr = np.array(im, dtype=np.float32) / 255.0
    imgs.append(torch.from_numpy(arr).permute(2, 0, 1))

batch = torch.stack(imgs).unsqueeze(0) # [1, 2, 3, 518, 518]
print(f"[2] Running VGGT forward pass on input shape: {batch.shape}...")
t1 = time.time()
with torch.no_grad():
    preds = model(batch)
print(f"[2] Forward pass completed in {time.time() - t1:.2f}s!")

for k, v in preds.items():
    if hasattr(v, "shape"):
        print(f"  {k}: {v.shape}, dtype={v.dtype}, min={v.min():.3f}, max={v.max():.3f}")
    else:
        print(f"  {k}: {type(v)}")

# Check world_points
if "world_points" in preds:
    pts = preds["world_points"].squeeze(0).numpy() # [2, 518, 518, 3]
    print(f"World points shape: {pts.shape}")
    print(f"Sample point (center): {pts[0, 259, 259]}")
