import React, { useState, useRef } from 'react';
import { 
  FolderClosed, 
  Image as ImageIcon, 
  X, 
  CheckCircle2, 
  AlertCircle
} from 'lucide-react';
import type { CameraTelemetry } from '../types';

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
  const [useDefaultLocation, setUseDefaultLocation] = useState(false);

  // Step 2: Selected Images
  const [imageList, setImageList] = useState<string[]>([]);
  const [camerasList, setCamerasList] = useState<CameraTelemetry[]>([]);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

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
      const relativePath = files[0].webkitRelativePath || files[0].name;
      const folderName = relativePath.split('/')[0] || 'SelectedProjectFolder';
      setPath(`C:/Projects/${folderName}`);
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
      const newImageNames: string[] = [];
      const newCameras: CameraTelemetry[] = [];
      const fileList = Array.from(files);
      let parsedCount = 0;

      fileList.forEach((file, index) => {
        newImageNames.push(file.name);
        const fileUrl = URL.createObjectURL(file);

        const EXIF = (window as any).EXIF;
        if (EXIF) {
          EXIF.getData(file, function(this: any) {
            const latDMS = EXIF.getTag(this, "GPSLatitude");
            const latRef = EXIF.getTag(this, "GPSLatitudeRef");
            const lngDMS = EXIF.getTag(this, "GPSLongitude");
            const lngRef = EXIF.getTag(this, "GPSLongitudeRef");
            const altVal = EXIF.getTag(this, "GPSAltitude");

            let lat = 34.0522;
            let lng = -118.2437;
            let alt = 120.0;

            if (latDMS && lngDMS) {
              lat = convertDMSToDD(latDMS, latRef);
              lng = convertDMSToDD(lngDMS, lngRef);
            } else {
              const row = Math.floor(index / 6);
              const col = index % 6;
              lat = 34.0522 + (row - 2) * 0.00015 + (Math.random() - 0.5) * 0.00002;
              lng = -118.2437 + (col - 3) * 0.00018 + (Math.random() - 0.5) * 0.00002;
            }

            if (altVal) {
              alt = typeof altVal === 'number' ? altVal : parseFloat((altVal.numerator / altVal.denominator).toFixed(1));
            } else {
              alt = 120.0 + (Math.random() - 0.5) * 6;
            }

            const pitch = (Math.random() - 0.5) * 3.5;
            const roll = (Math.random() - 0.5) * 2.5;
            const yaw = (index % 2 === 0) ? 90 + (Math.random() - 0.5) * 1.5 : 270 + (Math.random() - 0.5) * 1.5;

            const x = 150 + (index % 6) * 120;
            const y = 180 + Math.floor(index / 6) * 90;

            newCameras.push({
              id: `cam-${index + 1}`,
              filename: file.name,
              lat: parseFloat(lat.toFixed(6)),
              lng: parseFloat(lng.toFixed(6)),
              alt: parseFloat(alt.toFixed(2)),
              pitch: parseFloat(pitch.toFixed(1)),
              roll: parseFloat(roll.toFixed(1)),
              yaw: parseFloat(yaw.toFixed(1)),
              x,
              y,
              imageUrl: fileUrl
            });

            parsedCount++;
            if (parsedCount === fileList.length) {
              setCamerasList(newCameras);
            }
          });
        } else {
          const row = Math.floor(index / 6);
          const col = index % 6;
          const lat = 34.0522 + (row - 2) * 0.00015 + (Math.random() - 0.5) * 0.00002;
          const lng = -118.2437 + (col - 3) * 0.00018 + (Math.random() - 0.5) * 0.00002;
          const alt = 120.0 + (Math.random() - 0.5) * 6;

          newCameras.push({
            id: `cam-${index + 1}`,
            filename: file.name,
            lat: parseFloat(lat.toFixed(6)),
            lng: parseFloat(lng.toFixed(6)),
            alt: parseFloat(alt.toFixed(2)),
            pitch: 0,
            roll: 0,
            yaw: 0,
            x: 150 + (index % 6) * 120,
            y: 180 + Math.floor(index / 6) * 90,
            imageUrl: fileUrl
          });

          parsedCount++;
          if (parsedCount === fileList.length) {
            setCamerasList(newCameras);
          }
        }
      });

      setImageList(newImageNames);
    }
  };

  const handleRemoveSelected = () => {
    if (selectedRowIndex !== null) {
      setImageList(prev => prev.filter((_, idx) => idx !== selectedRowIndex));
      setCamerasList(prev => prev.filter((_, idx) => idx !== selectedRowIndex));
      setSelectedRowIndex(null);
    } else {
      alert('Click on an image path in the list below to select and remove it.');
    }
  };

  const handleClearList = () => {
    setImageList([]);
    setCamerasList([]);
    setSelectedRowIndex(null);
  };

  const handleNext = () => {
    if (step < 3) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleFinish = () => {
    if (!name.trim()) {
      alert('Please enter a project name.');
      return;
    }
    if (!path.trim()) {
      alert('Please select or specify a project path.');
      return;
    }

    onFinish({
      name,
      path,
      type: projectType,
      imageCount: imageList.length,
      images: imageList,
      coordinateSystem: selectedZone,
      datum,
      unit,
      cameras: camerasList
    });
    
    // reset wizard inputs
    setName('');
    setPath('');
    setImageList([]);
    setCamerasList([]);
    setStep(1);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in-scale select-none">
      
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
        accept="image/*" 
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
            </div>
          )}

          {/* STEP 2: SELECT IMAGES LIST */}
          {step === 2 && (
            <div className="flex-1 flex flex-col gap-3 min-h-[350px] animate-fade-in-scale overflow-hidden">
              <h3 className="font-display font-bold text-sm text-[#0F172A] border-b border-[#E2E8F0] pb-2 shrink-0">
                Select Images
              </h3>

              {/* Geotags validation banner */}
              {imageList.length >= 5 ? (
                <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs mt-1 shrink-0 animate-fade-in-scale">
                  <CheckCircle2 size={14} className="fill-emerald-500/10 text-emerald-500" />
                  <span>Enough images are selected; press Next to proceed.</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-rose-600 font-bold text-xs mt-1 shrink-0">
                  <AlertCircle size={14} />
                  <span>Geotag check: Please select at least 5 cameras to resolve block parameters.</span>
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
                    onClick={handleAddImages}
                    className="px-2.5 py-1.5 border border-[#E2E8F0] rounded text-slate-700 hover:bg-slate-50 hover:text-[#0F172A] transition-colors text-xs font-bold shadow-sm bg-white btn-scale cursor-pointer"
                  >
                    Select Images...
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
            onClick={() => alert('Wizard details.')}
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
