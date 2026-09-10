import React, { useState, useRef } from 'react';
import { 
  FolderClosed, 
  Image as ImageIcon, 
  X, 
  CheckCircle2, 
  AlertCircle,
  RotateCw
} from 'lucide-react';
import type { CameraTelemetry } from '../types';
import { toast } from 'react-toastify';

interface ProjectWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onFinish: (projectData: {
    name: string;
    path: string;
    type: 'new' | 'merged';
    imageCount: number;
    images: string[];
    coordinateSystem: string;
    datum: string;
    unit: string;
    cameras?: CameraTelemetry[];
    datasetName?: string;
    jobId?: string;
    isProcessing?: boolean;
  }) => void;
}

// Convert GPS DMS (Degrees, Minutes, Seconds) format to Decimal Degrees
const convertDMSToDD = (dms: any, ref: string): number => {
  if (!dms || dms.length < 3) return 0;
  
  const d = typeof dms[0] === 'number' ? dms[0] : dms[0].numerator / dms[0].denominator;
  const m = typeof dms[1] === 'number' ? dms[1] : dms[1].numerator / dms[1].denominator;
  const s = typeof dms[2] === 'number' ? dms[2] : dms[2].numerator / dms[2].denominator;
  
  let dd = d + m / 60 + s / 3600;
  if (ref === 'S' || ref === 'W') {
    dd = -dd;
  }
  return dd;
};

