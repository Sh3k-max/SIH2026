"""
Model interfaces and registry for 3D Scene Completion.
"""

from .base import SceneCompletionModel, PatchPrediction
from .geometric_semantic_model import GeometricSemanticModel
from .pcn_model import PCNCompletionModel
from .snowflake_model import SnowflakeCompletionModel

__all__ = [
    "SceneCompletionModel",
    "PatchPrediction",
    "GeometricSemanticModel",
    "PCNCompletionModel",
    "SnowflakeCompletionModel",
]
