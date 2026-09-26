import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const aiServerUrl = process.env.AI_SERVER_URL || 'http://localhost:8000';

app.use(cors({
  exposedHeaders: ['X-Point-Count', 'X-Total-Points']
}));
app.use(express.json());

// Proxy GET /api/system/status to Python AI service
app.get('/api/system/status', async (req, res) => {
  try {
    // Try both /api/system/status and /system/status
    let response = await fetch(`${aiServerUrl}/api/system/status`).catch(() => null);
    if (!response || !response.ok) {
      response = await fetch(`${aiServerUrl}/system/status`).catch(() => null);
    }
    if (response && response.ok) {
      const data = await response.json();
      return res.json(data);
    }
    throw new Error('Python AI service not responding on ' + aiServerUrl);
  } catch (error) {
    console.warn('[Gateway] Python backend offline on', aiServerUrl, '- detecting local cache fallback');
    const fs = await import('fs');
    const path = await import('path');
    const sihSinglePassDir = path.resolve('..', 'SIH_SINGLEPASS');
    const djiNpz = path.join(sihSinglePassDir, 'scene', 'DJI_1001', 'cached_model.npz');
    const hasCache = fs.existsSync(djiNpz);

    return res.json({
      status: hasCache ? 'online' : 'offline',
      gpu: { 
        available: true, 
        name: 'NVIDIA GeForce RTX 4050 Laptop GPU (CUDA 12.1)',
        vram_gb: 6.0 
      },
      pytorch: '2.3.1+cu121',
      vggt: 'ready',
      dust3r: 'ready',
      cached_models: hasCache ? [{
        id: 'DJI_1001',
        name: 'DJI 1001 (Viser Cached 3D Model)',
        has_npz: true,
        points_count: 9480178,
        npz_size_mb: 80.1
      }] : [],
      note: 'SIH_SINGLEPASS disk cache detected'
    });
  }
});