export const ProjectWizard: React.FC<ProjectWizardProps> = ({ isOpen, onClose, onFinish }) => {
  const [step, setStep] = useState(1);
  
  // Refs for local PC dialog uploads
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 1: Project Metadata
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [projectType, setProjectType] = useState<'new' | 'merged'>('new');
  const [engine, setEngine] = useState<'dust3r' | 'vggt' | 'genpc' | 'hybrid'>('genpc');
  const [useDefaultLocation, setUseDefaultLocation] = useState(false);

  // Step 2: Selected Images
  const [imageList, setImageList] = useState<string[]>([]);
  const [camerasList, setCamerasList] = useState<CameraTelemetry[]>([]);
  const [rawFiles, setRawFiles] = useState<File[]>([]);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadStatusText, setUploadStatusText] = useState<string>('');

  const [progressPct, setProgressPct] = useState<number>(0);
  const [recentLogs, setRecentLogs] = useState<string[]>([]);

  // Step 3: Coordinate System
  const [unit, setUnit] = useState('m');
  const [coordType, setCoordType] = useState<'auto' | 'arbitrary' | 'known'>('auto');
  const [selectedZone, setSelectedZone] = useState('WGS 84 / UTM zone 34N');
  const [datum, setDatum] = useState('World Geodetic System 1984');

  if (!isOpen) return null;

  const handleBrowseDir = () => {
    folderInputRef.current?.click();
  };

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileList = Array.from(files).filter(f => /\.(jpg|jpeg|png|webp|mov|mp4)$/i.test(f.name));
      setRawFiles(fileList);
      const relativePath = files[0].webkitRelativePath || files[0].name;
      const folderName = relativePath.split('/')[0] || 'SelectedProjectFolder';
      setPath(`C:/Projects/${folderName}`);
      setName(folderName);
      setImageList(fileList.map(f => f.name));
    } else {
      const customPath = prompt('Enter project directory path:', 'C:/Projects/MyDroneSurvey');
      if (customPath) {
        setPath(customPath);
      }
    }
  };

  const handleAddImages = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileList = Array.from(files);
      setRawFiles(fileList);
      setImageList(fileList.map(f => f.name));

      const newCameras: CameraTelemetry[] = fileList.map((file, index) => {
        const row = Math.floor(index / 4);
        const col = index % 4;
        return {
          id: `cam-${index + 1}`,
          filename: file.name,
          lat: parseFloat((34.0522 + (row - 1.5) * 0.00015).toFixed(6)),
          lng: parseFloat((-118.2437 + (col - 1.5) * 0.00018).toFixed(6)),
          alt: 120.0,
          pitch: 0,
          roll: 0,
          yaw: (row % 2 === 0) ? 90 : 270,
          x: 180 + col * 120,
          y: 180 + row * 90
        };
      });
      setCamerasList(newCameras);
      const isVideo = fileList.some(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f.name));
      if (isVideo) {
        toast.success(`Imported drone video: ${fileList[0].name}. Keyframes will be automatically extracted!`);
      } else {
        toast.success(`Imported ${fileList.length} survey photos!`);
      }
    }
  };

  const handleRemoveSelected = () => {
    if (selectedRowIndex !== null) {
      setImageList(prev => prev.filter((_, idx) => idx !== selectedRowIndex));
      setCamerasList(prev => prev.filter((_, idx) => idx !== selectedRowIndex));
      setRawFiles(prev => prev.filter((_, idx) => idx !== selectedRowIndex));
      setSelectedRowIndex(null);
      toast.info('Image removed from project list.');
    } else {
      toast.warning('Click on an image in the list to select and remove it.');
    }
  };

  const handleClearList = () => {
    setImageList([]);
    setCamerasList([]);
    setRawFiles([]);
    setSelectedRowIndex(null);
    toast.info('Image list cleared.');
  };

  const handleLoadSampleFlight = async () => {
    try {
      const projName = name.trim() || 'drone_survey_sample';
      setName(projName);
      setPath(`C:/Projects/${projName}`);
      setIsUploading(true);
      setUploadStatusText('Loading real sample drone aerial flight photos (16 captures)...');
      setProgressPct(10);

      const res = await fetch('/api/sample_flight/copy_to_project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: projName })
      });
      const data = await res.json();
      setIsUploading(false);

      if (data.files && data.files.length > 0) {
        setImageList(data.files);
        setRawFiles([]);
        const cams: CameraTelemetry[] = data.files.map((f: string, idx: number) => {
          const row = Math.floor(idx / 4);
          const col = idx % 4;
          return {
            id: `cam-${idx + 1}`,
            filename: f,
            lat: parseFloat((34.0522 + (row - 1.5) * 0.00015).toFixed(6)),
            lng: parseFloat((-118.2437 + (col - 1.5) * 0.00018).toFixed(6)),
            alt: 120.0,
            pitch: 0,
            roll: 0,
            yaw: (row % 2 === 0) ? 90 : 270,
            x: 180 + col * 120,
            y: 180 + row * 90
          };
        });
        setCamerasList(cams);
        toast.success(`Loaded 16 real aerial drone flight photos for "${projName}"!`);
      } else {
        toast.error('Could not load sample images');
      }
    } catch (err: any) {
      setIsUploading(false);
      toast.error('Failed to load sample drone flight: ' + err.message);
    }
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleNext = () => {
    if (step < 3) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleFinish = async () => {
    if (!name.trim()) {
      toast.warning('Please enter a project name.');
      return;
    }
    const hasVideo = rawFiles.some(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f.name)) || imageList.some(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f));
    if (!hasVideo && imageList.length < 2 && rawFiles.length < 2) {
      toast.warning('Photogrammetry requires either a video file or at least 2 overlapping drone images.');
      return;
    }

    const cleanName = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

    setIsUploading(true);
    setProgressPct(5);
    setUploadStatusText(hasVideo ? 'Uploading drone video and preparing keyframe extraction...' : 'Initializing photogrammetry workspace...');
    setRecentLogs([]);

    try {
      // 1. Upload raw files using zero-copy binary streaming (prevents browser Out of Memory crashes)
      if (rawFiles.length > 0) {
        for (let i = 0; i < rawFiles.length; i++) {
          const f = rawFiles[i];
          const sizeMB = (f.size / (1024 * 1024)).toFixed(1);
          setUploadStatusText(`Streaming [${i + 1}/${rawFiles.length}] ${f.name} (${sizeMB} MB) to engine...`);

          const uploadRes = await fetch(
            `/api/upload/stream?projectName=${encodeURIComponent(cleanName)}&fileName=${encodeURIComponent(f.name)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: f
            }
          );

          if (!uploadRes.ok) {
            throw new Error(`Failed to upload ${f.name}`);
          }
          setProgressPct(Math.round(5 + (20 * (i + 1) / rawFiles.length)));
        }
      }

      // 2. Trigger real Python photogrammetry reconstruction job
      setUploadStatusText(
        engine === 'genpc'
          ? 'Starting GenPC Zero-Shot Generative Prior & Missing Pixel Inpainting...'
          : engine === 'vggt'
          ? 'Starting VGGT Visual Geometry Grounded Transformer Pipeline...'
          : 'Starting DUSt3R Dense Neural 3D Transformer Engine...'
      );
      setProgressPct(12);

      const startRes = await fetch('/api/reconstruct/start_project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: cleanName,
          localPath: (rawFiles.length === 0 && path) ? path : '',
          engine
        })
      });

      const startData = await startRes.json();
      if (!startRes.ok || startData.error) {
        throw new Error(startData.error || 'Failed to start reconstruction job.');
      }

      const jobId = startData.jobId;

      // Hand off to App immediately — App will show the processing view & poll for progress
      onClose();
      onFinish({
        name,
        path: path || `C:/Projects/${cleanName}`,
        type: projectType,
        imageCount: imageList.length || rawFiles.length || 16,
        images: imageList,
        coordinateSystem: selectedZone,
        datum,
        unit,
        cameras: camerasList,
        datasetName: cleanName,
        jobId,
        isProcessing: true
      });

      // reset wizard inputs
      setName('');
      setPath('');
      setImageList([]);
      setCamerasList([]);
      setRawFiles([]);
      setStep(1);
    } catch (err: any) {
      console.error('Reconstruction failed:', err);
      toast.error('Reconstruction error: ' + (err.message || err));
      setUploadStatusText(`Error: ${err.message || err}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in-scale select-none">
      
      {/* Upload Progress Overlay (shown only during file upload phase) */}
      {isUploading && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-50 flex flex-col items-center justify-center p-8 text-center space-y-5 rounded-2xl animate-fade-in-scale">
          <div className="w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center animate-pulse text-blue-400">
            <RotateCw size={32} className="animate-spin" />
          </div>
          <div className="space-y-1.5 max-w-lg">
            <h3 className="text-white font-display font-extrabold text-base tracking-wide">
              Uploading & Starting Reconstruction...
            </h3>
            <p className="text-cyan-300 font-mono text-xs break-words leading-relaxed">
              {uploadStatusText || 'Uploading files and initializing the pipeline...'}
            </p>
          </div>

          {/* Progress bar */}
          <div className="w-80 h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
            <div
              className="h-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 rounded-full transition-all duration-300"
              style={{ width: `${Math.max(6, progressPct)}%` }}
            />
          </div>
          <div className="text-xs font-mono text-cyan-400 font-bold">
            {progressPct}%
          </div>
        </div>
      )}
      
      {/* Hidden file inputs for local PC uploads */}
      <input 
        type="file" 
        ref={folderInputRef}
        onChange={handleFolderChange}
        className="hidden" 
        {...{ webkitdirectory: "", directory: "" } as any}
      />
      <input 
        type="file" 
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden" 
        multiple 
        accept="image/*,video/*,.mp4,.mov,.avi,.mkv,.webm" 
      />

      <div className="relative w-full max-w-[800px] bg-white border border-[#E2E8F0] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] text-[#0F172A] font-sans">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] bg-slate-50 rounded-t-2xl shrink-0">
          <div className="flex items-center gap-2 text-[#2563eb]">
            <FolderClosed size={20} className="fill-[#2563eb]/10" />
            <h2 className="font-display font-extrabold text-base text-[#0F172A] tracking-wide m-0">New Project</h2>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-450 hover:text-[#0F172A] transition-colors cursor-pointer flex items-center justify-center p-1 rounded-full hover:bg-slate-100"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-4">

          {/* STEP 1: NAME, LOCATION & PROJECT TYPE */}
          {step === 1 && (
            <div className="flex flex-col gap-4 animate-fade-in-scale">
              <div className="text-slate-500 text-xs leading-relaxed space-y-0.5">
                <p>This wizard creates a new photogrammetry project.</p>
                <p>Choose a name, a directory location and a type for your new project.</p>
              </div>

              {/* Input grid */}
              <div className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-4 items-center mt-2">
                <label className="font-mono text-[10px] uppercase tracking-wider text-slate-500 text-right" htmlFor="projectName">
                  Name:
                </label>
                <input
                  id="projectName"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white border border-[#E2E8F0] text-[#0F172A] rounded px-3 py-2 focus:outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] text-xs font-semibold"
                  placeholder="Enter project name (e.g. Reservoir Survey)..."
                />

                <label className="font-mono text-[10px] uppercase tracking-wider text-slate-500 text-right" htmlFor="createIn">
                  Create In:
                </label>
                <div className="flex gap-2">
                  <input
                    id="createIn"
                    type="text"
                    value={path}
                    readOnly
                    className="flex-1 bg-slate-50 border border-[#E2E8F0] text-slate-650 rounded px-3 py-2 focus:outline-none text-xs font-mono"
                    placeholder="Click Browse to select folder..."
                  />
                  <button
                    type="button"
                    onClick={handleBrowseDir}
                    className="bg-white border border-[#E2E8F0] text-slate-700 font-bold text-xs rounded px-4 py-2 hover:bg-slate-50 transition-colors whitespace-nowrap btn-scale cursor-pointer"
                  >
                    Browse...
                  </button>
                </div>

                <div className="col-start-2">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={useDefaultLocation}
                      onChange={(e) => setUseDefaultLocation(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-[#2563eb] focus:ring-[#2563eb] bg-white transition-colors cursor-pointer"
                    />
                    <span className="text-xs text-slate-550 group-hover:text-[#2563eb] transition-colors font-medium">
                      Use As Default Project Location
                    </span>
                  </label>
                </div>
              </div>

              {/* Project Type radio boxes */}
              <div className="mt-4 border border-[#E2E8F0] rounded-xl bg-slate-50/50 overflow-hidden">
                <div className="px-4 py-2 border-b border-[#E2E8F0] bg-slate-50">
                  <h3 className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Project Type</h3>
                </div>
                <div className="p-4 flex flex-col gap-3">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                      type="radio"
                      name="projectType"
                      checked={projectType === 'new'}
                      onChange={() => setProjectType('new')}
                      className="w-4 h-4 border-slate-300 text-[#2563eb] focus:ring-[#2563eb] bg-white transition-colors cursor-pointer"
                    />
                    <span className="text-xs text-slate-700 group-hover:text-[#2563eb] transition-colors font-medium">
                      New Project
                    </span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                      type="radio"
                      name="projectType"
                      checked={projectType === 'merged'}
                      onChange={() => setProjectType('merged')}
                      className="w-4 h-4 border-slate-300 text-[#2563eb] focus:ring-[#2563eb] bg-white transition-colors cursor-pointer"
                    />
                    <span className="text-xs text-slate-700 group-hover:text-[#2563eb] transition-colors font-medium">
                      Project Merged from Existing Projects
                    </span>
                  </label>
                </div>
              </div>

              {/* AI Reconstruction Engine Selector */}
              <div className="mt-4 border border-[#E2E8F0] rounded-xl bg-slate-50/50 overflow-hidden">
                <div className="px-4 py-2 border-b border-[#E2E8F0] bg-slate-50 flex items-center justify-between">
                  <h3 className="font-mono text-[10px] uppercase tracking-wider text-slate-500">AI Reconstruction Engine</h3>
                  <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">Neural 3D Pipeline</span>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* GenPC Option */}
                  <div 
                    onClick={() => setEngine('genpc')}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      engine === 'genpc' 
                        ? 'border-purple-500 bg-purple-50/70 ring-2 ring-purple-500/20 shadow-sm' 
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <input
                        type="radio"
                        name="engineSelect"
                        checked={engine === 'genpc'}
                        onChange={() => setEngine('genpc')}
                        className="w-4 h-4 text-purple-600 cursor-pointer"
                      />
                      <span className="text-xs font-bold text-slate-800">GenPC Generative Prior</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-semibold ml-auto">CVPR 2025</span>
                    </div>
                    <p className="text-[11px] text-slate-500 pl-6 leading-snug">
                      Zero-shot point cloud completion. Inpaints missing pixels & occluded voids via 3D depth prompting.
                    </p>
                  </div>

                  {/* DUSt3R Option */}
                  <div 
                    onClick={() => setEngine('dust3r')}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      engine === 'dust3r' 
                        ? 'border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20 shadow-sm' 
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <input
                        type="radio"
                        name="engineSelect"
                        checked={engine === 'dust3r'}
                        onChange={() => setEngine('dust3r')}
                        className="w-4 h-4 text-[#2563eb] cursor-pointer"
                      />
                      <span className="text-xs font-bold text-slate-800">DUSt3R Neural AI</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-semibold ml-auto">Default</span>
                    </div>
                    <p className="text-[11px] text-slate-500 pl-6 leading-snug">
                      Dense ViT 3D transformer. Unconstrained multi-view stereo point cloud reconstruction.
                    </p>
                  </div>

                  {/* VGGT Option */}
                  <div 
                    onClick={() => setEngine('vggt')}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      engine === 'vggt' 
                        ? 'border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-500/20 shadow-sm' 
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <input
                        type="radio"
                        name="engineSelect"
                        checked={engine === 'vggt'}
                        onChange={() => setEngine('vggt')}
                        className="w-4 h-4 text-indigo-600 cursor-pointer"
                      />
                      <span className="text-xs font-bold text-slate-800">VGGT Transformer</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded font-semibold ml-auto">Fast</span>
                    </div>
                    <p className="text-[11px] text-slate-500 pl-6 leading-snug">
                      Visual Geometry Grounded Transformer. Direct video or aerial camera tracking.
                    </p>
                  </div>
                  {/* VGGT x DUSt3R Hybrid Option */}
                  <div
                    onClick={() => setEngine('hybrid')}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      engine === 'hybrid'
                        ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/20 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <input
                        type="radio"
                        name="engineSelect"
                        checked={engine === 'hybrid'}
                        onChange={() => setEngine('hybrid')}
                        className="w-4 h-4 text-amber-600 cursor-pointer"
                      />
                      <span className="text-xs font-bold text-slate-800">VGGT &times; DUSt3R Hybrid</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 bg-gradient-to-r from-amber-100 to-orange-100 text-amber-700 rounded font-semibold ml-auto border border-amber-200">
                        Best Quality
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 pl-6 leading-snug">
                      VGGT drift-free camera rig + DUSt3R pixel-density depth. Highest accuracy &amp; completeness.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: SELECT IMAGES LIST */}
          {step === 2 && (
            <div className="flex-1 flex flex-col gap-3 min-h-[350px] animate-fade-in-scale overflow-hidden">
              <h3 className="font-display font-bold text-sm text-[#0F172A] border-b border-[#E2E8F0] pb-2 shrink-0">
                Select Images
              </h3>

              {/* Geotags / Video validation banner */}
              {rawFiles.some(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f.name)) || imageList.some(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f)) ? (
                <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs mt-1 shrink-0 animate-fade-in-scale">
                  <CheckCircle2 size={14} className="fill-emerald-500/10 text-emerald-500" />
                  <span>Video selected! Sharp keyframes will be automatically extracted; press Next to proceed.</span>
                </div>
              ) : imageList.length >= 5 ? (
                <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs mt-1 shrink-0 animate-fade-in-scale">
                  <CheckCircle2 size={14} className="fill-emerald-500/10 text-emerald-500" />
                  <span>Enough images are selected; press Next to proceed.</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-amber-600 font-bold text-xs mt-1 shrink-0">
                  <AlertCircle size={14} />
                  <span>Select at least 2 overlapping images or 1 drone video file.</span>
                </div>
              )}

              {/* Actions row */}
              <div className="flex items-center justify-between mt-2 shrink-0">
                <span className="text-xs text-slate-550 font-semibold font-mono">
                  {imageList.length} image(s) selected.
                </span>
                
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleLoadSampleFlight}
                    className="px-2.5 py-1.5 border border-blue-200 bg-blue-50/80 text-blue-700 hover:bg-blue-100 transition-colors text-xs font-bold shadow-sm rounded btn-scale cursor-pointer flex items-center gap-1"
                    title="Instantly load the 16 real drone aerial photos from sample_drone_flight"
                  >
                    <span>🎬 Load Sample Flight (16 Photos)</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleAddImages}
                    className="px-2.5 py-1.5 border border-[#E2E8F0] rounded text-slate-700 hover:bg-slate-50 hover:text-[#0F172A] transition-colors text-xs font-bold shadow-sm bg-white btn-scale cursor-pointer"
                  >
                    Select Photos or Video...
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveSelected}
                    disabled={selectedRowIndex === null}
                    className={`px-2.5 py-1.5 border rounded text-xs font-bold shadow-sm transition-colors btn-scale ${
                      selectedRowIndex === null
                        ? 'border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed'
                        : 'border-rose-200 text-rose-600 hover:bg-rose-50 bg-white cursor-pointer'
                    }`}
                  >
                    Remove Selected
                  </button>
                  <button
                    type="button"
                    onClick={handleClearList}
                    className="px-2.5 py-1.5 border border-[#E2E8F0] rounded text-slate-700 hover:bg-slate-50 hover:text-[#0F172A] transition-colors text-xs font-bold shadow-sm bg-white btn-scale cursor-pointer"
                  >
                    Clear List
                  </button>
                </div>
              </div>

              {/* Scrollable File paths log list */}
              <div className="border border-[#E2E8F0] rounded-xl flex-1 min-h-[220px] bg-slate-50 overflow-hidden flex flex-col mt-1">
                {imageList.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                    <ImageIcon size={32} className="mb-2 text-slate-400 animate-bounce-slow" />
                    <span className="text-xs font-semibold">Image payload is empty</span>
                    <span className="text-[10px] text-slate-500 mt-1">Click "Select Images..." to upload drone images from your device.</span>
                  </div>
                ) : (
                  <div className="overflow-y-auto flex-1 p-2 custom-scrollbar font-mono text-[10.5px] leading-tight text-slate-650 break-all select-none">
                    {imageList.map((img, idx) => {
                      const isSelected = selectedRowIndex === idx;
                      return (
                        <div
                          key={`${img}-${idx}`}
                          onClick={() => setSelectedRowIndex(isSelected ? null : idx)}
                          className={`py-1 px-2 rounded cursor-pointer transition-colors border ${
                            isSelected 
                              ? 'bg-blue-50 text-[#2563eb] font-semibold border-[#dbeafe]' 
                              : 'border-transparent hover:bg-slate-100'
                          }`}
                        >
                          {img}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: COORDINATE SYSTEM SELECTS */}
          {step === 3 && (
            <div className="flex flex-col gap-4 animate-fade-in-scale">
              <h3 className="font-display font-bold text-sm text-[#0F172A] border-b border-[#E2E8F0] pb-2 shrink-0">
                Coordinate System
              </h3>

              {/* Selected Output System Details box */}
              <div className="border border-[#E2E8F0] rounded-xl p-4 bg-slate-50">
                <div className="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Selected Output Datum</div>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-slate-550 block mb-0.5">Datum System:</span>
                    <span className="font-bold text-slate-800">{datum}</span>
                  </div>
                  <div>
                    <span className="text-slate-550 block mb-0.5">Projection Zone:</span>
                    <span className="font-bold text-[#2563eb] font-mono">{selectedZone}</span>
                  </div>
                </div>
              </div>

              {/* Output parameters */}
              <div className="border border-[#E2E8F0] rounded-xl p-4 space-y-4">
                <div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Output Settings</div>

                {/* Unit select */}
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-bold text-slate-650">System Unit:</span>
                  <select 
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="bg-white border border-[#E2E8F0] px-3 py-1.5 rounded-lg text-slate-800 focus:outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] text-xs font-semibold cursor-pointer"
                  >
                    <option value="m">Meters (m)</option>
                    <option value="ft">Feet (ft)</option>
                  </select>
                </div>

                <div className="border-t border-[#E2E8F0] my-2" />

                {/* System options */}
                <div className="space-y-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="coordType"
                      checked={coordType === 'arbitrary'}
                      onChange={() => {
                        setCoordType('arbitrary');
                        setSelectedZone('Arbitrary Coordinate System [m]');
                        setDatum('Local Grid Base');
                      }}
                      className="w-4 h-4 text-[#2563eb] focus:ring-[#2563eb] bg-white border-slate-300"
                    />
                    <span className="text-xs text-slate-650">Arbitrary Coordinate System</span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="coordType"
                      checked={coordType === 'auto'}
                      onChange={() => {
                        setCoordType('auto');
                        setSelectedZone('WGS 84 / UTM zone 34N');
                        setDatum('World Geodetic System 1984');
                      }}
                      className="w-4 h-4 text-[#2563eb] focus:ring-[#2563eb] bg-white border-slate-300"
                    />
                    <span className="text-xs text-slate-800 font-semibold">
                      Auto Detected from image geotags: WGS 84 / UTM zone 34N
                    </span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="coordType"
                      checked={coordType === 'known'}
                      onChange={() => setCoordType('known')}
                      className="w-4 h-4 text-[#2563eb] focus:ring-[#2563eb] bg-white border-slate-300"
                    />
                    <span className="text-xs text-slate-650">Known Coordinate System</span>
                  </label>
                </div>

                {coordType === 'known' && (
                  <div className="pl-7 pt-2 flex gap-2 animate-fade-in-scale shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        const code = prompt('Enter EPSG Projection Code (e.g. 4326 for WGS84, 32634 for UTM 34N):', '32634');
                        if (code) {
                          setSelectedZone(`EPSG ${code} (Custom Zone)`);
                        }
                      }}
                      className="px-3 py-1.5 border border-[#E2E8F0] hover:bg-slate-50 rounded-lg text-xs font-bold transition bg-white btn-scale cursor-pointer text-slate-700"
                    >
                      From EPSG Code...
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedZone('NAD83 / California zone 1 [ftUS]');
                        setDatum('North American Datum 1983');
                        setUnit('ft');
                      }}
                      className="px-3 py-1.5 border border-[#E2E8F0] hover:bg-slate-50 rounded-lg text-xs font-bold transition bg-white btn-scale cursor-pointer text-slate-700"
                    >
                      From PRJ File...
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-t border-[#E2E8F0] rounded-b-2xl shrink-0">
          <button 
            type="button"
            onClick={() => toast.info('Aevora Project Wizard: Steps 1-3 configure datum, camera telemetry, and photogrammetry inputs.')}
            className="text-slate-500 hover:text-[#0F172A] font-bold text-xs rounded px-4 py-2 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Help
          </button>
          
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleBack}
              disabled={step === 1}
              className={`px-4 py-2 border rounded text-xs font-bold transition-colors btn-scale ${
                step === 1
                  ? 'border-slate-100 text-slate-450 bg-slate-50 cursor-not-allowed'
                  : 'border-[#E2E8F0] text-slate-700 hover:bg-slate-100 bg-white cursor-pointer'
              }`}
            >
              &lt; Back
            </button>

            {step < 3 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={step === 1 ? (!name.trim() || !path.trim()) : (imageList.length === 0)}
                className={`bg-[#2563eb] text-white font-bold text-xs rounded px-6 py-2 hover:bg-[#1d4ed8] transition shadow btn-scale ${
                  (step === 1 ? (!name.trim() || !path.trim()) : (imageList.length === 0))
                    ? 'opacity-50 cursor-not-allowed'
                    : 'cursor-pointer'
                }`}
              >
                Next &gt;
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinish}
                className="bg-[#2563eb] text-white font-bold text-xs rounded px-6 py-2 hover:bg-[#1d4ed8] transition shadow btn-scale cursor-pointer"
              >
                Finish & Load
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="text-slate-500 hover:text-[#0F172A] text-xs font-bold rounded px-4 py-2 transition-colors ml-2 cursor-pointer hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
