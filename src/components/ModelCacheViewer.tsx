import React, { useState, useEffect } from 'react';
import {
  RotateCw,
  ExternalLink,
  Play,
  Square,
  Sparkles,
  Server
} from 'lucide-react';
import type { Project } from '../types';

interface ModelCacheViewerProps {
  activeProject: Project | null;
  setCurrentView?: (view: string) => void;
  isVisible?: boolean;
}

export const ModelCacheViewer: React.FC<ModelCacheViewerProps> = ({
  activeProject: _activeProject,
  setCurrentView: _setCurrentView,
  isVisible = true
}) => {
  const backendUrl = 'http://localhost:5000';
  const viserUrl = 'http://localhost:8081';

  const [viserRunning, setViserRunning] = useState<boolean>(true); // default assume true since we ensure it starts
  const [viserStarting, setViserStarting] = useState<boolean>(false);
  const [iframeKey, setIframeKey] = useState<number>(1);
  const [autoStarted, setAutoStarted] = useState<boolean>(false);

  // Check Viser server status
  const checkStatus = async () => {
    try {
      const res = await fetch(`${backendUrl}/api/system/status`, { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        const data = await res.json();
        if (data.viser && data.viser.running) {
          setViserRunning(true);
          return true;
        }
      }
    } catch (e) {
      console.warn('Viser status check error:', e);
    }
    return false;
  };

  // Start Viser server if not running
  const startViser = async () => {
    setViserStarting(true);
    try {
      const res = await fetch(`${backendUrl}/api/cache/viser/start`, {
        method: 'POST',
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        setViserRunning(true);
        setTimeout(() => setIframeKey(k => k + 1), 1000);
      }
    } catch (e) {
      console.error('Failed to start Viser server:', e);
    } finally {
      setViserStarting(false);
    }
  };

  // Stop Viser server
  const stopViser = async () => {
    setViserStarting(true);
    try {
      const res = await fetch(`${backendUrl}/api/cache/viser/stop`, {
        method: 'POST',
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        setViserRunning(false);
      }
    } catch (e) {
      console.error('Failed to stop Viser server:', e);
    } finally {
      setViserStarting(false);
    }
  };

  // On mount and when isVisible becomes true, ensure Viser is running
  useEffect(() => {
    if (!isVisible) return;

    const init = async () => {
      const isUp = await checkStatus();
      if (!isUp && !autoStarted) {
        setAutoStarted(true);
        await startViser();
      } else if (isUp) {
        setViserRunning(true);
      }
    };

    init();
  }, [isVisible, autoStarted]);

  return (
    <div className="w-full h-full flex flex-col bg-[#0b0f19] text-white select-none overflow-hidden font-sans">
      {/* Main Full-Screen Viser Viewport */}
      <div className="flex-1 w-full h-full relative overflow-hidden bg-black">
        {viserRunning ? (
          <iframe
            key={iframeKey}
            src={viserUrl}
            className="w-full h-full border-none block"
            title="Viser 3D Scene Viewport"
            allow="accelerometer; camera; gyroscope; vr; xr-spatial-tracking"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-center p-8 bg-grid-pattern">
            <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 shadow-xl">
              <Server size={32} />
            </div>
            <div className="max-w-md space-y-2">
              <h3 className="font-display font-extrabold text-base text-slate-200 uppercase tracking-tight">
                Viser 3D Service Idle
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Click below to launch the lightweight Viser interactive 3D scene inspector. It renders the full 9.48M reconstructed point cloud with point size controls and camera viewpoints.
              </p>
            </div>
            <button
              onClick={startViser}
              disabled={viserStarting}
              className="mt-2 px-6 py-3 rounded-xl bg-[#2563eb] hover:bg-blue-600 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-blue-500/20 transition cursor-pointer disabled:opacity-50"
            >
              {viserStarting ? (
                <RotateCw size={15} className="animate-spin" />
              ) : (
                <Play size={15} />
              )}
              Launch Viser 3D Scene
            </button>
          </div>
        )}
      </div>

    </div>
  );
};
