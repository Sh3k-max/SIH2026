import React, { useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { 
  Columns, 
  Split, 
  RotateCw, 
  Activity, 
  Sliders, 
  Layers, 
  CheckCircle2, 
  Lock, 
  Unlock,
  Eye,
  Info
} from 'lucide-react';
import type { Project } from '../types';
import { generateDensePointCloud, loadSouthBuildingPointCloud, buildPhotogrammetryScene } from '../utils/photogrammetryScene';

interface ComparePanelProps {
  activeProject: Project | null;
  setCurrentView?: (view: string) => void;
}

export const ComparePanel: React.FC<ComparePanelProps> = ({ activeProject, setCurrentView }) => {
  const leftMountRef = useRef<HTMLDivElement>(null);
  const rightMountRef = useRef<HTMLDivElement>(null);

  // Split Screen Mode: 'side-by-side' or 'split-slider'
  const [splitMode, setSplitMode] = useState<'side-by-side' | 'split-slider'>('side-by-side');
  const [syncCameras, setSyncCameras] = useState<boolean>(true);
  const [splitSliderPos, setSplitSliderPos] = useState<number>(50);

  // Model Selection for Left & Right
  const [leftModel, setLeftModel] = useState<'colmap' | 'pointcloud' | 'mesh'>('colmap');
  const [rightModel, setRightModel] = useState<'mesh' | 'pointcloud' | 'terrain'>('mesh');

  // Camera & Traversal States
  const [yaw, setYaw] = useState<number>(-0.4);
  const [pitch, setPitch] = useState<number>(0.3);
  const [camPos, setCamPos] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 35, z: 200 });

  // Refs for Three.js renderers
  const leftRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const rightRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const leftCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rightCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const reqIdRef = useRef<number | null>(null);

  // Mouse interaction
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const rotationStart = useRef<{ yaw: number; pitch: number }>({ yaw: -0.4, pitch: 0.3 });

  // Keyboard navigation listener (WASD)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const key = e.key.toLowerCase();
      const speed = 12;
      setCamPos(prev => {
        let { x, y, z } = prev;
        if (key === 'w' || key === 'arrowup') {
          x -= Math.sin(yaw) * speed;
          z -= Math.cos(yaw) * speed;
        } else if (key === 's' || key === 'arrowdown') {
          x += Math.sin(yaw) * speed;
          z += Math.cos(yaw) * speed;
        } else if (key === 'a' || key === 'arrowleft') {
          x -= Math.cos(yaw) * speed;
          z += Math.sin(yaw) * speed;
        } else if (key === 'd' || key === 'arrowright') {
          x += Math.cos(yaw) * speed;
          z -= Math.sin(yaw) * speed;
        } else if (key === ' ' || key === 'e') {
          y += speed;
        } else if (key === 'shift' || key === 'q') {
          y = Math.max(2, y - speed);
        }
        return { x, y, z };
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [yaw]);

  // Left Viewport Three.js Setup
  useEffect(() => {
    const container = leftMountRef.current;
    if (!container) return;

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 500;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#070b14');

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.5, 1500);
    camera.position.set(camPos.x, camPos.y, camPos.z);
    leftCameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    leftRendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const grid = new THREE.GridHelper(300, 30, '#334155', '#1e293b');
    grid.position.y = -0.5;
    scene.add(grid);

    // Populate Left Model
    if (leftModel === 'colmap') {
      loadSouthBuildingPointCloud('http://localhost:5000').then(res => {
        if (res?.points) scene.add(res.points);
      });
    } else if (leftModel === 'pointcloud') {
      const pts = generateDensePointCloud('building');
      scene.add(pts);
    } else if (leftModel === 'mesh') {
      buildPhotogrammetryScene(scene, 'building');
    }

    const animate = () => {
      reqIdRef.current = requestAnimationFrame(animate);
      camera.position.set(camPos.x, camPos.y, camPos.z);
      const targetX = camPos.x - Math.sin(yaw) * Math.cos(pitch) * 100;
      const targetY = camPos.y - Math.sin(pitch) * 100;
      const targetZ = camPos.z - Math.cos(yaw) * Math.cos(pitch) * 100;
      camera.lookAt(targetX, targetY, targetZ);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      if (reqIdRef.current) cancelAnimationFrame(reqIdRef.current);
      renderer.dispose();
      container.innerHTML = '';
    };
  }, [leftModel]);

  // Right Viewport Three.js Setup
  useEffect(() => {
    const container = rightMountRef.current;
    if (!container) return;

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 500;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#070b14');

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.5, 1500);
    camera.position.set(camPos.x, camPos.y, camPos.z);
    rightCameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rightRendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const grid = new THREE.GridHelper(300, 30, '#334155', '#1e293b');
    grid.position.y = -0.5;
    scene.add(grid);

    // Populate Right Model
    if (rightModel === 'mesh') {
      buildPhotogrammetryScene(scene, 'building');
    } else if (rightModel === 'pointcloud') {
      const pts = generateDensePointCloud('building');
      scene.add(pts);
    } else if (rightModel === 'terrain') {
      buildPhotogrammetryScene(scene, 'terrain');
    }

    const animate = () => {
      requestAnimationFrame(animate);
      if (syncCameras) {
        camera.position.set(camPos.x, camPos.y, camPos.z);
        const targetX = camPos.x - Math.sin(yaw) * Math.cos(pitch) * 100;
        const targetY = camPos.y - Math.sin(pitch) * 100;
        const targetZ = camPos.z - Math.cos(yaw) * Math.cos(pitch) * 100;
        camera.lookAt(targetX, targetY, targetZ);
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      renderer.dispose();
      container.innerHTML = '';
    };
  }, [rightModel, syncCameras]);

  // Mouse Drag Listeners for Looking Around
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
    setPitch(Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, rotationStart.current.pitch + dy * 0.006)));
  };

  return (
    <div className="w-full h-full flex flex-col md:flex-row bg-[#F8FAFC] text-slate-800 select-none overflow-hidden animate-fade-in-scale">
      
      {/* 3D Comparison Window */}
      <div 
        className="flex-1 relative flex bg-slate-950 overflow-hidden cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => setIsDragging(false)}
        onMouseLeave={() => setIsDragging(false)}
      >
        {/* Top Control Bar */}
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-30 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 px-4 py-1.5 rounded-full flex items-center gap-3 text-xs text-white shadow-2xl">
          <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px] text-blue-400">
            <Split size={14} />
            <span>3D Model Comparison Mode</span>
          </div>

          <div className="h-4 w-[1px] bg-slate-700" />

          {/* Sync Viewpoints Toggle */}
          <button
            onClick={() => setSyncCameras(!syncCameras)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer ${
              syncCameras ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            {syncCameras ? <Lock size={11} /> : <Unlock size={11} />}
            <span>{syncCameras ? 'Sync Cameras' : 'Free Camera'}</span>
          </button>
        </div>

        {/* Left Viewport */}
        <div className="flex-1 h-full relative border-r border-slate-800/80">
          <div ref={leftMountRef} className="w-full h-full absolute inset-0 block" />
          <div className="absolute bottom-4 left-4 z-20 bg-slate-900/90 backdrop-blur-md border border-slate-700 px-3 py-1.5 rounded-xl text-white text-[11px] font-bold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span>MODEL A: {leftModel === 'colmap' ? '🏛️ South Building (Real COLMAP)' : leftModel.toUpperCase()}</span>
          </div>
        </div>

        {/* Right Viewport */}
        <div className="flex-1 h-full relative">
          <div ref={rightMountRef} className="w-full h-full absolute inset-0 block" />
          <div className="absolute bottom-4 right-4 z-20 bg-slate-900/90 backdrop-blur-md border border-slate-700 px-3 py-1.5 rounded-xl text-white text-[11px] font-bold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>MODEL B: {rightModel === 'mesh' ? '🏢 Textured 3D Architectural Mesh' : rightModel.toUpperCase()}</span>
          </div>
        </div>

        {/* Bottom Traversal Tip */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-20 bg-slate-900/80 backdrop-blur-md px-3 py-1 rounded-full text-[9.5px] font-mono text-slate-300 border border-slate-800">
          ⌨️ WASD to Walk Both Models Simultaneously • Mouse Drag to Look
        </div>

      </div>

      {/* Right Control & Metrics Comparison Panel */}
      <div className="w-full md:w-85 border-t md:border-t-0 md:border-l border-[#E2E8F0] bg-white p-5 flex flex-col space-y-5 justify-between shrink-0 overflow-y-auto">
        
        <div className="space-y-5">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Columns size={16} className="text-[#2563eb]" />
            <h3 className="text-sm font-bold tracking-wide">Comparison Inspector</h3>
          </div>

          {/* Model A Selector */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Model A (Left Viewport)</label>
            <select
              value={leftModel}
              onChange={(e) => setLeftModel(e.target.value as any)}
              className="w-full p-2 bg-slate-50 border border-[#E2E8F0] rounded-xl text-xs font-bold text-slate-800 cursor-pointer"
            >
              <option value="colmap">🏛️ South Building (61,514 COLMAP Points)</option>
              <option value="pointcloud">☁️ Dense 45k Photogrammetric Cloud</option>
              <option value="mesh">🏢 3D Textured Surface Mesh</option>
            </select>
          </div>

          {/* Model B Selector */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Model B (Right Viewport)</label>
            <select
              value={rightModel}
              onChange={(e) => setRightModel(e.target.value as any)}
              className="w-full p-2 bg-slate-50 border border-[#E2E8F0] rounded-xl text-xs font-bold text-slate-800 cursor-pointer"
            >
              <option value="mesh">🏢 3D Textured Surface Mesh (4K)</option>
              <option value="pointcloud">☁️ Dense Point Cloud</option>
              <option value="terrain">🗺️ Digital Elevation Model (DEM)</option>
            </select>
          </div>

          {/* Quality & Metrics Comparison Table */}
          <div className="bg-slate-50 border border-[#E2E8F0] p-4 rounded-xl space-y-3 animate-fade-in-scale">
            <div className="text-[10px] font-bold text-[#2563eb] uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-200 pb-1.5">
              <Activity size={13} />
              <span>QA & Accuracy Comparison</span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-3 text-[9px] font-bold text-slate-400 uppercase border-b border-slate-200 pb-1">
                <span>Metric</span>
                <span className="text-center">Model A</span>
                <span className="text-right">Model B</span>
              </div>

              <div className="grid grid-cols-3 text-[10px] font-mono">
                <span className="text-slate-600">Density:</span>
                <span className="text-center font-bold text-blue-600">61,514 pts</span>
                <span className="text-right font-bold text-emerald-600">45,000 pts</span>
              </div>

              <div className="grid grid-cols-3 text-[10px] font-mono">
                <span className="text-slate-600">Resolution:</span>
                <span className="text-center font-bold text-slate-800">0.05 m GSD</span>
                <span className="text-right font-bold text-slate-800">0.05 m GSD</span>
              </div>

              <div className="grid grid-cols-3 text-[10px] font-mono">
                <span className="text-slate-600">Reprojection:</span>
                <span className="text-center font-bold text-emerald-600">0.12 px</span>
                <span className="text-right font-bold text-emerald-600">0.15 px</span>
              </div>

              <div className="grid grid-cols-3 text-[10px] font-mono">
                <span className="text-slate-600">Surface:</span>
                <span className="text-center font-bold text-slate-700">Sparse SfM</span>
                <span className="text-right font-bold text-slate-700">Textured PBR</span>
              </div>
            </div>
          </div>

          {/* Preset Camera Views */}
          <div className="space-y-1.5 border-t border-slate-100 pt-3">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Synchronized Angles</span>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={() => {
                  setCamPos({ x: 0, y: 35, z: 200 });
                  setYaw(-0.4);
                  setPitch(0.3);
                }}
                className="py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-700 transition cursor-pointer text-center"
              >
                📐 3D Iso
              </button>
              <button
                onClick={() => {
                  setCamPos({ x: 0, y: 180, z: 10 });
                  setYaw(0);
                  setPitch(Math.PI / 2 - 0.05);
                }}
                className="py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-700 transition cursor-pointer text-center"
              >
                🛰️ Top Down
              </button>
              <button
                onClick={() => {
                  setCamPos({ x: -140, y: 15, z: 120 });
                  setYaw(-0.7);
                  setPitch(0.1);
                }}
                className="py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-700 transition cursor-pointer text-center"
              >
                🚶 Street View
              </button>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};