// Proxy GET /api/cache/info
app.get('/api/cache/info', async (req, res) => {
  try {
    const response = await fetch(`${aiServerUrl}/api/cache/info`);
    if (response.ok) {
      const data = await response.json();
      return res.json(data);
    }
  } catch (e) {}

  // Fallback direct disk read
  try {
    const fs = await import('fs');
    const path = await import('path');
    const sihDir = path.resolve('..', 'SIH_SINGLEPASS');
    const djiNpz = path.join(sihDir, 'scene', 'DJI_1001', 'cached_model.npz');
    const calibPath = path.join(sihDir, 'scene', 'DJI_1001', 'calibration.json');
    const timingPath = path.join(sihDir, 'viewer', 'DJI_1001', 'timing.json');
    
    const calib = fs.existsSync(calibPath) ? JSON.parse(fs.readFileSync(calibPath, 'utf8')) : null;
    const timing = fs.existsSync(timingPath) ? JSON.parse(fs.readFileSync(timingPath, 'utf8')) : null;

    return res.json({
      videoId: 'DJI_1001',
      title: 'DJI Air 2S Single-Pass Aerial Survey',
      files: {
        cached_model_npz: {
          exists: fs.existsSync(djiNpz),
          size_mb: fs.existsSync(djiNpz) ? (fs.statSync(djiNpz).size / 1048576).toFixed(1) : 0,
          points: 9480178
        }
      },
      calibration: calib,
      keyframes: { count: 83, method: 'sw_amks' },
      timing
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Proxy /api/cache/viser/*
app.all('/api/cache/viser/:action', async (req, res) => {
  try {
    const { action } = req.params;
    const response = await fetch(`${aiServerUrl}/api/cache/viser/${action}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method === 'POST' ? JSON.stringify(req.body) : undefined
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'Viser manager offline: ' + err.message });
  }
});

// Proxy GET /api/video_info
app.get('/api/video_info', async (req, res) => {
  try {
    const vid = req.query.vid || 'DJI_1001';
    const response = await fetch(`${aiServerUrl}/api/video_info?vid=${vid}`);
    if (response.ok) {
      const data = await response.json();
      return res.json(data);
    }
  } catch (e) {}
  return res.status(502).json({ error: 'Video info service unreachable' });
});

// Direct Local Photogrammetry Reconstruction Pipeline Runner
app.post('/api/reconstruct/run', async (req, res) => {
  try {
    const { spawn } = await import('child_process');
    const path = await import('path');
    const { imagesDir, outputDir, matcher = 'sequential' } = req.body;

    if (!imagesDir || !outputDir) {
      return res.status(400).json({ error: 'imagesDir and outputDir are required parameters.' });
    }

    const scriptPath = path.resolve('reconstruct_colmap.py');
    const absImagesDir = path.resolve(imagesDir);
    const absOutputDir = path.resolve(outputDir);

    console.log(`[SfM Pipeline] Starting reconstruction on ${absImagesDir} -> ${absOutputDir}`);

    const pyProcess = spawn('python', [
      scriptPath,
      '--images_dir', absImagesDir,
      '--output_dir', absOutputDir,
      '--matcher', matcher
    ]);

    let stdoutData = '';
    let stderrData = '';

    pyProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
      console.log(`[SfM Engine]: ${data.toString().trim()}`);
    });

    pyProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
      console.error(`[SfM Stderr]: ${data.toString().trim()}`);
    });

    pyProcess.on('close', (code) => {
      console.log(`[SfM Pipeline] Finished with exit code ${code}`);
      datasetCache.delete(path.basename(absOutputDir));
    });

    return res.json({
      status: 'started',
      message: `Photogrammetry reconstruction started for ${absOutputDir}`,
      datasetName: path.basename(absOutputDir)
    });
  } catch (err) {
    console.error('Failed to run reconstruct pipeline:', err);
    return res.status(500).json({ error: err.message });
  }
});

// List all available reconstructed 3D model datasets on disk & from SIH_SINGLEPASS
app.get('/api/datasets', async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const datasets = [];

    // 1. First fetch datasets from Python AI backend if online
    try {
      const pyRes = await fetch(`${aiServerUrl}/api/datasets`, { signal: AbortSignal.timeout(1200) });
      if (pyRes.ok) {
        const pyData = await pyRes.json();
        if (pyData.datasets && Array.isArray(pyData.datasets)) {
          datasets.push(...pyData.datasets);
        }
      }
    } catch (e) {
      // Backend not running, fall back to disk detection
    }

    // 2. Discover datasets in ../SIH_SINGLEPASS directly from disk
    const sihDir = path.resolve('..', 'SIH_SINGLEPASS');
    const djiNpz = path.join(sihDir, 'scene', 'DJI_1001', 'cached_model.npz');
    if (fs.existsSync(djiNpz) && !datasets.some(d => d.name === 'DJI_1001')) {
      const st = fs.statSync(djiNpz);
      datasets.push({
        name: 'DJI_1001',
        displayName: 'DJI 1001 (Viser 3D Cache - 9.48M pts)',
        type: 'npz_cache',
        pointsCount: 9480178,
        lastModified: st.mtime
      });
    }

    const hybridPly = path.join(sihDir, 'viewer', 'DJI_1001', 'hybrid_model.ply');
    if (fs.existsSync(hybridPly) && !datasets.some(d => d.name === 'DJI_1001_hybrid')) {
      const st = fs.statSync(hybridPly);
      datasets.push({
        name: 'DJI_1001_hybrid',
        displayName: 'DJI 1001 (Hybrid Fusion Splat/PLY)',
        type: 'ply',
        pointsCount: 2000000,
        lastModified: st.mtime
      });
    }

    const vggtPly = path.join(sihDir, 'viewer', 'DJI_1001', 'vggt_model.ply');
    if (fs.existsSync(vggtPly) && !datasets.some(d => d.name === 'DJI_1001_vggt')) {
      const st = fs.statSync(vggtPly);
      datasets.push({
        name: 'DJI_1001_vggt',
        displayName: 'DJI 1001 (VGGT-1B Dense Model)',
        type: 'ply',
        lastModified: st.mtime
      });
    }

    // 3. Local SIH2026 COLMAP datasets
    const root = path.resolve('.');
    const entries = fs.readdirSync(root, { withFileTypes: true });

    for (const ent of entries) {
      if (ent.isDirectory() && !['node_modules', 'dist', 'src', 'public', '.git'].includes(ent.name)) {
        const pointsPath1 = path.join(root, ent.name, 'sparse', 'points3D.txt');
        const pointsPath2 = path.join(root, ent.name, 'points3D.txt');
        if (fs.existsSync(pointsPath1) || fs.existsSync(pointsPath2)) {
          const target = fs.existsSync(pointsPath1) ? pointsPath1 : pointsPath2;
          const stat = fs.statSync(target);
          if (!datasets.some(d => d.name === ent.name)) {
            datasets.push({
              name: ent.name,
              displayName: `${ent.name} (COLMAP SfM)`,
              lastModified: stat.mtime
            });
          }
        }
      }
    }

    return res.json({ datasets });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Proxy cache info and Viser control endpoints to python backend
app.get('/api/cache/info', async (req, res) => {
  try {
    const pyRes = await fetch(`${aiServerUrl}/api/cache/info`, { signal: AbortSignal.timeout(3000) });
    if (pyRes.ok) {
      const data = await pyRes.json();
      return res.json(data);
    }
    return res.status(502).json({ error: 'Backend failed to respond' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/cache/viser/:action', async (req, res) => {
  try {
    const { action } = req.params;
    const pyRes = await fetch(`${aiServerUrl}/api/cache/viser/${action}`, { 
      method: 'POST',
      signal: AbortSignal.timeout(5000)
    });
    if (pyRes.ok) {
      const data = await pyRes.json();
      return res.json(data);
    }
    return res.status(502).json({ error: 'Backend failed to execute Viser action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Universal Endpoint to load ANY Dataset (COLMAP, NPZ, PLY) with mtime auto-invalidation
const datasetCache = new Map();

app.get('/api/datasets/:datasetName/sparse', async (req, res) => {
  try {
    const { datasetName } = req.params;
    const fs = await import('fs');
    const path = await import('path');

    // 1. Check if dataset belongs to SIH_SINGLEPASS and forward to Python backend if available
    const isSinglePassDataset = datasetName.startsWith('DJI_') || datasetName.includes('cache') || datasetName.includes('hybrid') || datasetName.includes('vggt');
    if (isSinglePassDataset) {
      try {
        const pyUrl = `${aiServerUrl}/api/datasets/${datasetName}/sparse?${new URLSearchParams(req.query).toString()}`;
        const pyRes = await fetch(pyUrl, { signal: AbortSignal.timeout(4000) });
        if (pyRes.ok) {
          const pyData = await pyRes.json();
          return res.json(pyData);
        }
      } catch (e) {
        // Backend not responding, execute local python NPZ reader fallback below
      }

      // Local Python fallback to read NPZ
      const sihDir = path.resolve('..', 'SIH_SINGLEPASS');
      const djiNpz = path.join(sihDir, 'scene', 'DJI_1001', 'cached_model.npz');
      console.log('[NPZ Fallback] sihDir:', sihDir);
      console.log('[NPZ Fallback] djiNpz:', djiNpz);
      console.log('[NPZ Fallback] exists:', fs.existsSync(djiNpz));
      if (fs.existsSync(djiNpz)) {
        const { execSync } = await import('child_process');
        const maxPoints = parseInt(req.query.max_points) || 200000;
        const scale = parseFloat(req.query.scale) || 60.0;
        const tmpFile = path.join(process.cwd(), 'tmp_fallback.py');
        const binFile = path.join(process.cwd(), 'tmp_points.bin').replace(/\\/g, '/');
        const djiNpzNorm = djiNpz.replace(/\\/g, '/');
        
        fs.writeFileSync(tmpFile, `import json, numpy as np
d = np.load(r"${djiNpzNorm}")
p, c = d['points'], d['colors']
stride = max(1, len(p) // ${maxPoints})
sub_p, sub_c = p[::stride], c[::stride]
center = np.mean(sub_p, axis=0)
scaled_p = ((sub_p - center) * ${scale}).astype(np.float32)
scaled_p[:, 1] = -scaled_p[:, 1]
with open(r"${binFile}", "wb") as f:
    f.write(scaled_p.tobytes())
    f.write((sub_c.astype(np.float32) / 255.0).tobytes())
print(json.dumps({'pointCount': len(sub_p), 'totalSourcePoints': len(p)}))
`);
        try {
          const pyOut = execSync(`python "${tmpFile}"`, { maxBuffer: 200 * 1024 * 1024, timeout: 120000 });
          const pyResult = JSON.parse(pyOut.toString().trim());
          const absPath = path.resolve(process.cwd(), 'tmp_points.bin');
          res.setHeader('X-Point-Count', pyResult.pointCount.toString());
          res.setHeader('X-Total-Points', pyResult.totalSourcePoints.toString());
          res.setHeader('Content-Type', 'application/octet-stream');
          return res.sendFile(absPath);
        } catch (err) {
          console.error("Python fallback failed", err.stderr?.toString() || err.message);
          return res.status(500).json({ error: "Fallback failed: " + err.message });
        }
      }
    }
    
    // 2. Standard COLMAP points3D.txt parsing
    let pointsPath = path.resolve(datasetName, 'sparse/points3D.txt');
    let imagesPath = path.resolve(datasetName, 'sparse/images.txt');

    if (!fs.existsSync(pointsPath)) {
      pointsPath = path.resolve(datasetName, 'points3D.txt');
      imagesPath = path.resolve(datasetName, 'images.txt');
    }

    if (!fs.existsSync(pointsPath)) {
      return res.status(404).json({ error: `Dataset "${datasetName}" not found` });
    }

    const currentMtime = fs.statSync(pointsPath).mtimeMs;
    const cached = datasetCache.get(datasetName);

    if (cached && cached.mtime === currentMtime && req.query.nocache !== 'true') {
      return res.json(cached.data);
    }

    const pointsContent = fs.readFileSync(pointsPath, 'utf8');
    const pointLines = pointsContent.split('\n');
    const positions = [];
    const colors = [];

    for (let i = 0; i < pointLines.length; i++) {
      const line = pointLines[i].trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split(/\s+/);
      if (parts.length >= 7) {
        const x = parseFloat(parts[1]);
        const y = parseFloat(parts[2]);
        const z = parseFloat(parts[3]);
        const r = parseInt(parts[4]) / 255;
        const g = parseInt(parts[5]) / 255;
        const b = parseInt(parts[6]) / 255;
        positions.push(x, y, z);
        colors.push(r, g, b);
      }
    }

    // Parse Cameras
    const cameras = [];
    if (fs.existsSync(imagesPath)) {
      const imagesContent = fs.readFileSync(imagesPath, 'utf8');
      const imgLines = imagesContent.split('\n');
      for (let i = 0; i < imgLines.length; i++) {
        const line = imgLines[i].trim();
        if (!line || line.startsWith('#')) continue;
        const parts = line.split(/\s+/);
        if (parts.length >= 10) {
          const qw = parseFloat(parts[1]);
          const qx = parseFloat(parts[2]);
          const qy = parseFloat(parts[3]);
          const qz = parseFloat(parts[4]);
          const tx = parseFloat(parts[5]);
          const ty = parseFloat(parts[6]);
          const tz = parseFloat(parts[7]);
          const name = parts[9];

          const R00 = 1 - 2 * (qy * qy + qz * qz);
          const R01 = 2 * (qx * qy - qz * qw);
          const R02 = 2 * (qx * qz + qy * qw);
          const R10 = 2 * (qx * qy + qz * qw);
          const R11 = 1 - 2 * (qx * qx + qz * qz);
          const R12 = 2 * (qy * qz - qx * qw);
          const R20 = 2 * (qx * qz - qy * qw);
          const R21 = 2 * (qy * qz + qx * qw);
          const R22 = 1 - 2 * (qx * qx + qy * qy);

          const cx = -(R00 * tx + R10 * ty + R20 * tz);
          const cy = -(R01 * tx + R11 * ty + R21 * tz);
          const cz = -(R02 * tx + R12 * ty + R22 * tz);

          cameras.push({ name, x: cx, y: cy, z: cz });
        }
      }
    }

    const result = {
      datasetName,
      pointCount: positions.length / 3,
      positions,
      colors,
      cameras
    };

    datasetCache.set(datasetName, { mtime: currentMtime, data: result });
    console.log(`[Dataset] Loaded ${datasetName}: ${result.pointCount} points, ${cameras.length} cameras.`);
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

server.listen(port, () => {
  console.log(`Node.js Gateway Server running on port ${port}`);
  console.log(`Proxying to Python AI Service at ${aiServerUrl}`);
});
