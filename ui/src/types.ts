export interface Project {
  id: string;
  name: string;
  path: string;
  type: 'new' | 'merged';
  imageCount: number;
  images: string[];
  coordinateSystem: string;
  datum: string;
  unit: string;
  createdAt: string;
  cameras?: CameraTelemetry[];
  isProcessed?: boolean;
  jobId?: string;
  datasetName?: string;
}

export interface CameraTelemetry {
  id: string;
  filename: string;
  lat: number;
  lng: number;
  alt: number; // in meters (MSL)
  pitch: number; // degrees
  roll: number;  // degrees
  yaw: number;   // degrees
  x: number;     // Map coordinates (SVG viewport % or px)
  y: number;
  imageUrl?: string;
}

export interface GCP {
  id: string;
  name: string;
  lat: number;
  lng: number;
  alt: number;
  x: number;
  y: number;
  status: 'measured' | 'unmeasured';
}

export interface FlightPath {
  id: string;
  name: string;
  points: { x: number; y: number }[];
  color: string;
}

export interface VolumePolygon {
  id: string;
  name: string;
  points: { x: number; y: number; z: number }[];
  area: number;       // sq meters
  perimeter: number;  // meters
  cutVolume: number;  // m3
  fillVolume: number; // m3
  netVolume: number;  // m3
}

export interface ProcessingLog {
  id: string;
  time: string;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
}

export interface AvailableModel {
  id: string;
  filename: string;
  name: string;
  category: string;
  description: string;
  type: 'mesh' | 'points';
}

export const AVAILABLE_3D_MODELS: AvailableModel[] = [
  { id: 'video_3d_world_semantic_completed', filename: 'video_3d_world_semantic_completed.obj', name: '★ Semantic 3D Completed (Progressive AI)', category: 'Semantic Completion', description: 'Progressive local completion with multi-factor confidence, video grounding & disaster resilience', type: 'points' },
  { id: 'video_3d_world_agent_infilled', filename: 'video_3d_world_agent_infilled.obj', name: '★ Video-Aware Agent Infilled Solid World (676k pts)', category: 'Multimodal AI Agent', description: 'Cross-referenced with ALL video frames; continuous traversable ground infill, solid roof capping & sealed rear facades', type: 'points' },
  { id: 'genpc_completed_model', filename: 'genpc_completed_model.obj', name: '★ GenPC Inpainted 3D World (Zero-Shot)', category: 'GenPC AI Completed', description: 'Zero-shot generative prior completion with 50,450 missing ray pixels repaired', type: 'points' },
  { id: 'dust3r_mode1l', filename: 'dust3r_mode1l.obj', name: 'VGGT + DUSt3R Hybrid Point Cloud', category: 'Dense Point Cloud', description: 'LiDAR/Photogrammetry hybrid 3D point matrix with true RGB', type: 'points' },
  { id: 'dust3r_model', filename: 'dust3r_model.obj', name: 'DUSt3R Dense Surface Reconstruction', category: 'High-Density Mesh', description: 'Deep multi-view stereo geometric point & triangle mesh', type: 'mesh' },
  { id: 'cinematic_world', filename: 'cinematic_world.obj', name: 'Cinematic Environment 3D World', category: 'Large-Scale Mesh', description: 'Full aerial panoramic 3D textured landscape reconstruction', type: 'mesh' },
  { id: 'video_3d_world', filename: 'video_3d_world.obj', name: 'Solid Grounded World Model', category: 'Sequential Mesh', description: 'Fully enclosed 3D world with continuous ground terrain & solid structures', type: 'points' },
  { id: 'dust3r_clean', filename: 'dust3r_clean.obj', name: 'DUSt3R Clean & Filtered Surface', category: 'Optimized Mesh', description: 'Outlier-filtered high-fidelity structural surface', type: 'mesh' },
  { id: 'large_survey', filename: 'large_survey.obj', name: 'Large Aerial Survey Reconstruction', category: 'Aerial Terrain', description: 'Wide-area orthophoto-textured surface mesh', type: 'mesh' },
  { id: 'points3D', filename: 'points3D.obj', name: 'Sparse Triangulated Points (points3D)', category: 'Seed Points', description: 'Bundle adjusted sparse tie-point cloud', type: 'points' },
  { id: 'points3D_clean', filename: 'points3D_clean.obj', name: 'Denoised Sparse Point Cloud', category: 'Filtered Points', description: 'Statistical noise-filtered sparse point tie-matrix', type: 'points' }
];

