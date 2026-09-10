"""
Abstract Base Class and standardized interfaces for 3D Scene Completion models.
Ensures zero-crash execution, clear memory lifecycle, and modular hot-swappability.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, Dict, Any
import numpy as np
import torch


@dataclass
class PatchPrediction:
    """Standardized output of a local 3D patch completion inference."""
    points: np.ndarray             # (K, 3) predicted world-space coordinates
    colors: np.ndarray             # (K, 3) predicted RGB colors [0, 255]
    confidence: np.ndarray         # (K,) per-point model confidence [0.0, 1.0]
    semantic_tag: str = "unknown"  # Inferred semantic structure
    metadata: Dict[str, Any] = None


class SceneCompletionModel(ABC):
    """
    Common contract for any 3D scene completion model (PCN, SnowflakeNet, Geometric-Semantic, etc.).
    """

    def __init__(self, name: str, device: Optional[torch.device] = None):
        self.name = name
        self.device = device or torch.device("cpu")
        self.is_loaded: bool = False
        self.weights_path: Optional[str] = None

    @abstractmethod
    def load(self, weights_path: Optional[str] = None) -> bool:
        """
        Loads model weights safely. If weights are missing, must enter a robust fallback
        mode without crashing or terminating the application.
        """
        pass

    @abstractmethod
    def preprocess(
        self,
        patch_points: np.ndarray,
        patch_colors: np.ndarray,
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Normalizes and prepares raw spatial patch data for model inference."""
        pass

    @abstractmethod
    def predict(self, processed_data: Dict[str, Any]) -> Dict[str, Any]:
        """Runs tensor or geometric inference to predict missing geometry."""
        pass

    @abstractmethod
    def postprocess(
        self,
        raw_output: Dict[str, Any],
        preprocess_context: Dict[str, Any]
    ) -> PatchPrediction:
        """Converts model outputs back to 3D world-space coordinates and RGB."""
        pass

    def complete_patch(
        self,
        patch_points: np.ndarray,
        patch_colors: np.ndarray,
        context: Optional[Dict[str, Any]] = None
    ) -> PatchPrediction:
        """Standard end-to-end execution pipeline for a local patch."""
        if not self.is_loaded:
            self.load(self.weights_path)

        pre = self.preprocess(patch_points, patch_colors, context)
        raw = self.predict(pre)
        return self.postprocess(raw, pre)

    def unload(self) -> None:
        """Frees GPU memory allocations."""
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        self.is_loaded = False
