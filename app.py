"""
FastAPI Backend Server & Testing API for 360° Drone Video to 3D World Reconstruction Engine
Provides minimal REST endpoints:
- POST /reconstruct (Uploads video & starts asynchronous reconstruction)
- GET /status/{job_id} & GET /api/progress/{job_id} (SSE & JSON status)
- GET /result/{job_id}
- GET /poses/{job_id}
- GET /pointcloud/{job_id}
- GET /gaussians/{job_id}
- GET /scene/{job_id}
- GET /coverage/{job_id}
"""

import os
import sys
import shutil
import uuid
import asyncio
import json
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# Add engine directory to sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENGINE_DIR = os.path.join(BASE_DIR, "engine")
if ENGINE_DIR not in sys.path:
    sys.path.insert(0, ENGINE_DIR)

from pipeline import ReconstructionPipeline

app = FastAPI(title="360 Drone Video 3D World Reconstruction Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(TEMPLATES_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/output", StaticFiles(directory=OUTPUT_DIR), name="output")

# Store in-memory job status
job_progress = {}


@app.get("/", response_class=HTMLResponse)
async def get_index():
    """Serves the minimal testing UI."""
    index_file = os.path.join(TEMPLATES_DIR, "index.html")
    if os.path.exists(index_file):
        with open(index_file, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>360 Video 3D Reconstruction Engine API Ready</h1>"


def run_pipeline_task(job_id: str, video_path: str, target_keyframes: int = 16, engine_mode: str = "fast"):
    """Background task executor for reconstruction."""
    try:
        job_progress[job_id] = {
            "status": "processing",
            "progress": 0.05,
            "message": "Initializing 360 video reconstruction engine..."
        }

        def update_cb(pct: float, msg: str):
            job_progress[job_id] = {
                "status": "processing",
                "progress": pct,
                "message": msg
            }

        job_out_dir = os.path.join(OUTPUT_DIR, f"job_{job_id}")
        result = ReconstructionPipeline.execute(
            video_path=video_path,
            output_dir=job_out_dir,
            target_keyframes=target_keyframes,
            engine_mode=engine_mode,
            progress_cb=update_cb
        )

        job_progress[job_id] = {
            "status": "completed",
            "progress": 1.0,
            "message": "3D World Reconstruction completed successfully!",
            "point_count": result.get("point_count", 0),
            "elapsed_seconds": result.get("elapsed_seconds", 0),
            "assets": {
                "mesh_obj": f"/output/job_{job_id}/geometry/mesh.obj",
                "mesh_ply": f"/output/job_{job_id}/geometry/mesh.ply",
                "dense_ply": f"/output/job_{job_id}/pointcloud/dense.ply",
                "gaussian_ply": f"/output/job_{job_id}/gaussians/scene.ply",
                "gaussian_splat": f"/output/job_{job_id}/gaussians/scene.splat",
                "scene_json": f"/output/job_{job_id}/metadata/scene.json"
            }
        }
    except Exception as e:
        job_progress[job_id] = {
            "status": "failed",
            "progress": 0.0,
            "message": f"Reconstruction Error: {str(e)}"
        }


@app.post("/reconstruct")
async def api_reconstruct(
    background_tasks: BackgroundTasks,
    video_file: Optional[UploadFile] = File(None),
    existing_video_path: Optional[str] = Form(None),
    keyframes_count: int = Form(16),
    engine_mode: str = Form("dust3r")
):
    """POST /reconstruct: Ingests 360 video and launches reconstruction job."""
    job_id = str(uuid.uuid4())[:8]
    job_dir = os.path.join(UPLOAD_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)

    if video_file and video_file.filename:
        video_path = os.path.join(job_dir, video_file.filename)
        with open(video_path, "wb") as f:
            shutil.copyfileobj(video_file.file, f)
    elif existing_video_path and os.path.exists(existing_video_path):
        video_path = existing_video_path
    elif os.path.exists("inp/input.mp4"):
        video_path = "inp/input.mp4"
    else:
        return JSONResponse({"error": "No valid 360 video file provided."}, status_code=400)

    job_progress[job_id] = {
        "status": "queued",
        "progress": 0.02,
        "message": "Job queued for 3D world reconstruction..."
    }

    background_tasks.add_task(run_pipeline_task, job_id, video_path, keyframes_count, engine_mode)

    return JSONResponse({
        "job_id": job_id,
        "video_path": video_path,
        "status": "queued",
        "message": "360 Video Reconstruction job started successfully."
    })


@app.get("/status/{job_id}")
async def get_status(job_id: str):
    """GET /status/{job_id}: Returns JSON status of reconstruction job."""
    if job_id in job_progress:
        return JSONResponse(job_progress[job_id])
    return JSONResponse({"status": "not_found", "message": f"Job {job_id} not found"}, status_code=404)


@app.get("/api/progress/{job_id}")
async def get_progress_stream(job_id: str):
    """SSE streaming progress endpoint for live UI updates."""
    async def event_generator():
        while True:
            if job_id in job_progress:
                data = job_progress[job_id]
                payload = json.dumps(data)
                yield f"data: {payload}\n\n"
                if data.get("status") in ["completed", "failed"]:
                    break
            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@app.get("/result/{job_id}")
async def get_result(job_id: str):
    """GET /result/{job_id}: Returns completed asset paths and metadata."""
    if job_id in job_progress and job_progress[job_id].get("status") == "completed":
        return JSONResponse(job_progress[job_id])
    return JSONResponse({"error": "Job not completed yet or not found"}, status_code=400)


@app.get("/scene/{job_id}")
async def get_scene(job_id: str):
    """GET /scene/{job_id}: Returns scene.json metadata."""
    scene_file = os.path.join(OUTPUT_DIR, f"job_{job_id}", "metadata", "scene.json")
    if os.path.exists(scene_file):
        return FileResponse(scene_file, media_type="application/json")
    return JSONResponse({"error": "Scene metadata not found"}, status_code=404)


@app.get("/pointcloud/{job_id}")
async def get_pointcloud(job_id: str):
    """GET /pointcloud/{job_id}: Downloads dense.ply."""
    ply_file = os.path.join(OUTPUT_DIR, f"job_{job_id}", "pointcloud", "dense.ply")
    if os.path.exists(ply_file):
        return FileResponse(ply_file, filename=f"pointcloud_{job_id}.ply")
    return JSONResponse({"error": "Point cloud file not found"}, status_code=404)


@app.get("/gaussians/{job_id}")
async def get_gaussians(job_id: str):
    """GET /gaussians/{job_id}: Downloads scene.splat / scene.ply."""
    splat_file = os.path.join(OUTPUT_DIR, f"job_{job_id}", "gaussians", "scene.splat")
    if os.path.exists(splat_file):
        return FileResponse(splat_file, filename=f"gaussians_{job_id}.splat")
    return JSONResponse({"error": "Gaussian splat file not found"}, status_code=404)


@app.get("/poses/{job_id}")
async def get_poses(job_id: str):
    """GET /poses/{job_id}: Returns cameras.json."""
    cameras_file = os.path.join(OUTPUT_DIR, f"job_{job_id}", "poses", "cameras.json")
    if os.path.exists(cameras_file):
        return FileResponse(cameras_file, media_type="application/json")
    return JSONResponse({"error": "Camera poses not found"}, status_code=404)


@app.get("/coverage/{job_id}")
async def get_coverage(job_id: str):
    """GET /coverage/{job_id}: Returns coverage.json."""
    coverage_file = os.path.join(OUTPUT_DIR, f"job_{job_id}", "coverage", "coverage.json")
    if os.path.exists(coverage_file):
        return FileResponse(coverage_file, media_type="application/json")
    return JSONResponse({"error": "Coverage data not found"}, status_code=404)


if __name__ == "__main__":
    import uvicorn
    preferred_port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print("\n" + "=" * 70)
    print(f"[ENGINE API SERVER] Running at http://localhost:{preferred_port}")
    print("=" * 70 + "\n")
    uvicorn.run("app:app", host="0.0.0.0", port=preferred_port, reload=False)
