# 🚁 AERO3D: Drone Photogrammetry & 3D World Reconstruction System

A high-performance system for converting **drone aerial photos**, **single-pass 360° videos**, and **dense 3D point clouds** into interactive 3D virtual worlds with **real polygonal wireframes**, **textured surface meshes**, and **sharp point clouds**.

---

## ⚡ Quick Start: How to Run

The system consists of three interconnected layers:
1. **React Web UI (Vite):** Port `5173`
2. **Node.js Gateway Server:** Port `5000`
3. **Python 3D Photogrammetry & AI Engine:** Port `8080`

### Step 1: Install Dependencies

```bash
# 1. Install Python dependencies (in root folder)
pip install -r requirements.txt

# 2. Install UI dependencies (in ui folder)
cd ui
npm install
cd ..
```

---

### Step 2: Start All Services

Open **three terminal tabs**:

#### Terminal 1: Start Python 3D Photogrammetry Engine (Port 8080)
```bash
# In root project directory
python app.py 8080
```
> Running at: `http://localhost:8080`

#### Terminal 2: Start Node.js Gateway Server (Port 5000)
```bash
# In ui directory
cd ui
node server.js
```
> Running at: `http://localhost:5000`

#### Terminal 3: Start React Web Application (Port 5173)
```bash
# In ui directory
cd ui
npm run dev
```
> Running at: `http://localhost:5173`

---

## 🖥️ User Interfaces

| Application | URL | Purpose |
|---|---|---|
| **Full React UI Studio** | **`http://localhost:5173`** | Complete Drone Project Management, Map Telemetry, Wizard photo upload, RayCloud inspection, and 3D Mesh Viewer. |
| **Standalone 3D Studio** | **`http://localhost:8080`** | Direct video-to-3D pipeline, fast point cloud meshing, 3D Geofencing gizmo, and real-time wireframe renderer. |

---

## ✨ Key Features & Capabilities

### 1. 📸 Drone Photos to 3D Reconstruction
* **SIFT / ORB Keypoint Matching**: KD-Tree FLANN with Epipolar RANSAC geometry estimation.
* **Structure-from-Motion (SfM)**: Computes 3D camera trajectory cones and triangulates sparse-to-dense point clouds.
* **Surface Meshing**: Generates watertight 3D polygonal meshes using **Screened Poisson** or **Ball Pivoting (BPA)** algorithms.

### 2. 🎥 Video to 3D World Reconstruction
* **Intelligent Keyframe Selector**: Analyzes motion, Laplacian sharpness, and color entropy to extract optimal non-redundant viewpoints.
* **360° Equirectangular Engine**: Projects $360^\circ$ panoramic video frames into 6 orthogonal tangent perspective cameras.
* **Single-Pass Video Support**: Reconstructs complete 3D environments from one continuous drone flight.

### 3. 🕸️ 3D View Modes
* **`🕸 Wireframe`**: Renders sharp triangular wireframe polygons with luminous cyan edges for architectural and terrain inspection.
* **`🎨 Textured`**: Renders solid, smooth opaque polygonal surfaces with baked true photo vertex colors.
* **`✨ Points`**: Renders crisp, pinpoint 3D coordinates (with zero Gaussian blur) for razor-sharp brick, window, and roof details.
* **`🔃 Flip Up/Down` (`F`)**: Instantly flips the model right-side up.

### 4. 🛡️ 3D Geofence & Volumes
* Real-time cylindrical and bounding box 3D geofence boundaries to ensure safety zones for drone missions.

---

## 💻 CLI Usage (Command Line)

You can also run the photogrammetry reconstruction directly from the command line:

```bash
# Run 3D reconstruction on a folder of drone photos
python main.py --input_dir ./sample_drone_flight --output ./output/model.obj --format obj --mesh_method poisson
```

### CLI Parameters:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--input_dir`, `-i` | String | *(Required)* | Path to folder containing drone images (`.jpg`, `.png`, `.tif`) |
| `--output`, `-o` | String | `output/model.obj` | Output 3D file path (`.obj`, `.ply`) |
| `--format`, `-f` | String | `obj` | 3D file format: `obj`, `ply`, `glb`, `stl` |
| `--feature_type` | String | `SIFT` | Feature detector: `SIFT` or `ORB` |
| `--max_features` | Integer | `4000` | Max keypoints per image |
| `--mesh_method` | String | `poisson` | Meshing: `poisson`, `bpa`, or `pointcloud` |
| `--poisson_depth` | Integer | `9` | Octree depth for Poisson meshing (higher = more detail) |

---

## 📁 Project Architecture

```
├── app.py                          # FastAPI backend & 3D Web Studio server (Port 8080)
├── reconstruction_engine.py        # Core SfM, feature matcher & Poisson/BPA meshing engine
├── main.py                         # Command-Line Interface (CLI)
├── pipeline_360_engine.py          # End-to-end Single-Pass 360 video reconstruction engine
├── keyframe_engine.py              # Information-driven keyframe selection engine
├── equirect_engine.py              # 360° equirectangular to 6-way cubemap projector
├── coverage_engine.py              # 3D visibility ray-casting & confidence mapping
├── ai_completion_engine.py         # Hierarchical gap completion engine
├── dataset_360_generator.py        # Benchmark demo dataset generator
├── geofence_engine.py              # 3D Geofence boundary calculator
├── templates/                      # Standalone studio HTML templates
├── static/                         # Standalone studio Three.js CSS and JS
├── output/                         # Reconstructed 3D models (.obj, .ply, .splat)
└── ui/                             # React Full-Featured Web Application
    ├── src/                        # React components (Wizard, MeshViewer, RayCloud, Map)
    ├── server.js                   # Node.js gateway server (Port 5000)
    └── package.json                # React frontend dependencies (Port 5173)
```

---

## ⌨️ Viewport Hotkeys

* **`F`**: Flip model Up/Down (invert axis).
* **`R`**: Rotate model around Y-axis ($90^\circ$).
* **`X`**: Rotate model around X-axis ($90^\circ$).
* **`+` / `-`**: Increase / decrease point cloud size.
* **`Left Mouse Drag`**: Orbit camera around target.
* **`Right Mouse Drag`**: Pan camera.
* **`Scroll Wheel`**: Zoom in/out.
