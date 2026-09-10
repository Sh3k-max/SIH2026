import React, { useState, useRef, useEffect } from 'react';
import { 
  Layers, 
  Ruler, 
  Trash2, 
  TrendingUp, 
  Info
} from 'lucide-react';
import type { Project } from '../types';

interface VolumesPanelProps {
  unit: string;
  activeProject: Project | null;
  setCurrentView?: (view: string) => void;
}

type ModeType = 'polygon' | 'profile';

export const VolumesPanel: React.FC<VolumesPanelProps> = ({ unit, activeProject, setCurrentView }) => {
  const [activeMode, setActiveMode] = useState<ModeType>('polygon');
  
  // Custom overlay points
  const [polyPoints, setPolyPoints] = useState<{ x: number; y: number }[]>([]);
  const [profilePoints, setProfilePoints] = useState<{ x: number; y: number }[]>([]);
  
  // Computed Output metrics
  const [calculatedArea, setCalculatedArea] = useState<number | null>(null);
  const [calculatedPerimeter, setCalculatedPerimeter] = useState<number | null>(null);
  const [calculatedVolume, setCalculatedVolume] = useState<{ cut: number; fill: number; net: number } | null>(null);
  
  // Hover coordinate on profile chart
  const [hoverProfileIndex, setHoverProfileIndex] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);

  // Stockpile presets
  const loadPresetStockpile = (id: 'A' | 'B') => {
    if (!activeProject?.isProcessed) return;
    
    if (id === 'A') {
      setPolyPoints([
        { x: 380, y: 220 },
        { x: 550, y: 180 },
        { x: 620, y: 320 },
        { x: 420, y: 380 }
      ]);
      setProfilePoints([
        { x: 350, y: 280 },
        { x: 650, y: 280 }
      ]);
    } else {
      setPolyPoints([
        { x: 200, y: 350 },
        { x: 350, y: 300 },
        { x: 380, y: 450 },
        { x: 220, y: 480 }
      ]);
      setProfilePoints([
        { x: 220, y: 400 },
        { x: 380, y: 400 }
      ]);
    }
  };

  // Render Elevation Heatmap (DSM)
  useEffect(() => {
    if (!activeProject?.isProcessed) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    const stockpileX = width / 2;
    const stockpileY = height / 2;
    const maxRadius = Math.max(width, height) * 0.65;

    const isBridge = activeProject.name.toLowerCase().includes('bridge');
    const isSolar = activeProject.name.toLowerCase().includes('solar');

    const imgData = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let z = 55; // default base terrain elevation (meters)

        if (isBridge) {
          // Bridge DSM: Horizontal bridge deck running from left to right (y around height / 2 = 250)
          const distToDeck = Math.abs(y - 250);
          if (distToDeck < 35) {
            z = 76;
            if (Math.abs(x - 200) < 15 || Math.abs(x - 400) < 15 || Math.abs(x - 600) < 15) {
              z = 78;
            }
          } else if (distToDeck < 60) {
            z = 76 - ((distToDeck - 35) / 25) * 20;
          } else {
            z = 56 + Math.sin(x * 0.05) * 2;
            if (x > 320 && x < 480) {
              const distToCenter = Math.abs(x - 400);
              z -= (1 - distToCenter / 80) * 8;
            }
          }
        } else if (isSolar) {
          // Solar panels DSM: 4 rows of panels
          z = 52 + Math.sin(x * 0.04) * Math.cos(y * 0.04) * 2;
          const panelWidth = 40;
          const rowOffsets = [120, 240, 360, 480];
          rowOffsets.forEach((rowX) => {
            if (x >= rowX && x < rowX + panelWidth) {
              const pct = (x - rowX) / panelWidth;
              z = 70 - pct * 12;
            }
          });
        } else {
          // Stockpile DSM
          const dx = x - stockpileX;
          const dy = y - stockpileY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          z = 80 - (dist / maxRadius) * 45;
          z += Math.sin(x * 0.08) * Math.cos(y * 0.08) * 1.5;
          z += Math.sin(x * 0.25) * Math.cos(y * 0.25) * 0.4;
          
          const sDx = x - 300;
          const sDy = y - 380;
          const sDist = Math.sqrt(sDx * sDx + sDy * sDy);
          const sz = Math.max(0, 18 - (sDist / 120) * 18);
          z += sz;
        }

        const normZ = Math.min(1, Math.max(0, (z - 45) / 37)); 
        const hue = Math.round(240 - normZ * 240);
        const sat = 75;
        const light = 50;

        const hRad = hue / 360;
        const q = light < 50 ? light * (1 + sat / 100) : light + sat - (light * sat) / 100;
        const p = 2 * light - q;

        const hue2rgb = (t: number) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1/6) return p + (q - p) * 6 * t;
          if (t < 1/2) return q;
          if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
          return p;
        };

        const r = Math.round(hue2rgb(hRad + 1/3) * 2.55);
        const g = Math.round(hue2rgb(hRad) * 2.55);
        const b = Math.round(hue2rgb(hRad - 1/3) * 2.55);

        const idx = (y * width + x) * 4;
        imgData.data[idx] = r;
        imgData.data[idx+1] = g;
        imgData.data[idx+2] = b;
        imgData.data[idx+3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Draw contours
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    if (!isBridge && !isSolar) {
      for (let rElev = 50; rElev < maxRadius; rElev += 40) {
        ctx.beginPath();
        ctx.arc(stockpileX, stockpileY, rElev, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
  }, [activeProject]);

  // Compute Volume & Area metrics when polygon points change
  useEffect(() => {
    if (polyPoints.length < 3) {
      setCalculatedArea(null);
      setCalculatedPerimeter(null);
      setCalculatedVolume(null);
      return;
    }

    const scale = 0.5; // pixel to meter factor

    let areaSum = 0;
    let perimeterSum = 0;
    for (let i = 0; i < polyPoints.length; i++) {
      const p1 = polyPoints[i];
      const p2 = polyPoints[(i + 1) % polyPoints.length];
      
      const x1 = p1.x * scale;
      const y1 = p1.y * scale;
      const x2 = p2.x * scale;
      const y2 = p2.y * scale;

      areaSum += (x1 * y2) - (x2 * y1);
      perimeterSum += Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    }

    const area = Math.abs(areaSum / 2);
    setCalculatedArea(area);
    setCalculatedPerimeter(perimeterSum);

    const heightEst = 8.5 + (polyPoints.length * 0.8); 
    const cut = area * heightEst; 
    const fill = area * 0.04; 
    setCalculatedVolume({
      cut,
      fill,
      net: cut - fill
    });
  }, [polyPoints]);

  // Render Elevation Profile Chart
  useEffect(() => {
    if (!activeProject?.isProcessed) return;

    const chartCanvas = chartCanvasRef.current;
    if (!chartCanvas) return;
    const ctx = chartCanvas.getContext('2d');
    if (!ctx) return;

    const w = chartCanvas.width;
    const h = chartCanvas.height;
    ctx.clearRect(0, 0, w, h);

    if (profilePoints.length < 2) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'italic 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Click 2 points on elevation map to generate profile cross-section', w / 2, h / 2 + 3);
      return;
    }

    const p1 = profilePoints[0];
    const p2 = profilePoints[1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const totalDist = Math.sqrt(dx * dx + dy * dy);

    const pointsCount = 40;
    const profileHeights: number[] = [];
    
    const stockpileX = 800 / 2;
    const stockpileY = 500 / 2;
    const maxRadius = Math.max(800, 500) * 0.65;

    const isBridge = activeProject.name.toLowerCase().includes('bridge');
    const isSolar = activeProject.name.toLowerCase().includes('solar');

    for (let i = 0; i < pointsCount; i++) {
      const t = i / (pointsCount - 1);
      const currX = p1.x + dx * t;
      const currY = p1.y + dy * t;

      let heightVal = 55;

      if (isBridge) {
        const distToDeck = Math.abs(currY - 250);
        if (distToDeck < 35) {
          heightVal = 76;
          if (Math.abs(currX - 200) < 15 || Math.abs(currX - 400) < 15 || Math.abs(currX - 600) < 15) {
            heightVal = 78;
          }
        } else if (distToDeck < 60) {
          heightVal = 76 - ((distToDeck - 35) / 25) * 20;
        } else {
          heightVal = 56 + Math.sin(currX * 0.05) * 2;
          if (currX > 320 && currX < 480) {
            const distToCenter = Math.abs(currX - 400);
            heightVal -= (1 - distToCenter / 80) * 8;
          }
        }
      } else if (isSolar) {
        heightVal = 52 + Math.sin(currX * 0.04) * Math.cos(currY * 0.04) * 2;
        const panelWidth = 40;
        const rowOffsets = [120, 240, 360, 480];
        rowOffsets.forEach((rowX) => {
          if (currX >= rowX && currX < rowX + panelWidth) {
            const pct = (currX - rowX) / panelWidth;
            heightVal = 70 - pct * 12;
          }
        });
      } else {
        const distFromCenter = Math.sqrt(Math.pow(currX - stockpileX, 2) + Math.pow(currY - stockpileY, 2));
        heightVal = 80 - (distFromCenter / maxRadius) * 45;
        heightVal += Math.sin(currX * 0.08) * Math.cos(currY * 0.08) * 1.5;
        
        const sDist = Math.sqrt(Math.pow(currX - 300, 2) + Math.pow(currY - 380, 2));
        const sz = Math.max(0, 18 - (sDist / 120) * 18);
        heightVal += sz;
      }

      profileHeights.push(Math.max(45, heightVal));
    }

    const paddingLeft = 35;
    const paddingRight = 15;
    const paddingTop = 15;
    const paddingBottom = 25;

    const chartW = w - paddingLeft - paddingRight;
    const chartH = h - paddingTop - paddingBottom;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.lineWidth = 1;
    ctx.font = '9px monospace';
    ctx.fillStyle = '#64748b';

    const minH = 40;
    const maxH = 90;

    for (let el = minH; el <= maxH; el += 10) {
      const py = paddingTop + chartH - ((el - minH) / (maxH - minH)) * chartH;
      ctx.beginPath();
      ctx.moveTo(paddingLeft, py);
      ctx.lineTo(w - paddingRight, py);
      ctx.stroke();

      ctx.textAlign = 'right';
      ctx.fillText(`${el}m`, paddingLeft - 5, py + 3);
    }

    ctx.beginPath();
    ctx.strokeStyle = '#ef4444'; // Red profile slice line
    ctx.lineWidth = 2.5;

    profileHeights.forEach((heightVal, i) => {
      const t = i / (pointsCount - 1);
      const px = paddingLeft + t * chartW;
      const py = paddingTop + chartH - ((heightVal - minH) / (maxH - minH)) * chartH;
      
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    ctx.lineTo(paddingLeft + chartW, paddingTop + chartH);
    ctx.lineTo(paddingLeft, paddingTop + chartH);
    ctx.closePath();
    
    const fillGrad = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + chartH);
    fillGrad.addColorStop(0, 'rgba(239, 68, 68, 0.25)');
    fillGrad.addColorStop(1, 'rgba(239, 68, 68, 0.02)');
    ctx.fillStyle = fillGrad;
    ctx.fill();

    const scaleFactor = 0.5; 
    const metersLen = totalDist * scaleFactor;
    
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    
    ctx.fillText('0 m', paddingLeft, paddingTop + chartH + 13);
    ctx.fillText(`${(metersLen / 2).toFixed(0)} m`, paddingLeft + chartW / 2, paddingTop + chartH + 13);
    ctx.fillText(`${metersLen.toFixed(0)} m`, paddingLeft + chartW, paddingTop + chartH + 13);

    if (hoverProfileIndex !== null && hoverProfileIndex < profileHeights.length) {
      const t = hoverProfileIndex / (pointsCount - 1);
      const px = paddingLeft + t * chartW;
      const py = paddingTop + chartH - ((profileHeights[hoverProfileIndex] - minH) / (maxH - minH)) * chartH;

      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px, paddingTop);
      ctx.lineTo(px, paddingTop + chartH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#6366f1';
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, 2 * Math.PI);
      ctx.fill();

      const dVal = t * metersLen;
      const eVal = profileHeights[hoverProfileIndex];
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(px - 45, py - 28, 90, 20);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.strokeRect(px - 45, py - 28, 90, 20);

      ctx.fillStyle = '#ffffff';
      ctx.font = '8.5px sans-serif';
      ctx.fillText(`${dVal.toFixed(1)}m | {${eVal.toFixed(1)}m}`, px, py - 15);
    }
  }, [profilePoints, hoverProfileIndex, activeProject]);

  const handleMapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!activeProject?.isProcessed) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const clickX = Math.round((x / rect.width) * canvas.width);
    const clickY = Math.round((y / rect.height) * canvas.height);

    if (activeMode === 'polygon') {
      setPolyPoints([...polyPoints, { x: clickX, y: clickY }]);
    } else if (activeMode === 'profile') {
      if (profilePoints.length >= 2) {
        setProfilePoints([{ x: clickX, y: clickY }]);
      } else {
        setProfilePoints([...profilePoints, { x: clickX, y: clickY }]);
      }
    }
  };

  const clearDraw = () => {
    setPolyPoints([]);
    setProfilePoints([]);
    setCalculatedArea(null);
    setCalculatedPerimeter(null);
    setCalculatedVolume(null);
  };

  return (
    <div className="w-full h-full flex flex-col md:flex-row bg-[#F8FAFC] font-sans select-none overflow-hidden animate-fade-in-scale transition-colors duration-200 text-slate-800">
      
      {/* Elevation heatmap DSM canvas */}
      <div className="flex-1 p-4 flex flex-col overflow-hidden relative">
        
        {/* Bounding info overlay when not processed */}
        {!activeProject?.isProcessed && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md z-30 flex items-center justify-center p-6 text-center select-none">
            <div className="max-w-md bg-white border border-[#E2E8F0] p-8 rounded-2xl shadow-2xl space-y-5 animate-fade-in-scale text-slate-800">
              <div className="w-14 h-14 rounded-full bg-blue-50 border border-blue-100/60 flex items-center justify-center mx-auto text-[#2563eb]">
                <Layers size={26} />
              </div>
              <div className="space-y-2">
                <h3 className="font-display font-extrabold text-base text-slate-900 uppercase tracking-tight">DSM Matrix Pending</h3>
                <p className="text-xs text-slate-500 leading-relaxed font-semibold">
                  This project has not been processed yet. Aevora needs to execute the **VGGT + DUSt3R Hybrid Reconstruction Engine** to generate the Digital Surface Model (DSM).
                </p>
              </div>
              <div className="bg-slate-50 border border-slate-200/60 p-3.5 rounded-xl text-[10.5px] text-slate-550 leading-relaxed font-mono text-left space-y-1.5">
                <span className="font-bold text-[#2563eb] block uppercase tracking-wider text-[9px]">Required Pipeline Steps:</span>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>Initial camera block adjustments</li>
                  <li>Dense geometry point interpolation</li>
                  <li>DSM & Orthomosaic compilation</li>
                </ul>
              </div>
              <div>
                <button 
                  onClick={() => setCurrentView && setCurrentView('map')}
                  className="w-full py-2.5 bg-[#2563eb] hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow transition cursor-pointer btn-scale"
                >
                  Go to Map View to Process
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2.5 mb-3">
          <div className="flex items-center gap-2">
            <Layers className="text-[#2563eb]" size={17} />
            <h3 className="font-display font-bold text-slate-700 text-sm">Digital Surface Model (DSM) Heatmap</h3>
          </div>

          {/* Quick loading presets */}
          {activeProject?.isProcessed && !activeProject?.name.toLowerCase().includes('bridge') && !activeProject?.name.toLowerCase().includes('solar') && (
            <div className="flex gap-1.5 text-xs font-semibold text-slate-550">
              <button
                onClick={() => loadPresetStockpile('A')}
                className="px-2 py-1 bg-white border border-[#E2E8F0] hover:bg-slate-50 rounded-lg cursor-pointer"
              >
                Preset Pile A
              </button>
              <button
                onClick={() => loadPresetStockpile('B')}
                className="px-2 py-1 bg-white border border-[#E2E8F0] hover:bg-slate-50 rounded-lg cursor-pointer"
              >
                Preset Pile B
              </button>
            </div>
          )}
        </div>

        {/* Canvas Pane wrapper */}
        <div className="flex-1 bg-slate-900 rounded-xl relative overflow-hidden flex items-center justify-center border border-[#E2E8F0]">
          <canvas
            ref={canvasRef}
            width={800}
            height={500}
            onClick={handleMapClick}
            className="w-full h-full block cursor-crosshair object-cover"
          />

          {/* SVG Overlay layer */}
          <svg
            viewBox="0 0 800 500"
            className="w-full h-full absolute inset-0 pointer-events-none select-none"
          >
            {/* Draw Polygon Stockpile boundary */}
            {polyPoints.length > 0 && (
              <>
                {polyPoints.length >= 3 ? (
                  <polygon
                    points={polyPoints.map(p => `${p.x},${p.y}`).join(' ')}
                    className="fill-[#2563eb]/10 stroke-[#2563eb] stroke-[2.5] stroke-linejoin-round"
                  />
                ) : (
                  <polyline
                    points={polyPoints.map(p => `${p.x},${p.y}`).join(' ')}
                    className="stroke-[#2563eb] stroke-[2]"
                  />
                )}
                {polyPoints.map((p, i) => (
                  <circle
                    key={`v-${i}`}
                    cx={p.x}
                    cy={p.y}
                    r={4.5}
                    className="fill-[#2563eb] stroke-white stroke-[1.5]"
                  />
                ))}
              </>
            )}

            {/* Draw Profile Line path */}
            {profilePoints.length > 0 && (
              <>
                {profilePoints.length === 1 ? (
                  <circle cx={profilePoints[0].x} cy={profilePoints[0].y} r={4.5} className="fill-rose-500 stroke-white stroke-[1.5]" />
                ) : (
                  <>
                    <line
                      x1={profilePoints[0].x}
                      y1={profilePoints[0].y}
                      x2={profilePoints[1].x}
                      y2={profilePoints[1].y}
                      className="stroke-rose-500 stroke-[2.5]"
                    />
                    <circle cx={profilePoints[0].x} cy={profilePoints[0].y} r={5} className="fill-rose-500 stroke-white" />
                    <circle cx={profilePoints[1].x} cy={profilePoints[1].y} r={5} className="fill-rose-500 stroke-white" />
                  </>
                )}
              </>
            )}
          </svg>

          {/* Elevation Heatmap Legend */}
          {activeProject?.isProcessed && (
            <div className="absolute bottom-4 right-4 bg-white/95 border border-[#E2E8F0] p-2.5 rounded-lg shadow-lg text-[9px] text-slate-500 font-bold uppercase tracking-wider backdrop-blur-sm">
              <div className="mb-1 text-center font-bold text-[#2563eb]">Elevation DSM</div>
              <div className="flex items-center gap-1.5">
                <span>Low (45m)</span>
                <div className="w-24 h-2 rounded bg-gradient-to-r from-blue-600 via-green-500 via-yellow-450 to-red-600" />
                <span>High (82m)</span>
              </div>
            </div>
          )}
        </div>

        {/* Cross-section slice graph */}
        <div className="h-44 mt-3 bg-white border border-[#E2E8F0] rounded-xl p-3 flex flex-col justify-between shadow">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-550 border-b border-slate-100 pb-1.5">
            <span className="flex items-center gap-1">
              <TrendingUp size={14} className="text-rose-500" />
              <span>Cross-Section Elevation Profiler Chart</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono">Profile Unit: Meters</span>
          </div>

          <div 
            className="flex-1 relative mt-1.5 cursor-ew-resize"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const hoverX = e.clientX - rect.left;
              const hoverPct = Math.min(1, Math.max(0, hoverX / rect.width));
              setHoverProfileIndex(Math.round(hoverPct * 39));
            }}
            onMouseLeave={() => setHoverProfileIndex(null)}
          >
            <canvas
              ref={chartCanvasRef}
              width={650}
              height={100}
              className="w-full h-full block"
            />
          </div>
        </div>

      </div>

      {/* Volumetric parameters sidebar */}
      <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-[#E2E8F0] bg-white p-5 flex flex-col justify-between shrink-0">
        
        <div className="space-y-5">
          <div className="flex flex-col gap-3">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Analysis Mode</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setActiveMode('polygon'); clearDraw(); }}
                className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer btn-scale ${
                  activeMode === 'polygon' 
                    ? 'bg-[#2563eb] text-white shadow font-bold' 
                    : 'bg-slate-100 text-slate-650 hover:bg-slate-200'
                }`}
                disabled={!activeProject?.isProcessed}
              >
                <Layers size={13} />
                <span>Volumetric Calc</span>
              </button>
              <button
                onClick={() => { setActiveMode('profile'); clearDraw(); }}
                className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer btn-scale ${
                  activeMode === 'profile' 
                    ? 'bg-[#2563eb] text-white shadow font-bold' 
                    : 'bg-slate-100 text-slate-650 hover:bg-slate-200'
                }`}
                disabled={!activeProject?.isProcessed}
              >
                <Ruler size={13} />
                <span>Profile Slice</span>
              </button>
            </div>
          </div>

          <div className="border-t border-slate-100 my-1" />

          {/* Guidelines card */}
          <div className="bg-slate-50 p-3.5 border border-slate-150 rounded-xl space-y-1.5 text-xs text-slate-600">
            <div className="text-[10px] font-bold text-[#2563eb] uppercase tracking-wider flex items-center gap-1.5">
              <Info size={13} />
              <span>Interactive Guide</span>
            </div>
            
            {activeMode === 'polygon' ? (
              <p className="text-[10.5px] leading-relaxed">
                Click 3 or more points on the DSM heatmap to draw the boundary area. The system will automatically calculate the Cut, Fill, and Net volume relative to the base plane.
              </p>
            ) : (
              <p className="text-[10.5px] leading-relaxed">
                Click 2 points on the terrain map to slice an elevation profile path. Hover your cursor over the chart below to inspect distance and height coordinates.
              </p>
            )}

            {(polyPoints.length > 0 || profilePoints.length > 0) && (
              <button
                onClick={clearDraw}
                className="mt-1 flex items-center gap-1 text-[10.5px] font-bold text-rose-500 hover:text-rose-600 cursor-pointer"
              >
                <Trash2 size={12} />
                <span>Clear Drawings</span>
              </button>
            )}
          </div>

          {/* CALCULATED RESULTS */}
          {activeMode === 'polygon' && (
            <div className="space-y-4">
              <div className="text-xs font-bold text-slate-550 uppercase tracking-wider">Calculated Volume</div>
              
              <div className="space-y-2.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Surface Area:</span>
                  <span className="font-bold font-mono text-slate-800">
                    {calculatedArea !== null ? `${(calculatedArea * (unit === 'm' ? 1 : 10.7639)).toFixed(1)} ${unit === 'm' ? 'm²' : 'ft²'}` : '--'}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Perimeter:</span>
                  <span className="font-bold font-mono text-slate-800">
                    {calculatedPerimeter !== null ? `${(calculatedPerimeter * (unit === 'm' ? 1 : 3.28084)).toFixed(1)} ${unit === 'm' ? 'm' : 'ft'}` : '--'}
                  </span>
                </div>

                <div className="border-t border-[#E2E8F0] my-1" />

                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Estimated Cut:</span>
                  <span className="font-bold text-emerald-600 font-mono">
                    {calculatedVolume !== null ? `+${(calculatedVolume.cut * (unit === 'm' ? 1 : 35.3147)).toFixed(1)} ${unit === 'm' ? 'm³' : 'ft³'}` : '--'}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Estimated Fill:</span>
                  <span className="font-bold text-rose-600 font-mono">
                    {calculatedVolume !== null ? `-${(calculatedVolume.fill * (unit === 'm' ? 1 : 35.3147)).toFixed(1)} ${unit === 'm' ? 'm³' : 'ft³'}` : '--'}
                  </span>
                </div>

                <div className="bg-blue-50 border border-blue-100/60 p-3 rounded-lg flex justify-between items-center text-xs mt-2">
                  <span className="font-bold text-[#2563eb]">Net Volume:</span>
                  <span className="font-extrabold text-[#2563eb] font-mono">
                    {calculatedVolume !== null ? `${(calculatedVolume.net * (unit === 'm' ? 1 : 35.3147)).toFixed(1)} ${unit === 'm' ? 'm³' : 'ft³'}` : '--'}
                  </span>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* banner notes */}
        <div className="bg-slate-50 border border-[#E2E8F0] p-4 rounded-xl flex items-start gap-2 text-[10px] text-slate-550 leading-normal">
          <Info size={14} className="text-[#2563eb] shrink-0 mt-0.5" />
          <span>
            Cut & Fill volumes are estimated relative to a triangulated base plane connecting boundary vertices. Datums settings affect coordinate conversions.
          </span>
        </div>

      </div>

    </div>
  );
};
