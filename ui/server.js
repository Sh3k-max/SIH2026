import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const aiServerUrl = process.env.HMM_SERVER_URL || process.env.AI_SERVER_URL || 'http://localhost:8080';

import path from 'path';
import fs from 'fs';

app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

// Serve all generated 3D OBJ/PLY models statically
app.use('/output', express.static(path.resolve('../output')));
app.use('/projects', express.static(path.resolve('projects')));
app.use('/models', express.static(path.resolve('public/models')));
app.use('/models', express.static(path.resolve('../output')));

// Available 3D Models List Endpoint
app.get('/api/available_point_files', (req, res) => {
  try {
    const outputDir = path.resolve('../output');
    if (!fs.existsSync(outputDir)) return res.json({ files: [] });
    const entries = fs.readdirSync(outputDir, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile() && (e.name.endsWith('.obj') || e.name.endsWith('.ply') || e.name.endsWith('.splat')))
      .map(e => {
        const stats = fs.statSync(path.join(outputDir, e.name));
        return {
          filename: e.name,
          size_mb: (stats.size / (1024 * 1024)).toFixed(1),
          lastModified: stats.mtime.toISOString()
        };
      });
    return res.json({ files });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const activeReconstructionJobs = new Map();

// 1. Zero-Copy Binary Stream Upload Endpoint for large videos & photos (Prevents browser OOM)
app.post('/api/upload/stream', async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const projectName = (req.query.projectName || 'custom_project').toString();
    const fileName = (req.query.fileName || 'upload.bin').toString();

    const cleanName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const imagesDir = path.resolve('projects', cleanName, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });

    const filePath = path.join(imagesDir, fileName);
    const writeStream = fs.createWriteStream(filePath);

    req.pipe(writeStream);

    writeStream.on('finish', () => {
      console.log(`[Stream Upload] Successfully saved: ${fileName} into projects/${cleanName}/images`);
      return res.json({ status: 'uploaded', file: fileName, path: filePath });
    });

    writeStream.on('error', (err) => {
      console.error('Streaming file write error:', err);
      return res.status(500).json({ error: err.message });
    });
  } catch (err) {
    console.error('Binary stream upload error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 1b. Single File / Batch File Chunk Upload Endpoint (Fallback)
app.post('/api/upload/file', async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { projectName = 'custom_project', fileName, base64 } = req.body;

    if (!fileName || !base64) {
      return res.status(400).json({ error: 'fileName and base64 required' });
    }

    const cleanName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const imagesDir = path.resolve('projects', cleanName, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });

    const filePath = path.join(imagesDir, fileName);
    const data = base64.replace(/^data:image\/\w+;base64,/, '').replace(/^data:video\/\w+;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));

    return res.json({ status: 'uploaded', file: fileName, path: filePath });
  } catch (err) {
    console.error('File chunk upload error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 1b. Batch File Upload Endpoint
app.post('/api/upload/batch', async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { projectName = 'custom_project', files = [] } = req.body;

    const cleanName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const imagesDir = path.resolve('projects', cleanName, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });

    let count = 0;
    for (const f of files) {
      if (f.fileName && f.base64) {
        const filePath = path.join(imagesDir, f.fileName);
        const data = f.base64.replace(/^data:image\/\w+;base64,/, '').replace(/^data:video\/\w+;base64,/, '');
        fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
        count++;
      }
    }

    return res.json({ status: 'uploaded', count, dir: imagesDir });
  } catch (err) {
    console.error('Batch upload error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 1c. Copy Sample Drone Flight Photos directly into project
app.post('/api/sample_flight/copy_to_project', async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { projectName = 'sample_project' } = req.body;

    const cleanName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const targetDir = path.resolve('projects', cleanName, 'images');
    fs.mkdirSync(targetDir, { recursive: true });

    const sampleDir = path.resolve('..', 'sample_drone_flight');
    const copiedFiles = [];
    if (fs.existsSync(sampleDir)) {
      const files = fs.readdirSync(sampleDir);
      for (const f of files) {
        if (/\.(jpg|jpeg|png)$/i.test(f)) {
          fs.copyFileSync(path.join(sampleDir, f), path.join(targetDir, f));
          copiedFiles.push(f);
        }
      }
      return res.json({ status: 'ok', count: copiedFiles.length, files: copiedFiles, dir: targetDir });
    }
    return res.status(404).json({ error: 'Sample flight directory not found' });
  } catch (err) {
    console.error('Copy sample flight error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 2. Start Asynchronous Photogrammetry Reconstruction Job
app.post('/api/reconstruct/start_project', async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { spawn } = await import('child_process');
    const crypto = await import('crypto');

    const { projectName = 'custom_project', localPath = '', engine = 'dust3r' } = req.body;
    const cleanName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const jobId = crypto.randomUUID();

    const targetDir = path.resolve('projects', cleanName);
    let imagesDir = path.join(targetDir, 'images');
    const outputDir = path.join(targetDir, '3d_model');

    // If a valid local directory or file is provided on disk, use it directly
    let candidatePath = localPath;
    if (candidatePath && !fs.existsSync(candidatePath)) {
      const parentCandidate = path.resolve('..', candidatePath);
      if (fs.existsSync(parentCandidate)) {
        candidatePath = parentCandidate;
      }
    }
    if (candidatePath && fs.existsSync(candidatePath)) {
      const stats = fs.statSync(candidatePath);
      if (stats.isDirectory() || stats.isFile()) {
        imagesDir = path.resolve(candidatePath);
      }
    }

    fs.mkdirSync(outputDir, { recursive: true });

    const job = {
      jobId,
      projectName: cleanName,
      status: 'running',
      progress: 5,
      logs: [`[INFO] Initialized project ${cleanName}`, `[INFO] Selected AI Engine: ${engine.toUpperCase()}`, `[INFO] Input images directory: ${imagesDir}`],
      datasetName: cleanName,
      outputDir
    };
    activeReconstructionJobs.set(jobId, job);

    // Run async photogrammetry pipeline using hmm/main.py or selected neural engine
    (async () => {
      try {
        const genpcScript   = path.resolve('..', 'genpc_reconstruction.py');
        const vggtScript    = path.resolve('..', 'vggt_reconstruction.py');
        const dust3rScript  = path.resolve('..', 'dust3r_reconstruction.py');
        const hybridScript  = path.resolve('..', 'vggt_dust3r_hybrid.py');
        const mainScript    = path.resolve('..', 'main.py');
        const outObj        = path.join(outputDir, 'model.obj');
        const outHybridPfx  = outObj.replace(/\.obj$/i, '');

        let pyScript;
        let pyArgs;

        if (engine === 'genpc' && fs.existsSync(genpcScript)) {
          job.logs.push('[Stage 1/2] Launching GenPC Zero-Shot Generative Prior & Inpainting Engine...');
          pyScript = genpcScript;
          pyArgs = [
            genpcScript,
            '--input', imagesDir,
            '--output', outObj,
            '--inpaint_ratio', '0.35'
          ];
        } else if (engine === 'hybrid' && fs.existsSync(hybridScript)) {
          job.logs.push('[Stage 1/3] Launching VGGT × DUSt3R Hybrid (6GB VRAM mode: sequential loading, fp16)...');
          pyScript = hybridScript;
          pyArgs = [
            hybridScript,
            '--input',        imagesDir,
            '--output',       outHybridPfx,
            '--vggt_views',   '7',    // VGGT-1B fp16 @ 7 views ~2.5GB peak
            '--dust3r_views', '10',   // DUSt3R 224px @ 10 views ~3GB peak
            '--img_size',     '224',  // 224px = 6GB safe; 512px needs >=12GB
            '--vggt_conf',    '1.2',
            '--dust3r_conf',  '3.0'
          ];
        } else if (engine === 'vggt' && fs.existsSync(vggtScript)) {
          job.logs.push('[Stage 1/2] Launching VGGT Visual Geometry Grounded Transformer Pipeline...');
          pyScript = vggtScript;
          pyArgs = [
            vggtScript,
            '--input_dir', imagesDir,
            '--output', outObj,
            '--max_images', '6',
            '--conf_thresh', '1.5'
          ];
        } else if (fs.existsSync(dust3rScript)) {
          job.logs.push('[Stage 1/2] Launching DUSt3R Dense Neural 3D Transformer Pipeline...');
          pyScript = dust3rScript;
          pyArgs = [
            dust3rScript,
            '--input_dir', imagesDir,
            '--output', outObj,
            '--img_size', '224',
            '--max_images', '12',
            '--conf_thresh', '3.5'
          ];
        } else {
          job.logs.push('[Stage 1/2] Launching Python High-Precision Photogrammetry Pipeline...');
          pyScript = mainScript;
          pyArgs = [
            mainScript,
            '--input_dir', imagesDir,
            '--output', outObj,
            '--format', 'obj',
            '--feature_type', 'SIFT',
            '--mesh_method', 'poisson'
          ];
        }

        const pyProcess = spawn('python', pyArgs);

        pyProcess.stdout.on('data', (d) => {
          const raw = d.toString();
          const lines = raw.split(/\r?\n/);
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              job.logs.push(trimmed);
              // Extract percentage: e.g. [ 25%] or 25% | or [INFO] [25%]
              const pctMatch = trimmed.match(/(?:\[|\s)(\d{1,3})%/);
              if (pctMatch) {
                const parsed = parseInt(pctMatch[1], 10);
                if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
                  job.progress = Math.min(99, Math.max(job.progress, parsed));
                }
              }
            }
          }
        });

        pyProcess.stderr.on('data', (d) => {
          const line = d.toString().trim();
          if (line) {
            console.warn('[Python Stderr]:', line);
            job.logs.push(`[WARN]: ${line}`);
          }
        });

        const exitCode = await new Promise((resolve) => pyProcess.on('close', resolve));

        // Hybrid pipeline writes outHybridPfx + '.obj'; normalise to outObj
        const resolvedObj = (engine === 'hybrid' && fs.existsSync(outHybridPfx + '.obj'))
          ? outHybridPfx + '.obj'
          : outObj;

        if (exitCode !== 0 || !fs.existsSync(resolvedObj)) {
          job.status = 'error';
          job.logs.push(`[ERROR] Python pipeline failed with exit code ${exitCode}.`);
          return;
        }

        // Copy generated 3D OBJ to public/models and ../output for universal Three.js accessibility
        const publicModelsDir = path.resolve('public', 'models');
        fs.mkdirSync(publicModelsDir, { recursive: true });
        fs.copyFileSync(resolvedObj, path.join(publicModelsDir, `${cleanName}.obj`));

        // Also copy .splat if the hybrid produced one
        const hybridSplat = outHybridPfx + '.splat';
        if (engine === 'hybrid' && fs.existsSync(hybridSplat)) {
          fs.copyFileSync(hybridSplat, path.join(publicModelsDir, `${cleanName}.splat`));
          job.logs.push(`[INFO] Hybrid .splat exported: ${cleanName}.splat`);
        }

        const globalOutputDir = path.resolve('..', 'output');
        fs.mkdirSync(globalOutputDir, { recursive: true });
        fs.copyFileSync(resolvedObj, path.join(globalOutputDir, `${cleanName}.obj`));

        // Create points3D.txt from OBJ vertices if not already present
        if (fs.existsSync(outObj)) {
          const objContent = fs.readFileSync(outObj, 'utf8');
          const lines = objContent.split('\n');
          let txtLines = ['# 3D Point Cloud Export', '# PointID X Y Z R G B Error Track[]'];
          let ptId = 1;
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('v ')) {
              const parts = line.split(/\s+/);
              if (parts.length >= 4) {
                const x = parts[1];
                const y = parts[2];
                const z = parts[3];
                const r = parts[4] ? Math.round(parseFloat(parts[4]) * 255) : 200;
                const g = parts[5] ? Math.round(parseFloat(parts[5]) * 255) : 200;
                const b = parts[6] ? Math.round(parseFloat(parts[6]) * 255) : 200;
                txtLines.push(`${ptId} ${x} ${y} ${z} ${r} ${g} ${b} 1.0`);
                ptId++;
              }
            }
          }
          fs.writeFileSync(path.join(outputDir, 'points3D.txt'), txtLines.join('\n'));
        }

        job.progress = 100;
        job.status = 'complete';
        job.modelFile = `${cleanName}.obj`;
        job.logs.push(`[SUCCESS] Real 3D Reconstruction completed! Saved as ${cleanName}.obj`);
        datasetCache.delete(cleanName);
      } catch (e) {
        job.status = 'error';
        job.logs.push(`[ERROR] Reconstruction failed: ${e.message}`);
      }
    })();

    return res.json({ jobId, datasetName: cleanName, status: 'started' });
  } catch (err) {
    console.error('Failed to start reconstruction job:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 3. Job Status Polling
app.get('/api/jobs/:jobId/status', (req, res) => {
  const { jobId } = req.params;
  const job = activeReconstructionJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  return res.json(job);
});
// 3b. GenPC Missing Pixel Completion Endpoint
app.post('/api/genpc/complete', async (req, res) => {
  try {
    const { modelName = 'dust3r_mode1l.obj', inpaintRatio = 0.35 } = req.body;
    const { spawn } = await import('child_process');

    const publicModelsDir = path.resolve('public', 'models');
    const outputHMM = path.resolve('..', 'output');

    let inputPath = path.join(publicModelsDir, modelName);
    if (!fs.existsSync(inputPath)) {
      inputPath = path.join(outputHMM, modelName);
    }
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ error: `Model ${modelName} not found.` });
    }

    const baseName = modelName.replace(/\.obj$/i, '');
    const outFilename = `${baseName}_genpc.obj`;
    const outObjPath = path.join(publicModelsDir, outFilename);
    const globalOutObjPath = path.join(outputHMM, outFilename);

    const pyScript = path.resolve('..', 'genpc_engine.py');
    const pyCode = `
import sys, json
from genpc_engine import GenPCCompletionEngine
res = GenPCCompletionEngine.complete_obj_file(
    input_obj_path=r'${inputPath}',
    output_obj_path=r'${outObjPath}',
    inpaint_ratio=${parseFloat(inpaintRatio)}
)
# Output JSON result for node server
info = {
    "status": "success",
    "model_name": "${outFilename}",
    "captured_count": res["captured_count"],
    "generated_count": res["generated_count"],
    "total_count": res["total_count"],
    "missing_pixels_inpainted": res["missing_pixels_inpainted"],
    "captured_pct": res["captured_pct"],
    "generated_pct": res["generated_pct"],
    "avg_confidence": res["avg_confidence"]
}
print("__GENPC_JSON__" + json.dumps(info))
`;

    const pyProcess = spawn('python', ['-c', pyCode], { cwd: path.resolve('..') });
    let stdoutData = '';
    let stderrData = '';

    pyProcess.stdout.on('data', d => stdoutData += d.toString());
    pyProcess.stderr.on('data', d => stderrData += d.toString());

    pyProcess.on('close', code => {
      if (code === 0 && stdoutData.includes('__GENPC_JSON__')) {
        try {
          if (fs.existsSync(outObjPath)) {
            fs.copyFileSync(outObjPath, globalOutObjPath);
          }
          const jsonStr = stdoutData.split('__GENPC_JSON__')[1].trim();
          const parsed = JSON.parse(jsonStr);
          return res.json(parsed);
        } catch (parseErr) {
          return res.status(500).json({ error: 'Failed to parse GenPC completion output.' });
        }
      } else {
        console.error('GenPC completion process failed:', stderrData || stdoutData);
        return res.status(500).json({ error: 'GenPC completion failed: ' + (stderrData || stdoutData) });
      }
    });
  } catch (err) {
    console.error('GenPC API error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 3c. Autonomous Video-Aware Multimodal 3D World Completion Agent Endpoint
app.post('/api/agent/complete', async (req, res) => {
  try {
    const { modelName = 'video_3d_world.obj', videoSource = null, datasetName = null } = req.body;
    const { spawn } = await import('child_process');

    const publicModelsDir = path.resolve('public', 'models');
    const outputHMM = path.resolve('..', 'output');

    let inputPath = path.join(publicModelsDir, modelName);
    if (!fs.existsSync(inputPath)) {
      inputPath = path.join(outputHMM, modelName);
    }
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ error: `Model ${modelName} not found.` });
    }

    const baseName = modelName.replace(/\.obj$/i, '');
    const outFilename = `${baseName}_agent_infilled.obj`;
    const outObjPath = path.join(publicModelsDir, outFilename);
    const globalOutObjPath = path.join(outputHMM, outFilename);

    const pyCode = `
import sys, json, os
from video_aware_agent import VideoAware3DWorldAgent
agent = VideoAware3DWorldAgent(verbose=False)
frame_dir = r'${videoSource || ''}' if r'${videoSource || ''}' and os.path.exists(r'${videoSource || ''}') else None
if not frame_dir:
    frame_dir = VideoAware3DWorldAgent.resolve_frame_directory(r'${inputPath}', r'${datasetName || ''}')

res = agent.run_agentic_pipeline(
    video_path_or_dir=frame_dir,
    model_path=r'${inputPath}',
    dataset_name=r'${datasetName || ''}',
    output_path=r'${outObjPath}'
)
info = {
    "status": "success",
    "model_name": "${outFilename}",
    "captured_count": res["captured_count"],
    "generated_count": res["generated_count"],
    "total_count": res["total_count"],
    "video_recovered_count": res["video_recovered_count"],
    "generative_prior_count": res["generative_prior_count"],
    "pass_rate": res["pass_rate"],
    "avg_confidence": res["avg_confidence"],
    "trace_logs": res["trace_logs"],
    "elapsed_seconds": res["elapsed_seconds"]
}
print("__AGENT_JSON__" + json.dumps(info))
`;

    const pyProcess = spawn('python', ['-c', pyCode], { cwd: path.resolve('..') });
    let stdoutData = '';
    let stderrData = '';

    pyProcess.stdout.on('data', d => stdoutData += d.toString());
    pyProcess.stderr.on('data', d => stderrData += d.toString());

    pyProcess.on('close', code => {
      if (code === 0 && stdoutData.includes('__AGENT_JSON__')) {
        try {
          if (fs.existsSync(outObjPath)) {
            fs.copyFileSync(outObjPath, globalOutObjPath);
          }
          const jsonStr = stdoutData.split('__AGENT_JSON__')[1].trim();
          const parsed = JSON.parse(jsonStr);
          return res.json(parsed);
        } catch (parseErr) {
          return res.status(500).json({ error: 'Failed to parse Video Agent output.' });
        }
      } else {
        console.error('Video Agent process failed:', stderrData || stdoutData);
        return res.status(500).json({ error: 'Video Agent failed: ' + (stderrData || stdoutData) });
      }
    });
  } catch (err) {
    console.error('Video Agent API error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 3d. Semantic 3D Scene Completion Endpoint (Isolated Experimental Module)
app.post('/api/semantic_completion/run', async (req, res) => {
  try {
    const {
      modelName = 'video_3d_world.obj',
      model = 'geometric_semantic',
      confidence = 0.65,
      iterations = 25,
      exportMode = 'rgb',
      videoSource = null,
      groundFloating = true,
      continuousTerrain = true
    } = req.body;
    const { spawn } = await import('child_process');

    const publicModelsDir = path.resolve('public', 'models');
    const outputHMM = path.resolve('..', 'output');

    let inputPath = path.join(publicModelsDir, modelName);
    if (!fs.existsSync(inputPath)) {
      inputPath = path.join(outputHMM, modelName);
    }
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ error: `Model ${modelName} not found.` });
    }

    const baseName = modelName.replace(/\.obj$/i, '');
    const outFilename = `${baseName}_semantic_completed.obj`;
    const outObjPath = path.join(publicModelsDir, outFilename);
    const globalOutObjPath = path.join(outputHMM, outFilename);

    let kfDir = videoSource && fs.existsSync(videoSource) ? videoSource : path.join(outputHMM, 'video_keyframes');
    if (!fs.existsSync(kfDir)) {
      kfDir = '';
    }

    const pyCode = `
import sys, json, os, time
from semantic_completion import PointCloudAdapter, VideoFeatureAdapter, SemanticCompletionEngine, CompletionConfig, ExportFormat

scene_input = PointCloudAdapter.load_from_file(r'${inputPath}')
video_adapter = None
if r'${kfDir}' and os.path.isdir(r'${kfDir}'):
    video_adapter = VideoFeatureAdapter(keyframe_dir=r'${kfDir}')

config = CompletionConfig(
    model_name='${model}',
    confidence_threshold=${confidence},
    max_frontier_iterations=${iterations},
    deep_scene_infill=True,
    ground_floating_structures=${groundFloating ? 'True' : 'False'},
    continuous_terrain_infill=${continuousTerrain ? 'True' : 'False'},
    disaster_conservative_mode=True
)
engine = SemanticCompletionEngine(config)
res = engine.run_completion(scene_input, video_adapter=video_adapter)

export_fmt = ExportFormat('${exportMode}')
export_info = res["fusion_manager"].export_obj(
    output_path=r'${outObjPath}',
    export_format=export_fmt,
    min_confidence=${confidence},
    include_unknown=True
)

info = {
    "status": "success",
    "model_name": "${outFilename}",
    "total_points": export_info["total_points"],
    "observed_count": export_info["observed_count"],
    "predicted_count": export_info["predicted_count"],
    "unknown_count": export_info["unknown_count"],
    "model_used": res["diagnostics"]["model_name"],
    "acceptance_rate": f"{res['diagnostics']['acceptance_rate_pct']}%",
    "mean_confidence": str(res["diagnostics"]["mean_confidence"]),
    "structures_grounded": res["diagnostics"].get("structures_grounded", 0),
    "terrain_voids_sealed": res["diagnostics"].get("terrain_voids_sealed", 0),
    "inference_time_sec": str(res["diagnostics"]["inference_time_sec"]) + "s",
    "vram_used": str(res["diagnostics"]["gpu_memory_used_mb"]) + " MB"
}
print("__SEMANTIC_JSON__" + json.dumps(info))
`;

    const pyProcess = spawn('python', ['-c', pyCode], { cwd: path.resolve('..') });
    let stdoutData = '';
    let stderrData = '';

    pyProcess.stdout.on('data', d => stdoutData += d.toString());
    pyProcess.stderr.on('data', d => stderrData += d.toString());

    pyProcess.on('close', code => {
      if (code === 0 && stdoutData.includes('__SEMANTIC_JSON__')) {
        try {
          if (fs.existsSync(outObjPath)) {
            fs.copyFileSync(outObjPath, globalOutObjPath);
          }
          const jsonStr = stdoutData.split('__SEMANTIC_JSON__')[1].trim();
          const parsed = JSON.parse(jsonStr);
          return res.json(parsed);
        } catch (parseErr) {
          return res.status(500).json({ error: 'Failed to parse Semantic Completion output.' });
        }
      } else {
        console.error('Semantic Completion process failed:', stderrData || stdoutData);
        return res.status(500).json({ error: 'Semantic Completion failed: ' + (stderrData || stdoutData) });
      }
    });
  } catch (err) {
    console.error('Semantic Completion API error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 4. List all .obj files actually on disk
app.get('/api/models', (req, res) => {
  try {
    const publicModelsDir = path.resolve('public', 'models');
    const projectsDir = path.resolve('projects');
    const results = [];

    // Scan public/models/ for all .obj files
    if (fs.existsSync(publicModelsDir)) {
      const files = fs.readdirSync(publicModelsDir).filter(f => f.endsWith('.obj'));
      for (const file of files) {
        const name = file.replace('.obj', '');
        const stat = fs.statSync(path.join(publicModelsDir, file));
        // Check if this came from a real project (has a matching projects/ subfolder)
        const isProject = fs.existsSync(path.join(projectsDir, name));
        results.push({
          filename: file,
          name: name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          datasetName: name,
          sizeKB: Math.round(stat.size / 1024),
          isProject
        });
      }
    }

    return res.json({ models: results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});


app.get('/api/datasets', async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const root = path.resolve('.');
    const outputHMM = path.resolve('..', 'output');
    const datasets = [];

    const searchDirs = [root, path.join(root, 'projects'), outputHMM];

    for (const sDir of searchDirs) {
      if (!fs.existsSync(sDir)) continue;
      const entries = fs.readdirSync(sDir, { withFileTypes: true });

      for (const ent of entries) {
        if (ent.isDirectory() && !['node_modules', 'dist', 'src', 'public', '.git'].includes(ent.name)) {
          const p1 = path.join(sDir, ent.name, 'sparse', 'points3D.txt');
          const p2 = path.join(sDir, ent.name, 'points3D.txt');
          const p3 = path.join(sDir, ent.name, '3d_model', 'points3D.txt');
          const p4 = path.join(sDir, ent.name, 'model.obj');

          const found = [p1, p2, p3, p4].find(p => fs.existsSync(p));
          if (found) {
            const stat = fs.statSync(found);
            datasets.push({
              name: ent.name,
              lastModified: stat.mtime
            });
          }
        } else if (ent.isFile() && ent.name.endsWith('.obj')) {
          const stat = fs.statSync(path.join(sDir, ent.name));
          datasets.push({
            name: ent.name.replace('.obj', ''),
            lastModified: stat.mtime
          });
        }
      }
    }
    return res.json({ datasets });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Universal Endpoint to load ANY COLMAP / SfM / OBJ dataset with mtime auto-invalidation
const datasetCache = new Map();

app.get('/api/datasets/:datasetName/sparse', async (req, res) => {
  try {
    const { datasetName } = req.params;
    const fs = await import('fs');
    const path = await import('path');
    
    // Check multiple potential locations
    const candidatePaths = [
      path.resolve(datasetName, 'sparse/points3D.txt'),
      path.resolve(datasetName, 'points3D.txt'),
      path.resolve('projects', datasetName, '3d_model/points3D.txt'),
      path.resolve('projects', datasetName, '3d_model/model.obj'),
      path.resolve('projects', datasetName, 'points3D.txt'),
      path.resolve('..', 'output', `${datasetName}.obj`),
      path.resolve('..', 'output', datasetName, 'points3D.txt'),
      path.resolve('..', 'output', datasetName, 'temple_world.obj'),
      path.resolve('..', 'output', 'cinematic_world.obj')
    ];

    const modelPath = candidatePaths.find(p => fs.existsSync(p));

    if (!modelPath) {
      return res.status(404).json({ error: `Dataset "${datasetName}" not found` });
    }

    const currentMtime = fs.statSync(modelPath).mtimeMs;
    const cached = datasetCache.get(datasetName);

    if (cached && cached.mtime === currentMtime && req.query.nocache !== 'true') {
      return res.json(cached.data);
    }

    const content = fs.readFileSync(modelPath, 'utf8');
    const positions = [];
    const colors = [];

    if (modelPath.endsWith('.obj')) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('v ')) {
          const parts = line.split(/\s+/);
          if (parts.length >= 4) {
            positions.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
            if (parts.length >= 7) {
              colors.push(parseFloat(parts[4]), parseFloat(parts[5]), parseFloat(parts[6]));
            } else {
              colors.push(0.85, 0.85, 0.85);
            }
          }
        }
      }
    } else {
      const pointLines = content.split('\n');
      for (let i = 0; i < pointLines.length; i++) {
        const line = pointLines[i].trim();
        if (!line || line.startsWith('#')) continue;
        const parts = line.split(/\s+/);
        if (parts.length >= 7) {
          positions.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
          colors.push(parseInt(parts[4]) / 255, parseInt(parts[5]) / 255, parseInt(parts[6]) / 255);
        }
      }
    }

    const result = {
      datasetName,
      pointCount: positions.length / 3,
      positions,
      colors,
      cameras: []
    };

    datasetCache.set(datasetName, { mtime: currentMtime, data: result });
    console.log(`[Photogrammetry Engine] Loaded ${datasetName}: ${result.pointCount} points`);
    return res.json(result);
  } catch (err) {
    console.error(`Error parsing dataset ${req.params.datasetName}:`, err);
    return res.status(500).json({ error: err.message });
  }
});

const server = http.createServer(app);

// WebSocket Proxy Server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  console.log('Client connected to Node.js WebSocket proxy');

  // Convert http URL to ws URL for the python server
  const aiWsUrl = aiServerUrl.replace(/^http/, 'ws') + '/reconstruction/ws';
  let aiWs = null;

  try {
    aiWs = new WebSocket(aiWsUrl);
  } catch (err) {
    console.error('Failed to open connection to Python AI WS:', err.message);
    ws.send(JSON.stringify({ stage: 'error', error: 'Python inference server WebSocket offline.' }));
    ws.close();
    return;
  }

  // Queue for messages sent before Python WS is fully open
  const pendingMessages = [];

  // Forward messages from browser client to Python server
  ws.on('message', (message) => {
    const msgStr = message.toString();
    if (aiWs && aiWs.readyState === WebSocket.OPEN) {
      aiWs.send(msgStr);
    } else {
      console.log('Buffering message until Python WS is open:', msgStr);
      pendingMessages.push(msgStr);
    }
  });

  // Forward messages from Python server to browser client
  aiWs.on('open', () => {
    console.log('Connected to Python AI service WebSocket');
    // Flush buffered messages
    while (pendingMessages.length > 0) {
      const queuedMsg = pendingMessages.shift();
      console.log('Flushing buffered message to Python WS:', queuedMsg);
      aiWs.send(queuedMsg);
    }
  });

  aiWs.on('message', (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data.toString());
    }
  });

  aiWs.on('close', () => {
    console.log('Python AI service closed WS connection');
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  aiWs.on('error', (err) => {
    console.error('Python AI WS Error:', err.message);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ stage: 'error', error: 'Python AI server inference error.' }));
    }
  });

  ws.on('close', () => {
    console.log('Client closed WS connection');
    if (aiWs && aiWs.readyState === WebSocket.OPEN) {
      aiWs.close();
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Node.js Gateway Server running on port ${port} (0.0.0.0)`);
  console.log(`Proxying reconstruction requests to the HMM backend at ${aiServerUrl}`);
});
