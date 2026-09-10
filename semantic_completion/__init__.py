"""
Semantic 3D Scene Completion Module
An isolated experimental add-on for predicting and completing missing regions
in 3D photogrammetric scenes using visual and semantic context.

Architectural Rule: This module is purely additive. It consumes outputs from
existing photogrammetry pipelines (DUSt3R, VGGT, Gaussian Splatting) without
modifying, replacing, or interfering with them.
"""

from .config import CompletionConfig, DeviceConfig
from .pointcloud_adapter import SceneCompletionInput, PointState, PointCloudAdapter
from .video_feature_adapter import VideoFeatureAdapter
from .semantic_encoder import SemanticSceneEncoder, SemanticClass
from .confidence import ConfidenceEstimator, PatchConfidence
from .fusion import SceneFusionManager, ExportFormat
from .completion_engine import SemanticCompletionEngine
from .models.base import SceneCompletionModel

__version__ = "1.0.0"
__all__ = [
    "CompletionConfig",
    "DeviceConfig",
    "SceneCompletionInput",
    "PointState",
    "PointCloudAdapter",
    "VideoFeatureAdapter",
    "SemanticSceneEncoder",
    "SemanticClass",
    "ConfidenceEstimator",
    "PatchConfidence",
    "SceneFusionManager",
    "ExportFormat",
    "SemanticCompletionEngine",
    "SceneCompletionModel",
]
