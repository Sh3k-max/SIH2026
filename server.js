import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const aiServerUrl = process.env.AI_SERVER_URL || 'http://localhost:8000';

app.use(cors());
app.use(express.json());

// Proxy GET /api/system/status to Python AI service
app.get('/api/system/status', async (req, res) => {
  try {
    const response = await fetch(`${aiServerUrl}/system/status`);
    if (!response.ok) {
      throw new Error(`AI Service returned status ${response.status}`);
    }
    const data = await response.json();
    return res.json(data);
  } catch (error) {
    console.error('Failed to contact Python AI Service:', error.message);
    return res.status(502).json({
      status: 'offline',
      error: 'Python inference server is not running.',
      gpu: { available: false }
    });
  }
});

// Proxy POST /api/reconstruction/start
app.post('/api/reconstruction/start', async (req, res) => {
  try {
    const response = await fetch(`${aiServerUrl}/reconstruction/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(502).json({
      error: 'Python inference server is not running.'
    });
  }
});

// Proxy POST /api/reconstruction/frame
app.post('/api/reconstruction/frame', async (req, res) => {
  try {
    const response = await fetch(`${aiServerUrl}/reconstruction/frame`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(502).json({
      error: 'Python inference server is not running.'
    });
  }
});

// Proxy GET /api/reconstruction/:job_id/results
app.get('/api/reconstruction/:job_id/results', async (req, res) => {
  try {
    const { job_id } = req.params;
    const response = await fetch(`${aiServerUrl}/reconstruction/${job_id}/results`);
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(502).json({
      error: 'Python inference server is not running.'
    });
  }
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
      // Invalidate dataset cache so the new model is loaded immediately
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

// List all available reconstructed 3D model datasets on disk
app.get('/api/datasets', async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const root = path.resolve('.');
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const datasets = [];

    for (const ent of entries) {
      if (ent.isDirectory() && !['node_modules', 'dist', 'src', 'public', '.git'].includes(ent.name)) {
        const pointsPath1 = path.join(root, ent.name, 'sparse', 'points3D.txt');
        const pointsPath2 = path.join(root, ent.name, 'points3D.txt');
        if (fs.existsSync(pointsPath1) || fs.existsSync(pointsPath2)) {
          const target = fs.existsSync(pointsPath1) ? pointsPath1 : pointsPath2;
          const stat = fs.statSync(target);
          datasets.push({
            name: ent.name,
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

// Universal Endpoint to load ANY COLMAP / SfM dataset with mtime auto-invalidation
const datasetCache = new Map();

app.get('/api/datasets/:datasetName/sparse', async (req, res) => {
  try {
    const { datasetName } = req.params;
    const fs = await import('fs');
    const path = await import('path');
    
    // Check multiple potential locations
    let pointsPath = path.resolve(datasetName, 'sparse/points3D.txt');
    let imagesPath = path.resolve(datasetName, 'sparse/images.txt');

    if (!fs.existsSync(pointsPath)) {
      pointsPath = path.resolve(datasetName, 'points3D.txt');
      imagesPath = path.resolve(datasetName, 'images.txt');
    }

    if (!fs.existsSync(pointsPath)) {
      return res.status(404).json({ error: `Dataset "${datasetName}" with points3D.txt not found` });
    }

    const currentMtime = fs.statSync(pointsPath).mtimeMs;
    const cached = datasetCache.get(datasetName);

    // If cache is fresh and file hasn't changed, return it
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
    console.log(`[COLMAP] Loaded ${datasetName}: ${result.pointCount} points, ${cameras.length} cameras.`);
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
