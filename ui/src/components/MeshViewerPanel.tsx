import React, { useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { AVAILABLE_3D_MODELS } from '../types';
import { Box, Layers, Sparkles, RefreshCw, Eye } from 'lucide-react';
import { toast } from 'react-toastify';

interface MeshViewerPanelProps {
  activeProject?: any;
  setCurrentView?: (view: string) => void;
}

export const MeshViewerPanel: React.FC<MeshViewerPanelProps> = ({ activeProject }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRootRef = useRef<THREE.Group | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const reqIdRef = useRef<number | null>(null);

  // Model Selection & Display Mode States
  const initialModel = activeProject?.datasetName ? `${activeProject.datasetName}.obj` : 'dust3r_mode1l.obj';
  const [selectedModel, setSelectedModel] = useState<string>(initialModel);
  const [viewMode, setViewMode] = useState<'wireframe' | 'textured' | 'points'>('textured');
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [pointSize, setPointSize] = useState<number>(0.04);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [modelStats, setModelStats] = useState<{ vertexCount: number; faceCount: number; name: string }>({
    vertexCount: 0,
    faceCount: 0,
    name: '3D Photogrammetry Model'
  });

  const customModelOption = activeProject?.datasetName ? [{
    id: activeProject.datasetName,
    filename: `${activeProject.datasetName}.obj`,
    name: `★ ${activeProject.name || 'Your Project'} (Reconstructed)`,
    category: 'Active Project',
    description: `Real 3D model reconstructed for ${activeProject.name}`,
    type: 'mesh' as const
  }] : [];

  const modelsList = [...customModelOption, ...AVAILABLE_3D_MODELS];

  // Auto-switch model when activeProject changes
  useEffect(() => {
    if (activeProject?.datasetName) {
      const modelName = `${activeProject.datasetName}.obj`;
      setSelectedModel(modelName);
      loadObjModel(modelName);
    }
  }, [activeProject?.datasetName]);

  // Load Model File
  const loadObjModel = (modelName: string = selectedModel) => {
    if (!modelRootRef.current || !sceneRef.current || !cameraRef.current || !controlsRef.current) return;
    setIsLoading(true);

    const modelRoot = modelRootRef.current;
    while (modelRoot.children.length > 0) {
      modelRoot.remove(modelRoot.children[0]);
    }

    const matchedInfo = modelsList.find(m => m.filename === modelName);

    const loader = new OBJLoader();
    const tryLoad = (url: string, isFallback: boolean = false) => {
      loader.load(
        url,
        (obj) => {
        let positions: number[] = [];
        let colors: number[] = [];
        let totalVertices = 0;
        let totalFaces = 0;

        obj.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const geo = mesh.geometry;
            const posAttr = geo.attributes.position;
            const colAttr = geo.attributes.color;

            if (posAttr) {
              totalVertices += posAttr.count;
              totalFaces += geo.index ? geo.index.count / 3 : posAttr.count / 3;

              for (let i = 0; i < posAttr.count; i++) {
                positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
                if (colAttr) {
                  colors.push(colAttr.getX(i), colAttr.getY(i), colAttr.getZ(i));
                } else {
                  colors.push(0.88, 0.88, 0.88);
                }
              }
            }

            // High quality solid surface material
            mesh.material = new THREE.MeshStandardMaterial({
              vertexColors: !!colAttr,
              roughness: 0.6,
              metalness: 0.1,
              side: THREE.DoubleSide
            });
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });

        // Dedicated Points representation
        if (positions.length > 0) {
          const ptGeo = new THREE.BufferGeometry();
          ptGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          ptGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
          const ptMat = new THREE.PointsMaterial({
            size: pointSize,
            vertexColors: true,
            sizeAttenuation: true
          });
          const ptsObj = new THREE.Points(ptGeo, ptMat);
          ptsObj.name = 'pointsObject';
          ptsObj.visible = (viewMode === 'points');
          modelRoot.add(ptsObj);
        }

        obj.name = 'meshObject';
        obj.visible = (viewMode !== 'points');
        modelRoot.add(obj);

        // Center Model and Camera
        const box = new THREE.Box3().setFromObject(modelRoot);
        if (!box.isEmpty()) {
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 50;

          obj.position.sub(center);
          if (modelRoot.getObjectByName('pointsObject')) {
            modelRoot.getObjectByName('pointsObject')!.position.sub(center);
          }

          cameraRef.current!.position.set(maxDim * 0.9, maxDim * 0.7, maxDim * 1.3);
          controlsRef.current!.target.set(0, 0, 0);
          controlsRef.current!.update();
        }

        setModelStats({
          vertexCount: totalVertices || positions.length / 3,
          faceCount: Math.round(totalFaces),
          name: matchedInfo?.name || modelName
        });

        setIsLoading(false);
        toast.info(`Rendered "${matchedInfo?.name || modelName}" (${(totalVertices || positions.length / 3).toLocaleString()} vertices)`);
      },
      undefined,
      (err) => {
        if (!isFallback) {
          console.warn(`Initial local load failed for ${url}, trying /output fallback...`);
          tryLoad(`/output/${modelName}`, true);
        } else {
          console.error('Model load error:', err);
          setIsLoading(false);
          toast.error(`Failed to load ${modelName}`);
        }
      }
    );
  };

  tryLoad(`/models/${modelName}`);
};

  // Switch View Modes (Textured / Wireframe / Points)
  useEffect(() => {
    if (!modelRootRef.current) return;
    const meshObj = modelRootRef.current.getObjectByName('meshObject');
    const pointsObj = modelRootRef.current.getObjectByName('pointsObject') as THREE.Points;

    if (viewMode === 'points') {
      if (meshObj) meshObj.visible = false;
      if (pointsObj) pointsObj.visible = true;
    } else if (viewMode === 'wireframe') {
      if (pointsObj) pointsObj.visible = false;
      if (meshObj) {
        meshObj.visible = true;
        meshObj.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            (child as THREE.Mesh).material = new THREE.MeshBasicMaterial({
              color: 0x00f0ff,
              wireframe: true
            });
          }
        });
      }
    } else if (viewMode === 'textured') {
      if (pointsObj) pointsObj.visible = false;
      if (meshObj) {
        meshObj.visible = true;
        meshObj.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const hasColor = !!(child as THREE.Mesh).geometry.attributes.color;
            (child as THREE.Mesh).material = new THREE.MeshStandardMaterial({
              vertexColors: hasColor,
              roughness: 0.6,
              metalness: 0.1,
              side: THREE.DoubleSide
            });
          }
        });
      }
    }
  }, [viewMode]);

  // Update Point Size
  useEffect(() => {
    if (!modelRootRef.current) return;
    const pointsObj = modelRootRef.current.getObjectByName('pointsObject') as THREE.Points;
    if (pointsObj && pointsObj.material) {
      (pointsObj.material as THREE.PointsMaterial).size = pointSize;
      (pointsObj.material as THREE.PointsMaterial).needsUpdate = true;
    }
  }, [pointSize]);

  // Toggle Grid
  useEffect(() => {
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = showGrid;
    }
  }, [showGrid]);

  // Toggle Flip Orientation
  const toggleFlip = () => {
    setIsFlipped(prev => {
      const next = !prev;
      if (modelRootRef.current) {
        modelRootRef.current.rotation.x = next ? Math.PI : 0;
      }
      return next;
    });
  };

  // Reset Camera View
  const resetCamera = () => {
    if (!cameraRef.current || !controlsRef.current || !modelRootRef.current) return;
    const box = new THREE.Box3().setFromObject(modelRootRef.current);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 50;
    cameraRef.current.position.set(maxDim * 0.9, maxDim * 0.7, maxDim * 1.3);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  };

  // Three.js Mount Setup
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e1a); // Dark navy slate background
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    camera.position.set(20, 15, 25);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    rendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // OrbitControls bound directly to canvas
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.screenSpacePanning = true;
    controls.maxDistance = 3000;
    controls.minDistance = 0.5;
    controlsRef.current = controls;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight1.position.set(40, 60, 40);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x00f0ff, 0.4);
    dirLight2.position.set(-40, -20, -40);
    scene.add(dirLight2);

    // Cyan Neon Grid
    const grid = new THREE.GridHelper(100, 30, 0x00f0ff, 0x1e293b);
    grid.position.y = -0.01;
    scene.add(grid);
    gridHelperRef.current = grid;

    // Model Root
    const modelRoot = new THREE.Group();
    scene.add(modelRoot);
    modelRootRef.current = modelRoot;

    loadObjModel('dust3r_mode1l.obj');

    // Animation Loop
    const animate = () => {
      reqIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container || !cameraRef.current || !rendererRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (reqIdRef.current) cancelAnimationFrame(reqIdRef.current);
      if (rendererRef.current) rendererRef.current.dispose();
    };
  }, []);

  // Keyboard Shortcuts (F, R, +, -, WASD)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      
      if (e.key === 'f' || e.key === 'F') {
        toggleFlip();
      } else if (e.key === 'r' || e.key === 'R') {
        resetCamera();
      } else if (e.key === '+' || e.key === '=') {
        setPointSize(prev => Math.min(0.25, prev + 0.005));
      } else if (e.key === '-' || e.key === '_') {
        setPointSize(prev => Math.max(0.005, prev - 0.005));
      } else if (controlsRef.current && cameraRef.current) {
        const panSpeed = 3.0;
        if (e.key === 'w' || e.key === 'ArrowUp') {
          controlsRef.current.target.y += panSpeed;
          cameraRef.current.position.y += panSpeed;
          controlsRef.current.update();
        } else if (e.key === 's' || e.key === 'ArrowDown') {
          controlsRef.current.target.y -= panSpeed;
          cameraRef.current.position.y -= panSpeed;
          controlsRef.current.update();
        } else if (e.key === 'a' || e.key === 'ArrowLeft') {
          controlsRef.current.target.x -= panSpeed;
          cameraRef.current.position.x -= panSpeed;
          controlsRef.current.update();
        } else if (e.key === 'd' || e.key === 'ArrowRight') {
          controlsRef.current.target.x += panSpeed;
          cameraRef.current.position.x += panSpeed;
          controlsRef.current.update();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="w-full h-full relative bg-[#0a0e1a] text-white select-none overflow-hidden font-sans">
      
      {/* 3D WebGL Canvas Container */}
      <div ref={mountRef} className="w-full h-full absolute inset-0 block cursor-grab active:cursor-grabbing" />

      {/* Floating Top Left Controls Toolbar */}
      <div className="absolute top-5 left-6 z-30 flex flex-wrap items-center gap-2 bg-[#121726]/90 backdrop-blur-md border border-white/10 p-2 rounded-2xl shadow-2xl">
        
        {/* Model Object Selector */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-xl border border-white/10">
          <Box size={14} className="text-cyan-400 shrink-0" />
          <span className="text-[11px] font-bold text-slate-300">Model:</span>
          <select
            value={selectedModel}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedModel(val);
              loadObjModel(val);
            }}
            className="bg-[#0b0f19] text-cyan-300 border border-cyan-500/30 rounded-lg px-2.5 py-1 text-xs font-semibold focus:outline-none focus:border-cyan-400 cursor-pointer max-w-[210px] truncate"
          >
            {modelsList.map(m => (
              <option key={m.id} value={m.filename} className="bg-[#0b0f19] text-white">
                {m.name} ({m.category})
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => setViewMode('textured')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
            viewMode === 'textured' 
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-lg shadow-cyan-500/20' 
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <span>🎨 Textured</span>
        </button>

        <button
          onClick={() => setViewMode('wireframe')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
            viewMode === 'wireframe' 
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-lg shadow-cyan-500/20' 
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <span>🕸 Wireframe</span>
        </button>

        <button
          onClick={() => setViewMode('points')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
            viewMode === 'points' 
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-lg shadow-cyan-500/20' 
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <span>✨ Points</span>
        </button>

        <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-xl border border-white/5 text-xs text-slate-300">
          <span className="text-[11px] text-slate-400 font-mono">Size:</span>
          <input
            type="range"
            min="0.005"
            max="0.15"
            step="0.005"
            value={pointSize}
            onChange={(e) => setPointSize(parseFloat(e.target.value))}
            className="w-16 cursor-pointer accent-cyan-400"
          />
        </div>
      </div>

      {/* Floating Top Right Controls Toolbar */}
      <div className="absolute top-5 right-6 z-30 flex items-center gap-2 bg-[#121726]/90 backdrop-blur-md border border-white/10 p-2 rounded-2xl shadow-2xl">
        <button
          onClick={toggleFlip}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
            isFlipped 
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40' 
              : 'bg-white/5 text-slate-300 hover:text-white hover:bg-white/10'
          }`}
          title="Invert Up/Down (Press F)"
        >
          <span>🔃 Flip (F)</span>
        </button>

        <button
          onClick={() => setShowGrid(!showGrid)}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
            showGrid 
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40' 
              : 'bg-white/5 text-slate-300 hover:text-white hover:bg-white/10'
          }`}
        >
          <span>📐 Grid</span>
        </button>

        <button
          onClick={resetCamera}
          className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
          title="Reset Camera (Press R)"
        >
          <span>🔄 Reset</span>
        </button>
      </div>

      {/* Active Model Stats HUD Badge */}
      <div className="absolute top-20 left-6 z-30 bg-[#121726]/80 backdrop-blur-md border border-white/10 px-4 py-2 rounded-xl text-xs text-slate-300 flex items-center gap-4 shadow-xl">
        <div className="flex items-center gap-1.5">
          <Layers size={13} className="text-cyan-400" />
          <span className="font-bold text-white text-[11px]">{modelStats.name}</span>
        </div>
        <div className="h-3 w-px bg-white/20" />
        <div className="font-mono text-[10.5px]">
          <span className="text-slate-400">Vertices: </span>
          <span className="text-cyan-300 font-bold">{modelStats.vertexCount.toLocaleString()}</span>
        </div>
        {modelStats.faceCount > 0 && (
          <>
            <div className="h-3 w-px bg-white/20" />
            <div className="font-mono text-[10.5px]">
              <span className="text-slate-400">Triangles: </span>
              <span className="text-emerald-400 font-bold">{modelStats.faceCount.toLocaleString()}</span>
            </div>
          </>
        )}
      </div>

      {/* Loading Indicator */}
      {isLoading && (
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm z-40 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-3 bg-[#121726] border border-cyan-500/30 px-6 py-3.5 rounded-2xl shadow-2xl text-cyan-300 font-bold text-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
            <span>Loading 3D Photogrammetry Model...</span>
          </div>
        </div>
      )}

      {/* Bottom Floating Navigation Legend */}
      <div className="absolute bottom-5 left-6 z-30 bg-[#121726]/85 backdrop-blur-md border border-white/10 px-4 py-2.5 rounded-2xl text-[11.5px] font-mono text-slate-300 pointer-events-none shadow-2xl flex items-center gap-3">
        <span><strong className="text-cyan-300">Left Click + Drag</strong>: Rotate 360°</span>
        <span>•</span>
        <span><strong className="text-cyan-300">Right Click + Drag</strong>: Pan</span>
        <span>•</span>
        <span><strong className="text-cyan-300">Scroll</strong>: Zoom</span>
        <span>•</span>
        <span><strong className="text-cyan-300">WASD</strong>: Move Around</span>
      </div>

    </div>
  );
};
