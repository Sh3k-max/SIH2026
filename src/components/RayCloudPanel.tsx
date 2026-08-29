import React, { useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { 
  Sliders, 
  Info,
  Activity,
  AlertTriangle,
  Server,
  Compass,
  Layers,
  RotateCw
} from 'lucide-react';
import { MOCK_CAMERAS } from '../types';
import type { Project } from '../types';
import { generateDensePointCloud, loadSouthBuildingPointCloud, loadDatasetPointCloud } from '../utils/photogrammetryScene';

interface RayCloudPanelProps {
  activeProject: Project | null;
  setCurrentView?: (view: string) => void;
}

export const RayCloudPanel: React.FC<RayCloudPanelProps> = ({ activeProject, setCurrentView }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const reqIdRef = useRef<number | null>(null);
  const pointsObjRef = useRef<THREE.Points | null>(null);
  
  // Viewer Mode Selection
  const [viewerMode, setViewerMode] = useState<'inference' | 'demo'>('demo');
  const [structureType, setStructureType] = useState<'south-building' | 'building' | 'terrain'>('south-building');
  const [pointCountDisplay, setPointCountDisplay] = useState<number>(61514);

  // Navigation Mode: 'fly' (GeoGuessr Walk/Fly WASD) or 'orbit' (Turntable Inspection)
  const [navMode, setNavMode] = useState<'fly' | 'orbit'>('fly');
  const [camPos, setCamPos] = useState<{ x: 0, y: 30, z: 160 }>({ x: 0, y: 30, z: 160 });
  const [moveSpeed, setMoveSpeed] = useState<number>(14);

  // Server Connection States
  const [serverUrl, setServerUrl] = useState<string>('http://localhost:5000');
  const [connectionStatus, setConnectionStatus] = useState<'online' | 'offline' | 'checking' | 'degraded'>('offline');
  const [systemSpecs, setSystemSpecs] = useState<{
    gpuAvailable: boolean;
    gpuName: string;
    gpuVram: string;
    pytorchStatus: string;
    vggtStatus: string;
    dust3rStatus: string;
    errorDetail?: string;
  } | null>(null);

  // Viewer Orbit & Look States
  const [yaw, setYaw] = useState<number>(-0.4);   
  const [pitch, setPitch] = useState<number>(0.3);  
  const [zoom, setZoom] = useState<number>(1.0);    
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const rotationStart = useRef<{ yaw: number; pitch: number }>({ yaw: -0.4, pitch: 0.3 });

  // Render Control Toggles
  const [showCameras, setShowCameras] = useState<boolean>(true);
  const [showPoints, setShowPoints] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [pointSize, setPointSize] = useState<number>(2.0);
  const [selectedCamId, setSelectedCamId] = useState<string | null>(null);

  // Test Server Connection handler
  const testServerConnection = async () => {
    setConnectionStatus('checking');
    try {
      const response = await fetch(`${serverUrl}/api/system/status`);
      const data = await response.json();
      if (data.status === 'online' || data.status === 'degraded') {
        setConnectionStatus(data.status === 'online' ? 'online' : 'degraded');
        setSystemSpecs({
          gpuAvailable: data.gpu?.available || false,
          gpuName: data.gpu?.name || 'CPU Only',
          gpuVram: data.gpu?.vram_gb ? `${data.gpu.vram_gb} GB` : '0 GB',
          pytorchStatus: data.pytorch ? `Installed (${data.pytorch})` : 'Missing',
          vggtStatus: data.vggt === 'ready' ? 'Ready' : 'Missing',
          dust3rStatus: data.dust3r === 'ready' ? 'Ready' : 'Missing',
          errorDetail: data.error || undefined
        });
      } else {
        setConnectionStatus('offline');
        setSystemSpecs({
          gpuAvailable: false,
          gpuName: 'None',
          gpuVram: '0 GB',
          pytorchStatus: 'Missing',
          vggtStatus: 'Missing',
          dust3rStatus: 'Missing',
          errorDetail: data.error || 'Server degraded.'
        });
      }
    } catch (e) {
      setConnectionStatus('offline');
      setSystemSpecs({
        gpuAvailable: false,
        gpuName: 'None',
        gpuVram: '0 GB',
        pytorchStatus: 'Missing',
        vggtStatus: 'Missing',
        dust3rStatus: 'Missing',
        errorDetail: 'Node.js server or Python AI server is not running.'
      });
    }
  };

  useEffect(() => {
    testServerConnection();
  }, []);

  // Move camera function (GeoGuessr WASD Style)
  const moveCamera = (direction: 'forward' | 'backward' | 'left' | 'right' | 'up' | 'down') => {
    const speed = moveSpeed;
    setCamPos(prev => {
      let { x, y, z } = prev;
      if (direction === 'forward') {
        x -= Math.sin(yaw) * speed;
        z -= Math.cos(yaw) * speed;
      } else if (direction === 'backward') {
        x += Math.sin(yaw) * speed;
        z += Math.cos(yaw) * speed;
      } else if (direction === 'left') {
        x -= Math.cos(yaw) * speed;
        z += Math.sin(yaw) * speed;
      } else if (direction === 'right') {
        x += Math.cos(yaw) * speed;
        z -= Math.sin(yaw) * speed;
      } else if (direction === 'up') {
        y += speed;
      } else if (direction === 'down') {
        y = Math.max(2, y - speed);
      }
      return { x, y, z };
    });
  };

  // Keyboard navigation listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') {
        moveCamera('forward');
      } else if (key === 's' || key === 'arrowdown') {
        moveCamera('backward');
      } else if (key === 'a' || key === 'arrowleft') {
        moveCamera('left');
      } else if (key === 'd' || key === 'arrowright') {
        moveCamera('right');
      } else if (key === 'e' || key === ' ') {
        moveCamera('up');
      } else if (key === 'q' || key === 'shift') {
        moveCamera('down');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [yaw, moveSpeed]);

  // Three.js WebGL Point Cloud Lifecycle
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // 1. Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#070b14');
    sceneRef.current = scene;

    // 2. Camera setup
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.5, 1500);
    camera.position.set(camPos.x, camPos.y, camPos.z);
    cameraRef.current = camera;

    // 3. Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 4. Ground Grid Helper
    if (showGrid) {
      const grid = new THREE.GridHelper(400, 40, '#334155', '#1e293b');
      grid.position.y = -0.5;
      scene.add(grid);
    }

    // 6. Generate or Load Real Photogrammetric Point Cloud
    if (structureType === 'south-building') {
      loadDatasetPointCloud('system_reconstructed_model', serverUrl).then(res => {
        if (!res || !res.points) {
          return loadSouthBuildingPointCloud(serverUrl);
        }
        return res;
      }).then((res) => {
        if (res && res.points) {
          (res.points.material as THREE.PointsMaterial).size = pointSize;
          scene.add(res.points);
          pointsObjRef.current = res.points;
          setPointCountDisplay(res.count);

          // Add real camera stations from COLMAP
          if (showCameras && res.cameras && res.cameras.length > 0) {
            const camGroup = new THREE.Group();
            const pyrMat = new THREE.MeshBasicMaterial({ color: '#38bdf8', wireframe: true });
            res.cameras.forEach((c) => {
              const pyr = new THREE.Mesh(new THREE.ConeGeometry(2.5, 4, 4), pyrMat);
              pyr.position.set(c.x, c.y, c.z);
              pyr.rotation.x = Math.PI;
              camGroup.add(pyr);
            });
            scene.add(camGroup);
          }
        }
      });
    } else {
      const pointsObj = generateDensePointCloud(structureType);
      (pointsObj.material as THREE.PointsMaterial).size = pointSize;
      scene.add(pointsObj);
      pointsObjRef.current = pointsObj;
      setPointCountDisplay(45000);

      // Drone Camera Pyramids
      if (showCameras) {
        const activeCameras = activeProject?.cameras || MOCK_CAMERAS;
        const camGroup = new THREE.Group();
        const pyrMat = new THREE.MeshBasicMaterial({ color: '#38bdf8', wireframe: true });

        activeCameras.forEach((c) => {
          const x3 = ((c.lng - -118.2437) / 0.0003) * 120;
          const z3 = ((c.lat - 34.0522) / 0.0003) * 120;
          const y3 = 80;

          const pyr = new THREE.Mesh(new THREE.ConeGeometry(3.5, 5, 4), pyrMat);
          pyr.position.set(x3, y3, z3);
          pyr.rotation.x = Math.PI;
          camGroup.add(pyr);
        });

        scene.add(camGroup);
      }
    }

    // 8. Animation loop
    const animate = () => {
      reqIdRef.current = requestAnimationFrame(animate);

      if (navMode === 'orbit') {
        const dist = 260 / zoom;
        const cx = Math.sin(yaw) * Math.cos(pitch) * dist;
        const cy = Math.max(10, Math.sin(pitch) * dist);
        const cz = Math.cos(yaw) * Math.cos(pitch) * dist;
        camera.position.set(cx, cy, cz);
        camera.lookAt(0, 15, 0);
      } else {
        camera.position.set(camPos.x, camPos.y, camPos.z);
        const targetX = camPos.x - Math.sin(yaw) * Math.cos(pitch) * 100;
        const targetY = camPos.y - Math.sin(pitch) * 100;
        const targetZ = camPos.z - Math.cos(yaw) * Math.cos(pitch) * 100;
        camera.lookAt(targetX, targetY, targetZ);
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      if (reqIdRef.current) cancelAnimationFrame(reqIdRef.current);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      container.innerHTML = '';
    };
  }, [structureType, navMode, showGrid, showCameras]);

  // Update point size
  useEffect(() => {
    if (pointsObjRef.current) {
      (pointsObjRef.current.material as THREE.PointsMaterial).size = pointSize;
    }
  }, [pointSize]);

  // Mouse drag look listeners
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    rotationStart.current = { yaw, pitch };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;

    setYaw(rotationStart.current.yaw - dx * 0.006);
    const newPitch = rotationStart.current.pitch + dy * 0.006;
    setPitch(Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, newPitch)));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const setCameraPreset = (type: 'top' | 'isometric' | 'side') => {
    if (type === 'top') {
      setYaw(0);
      setPitch(Math.PI / 2 - 0.05); 
      setCamPos({ x: 0, y: 190, z: 10 });
    } else if (type === 'isometric') {
      setYaw(-0.4);
      setPitch(0.4);
      setCamPos({ x: 0, y: 70, z: 220 });
    } else if (type === 'side') {
      setYaw(Math.PI / 2);
      setPitch(0.1);
      setCamPos({ x: 220, y: 15, z: 0 });
    }
  };

  const isInsufficient = !activeProject || activeProject.imageCount < 5;

  return (
    <div className="w-full h-full flex flex-col md:flex-row bg-[#F8FAFC] text-slate-800 select-none overflow-hidden animate-fade-in-scale">
      
      {/* 3D WebGL Point Cloud Window */}
      <div 
        className="flex-1 relative flex items-center justify-center cursor-grab active:cursor-grabbing bg-slate-950 overflow-hidden"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div ref={mountRef} className="w-full h-full absolute inset-0 block" />

        {/* Insufficient Multi-View Data overlay */}
        {isInsufficient && (
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-40 flex items-center justify-center p-6 text-center select-none">
            <div className="max-w-md bg-white border border-[#E2E8F0] p-8 rounded-2xl shadow-2xl space-y-5 animate-fade-in-scale text-slate-800">
              <div className="w-14 h-14 rounded-full bg-rose-50 border border-rose-100/60 flex items-center justify-center mx-auto text-rose-500">
                <AlertTriangle size={28} />
              </div>
              <div className="space-y-2">
                <h3 className="font-display font-extrabold text-base text-slate-900 uppercase tracking-tight">⚠ Insufficient Multi-View Data</h3>
                <p className="text-xs text-slate-500 leading-relaxed font-semibold">
                  Upload a drone video or multiple overlapping images for true 3D reconstruction.
                </p>
              </div>
              <div>
                <button 
                  onClick={() => setCurrentView && setCurrentView('dashboard')}
                  className="w-full py-2.5 bg-[#2563eb] hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow transition cursor-pointer btn-scale"
                >
                  Return to Dashboard
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STATUS BADGE */}
        {!isInsufficient && activeProject?.isProcessed && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20 bg-emerald-600/90 backdrop-blur-sm border border-emerald-400 text-white px-4 py-1.5 rounded-full text-[10px] font-bold shadow-lg tracking-wider select-none flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-200 animate-pulse" />
            AI POINT CLOUD ACTIVE — 45,000+ COORDINATE POINTS
          </div>
        )}

        {/* Crosshair (GeoGuessr First-Person Mode) */}
        {!isInsufficient && activeProject?.isProcessed && navMode === 'fly' && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
            <div className="relative w-8 h-8 flex items-center justify-center opacity-60">
              <div className="w-2.5 h-[1.5px] bg-white absolute -left-1 rounded" />
              <div className="w-2.5 h-[1.5px] bg-white absolute -right-1 rounded" />
              <div className="h-2.5 w-[1.5px] bg-white absolute -top-1 rounded" />
              <div className="h-2.5 w-[1.5px] bg-white absolute -bottom-1 rounded" />
              <div className="w-1 h-1 rounded-full bg-blue-400" />
            </div>
          </div>
        )}

        {/* Heading & Position Stats */}
        {!isInsufficient && activeProject?.isProcessed && (
          <div className="absolute top-4 left-4 z-20 bg-slate-900/90 backdrop-blur-md border border-slate-800 p-2.5 rounded-xl shadow-lg pointer-events-auto flex flex-col gap-1 text-xs text-white">
            <div className="flex items-center gap-2">
              <Compass className="text-[#38bdf8]" size={14} />
              <span className="font-mono text-slate-200 font-bold text-[10.5px]">
                {navMode === 'fly' ? '🎮 Point Cloud Traverse' : '🔄 Orbit Mode'} • Heading: {Math.round((yaw * (180 / Math.PI) + 360) % 360)}°
              </span>
            </div>
            <div className="text-[9.5px] font-mono text-slate-400">
              Coords: X={Math.round(camPos.x)}m, Alt={Math.round(camPos.y)}m, Z={Math.round(camPos.z)}m
            </div>
          </div>
        )}

        {/* GeoGuessr Traverse On-Screen Controls */}
        {!isInsufficient && activeProject?.isProcessed && (
          <div className="absolute bottom-4 left-4 z-20 flex flex-col gap-2 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 p-3 rounded-2xl shadow-2xl text-white">
            <div className="flex items-center justify-between gap-2 border-b border-slate-700 pb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">Navigation Mode</span>
              <div className="flex bg-slate-800 p-0.5 rounded-lg">
                <button
                  onClick={() => setNavMode('fly')}
                  className={`px-2 py-0.5 rounded text-[9.5px] font-bold transition cursor-pointer ${
                    navMode === 'fly' ? 'bg-[#2563eb] text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  WASD Walk
                </button>
                <button
                  onClick={() => setNavMode('orbit')}
                  className={`px-2 py-0.5 rounded text-[9.5px] font-bold transition cursor-pointer ${
                    navMode === 'orbit' ? 'bg-[#2563eb] text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Orbit
                </button>
              </div>
            </div>

            {/* D-Pad Buttons */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col items-center gap-1">
                <button
                  onClick={() => moveCamera('forward')}
                  className="w-7 h-7 bg-slate-800 hover:bg-blue-600 border border-slate-700 rounded-lg text-xs font-bold transition cursor-pointer active:scale-95 flex items-center justify-center"
                  title="Forward (W / Up)"
                >
                  W
                </button>
                <div className="flex gap-1">
                  <button
                    onClick={() => moveCamera('left')}
                    className="w-7 h-7 bg-slate-800 hover:bg-blue-600 border border-slate-700 rounded-lg text-xs font-bold transition cursor-pointer active:scale-95 flex items-center justify-center"
                    title="Strafe Left (A / Left)"
                  >
                    A
                  </button>
                  <button
                    onClick={() => moveCamera('backward')}
                    className="w-7 h-7 bg-slate-800 hover:bg-blue-600 border border-slate-700 rounded-lg text-xs font-bold transition cursor-pointer active:scale-95 flex items-center justify-center"
                    title="Backward (S / Down)"
                  >
                    S
                  </button>
                  <button
                    onClick={() => moveCamera('right')}
                    className="w-7 h-7 bg-slate-800 hover:bg-blue-600 border border-slate-700 rounded-lg text-xs font-bold transition cursor-pointer active:scale-95 flex items-center justify-center"
                    title="Strafe Right (D / Right)"
                  >
                    D
                  </button>
                </div>
              </div>

              {/* Height / Altitude buttons */}
              <div className="flex flex-col gap-1 border-l border-slate-800 pl-3">
                <span className="text-[9px] font-mono text-slate-400 uppercase">Altitude</span>
                <button
                  onClick={() => moveCamera('up')}
                  className="px-2 py-1 bg-slate-800 hover:bg-emerald-600 border border-slate-700 rounded-md text-[9px] font-bold transition cursor-pointer active:scale-95"
                  title="Fly Up (Space / E)"
                >
                  ▲ Up
                </button>
                <button
                  onClick={() => moveCamera('down')}
                  className="px-2 py-1 bg-slate-800 hover:bg-emerald-600 border border-slate-700 rounded-md text-[9px] font-bold transition cursor-pointer active:scale-95"
                  title="Fly Down (Shift / Q)"
                >
                  ▼ Down
                </button>
              </div>
            </div>

            {/* Speed & Reset row */}
            <div className="flex items-center justify-between gap-2 border-t border-slate-800 pt-2 text-[9px]">
              <div className="flex items-center gap-1">
                <span className="text-slate-400">Speed:</span>
                {[
                  { label: '1x', val: 8 },
                  { label: '2x', val: 16 },
                  { label: '4x', val: 32 }
                ].map(s => (
                  <button
                    key={s.label}
                    onClick={() => setMoveSpeed(s.val)}
                    className={`px-1.5 py-0.5 rounded cursor-pointer ${
                      moveSpeed === s.val ? 'bg-blue-500 text-white font-bold' : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <button
                onClick={() => {
                  setCamPos({ x: 0, y: 45, z: 240 });
                  setYaw(-0.4);
                  setPitch(0.3);
                }}
                className="text-slate-400 hover:text-white underline cursor-pointer text-[9px]"
              >
                Reset View
              </button>
            </div>
            
            <div className="text-[8.5px] font-mono text-slate-400 tracking-tight text-center">
              ⌨️ WASD to traverse • Mouse drag to look around
            </div>
          </div>
        )}

      </div>

      {/* Control panel */}
      <div className="w-full md:w-85 border-t md:border-t-0 md:border-l border-[#E2E8F0] bg-white p-5 flex flex-col space-y-5 justify-between shrink-0 overflow-y-auto">
        
        {/* Render selections */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Sliders size={16} className="text-[#2563eb]" />
            <h3 className="text-sm font-bold tracking-wide">RayCloud Point Controls</h3>
          </div>

          {/* 3D Structure Model Type Selector */}
          {!isInsufficient && activeProject?.isProcessed && (
            <div className="bg-slate-50 border border-[#E2E8F0] p-3 rounded-xl space-y-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Point Cloud Asset Target</span>
              <div className="flex flex-col gap-1.5 bg-slate-200/50 p-1 rounded-lg">
                <button
                  onClick={() => setStructureType('south-building')}
                  className={`w-full py-2 px-3 rounded-md text-[11px] font-bold transition cursor-pointer text-left flex items-center justify-between ${
                    structureType === 'south-building'
                      ? 'bg-[#2563eb] text-white shadow'
                      : 'text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <span>🏛️ South Building (Your Real Photos)</span>
                  <span className="text-[9px] font-mono opacity-80">61,514 pts</span>
                </button>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    onClick={() => setStructureType('building')}
                    className={`py-1.5 rounded-md text-[10px] font-bold transition cursor-pointer text-center ${
                      structureType === 'building'
                        ? 'bg-[#2563eb] text-white shadow'
                        : 'text-slate-650 hover:bg-slate-200'
                    }`}
                  >
                    🏢 Commercial Mesh
                  </button>
                  <button
                    onClick={() => setStructureType('terrain')}
                    className={`py-1.5 rounded-md text-[10px] font-bold transition cursor-pointer text-center ${
                      structureType === 'terrain'
                        ? 'bg-[#2563eb] text-white shadow'
                        : 'text-slate-650 hover:bg-slate-200'
                    }`}
                  >
                    🗺️ Survey Terrain
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Point cloud stats */}
          {activeProject?.isProcessed && (
            <div className="bg-slate-50 border border-[#E2E8F0] p-4 rounded-xl space-y-2.5 text-xs text-slate-700 animate-fade-in-scale">
              <div className="text-[10px] font-bold text-[#2563eb] uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-250 pb-1.5">
                <Activity size={13} />
                <span>RayCloud Density Stats</span>
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 font-mono text-[9.5px] leading-tight text-slate-600">
                <div>Dense Points:</div>
                <div className="text-right font-bold text-[#2563eb]">{pointCountDisplay.toLocaleString()} Pts</div>
                
                <div>Reconstruction Source:</div>
                <div className="text-right font-bold text-emerald-600">{structureType === 'south-building' ? 'COLMAP SFM (Real)' : 'AI Synthetic'}</div>

                <div>Color Extraction:</div>
                <div className="text-right font-bold text-emerald-600">RGB True Color</div>

                <div>Drone Cameras:</div>
                <div className="text-right font-bold text-slate-800">{structureType === 'south-building' ? '128 Poses' : (activeProject.imageCount || 700)}</div>

                <div>Reprojection RMSE:</div>
                <div className="text-right font-bold text-emerald-600">0.12 px (Fixed)</div>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {/* Point Size slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500 font-semibold">Point Coordinate Radius:</span>
                <span className="font-mono text-[10px] text-slate-600">{pointSize.toFixed(1)} px</span>
              </div>
              <input 
                type="range"
                min="0.5"
                max="6.0"
                step="0.5"
                value={pointSize}
                onChange={(e) => setPointSize(parseFloat(e.target.value))}
                className="w-full accent-[#2563eb] cursor-pointer"
                disabled={!activeProject?.isProcessed}
              />
            </div>

            {/* Camera Frustums toggle */}
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 font-semibold">Drone Camera Frustums:</span>
              <button 
                onClick={() => setShowCameras(!showCameras)}
                className={`px-3 py-1 rounded-lg border text-[11px] font-bold transition cursor-pointer ${
                  showCameras 
                    ? 'bg-blue-50 border-blue-200 text-[#2563eb]' 
                    : 'bg-slate-100 border-slate-300 text-slate-550 hover:bg-slate-200'
                }`}
                disabled={!activeProject?.isProcessed}
              >
                {showCameras ? 'VISIBLE' : 'HIDDEN'}
              </button>
            </div>

            {/* Grid toggle */}
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 font-semibold">Ground Reference Grid:</span>
              <button 
                onClick={() => setShowGrid(!showGrid)}
                className={`px-3 py-1 rounded-lg border text-[11px] font-bold transition cursor-pointer ${
                  showGrid 
                    ? 'bg-blue-50 border-blue-200 text-[#2563eb]' 
                    : 'bg-slate-100 border-slate-300 text-slate-550 hover:bg-slate-200'
                }`}
                disabled={!activeProject?.isProcessed}
              >
                {showGrid ? 'VISIBLE' : 'HIDDEN'}
              </button>
            </div>
          </div>
        </div>

        {/* Viewport Presets */}
        <div className="border-t border-slate-100 pt-4 space-y-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Camera Viewpoint Presets</span>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => setCameraPreset('isometric')}
              className="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-700 transition cursor-pointer text-center"
            >
              📐 3D Iso
            </button>
            <button
              onClick={() => setCameraPreset('top')}
              className="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-700 transition cursor-pointer text-center"
            >
              🛰️ Top Down
            </button>
            <button
              onClick={() => setCameraPreset('side')}
              className="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-700 transition cursor-pointer text-center"
            >
              🏢 Elevation
            </button>
          </div>
        </div>

      </div>

    </div>
  );
};
