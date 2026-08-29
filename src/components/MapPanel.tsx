import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Square, 
  MousePointer, 
  Ruler, 
  Grid, 
  MapPin, 
  Crosshair, 
  FileText, 
  Sparkles, 
  X,
  Compass
} from 'lucide-react';
import type { CameraTelemetry, GCP, Project } from '../types';
import { MOCK_CAMERAS, MOCK_GCPS } from '../types';

interface MapPanelProps {
  onProcessingComplete: (jobId?: string) => void;
  unit: string;
  activeProject: Project | null;
}

type ToolType = 'select' | 'boundary' | 'measure' | 'gcp';

export const MapPanel: React.FC<MapPanelProps> = ({ onProcessingComplete, unit, activeProject }) => {
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [selectedCamera, setSelectedCamera] = useState<CameraTelemetry | null>(null);
  
  // Overlay Drawing States (Geodetic Coordinates: lat, lng)
  const [boundaryPoints, setBoundaryPoints] = useState<{ lat: number; lng: number }[]>([]);
  const [measurePoints, setMeasurePoints] = useState<{ lat: number; lng: number }[]>([]);
  const [placedGcps, setPlacedGcps] = useState<GCP[]>(MOCK_GCPS);
  
  // Base map layer state: 'streets' (terrestrial) or 'satellite'
  const [mapType, setMapType] = useState<'streets' | 'satellite'>('streets');

  // Pipeline settings
  const [step1Checked, setStep1Checked] = useState(true);
  const [step2Checked, setStep2Checked] = useState(false);
  const [step3Checked, setStep3Checked] = useState(false);
  
  // Pipeline Processing states
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [isProcessingPanelOpen, setIsProcessingPanelOpen] = useState(false);
  
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const hasFitBoundsRef = useRef(false);

  // Leaflet map refs
  const mapRef = useRef<any>(null);
  const camerasGroupRef = useRef<any>(null);
  const flightPathLineRef = useRef<any>(null);
  const boundaryPolygonRef = useRef<any>(null);
  const measurePolylineRef = useRef<any>(null);
  const gcpsGroupRef = useRef<any>(null);
  const activeTileLayerRef = useRef<any>(null);

  // Refs to avoid closures in Leaflet events
  const activeToolRef = useRef(activeTool);
  const isProcessingRef = useRef(isProcessing);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  // Load cameras dynamically from active project or fallback to defaults
  const cameras = activeProject?.cameras || MOCK_CAMERAS;

  useEffect(() => {
    hasFitBoundsRef.current = false;
    if (activeProject?.isProcessed) {
      setProgress(100);
      setTerminalLogs([
        '[INFO] Ingesting drone video stream: 18,000 frames (10 mins, 30 FPS)...',
        '[INFO] [TIME SYNC] Synchronized timestamps with GPS, IMU, and RTK sensors...',
        '[INFO] [FILTER] Generating candidate frames based on camera motion and novelty...',
        '[INFO] [FILTER] Blur check, exposure filter, and motion-blur checks complete. Rejected 14,200 corrupt/redundant candidates.',
        '[INFO] [KEYFRAME SELECT] Keyframe Selection Engine running: multi-factor scoring initialized...',
        '[INFO] [KEYFRAME SELECT] Visual novelty + feature overlap + spatial GPS distance score: 380 keyframes selected.',
        '[INFO] [VGGT ENGINE] Executing primary VGGT reconstruction on keyframe batches...',
        '[INFO] [VGGT ENGINE] Computing camera poses and initial depth map geometry...',
        '[INFO] [CONFIDENCE ENGINE] Evaluating multi-view geometry confidence (reprojection RMSE)...',
        '[INFO] [CONFIDENCE ENGINE] Batch confidence high (0.85). Normal flow preserved.',
        '[INFO] [FUSION ENGINE] Fusing VGGT depth models + DUSt3R geometry with RTK GPS trajectory...',
        '[INFO] [OPTIMIZER] Bundle Block Adjustment (BBA) running. Reprojection error: 0.12px',
        '[INFO] [GEOREFERENCING] Aligned local model to absolute WGS84 Datum projection.',
        '[SUCCESS] Incremental 3D Reconstruction model successfully compiled!',
        '[INFO] Push update to live workspace: Dense Point Cloud (28,450,120 points) & DSM generated.'
      ]);
    } else {
      setProgress(0);
      setTerminalLogs([]);
    }
  }, [activeProject]);

  // Auto scroll console
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs]);

  // Real Processing Logic with Backend Tiers connection
  useEffect(() => {
    let ws: WebSocket | null = null;
    let isAborted = false;

    const runRealPipeline = async () => {
      if (!isProcessing) return;
      
      setTerminalLogs(["[INFO] Contacting AeroMap Gateway Server..."]);
      setProgress(0);
      
      try {
        // 1. Start Job
        const startRes = await fetch('http://localhost:5000/api/reconstruction/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_name: activeProject?.name || "unnamed_project",
            image_count: cameras.length,
            demo: false
          })
        });
        
        if (isAborted) return;
        if (!startRes.ok) {
          throw new Error(`Failed to start reconstruction: ${startRes.statusText}`);
        }
        
        const startData = await startRes.json();
        const jobId = startData.job_id;
        
        setTerminalLogs(prev => [...prev, `[INFO] Job initialized. Job ID: ${jobId}`, "[INFO] Uploading telemetry and camera metadata..."]);
        
        // 2. Upload Frame Telemetry (one by one)
        for (let i = 0; i < cameras.length; i++) {
          if (isAborted) return;
          const cam = cameras[i];
          await fetch('http://localhost:5000/api/reconstruction/frame', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              job_id: jobId,
              filename: cam.filename,
              gps_lat: cam.lat,
              gps_lng: cam.lng,
              gps_alt: cam.alt,
              yaw: cam.yaw,
              pitch: cam.pitch,
              roll: cam.roll,
              timestamp: Date.now() / 1000 + i,
              imageUrl: cam.imageUrl || ""
            })
          });
        }
        
        if (isAborted) return;
        setTerminalLogs(prev => [...prev, `[INFO] Uploaded all camera telemetry. Starting solver stream...`]);
        
        // 3. Connect WebSocket for progress stream
        const wsUrl = `ws://localhost:5000/api/reconstruction/ws`;
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
          if (isAborted) { ws?.close(); return; }
          // Trigger solving
          ws?.send(JSON.stringify({ job_id: jobId }));
        };
        
        ws.onmessage = (event) => {
          if (isAborted) return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.log) {
              setTerminalLogs(prev => [...prev, msg.log]);
            }
            if (msg.progress !== undefined) {
              setProgress(msg.progress);
            }
            if (msg.stage === 'complete') {
              setIsProcessing(false);
              onProcessingComplete(jobId);
              ws?.close();
            }
            if (msg.stage === 'error') {
              setTerminalLogs(prev => [...prev, `[ERROR] Solver reported error: ${msg.error}`]);
              setIsProcessing(false);
              ws?.close();
            }
          } catch (e) {
            console.error("Failed to parse WebSocket message:", e);
          }
        };
        
        ws.onerror = () => {
          if (isAborted) return;
          setTerminalLogs(prev => [...prev, "[ERROR] WebSocket proxy connection failed."]);
          setIsProcessing(false);
        };
        
        ws.onclose = () => {
          console.log("WebSocket connection closed.");
        };
        
      } catch (error: any) {
        if (isAborted) return;
        setTerminalLogs(prev => [
          ...prev, 
          `[ERROR] Connection failed: ${error.message}`, 
          `[INFO] Please ensure Node.js server (port 5000) and Python AI service (port 8000) are running.`
        ]);
        setIsProcessing(false);
      }
    };
    
    runRealPipeline();
    
    return () => {
      isAborted = true;
      if (ws) {
        ws.close();
      }
    };
  }, [isProcessing, onProcessingComplete, cameras, activeProject]);

  // Leaflet Map Initialization
  useEffect(() => {
    const L = (window as any).L;
    if (!L) return;

    // Default center LA
    let centerLat = 34.0522;
    let centerLng = -118.2437;
    
    if (cameras.length > 0) {
      centerLat = cameras.reduce((sum, c) => sum + c.lat, 0) / cameras.length;
      centerLng = cameras.reduce((sum, c) => sum + c.lng, 0) / cameras.length;
    }

    const map = L.map('leaflet-map-container', {
      center: [centerLat, centerLng],
      zoom: 17,
      zoomControl: false,
      attributionControl: false
    });
    mapRef.current = map;

    // Create Tile layer (OpenStreetMap)
    const baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);
    activeTileLayerRef.current = baseLayer;

    // Create Layer Groups
    camerasGroupRef.current = L.layerGroup().addTo(map);
    flightPathLineRef.current = L.polyline([], { color: '#2563eb', dashArray: '5, 5', weight: 2 }).addTo(map);
    boundaryPolygonRef.current = L.polygon([], { color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.1, weight: 2 }).addTo(map);
    measurePolylineRef.current = L.polyline([], { color: '#f59e0b', weight: 3 }).addTo(map);
    gcpsGroupRef.current = L.layerGroup().addTo(map);

    // Zoom controls at top right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Click handler for drawing tools
    map.on('click', (e: any) => {
      if (isProcessingRef.current) return;
      const { lat, lng } = e.latlng;

      if (activeToolRef.current === 'boundary') {
        setBoundaryPoints(prev => [...prev, { lat, lng }]);
      } else if (activeToolRef.current === 'measure') {
        setMeasurePoints(prev => {
          if (prev.length >= 2) return [{ lat, lng }];
          return [...prev, { lat, lng }];
        });
      } else if (activeToolRef.current === 'gcp') {
        setPlacedGcps(prev => {
          const gcpCount = prev.length + 1;
          const newGcp: GCP = {
            id: `gcp-${gcpCount}`,
            name: `GCP_${String(gcpCount).padStart(3, '0')}`,
            lat,
            lng,
            alt: parseFloat((120.0 + (Math.random() - 0.5) * 2).toFixed(2)),
            x: 0,
            y: 0,
            status: 'unmeasured'
          };
          return [...prev, newGcp];
        });
        setActiveTool('select');
      }
    });

    // Invalidate size shortly after mounting to prevent tile misalignment/gray boxes
    const timer = setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize({ animate: false });
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update Base Layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const L = (window as any).L;
    if (!L) return;

    if (activeTileLayerRef.current) {
      map.removeLayer(activeTileLayerRef.current);
    }

    let newTile;
    if (mapType === 'streets') {
      newTile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      });
    } else {
      newTile = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
      });
    }

    newTile.addTo(map);
    activeTileLayerRef.current = newTile;
  }, [mapType]);

  // Synchronize Camera markers
  useEffect(() => {
    const map = mapRef.current;
    const group = camerasGroupRef.current;
    const flightPath = flightPathLineRef.current;
    if (!map || !group || !flightPath) return;

    const L = (window as any).L;
    if (!L) return;

    group.clearLayers();

    const latlngs: any[] = [];
    cameras.forEach((cam) => {
      latlngs.push([cam.lat, cam.lng]);

      const isSelected = selectedCamera?.id === cam.id;
      const marker = L.circleMarker([cam.lat, cam.lng], {
        radius: isSelected ? 8 : 5,
        color: isSelected ? '#ffffff' : '#2563eb',
        fillColor: '#2563eb',
        fillOpacity: isSelected ? 1.0 : 0.8,
        weight: isSelected ? 3 : 1
      });

      marker.on('click', (e: any) => {
        L.DomEvent.stopPropagation(e);
        setSelectedCamera(cam);
      });

      marker.addTo(group);
    });

    flightPath.setLatLngs(latlngs);

    // Fit map bounds on cameras loading (only once per project/dataset load)
    if (cameras.length > 0 && !hasFitBoundsRef.current) {
      const bounds = L.latLngBounds(latlngs);
      map.fitBounds(bounds, { padding: [40, 40] });
      hasFitBoundsRef.current = true;
    }
  }, [cameras, selectedCamera]);

  // Synchronize Boundary Overlay
  useEffect(() => {
    if (boundaryPolygonRef.current) {
      const latlngs = boundaryPoints.map(p => [p.lat, p.lng]);
      boundaryPolygonRef.current.setLatLngs(latlngs);
    }
  }, [boundaryPoints]);

  // Synchronize Measure Overlay
  useEffect(() => {
    if (measurePolylineRef.current) {
      const latlngs = measurePoints.map(p => [p.lat, p.lng]);
      measurePolylineRef.current.setLatLngs(latlngs);
    }
  }, [measurePoints]);

  // Synchronize GCP Markers
  useEffect(() => {
    const group = gcpsGroupRef.current;
    if (!group) return;
    const L = (window as any).L;
    if (!L) return;

    group.clearLayers();

    placedGcps.forEach((gcp) => {
      const gcpIcon = L.divIcon({
        className: 'custom-gcp-icon',
        html: `<div style="position: relative; display: flex; align-items: center; justify-content: center;">
                 <div style="position: absolute; width: 16px; height: 16px; background: rgba(244, 63, 94, 0.2); border: 1.5px solid rgb(244, 63, 94); border-radius: 9999px; animation: ping 1.2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
                 <div style="width: 6px; height: 6px; background: rgb(225, 29, 72); border-radius: 9999px;"></div>
                 <span style="position: absolute; top: -16px; font-family: monospace; font-size: 8px; font-weight: bold; color: rgb(159, 18, 57); background: rgba(255,255,255,0.85); padding: 1px 3px; border-radius: 3px; border: 1px solid rgba(225,29,72,0.25); white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">${gcp.name}</span>
               </div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });

      const marker = L.marker([gcp.lat, gcp.lng], { icon: gcpIcon });
      marker.on('click', (e: any) => {
        L.DomEvent.stopPropagation(e);
        alert(`GCP Node: ${gcp.name}\nLat: ${gcp.lat.toFixed(6)}\nLng: ${gcp.lng.toFixed(6)}\nElev: ${gcp.alt}m`);
      });

      marker.addTo(group);
    });
  }, [placedGcps]);

  const handleStartProcessing = () => {
    if (!step1Checked && !step2Checked && !step3Checked) {
      alert('Please check at least one processing step to start!');
      return;
    }
    setTerminalLogs([]);
    setProgress(0);
    setIsProcessing(true);
  };

  const handleCancelProcessing = () => {
    setIsProcessing(false);
    setProgress(0);
    setTerminalLogs((prev) => [...prev, '[WARN] Processing canceled by operator.']);
  };

  const clearDrawings = () => {
    setBoundaryPoints([]);
    setMeasurePoints([]);
  };

  const calculateDistance = () => {
    if (measurePoints.length < 2) return 0;
    const L = (window as any).L;
    if (!L) return 0;
    
    const p1 = L.latLng(measurePoints[0].lat, measurePoints[0].lng);
    const p2 = L.latLng(measurePoints[1].lat, measurePoints[1].lng);
    const meters = p1.distanceTo(p2);
    
    return unit === 'm' ? meters : meters * 3.28084;
  };

  return (
    <div className="w-full h-full relative bg-[#F8FAFC] font-sans select-none transition-colors duration-200">
      
      {/* Leaflet container */}
      <div id="leaflet-map-container" className="w-full h-full absolute inset-0 z-10" />

      {/* Floating Toolbar controls */}
      <div className="absolute top-4 left-4 z-[1010] flex gap-1 bg-white border border-[#E2E8F0] p-1 rounded-lg shadow-lg">
        <button
          onClick={() => { setActiveTool('select'); clearDrawings(); }}
          className={`p-2 rounded transition cursor-pointer flex items-center justify-center ${
            activeTool === 'select' ? 'text-[#2563eb] bg-slate-100 font-bold' : 'text-slate-450 hover:text-slate-600'
          }`}
          title="Select camera triggers"
        >
          <MousePointer size={18} />
        </button>
        
        <button
          onClick={() => setActiveTool('boundary')}
          className={`p-2 rounded transition cursor-pointer flex items-center justify-center ${
            activeTool === 'boundary' ? 'text-[#2563eb] bg-slate-100 font-bold' : 'text-slate-450 hover:text-slate-600'
          }`}
          title="Draw processing area boundary"
        >
          <Grid size={18} />
        </button>

        <button
          onClick={() => setActiveTool('measure')}
          className={`p-2 rounded transition cursor-pointer flex items-center justify-center ${
            activeTool === 'measure' ? 'text-[#2563eb] bg-slate-100 font-bold' : 'text-slate-450 hover:text-slate-600'
          }`}
          title="Measure line distance"
        >
          <Ruler size={18} />
        </button>

        <button
          onClick={() => setActiveTool('gcp')}
          className={`p-2 rounded transition cursor-pointer flex items-center justify-center ${
            activeTool === 'gcp' ? 'text-[#2563eb] bg-slate-100 font-bold' : 'text-slate-450 hover:text-slate-600'
          }`}
          title="Place Ground Control Point (GCP)"
        >
          <MapPin size={18} />
        </button>

        {(boundaryPoints.length > 0 || measurePoints.length > 0) && (
          <>
            <div className="w-px bg-[#E2E8F0] mx-1" />
            <button
              onClick={clearDrawings}
              className="px-2 py-1 text-slate-450 hover:text-rose-600 text-xs font-bold rounded transition cursor-pointer"
            >
              Clear
            </button>
          </>
        )}

        {/* Map view selection toggle */}
        <div className="w-px bg-[#E2E8F0] mx-1" />
        <button
          onClick={() => setMapType(mapType === 'streets' ? 'satellite' : 'streets')}
          className="px-2.5 py-1.5 hover:bg-slate-50 text-[10px] font-bold rounded transition cursor-pointer flex items-center gap-1.5 text-slate-650 hover:text-[#2563eb]"
        >
          <span>{mapType === 'streets' ? 'Satellite View' : 'Streets Map'}</span>
        </button>
      </div>

      {/* Measurement info card */}
      {activeTool === 'measure' && measurePoints.length > 0 && (
        <div className="absolute top-4 left-72 z-[1010] bg-white border border-[#E2E8F0] text-[#0F172A] text-xs px-3 py-2 rounded-lg shadow-lg font-semibold animate-fade-in-scale">
          {measurePoints.length === 1 ? (
            <span>Click second point...</span>
          ) : (
            <span className="text-[#2563eb] font-bold">
              Distance: {calculateDistance().toFixed(2)} {unit === 'm' ? 'meters' : 'feet'}
            </span>
          )}
        </div>
      )}

      {/* Floating Camera Telemetry Inspector */}
      {selectedCamera && (
        <div className="absolute top-4 right-14 z-[1010] w-76 bg-white border border-[#E2E8F0] rounded-xl shadow-2xl p-4 animate-fade-in-scale text-[#0F172A]">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
            <div className="flex items-center gap-2">
              <Compass className="text-[#2563eb]" size={16} />
              <span className="font-bold text-xs font-mono text-slate-700">
                {selectedCamera.filename}
              </span>
            </div>
            <button 
              onClick={() => setSelectedCamera(null)}
              className="p-1 text-slate-450 hover:text-slate-650 rounded-full hover:bg-slate-100 cursor-pointer flex items-center justify-center"
            >
              <X size={14} />
            </button>
          </div>

          {/* Drone Camera Preview HUD */}
          <div className="w-full h-32 rounded-lg border border-[#E2E8F0] bg-slate-900 relative overflow-hidden mb-3">
            <div 
              className="absolute inset-0 bg-cover bg-center opacity-65 filter blur-[0.5px]" 
              style={{ backgroundImage: `url("${selectedCamera.imageUrl || 'https://lh3.googleusercontent.com/aida-public/AB6AXuCHD5xMMex02CXE_V6DOXJjBmUH6yHWbNq1ty0U4Z72KxA9AZsOubvjTTJd-bnxWgPkI833_gMVSuLRjd6uAwGn7rx_HIOYJH40i-wxIILqfDjjLd1Z_fzvx_soWhsBP81J2B6n'}")` }} 
            />
            
            {/* HUD HUD Overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-emerald-450 text-[10px] font-mono select-none">
              {/* Crosshair Center */}
              <div className="w-10 h-10 border border-emerald-500/40 rounded-full flex items-center justify-center">
                <Crosshair size={10} className="text-emerald-500/80" />
              </div>

              {/* Corner brackets */}
              <div className="absolute top-2 left-2 border-t border-l border-emerald-500/60 w-3.5 h-3.5" />
              <div className="absolute top-2 right-2 border-t border-r border-emerald-500/60 w-3.5 h-3.5" />
              <div className="absolute bottom-2 left-2 border-b border-l border-emerald-500/60 w-3.5 h-3.5" />
              <div className="absolute bottom-2 right-2 border-b border-r border-emerald-500/60 w-3.5 h-3.5" />

              {/* Telemetry info inside HUD */}
              <div className="absolute bottom-2 left-3 flex flex-col text-[7.5px] text-emerald-450 leading-tight">
                <span>ALT: {selectedCamera.alt}m</span>
                <span>YAW: {selectedCamera.yaw}°</span>
              </div>

              <div className="absolute bottom-2 right-3 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[7.5px] font-bold">GPS LOCK</span>
              </div>
            </div>
          </div>

          {/* Data Specs Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-50 border border-slate-100 px-2 py-1.5 rounded">
              <span className="text-[9px] text-slate-500 block uppercase font-semibold">Latitude</span>
              <span className="font-bold font-mono text-[10.5px]">{selectedCamera.lat}</span>
            </div>
            <div className="bg-slate-50 border border-slate-100 px-2 py-1.5 rounded">
              <span className="text-[9px] text-slate-500 block uppercase font-semibold">Longitude</span>
              <span className="font-bold font-mono text-[10.5px]">{selectedCamera.lng}</span>
            </div>
            <div className="bg-slate-50 border border-slate-100 px-2 py-1.5 rounded">
              <span className="text-[9px] text-slate-500 block uppercase font-semibold">Pitch / Roll</span>
              <span className="font-bold font-mono text-[10.5px]">{selectedCamera.pitch}° / {selectedCamera.roll}°</span>
            </div>
            <div className="bg-slate-50 border border-slate-100 px-2 py-1.5 rounded">
              <span className="text-[9px] text-slate-500 block uppercase font-semibold">Yaw (Heading)</span>
              <span className="font-bold font-mono text-[10.5px]">{selectedCamera.yaw}°</span>
            </div>
          </div>
        </div>
      )}

      {/* Floating Processing Setup Toggle Button */}
      {!isProcessingPanelOpen && (
        <button
          type="button"
          onClick={() => setIsProcessingPanelOpen(true)}
          className={`absolute bottom-6 left-6 z-[1010] bg-white border border-[#E2E8F0] px-4 py-2.5 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 cursor-pointer flex items-center gap-2 text-slate-700 hover:text-[#2563eb] hover:border-[#2563eb] font-bold text-xs btn-scale ${
            isProcessing ? 'ring-2 ring-[#2563eb]/20' : ''
          }`}
        >
          {isProcessing ? (
            <div className="relative flex items-center justify-center w-4 h-4">
              <svg className="w-full h-full animate-spin text-[#2563eb]" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : (
            <Sparkles size={16} className="text-[#2563eb]" />
          )}
          <span>
            {isProcessing ? `Processing (${Math.round(progress)}%)` : 'Processing Setup'}
          </span>
        </button>
      )}

      {/* Collapsible Floating Processing Panel */}
      {isProcessingPanelOpen && (
        <div className="absolute bottom-4 left-4 right-4 z-[1010] h-[290px] bg-white/95 backdrop-blur-sm border border-[#E2E8F0] rounded-2xl shadow-2xl flex flex-col md:flex-row overflow-hidden animate-slide-up">
          {/* Close Panel Button */}
          <button
            type="button"
            onClick={() => setIsProcessingPanelOpen(false)}
            className="absolute top-3 right-3 z-30 p-1.5 text-slate-450 hover:text-slate-750 hover:bg-slate-100 rounded-full transition cursor-pointer flex items-center justify-center"
            title="Collapse Processing Setup"
          >
            <X size={15} />
          </button>

          {/* Step Checkbox Settings */}
          <div className="w-full md:w-80 border-r border-[#E2E8F0] p-4 flex flex-col justify-between select-none shrink-0 bg-slate-50/75">
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-550 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Sparkles size={14} className="text-[#2563eb]" />
                <span>Processing Setup</span>
              </h3>
              
              <label className="flex items-start gap-3 cursor-pointer p-1.5 rounded hover:bg-slate-200/50 transition select-none">
                <input
                  type="checkbox"
                  checked={step1Checked}
                  onChange={(e) => setStep1Checked(e.target.checked)}
                  className="mt-0.5 rounded text-[#2563eb] focus:ring-[#2563eb] w-4 h-4 cursor-pointer border-slate-350"
                  disabled={isProcessing}
                />
                <div className="text-xs">
                  <div className="font-bold text-slate-800">1. Initial Processing</div>
                  <p className="text-[10px] text-slate-500 leading-tight mt-0.5">Solve camera pose triangulation & BBA adjustments.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer p-1.5 rounded hover:bg-slate-200/50 transition select-none">
                <input
                  type="checkbox"
                  checked={step2Checked}
                  onChange={(e) => setStep2Checked(e.target.checked)}
                  className="mt-0.5 rounded text-[#2563eb] focus:ring-[#2563eb] w-4 h-4 cursor-pointer border-slate-350"
                  disabled={isProcessing}
                />
                <div className="text-xs">
                  <div className="font-bold text-slate-800">2. Point Cloud and Mesh</div>
                  <p className="text-[10px] text-slate-500 leading-tight mt-0.5">Dense points interpolation & textured 3D wireframe mesh.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer p-1.5 rounded hover:bg-slate-200/50 transition select-none">
                <input
                  type="checkbox"
                  checked={step3Checked}
                  onChange={(e) => setStep3Checked(e.target.checked)}
                  className="mt-0.5 rounded text-[#2563eb] focus:ring-[#2563eb] w-4 h-4 cursor-pointer border-slate-350"
                  disabled={isProcessing}
                />
                <div className="text-xs">
                  <div className="font-bold text-slate-800">3. DSM, Orthomosaic</div>
                  <p className="text-[10px] text-slate-500 leading-tight mt-0.5">Digital elevation modeling and geometric orthophoto maps.</p>
                </div>
              </label>
            </div>

            {/* Action buttons & progress */}
            <div className="mt-2.5 space-y-2">
              {isProcessing && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-mono text-[#2563eb] font-bold">
                    <span>COMPILING DATASETS...</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[#2563eb] rounded-full transition-all duration-150"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
              
              <div className="flex gap-2">
                {isProcessing ? (
                  <button
                    type="button"
                    onClick={handleCancelProcessing}
                    className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-bold flex items-center justify-center gap-1.5 transition shadow cursor-pointer"
                  >
                    <Square size={13} fill="white" />
                    <span>Cancel</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartProcessing}
                    className="flex-1 py-1.5 bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold rounded text-xs flex items-center justify-center gap-1.5 transition shadow cursor-pointer"
                  >
                    <Play size={13} fill="white" />
                    <span>Start Processing</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* scrolling logging terminal console */}
          <div className="flex-1 bg-[#F8FAFC]/40 p-4 font-mono text-[11px] text-slate-700 overflow-y-auto flex flex-col justify-between border-l border-[#E2E8F0]">
            <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-2 text-slate-500 uppercase text-[9px] font-bold select-none tracking-wider shrink-0">
              <span className="flex items-center gap-1.5">
                <FileText size={11} className="text-[#2563eb]" />
                <span>Pipeline Compilation Output Console</span>
              </span>
            </div>

            <div className="flex-1 space-y-1 select-text">
              {terminalLogs.length === 0 ? (
                <div className="text-slate-400 italic mt-4 text-center font-sans">
                  AeroMap pipeline idle. Select options and press 'Start Processing' to compile point cloud datasets.
                </div>
              ) : (
                terminalLogs.map((log, index) => {
                  if (!log) return null;
                  let colorClass = 'text-slate-600';
                  if (log.includes('[SUCCESS]')) colorClass = 'text-emerald-600 font-bold';
                  if (log.includes('[WARN]')) colorClass = 'text-amber-600';
                  if (log.includes('[ERROR]')) colorClass = 'text-rose-600';
                  if (log.includes('[INFO]')) colorClass = 'text-slate-500';

                  return (
                    <div key={index} className={`${colorClass} leading-5 border-l-2 border-slate-200 pl-2`}>
                      {log}
                    </div>
                  );
                })
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
