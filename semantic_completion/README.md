# Semantic 3D Scene Completion Module (Experimental)

An isolated, modular, and non-destructive AI subsystem that predicts and completes missing regions in 3D photogrammetric models using multi-view visual evidence and semantic scene understanding.

---

## 1. Architectural Isolation Contract

```
┌─────────────────────────────────────────────────────────────┐
│                 SACRED EXISTING PIPELINES                   │
│   (DUSt3R / VGGT / Gaussian Splatting / Photogrammetry)     │
│             100% Untouched, Zero Modifications              │
└──────────────────────────────┬──────────────────────────────┘
                               │ Produces .obj / .ply / keyframes
                               ▼
┌─────────────────────────────────────────────────────────────┐
│         NEW EXPERIMENTAL ADD-ON: semantic_completion        │
│                                                             │
│   SceneCompletionInput (Adapter)                            │
│              │                                              │
│              ▼                                              │
│   Progressive Frontier Detection & Cavity Extraction        │
│              │                                              │
│              ▼                                              │
│   Video Visual Evidence + Semantic Scene Encoder            │
│   (Disaster Resilience: Rubble/Debris Suppression)          │
│              │                                              │
│              ▼                                              │
│   SceneCompletionModel (Geometric-Semantic, PCN, Snowflake) │
│              │                                              │
│              ▼                                              │
│   Multi-Factor Confidence & Registration Verification       │
│              │                                              │
│              ▼                                              │
│   Provenance Fusion Manager (OBSERVED / PREDICTED / UNKNOWN)│
└─────────────────────────────────────────────────────────────┘
```

- **Zero Coupling**: Existing reconstruction pipelines do **NOT** import or depend on `semantic_completion`.
- **One-Way Data Flow**: The completion engine consumes exported 3D point clouds and video frames as a downstream optional post-processing step.
- **Strict Provenance**: Observed photogrammetry is sacred (`PointState.OBSERVED`) and is **never** altered, distorted, or deleted.

---

## 2. Models Supported

| Model Name | Type | Key Features | Default Status |
| :--- | :--- | :--- | :--- |
| **`geometric_semantic`** | Adaptive Manifold Prior | Zero floaters, video color matching, fast CPU/GPU inference | **Active Default** |
| **`pcn`** | PointNet + FoldingNet | Standard benchmark encoder-decoder for local point patches | Included |
| **`snowflake`** | Skip-Transformer Deconv | Progressive multi-stage hierarchical point expansion | Included |

### Model Selection Rationale
- Standard point cloud completion networks (PCN, SnowflakeNet) were originally trained on synthetic CAD objects (ShapeNet). Directly applying them to full outdoor scenes causes massive scale distortion.
- Therefore, this architecture uses a **Local Patch-Based Progressive Architecture**:
  1. Identifies local structural boundaries / frontiers.
  2. Normalizes the local patch into canonical unit coordinates.
  3. Executes model inference on the normalized patch.
  4. Restores global world coordinates and enforces neighbor surface continuity.
- In disaster/rubble scenarios, `SemanticSceneEncoder` detects chaotic surface entropy and conservative suppression suppresses hallucinating false clean geometry.

---

## 3. Hardware & VRAM Requirements

- **GPU Requirement**: NVIDIA RTX 4060 Laptop GPU (6 GB VRAM) supported.
- **Peak VRAM Usage**: `< 1.2 GB VRAM` during patch inference.
- **Safe CPU Fallback**: Automatically switches to CPU if GPU free memory is $< 1.0\text{ GB}$ or if CUDA is not available.
- **Graceful Weight Loading**: If external `.pth` weights are not supplied, models initialize cleanly without throwing exceptions or terminating the host process.

---

## 4. How to Run Independently

### Command-Line Interface (CLI)

```bash
# Run completion using the default geometric-semantic model
python -m semantic_completion.completion_engine \
  --input output/video_3d_world.obj \
  --output output/video_3d_world_completed.obj \
  --video_dir output/video_keyframes \
  --confidence 0.65

# Export with color-coded provenance visualization
# (Green = Observed, Cyan = High Conf Predicted, Amber = Low Conf Predicted, Crimson = Unknown)
python -m semantic_completion.completion_engine \
  --input output/video_3d_world.obj \
  --output output/video_3d_world_provenance.obj \
  --export_mode provenance

# Run with PCN or SnowflakeNet model
python -m semantic_completion.completion_engine \
  --input output/video_3d_world.obj \
  --model pcn \
  --confidence 0.60
```

### Python API

```python
from semantic_completion import (
    PointCloudAdapter,
    VideoFeatureAdapter,
    SemanticCompletionEngine,
    CompletionConfig,
    ExportFormat,
)

# 1. Load partial reconstruction
scene_input = PointCloudAdapter.load_from_file("output/video_3d_world.obj")

# 2. Extract video context
video_adapter = VideoFeatureAdapter(keyframe_dir="output/video_keyframes")

# 3. Configure and execute engine
config = CompletionConfig(model_name="geometric_semantic", confidence_threshold=0.65)
engine = SemanticCompletionEngine(config)
results = engine.run_completion(scene_input, video_adapter=video_adapter)

# 4. Export completed scene
results["fusion_manager"].export_obj(
    "output/my_completed_world.obj",
    export_format=ExportFormat.RGB,
    min_confidence=0.65,
)
```

---

## 5. How to Disable Completely

- To disable this module, simply do not invoke `SemanticCompletionEngine` or keep the UI toggle set to **Disabled**.
- Zero background processes or daemon threads are created.
- Deleting or moving the `semantic_completion/` folder leaves all existing reconstruction algorithms functioning with 100% integrity.
