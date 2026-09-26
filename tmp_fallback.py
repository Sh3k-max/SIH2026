import json, numpy as np
d = np.load(r"C:/Users/Abeshek/Desktop/SIHVGGT/SIH_SINGLEPASS/scene/DJI_1001/cached_model.npz")
p, c = d['points'], d['colors']
stride = max(1, len(p) // 200000)
sub_p, sub_c = p[::stride], c[::stride]
center = np.mean(sub_p, axis=0)
scaled_p = ((sub_p - center) * 60).astype(np.float32)
scaled_p[:, 1] = -scaled_p[:, 1]
with open(r"C:/Users/Abeshek/Desktop/SIHVGGT/SIH2026/tmp_points.bin", "wb") as f:
    f.write(scaled_p.tobytes())
    f.write((sub_c.astype(np.float32) / 255.0).tobytes())
print(json.dumps({'pointCount': len(sub_p), 'totalSourcePoints': len(p)}))
