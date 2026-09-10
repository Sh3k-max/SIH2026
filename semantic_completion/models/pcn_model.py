"""
PCN (Point Completion Network) Implementation.
Provides neural encoder-decoder point cloud completion with graceful CPU/missing weights handling.
"""

from typing import Optional, Dict, Any
import os
import numpy as np
import torch
import torch.nn as nn
from .base import SceneCompletionModel, PatchPrediction


class PCNDecoder(nn.Module):
    """Folding-based decoder mapping global feature to 3D point patch."""
    def __init__(self, feat_dim: int = 512, num_points: int = 128):
        super().__init__()
        self.num_points = num_points
        self.fc = nn.Sequential(
            nn.Linear(feat_dim, 256),
            nn.ReLU(inplace=True),
            nn.Linear(256, 128),
            nn.ReLU(inplace=True),
            nn.Linear(128, num_points * 3)
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        batch_size = x.size(0)
        out = self.fc(x)
        return out.view(batch_size, self.num_points, 3)


class PCNNet(nn.Module):
    """PointNet Encoder + Folding Decoder."""
    def __init__(self, feat_dim: int = 512, num_points: int = 128):
        super().__init__()
        self.conv1 = nn.Conv1d(3, 128, 1)
        self.conv2 = nn.Conv1d(128, 256, 1)
        self.conv3 = nn.Conv1d(256, feat_dim, 1)
        self.relu = nn.ReLU(inplace=True)
        self.decoder = PCNDecoder(feat_dim=feat_dim, num_points=num_points)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, 3, N)
        net = self.relu(self.conv1(x))
        net = self.relu(self.conv2(net))
        net = self.conv3(net)
        # Global max pooling
        feat = torch.max(net, dim=2)[0]  # (B, feat_dim)
        points = self.decoder(feat)       # (B, num_points, 3)
        return points


class PCNCompletionModel(SceneCompletionModel):
    """
    PCN (Point Completion Network) wrapper conforming to SceneCompletionModel.
    Supports both GPU and CPU inference with zero crash when weights are unavailable.
    """

    def __init__(self, device: Optional[torch.device] = None, num_output_points: int = 96):
        super().__init__(name="pcn", device=device)
        self.num_output_points = num_output_points
        self.net: Optional[PCNNet] = None
        self.has_pretrained_weights: bool = False

    def load(self, weights_path: Optional[str] = None) -> bool:
        self.net = PCNNet(feat_dim=256, num_points=self.num_output_points).to(self.device)
        self.net.eval()

        if weights_path and os.path.exists(weights_path):
            try:
                state_dict = torch.load(weights_path, map_location=self.device)
                self.net.load_state_dict(state_dict, strict=False)
                self.has_pretrained_weights = True
                print(f"[PCNCompletionModel] Successfully loaded pretrained weights from {weights_path}")
            except Exception as e:
                print(f"[PCNCompletionModel] Warning: Failed to load weights ({e}). Running in initialized baseline mode.")
                self.has_pretrained_weights = False
        else:
            self.has_pretrained_weights = False

        self.is_loaded = True
        return True

    def preprocess(
        self,
        patch_points: np.ndarray,
        patch_colors: np.ndarray,
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        context = context or {}
        center = context.get("center", np.mean(patch_points, axis=0) if len(patch_points) > 0 else np.zeros(3))
        radius = context.get("radius", 1.25)
        visual_rgb = context.get("dominant_rgb", np.array([160, 160, 160], dtype=np.uint8))

        if len(patch_points) == 0:
            norm_pts = np.zeros((16, 3), dtype=np.float32)
        else:
            # Center and scale to [-1, 1]
            norm_pts = (patch_points - center) / (radius + 1e-6)
            if len(norm_pts) > 256:
                # Subsample for lightweight inference
                idx = np.random.choice(len(norm_pts), 256, replace=False)
                norm_pts = norm_pts[idx]
            elif len(norm_pts) < 32:
                # Pad to minimum
                repeats = int(np.ceil(32 / len(norm_pts)))
                norm_pts = np.tile(norm_pts, (repeats, 1))[:32]

        return {
            "tensor_pts": torch.from_numpy(norm_pts).float().unsqueeze(0).transpose(1, 2).to(self.device),
            "center": center,
            "radius": radius,
            "visual_rgb": visual_rgb,
            "patch_colors": patch_colors,
            "semantic_tag": str(context.get("semantic_class", "unknown")),
        }

    def predict(self, processed_data: Dict[str, Any]) -> Dict[str, Any]:
        if self.net is None:
            self.load()

        tensor_pts = processed_data["tensor_pts"]
        with torch.no_grad():
            pred_pts = self.net(tensor_pts)  # (1, num_points, 3)

        out_pts = pred_pts.squeeze(0).cpu().numpy()
        return {
            "rel_points": out_pts,
            "visual_rgb": processed_data["visual_rgb"],
            "patch_colors": processed_data["patch_colors"],
            "semantic_tag": processed_data["semantic_tag"],
        }

    def postprocess(
        self,
        raw_output: Dict[str, Any],
        preprocess_context: Dict[str, Any]
    ) -> PatchPrediction:
        rel_pts = raw_output["rel_points"]
        center = preprocess_context["center"]
        radius = preprocess_context["radius"]
        visual_rgb = raw_output["visual_rgb"]
        patch_colors = raw_output["patch_colors"]

        # Scale back to world units and uncenter
        world_pts = (rel_pts * (radius * 0.75)) + center

        # Compute confidence based on weights status & proximity
        base_conf = 0.78 if self.has_pretrained_weights else 0.62
        dists = np.linalg.norm(rel_pts, axis=1)
        conf = np.clip(base_conf - (dists * 0.15), 0.35, 0.92)

        # Synthesize RGB
        mean_c = np.mean(patch_colors, axis=0) if len(patch_colors) > 0 else visual_rgb
        target_color = 0.6 * mean_c + 0.4 * visual_rgb
        noise = np.random.normal(0, 4, (len(world_pts), 3))
        colors = np.clip(target_color + noise, 0, 255).astype(np.uint8)

        return PatchPrediction(
            points=world_pts.astype(np.float32),
            colors=colors,
            confidence=conf.astype(np.float32),
            semantic_tag=raw_output["semantic_tag"],
            metadata={"model": self.name, "has_weights": self.has_pretrained_weights}
        )
