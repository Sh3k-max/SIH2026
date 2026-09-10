"""
Configuration and hardware resource management for Semantic 3D Scene Completion.
Ensures stability on 6GB VRAM (RTX 4060 Laptop GPU) and provides robust CPU fallbacks.
"""

from dataclasses import dataclass, field
from typing import Optional, Literal
import torch


@dataclass
class DeviceConfig:
    """Hardware device configuration and memory bounds."""
    preferred_device: str = "cuda"
    max_vram_gb: float = 5.5  # Safe ceiling for 6GB RTX 4060 laptop
    use_fp16: bool = True
    batch_size: int = 16
    point_chunk_size: int = 2048
    enable_cpu_fallback: bool = True

    def get_torch_device(self) -> torch.device:
        """Determines active PyTorch device with memory validation."""
        if self.preferred_device == "cuda" and torch.cuda.is_available():
            try:
                # Check available VRAM
                free_mem_bytes, total_mem_bytes = torch.cuda.mem_get_info()
                free_gb = free_mem_bytes / (1024 ** 3)
                if free_gb < 1.0 and self.enable_cpu_fallback:
                    print(f"[DeviceConfig] Warning: Only {free_gb:.2f} GB free VRAM. Falling back to CPU for stability.")
                    return torch.device("cpu")
                return torch.device("cuda:0")
            except Exception:
                return torch.device("cuda:0")
        return torch.device("cpu")


@dataclass
class CompletionConfig:
    """Hyperparameters and operational settings for Semantic 3D Scene Completion."""
    # Model Selection
    model_name: Literal["geometric_semantic", "pcn", "snowflake"] = "geometric_semantic"
    weights_path: Optional[str] = None

    # Completion Strategy
    completion_mode: Literal["progressive", "patch_local"] = "progressive"
    patch_radius: float = 1.25  # In world metric units
    max_frontier_iterations: int = 35
    target_points_per_patch: int = 256
    deep_scene_infill: bool = True
    ground_floating_structures: bool = True
    continuous_terrain_infill: bool = True
    seal_building_shells: bool = True

    # Confidence Thresholding
    confidence_threshold: float = 0.65  # Minimum unified confidence to accept predicted points
    uncertain_threshold: float = 0.40   # Points between 0.40 and 0.65 are tagged UNKNOWN

    # Disaster & Rugged Environment Resilience
    disaster_conservative_mode: bool = True  # If true, suppresses hallucination on ambiguous debris/rubble
    entropy_rejection_limit: float = 0.82    # High entropy surfaces reject aggressive planar infills

    # Multi-factor Confidence Weights
    weight_geometric: float = 0.30
    weight_semantic: float = 0.25
    weight_proximity: float = 0.25
    weight_visual: float = 0.20

    # Hardware & Performance
    device: DeviceConfig = field(default_factory=DeviceConfig)
