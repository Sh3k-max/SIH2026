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

// 1. Single File / Batch File Chunk Upload Endpoint
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

    const { projectName = 'custom_project', localPath = '' } = req.body;
    const cleanName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const jobId = crypto.randomUUID();

    const targetDir = path.resolve('projects', cleanName);
    let imagesDir = path.join(targetDir, 'images');
    const outputDir = path.join(targetDir, '3d_model');

    // If a valid local directory is provided on disk, use it directly
    if (localPath && fs.existsSync(localPath)) {
      const stats = fs.statSync(localPath);
      if (stats.isDirectory()) {
        imagesDir = path.resolve(localPath);
      }
    }

    fs.mkdirSync(outputDir, { recursive: true });

    const job = {
      jobId,
      projectName: cleanName,
      status: 'running',
      progress: 5,
      logs: [`[INFO] Initialized project ${cleanName}`, `[INFO] Input images directory: ${imagesDir}`],
      datasetName: cleanName,
      outputDir
    };
    activeReconstructionJobs.set(jobId, job);

    // Run async photogrammetry pipeline using hmm/main.py
    (async () => {
      try {
        job.progress = 10;
        job.logs.push('[Stage 1/2] Launching Python High-Precision Photogrammetry Pipeline...');

        const mainScript = path.resolve('..', 'main.py');
        const outObj = path.join(outputDir, 'model.obj');

        const pyProcess = spawn('python', [
          mainScript,
          '--input_dir', imagesDir,
          '--output', outObj,
          '--format', 'obj',
          '--feature_type', 'SIFT',
          '--mesh_method', 'poisson'
        ]);

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

        if (exitCode !== 0 || !fs.existsSync(outObj)) {
          job.status = 'error';
          job.logs.push(`[ERROR] Python pipeline failed with exit code ${exitCode}.`);
          return;
        }

        // Copy generated 3D OBJ to public/models and ../output for universal Three.js accessibility
        const publicModelsDir = path.resolve('public', 'models');
        fs.mkdirSync(publicModelsDir, { recursive: true });
        fs.copyFileSync(outObj, path.join(publicModelsDir, `${cleanName}.obj`));

        const globalOutputDir = path.resolve('..', 'output');
        fs.mkdirSync(globalOutputDir, { recursive: true });
        fs.copyFileSync(outObj, path.join(globalOutputDir, `${cleanName}.obj`));

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

// List all available reconstructed 3D model datasets on disk
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
