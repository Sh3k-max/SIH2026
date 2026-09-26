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
        y
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
    id: 'proj-dji-1001',
    name: 'DJI 1001 - Single-Pass Aerial Survey (Viser Cache)',
    path: 'SIH_SINGLEPASS/scene/DJI_1001',
    type: 'new',
    imageCount: 83,
    images: [],
    coordinateSystem: 'WGS-84 / UTM Zone 14N',
    datum: 'WGS-84',
    unit: 'm',
    createdAt: '2026-09-26 10:30',
    isProcessed: true,
    datasetName: 'DJI_1001',
    cameras: MOCK_CAMERAS
  },
  {
    id: 'proj-south-building',
    name: 'South Building Photogrammetry Survey',
    path: 'south-building',
    type: 'new',
    imageCount: 128,
    images: [],
    coordinateSystem: 'WGS-84',
    datum: 'WGS-84',
    unit: 'm',
    createdAt: '2026-09-25 14:15',
    isProcessed: true,
    datasetName: 'south-building'
  }
];