// Generate beautiful zigzag flight pattern over the simulated map
const generateFlightData = (): { cameras: CameraTelemetry[]; flightLines: { x: number; y: number }[] } => {
  const cameras: CameraTelemetry[] = [];
  const flightLines: { x: number; y: number }[] = [];
  
  // 4 strip flight lines
  const rows = [150, 250, 350, 450];
  const startLat = 34.0522;
  const startLng = -118.2437;
  let idCounter = 1;

  rows.forEach((y, rowIndex) => {
    const isEven = rowIndex % 2 === 0;
    const xPositions = [];
    
    // Create 10 camera triggers per flight line strip
    for (let col = 0; col < 10; col++) {
      const pct = col / 9;
      const x = isEven ? (100 + pct * 800) : (900 - pct * 800);
      xPositions.push({ x });
    }

    xPositions.forEach(({ x }) => {
      // Add point to flight line track
      flightLines.push({ x, y });

      // Generate realistic GPS deviations
      const lat = startLat + (y - 300) * 0.00002 + (Math.random() - 0.5) * 0.000005;
      const lng = startLng + (x - 500) * 0.000024 + (Math.random() - 0.5) * 0.000005;
      const alt = 120.5 + (Math.random() - 0.5) * 1.5; // fly height around 120m
      const pitch = (Math.random() - 0.5) * 4;       // slight gimbal drift
      const roll = (Math.random() - 0.5) * 3;
      const yaw = isEven ? 90 + (Math.random() - 0.5) * 2 : 270 + (Math.random() - 0.5) * 2;

      const numStr = String(idCounter).padStart(3, '0');
      const imgIdx = String((idCounter - 1) % 16).padStart(3, '0');
      cameras.push({
        id: `cam-${idCounter}`,
        filename: `DJI_${numStr}.JPG`,
        lat: parseFloat(lat.toFixed(6)),
        lng: parseFloat(lng.toFixed(6)),
        alt: parseFloat(alt.toFixed(2)),
        pitch: parseFloat(pitch.toFixed(1)),
        roll: parseFloat(roll.toFixed(1)),
        yaw: parseFloat(yaw.toFixed(1)),
        x,
        y,
        imageUrl: `/sample_drone_flight/drone_capture_${imgIdx}.jpg`
      });
      idCounter++;
    });
  });

  return { cameras, flightLines };
};

const flightData = generateFlightData();

export const MOCK_CAMERAS = flightData.cameras;
export const MOCK_FLIGHT_PATH = flightData.flightLines;

export const MOCK_GCPS: GCP[] = [
  { id: 'gcp-1', name: 'GCP_001', lat: 34.0512, lng: -118.2512, alt: 118.2, x: 220, y: 190, status: 'measured' },
  { id: 'gcp-2', name: 'GCP_002', lat: 34.0538, lng: -118.2392, alt: 121.4, x: 780, y: 220, status: 'measured' },
  { id: 'gcp-3', name: 'GCP_003', lat: 34.0505, lng: -118.2415, alt: 119.7, x: 620, y: 480, status: 'unmeasured' },
  { id: 'gcp-4', name: 'GCP_004', lat: 34.0529, lng: -118.2498, alt: 120.1, x: 310, y: 390, status: 'unmeasured' },
];

export const MOCK_PROJECTS: Project[] = [
  {
    id: 'proj-1',
    name: 'Infrastructure & Harbor 3D Survey',
    path: 'C:/Surveys/Aevora_Harbor_Flight_01',
    type: 'new',
    imageCount: MOCK_CAMERAS.length,
    images: MOCK_CAMERAS.map(c => c.filename),
    coordinateSystem: 'WGS 84 / UTM zone 34N',
    datum: 'World Geodetic System 1984',
    unit: 'm',
    cameras: MOCK_CAMERAS,
    datasetName: 'harbor_survey',
    isProcessed: true,
    createdAt: '2026-08-31 09:30'
  },
  {
    id: 'proj-2',
    name: 'Bridge Highway Span Inspection',
    path: 'C:/Surveys/Bridge_Span_North',
    type: 'new',
    imageCount: 32,
    images: MOCK_CAMERAS.slice(0, 32).map(c => c.filename),
    coordinateSystem: 'WGS 84 / UTM zone 32N',
    datum: 'World Geodetic System 1984',
    unit: 'm',
    cameras: MOCK_CAMERAS.slice(0, 32),
    datasetName: 'bridge_span',
    isProcessed: true,
    createdAt: '2026-08-30 14:15'
  },
  {
    id: 'proj-3',
    name: 'Solar Energy Facility Volumetrics',
    path: 'C:/Surveys/Solar_Facility_Volumetrics',
    type: 'new',
    imageCount: 24,
    images: MOCK_CAMERAS.slice(0, 24).map(c => c.filename),
    coordinateSystem: 'WGS 84 / UTM zone 11N',
    datum: 'World Geodetic System 1984',
    unit: 'm',
    cameras: MOCK_CAMERAS.slice(0, 24),
    datasetName: 'solar_facility',
    isProcessed: true,
    createdAt: '2026-08-29 11:20'
  }
];
