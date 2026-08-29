import { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { ProjectWizard } from './components/ProjectWizard';
import { MapPanel } from './components/MapPanel';
import { RayCloudPanel } from './components/RayCloudPanel';
import { VolumesPanel } from './components/VolumesPanel';
import { MeshViewerPanel } from './components/MeshViewerPanel';
import type { Project, CameraTelemetry } from './types';
import { MOCK_PROJECTS } from './types';
import { 
  FolderClosed, 
  Settings, 
  HardDrive,
  Clock,
  ChevronRight,
  Calendar,
  Layers2,
  Search,
  Globe,
  Trash2
} from 'lucide-react';
import heroScanBg from './assets/hero_scan_bg.png';
import bridgeWireframe from './assets/bridge_wireframe.png';
import stockpileDem from './assets/stockpile_dem.png';
import concreteDamage from './assets/concrete_damage.png';
import solarOverhang from './assets/solar_overhang.png';

export default function App() {
  const [currentView, setCurrentView] = useState<string>('home');
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  
  // Auth states
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<{ email: string; name: string } | null>(null);

  // Wizard Modal Triggers
  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false);
  const [projectList, setProjectList] = useState<Project[]>(MOCK_PROJECTS);

  const isWorkspaceView = ['dashboard', 'map', 'raycloud', 'mesh', 'volumes', 'processing'].includes(currentView);

  // Ensure dark class is removed on mount
  useEffect(() => {
    window.document.documentElement.classList.remove('dark');
  }, []);

  const handleOpenProjectSelect = () => {
    const pNames = projectList.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
    const choice = prompt(`Select project index to open:\n\n${pNames}`, '1');
    if (choice) {
      const idx = parseInt(choice) - 1;
      if (idx >= 0 && idx < projectList.length) {
        handleLoadProject(projectList[idx]);
      } else {
        alert('Invalid index choice.');
      }
    }
  };

  const handleLoadProject = (project: Project) => {
    setActiveProject(project);
    setCurrentView('map'); 
  };

  const handleCreateProject = (projectData: {
    name: string;
    path: string;
    type: 'new' | 'merged';
    imageCount: number;
    images: string[];
    coordinateSystem: string;
    datum: string;
    unit: string;
    cameras?: CameraTelemetry[];
  }) => {
    const newProj: Project = {
      id: `proj-${projectList.length + 1}`,
      name: projectData.name,
      path: projectData.path,
      type: projectData.type,
      imageCount: projectData.imageCount,
      images: projectData.images,
      coordinateSystem: projectData.coordinateSystem,
      datum: projectData.datum,
      unit: projectData.unit,
      cameras: projectData.cameras,
      createdAt: new Date().toISOString().slice(0, 16).replace('T', ' ')
    };

    setProjectList([newProj, ...projectList]);
    handleLoadProject(newProj);
  };

  const handleProcessingComplete = (jobId?: string) => {
    if (activeProject) {
      const updatedProject = { ...activeProject, isProcessed: true, jobId };
      setActiveProject(updatedProject);
      setProjectList(prev => prev.map(p => p.id === activeProject.id ? updatedProject : p));
      alert('VGGT + DUSt3R Hybrid Reconstruction completed! 3D Point Cloud and DSM are now generated.');
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#F8FAFC] text-[#0F172A] transition-colors duration-200">
      
      {/* Navbar component */}
      {isWorkspaceView && (
        <Navbar
          activeProjectName={activeProject ? activeProject.name : null}
          onNewProjectClick={() => setIsWizardOpen(true)}
          onOpenProjectClick={handleOpenProjectSelect}
        />
      )}

      {/* Main Layout Content */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Sidebar Navigation */}
        {isWorkspaceView && (
          <Sidebar
            currentView={currentView}
            setCurrentView={setCurrentView}
            hasActiveProject={activeProject !== null}
            onSignOut={() => {
              setIsLoggedIn(false);
              setCurrentUser(null);
              setActiveProject(null);
              setCurrentView('home');
              alert('Signed out successfully.');
            }}
          />
        )}

        {/* View Workspace Container */}
        <main className={`flex-1 relative bg-[#F8FAFC] transition-colors duration-200 ${
          isWorkspaceView ? 'overflow-hidden h-full' : 'overflow-y-auto h-full'
        }`}>
          
          {/* HOME VIEW: CORPORATE LANDING PAGE */}
          {currentView === 'home' && (
            <div className="w-full h-full flex flex-col bg-slate-50 text-slate-900 select-none">
              
              {/* Above the fold: Hero Landing Section */}
              <div 
                className="w-full min-h-screen relative flex flex-col justify-between overflow-hidden bg-cover bg-center shrink-0"
                style={{ backgroundImage: `url(${heroScanBg})` }}
              >
                {/* Dark Overlay for premium look & readability */}
                <div className="absolute inset-0 bg-black/40 backdrop-blur-[0.5px] z-10" />

                {/* Floating Nav Bar */}
                <header className="relative z-30 mt-6 mx-4 sm:mx-8 bg-white/60 backdrop-blur-lg rounded-2xl border border-white/30 shadow-lg px-6 h-16 flex justify-between items-center text-slate-800 select-none">
                  <div className="flex items-center gap-6 lg:gap-8">
                    {/* Logo (Dual Sheared Parallelograms matching screenshot) */}
                    <div 
                      onClick={() => setCurrentView('home')}
                      className="flex items-center gap-2 cursor-pointer font-display font-extrabold text-lg text-slate-900 tracking-tight"
                    >
                      <svg className="h-7 w-7 text-slate-950 fill-current" viewBox="0 0 24 24">
                        <path d="M2 4h18l-3 6H2V4zm3 8h17l-3 6H5v-6z"/>
                      </svg>
                    </div>

                    {/* Nav Links */}
                    <nav className="hidden xl:flex items-center gap-5 lg:gap-6 text-[12px] font-semibold text-slate-700 hover:text-slate-900 transition-colors uppercase tracking-wider">
                      {['AeroMap', 'Site Security', 'Inspection', 'Mapping', 'National Security', 'Industries', 'Products', 'Resources'].map((item) => (
                        <button
                          key={item}
                          onClick={() => {
                            if (['AeroMap', 'Site Security', 'Inspection', 'Mapping', 'National Security'].includes(item)) {
                              const el = document.getElementById('solutions-alternating-section');
                              el?.scrollIntoView({ behavior: 'smooth' });
                            } else if (item === 'Industries' || item === 'Products' || item === 'Resources') {
                              const el = document.getElementById('workflow-section');
                              el?.scrollIntoView({ behavior: 'smooth' });
                            } else {
                              alert(`Navigating to ${item} page...`);
                            }
                          }}
                          className="hover:text-black cursor-pointer transition-colors"
                        >
                          {item}
                        </button>
                      ))}
                    </nav>
                  </div>

                  {/* Right Header Controls */}
                  <div className="flex items-center gap-4 lg:gap-5">
                    <button 
                      onClick={() => alert('Search feature activated.')}
                      className="p-1 hover:bg-slate-100 rounded-full cursor-pointer transition"
                    >
                      <Search size={16} className="text-slate-700" />
                    </button>
                    <div 
                      onClick={() => alert('Selected Region: US')}
                      className="flex items-center gap-1 text-slate-700 cursor-pointer hover:text-black text-xs font-semibold"
                    >
                      <Globe size={15} />
                      <span>US</span>
                    </div>
                    {isLoggedIn ? (
                      <>
                        <button 
                          onClick={() => setCurrentView('dashboard')}
                          className="bg-[#2563eb] text-white hover:bg-blue-700 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer"
                        >
                          Workspace
                        </button>
                        <button 
                          onClick={() => {
                            setIsLoggedIn(false);
                            setCurrentUser(null);
                            alert('Logged out successfully.');
                          }}
                          className="text-slate-700 hover:text-black text-xs font-semibold cursor-pointer"
                        >
                          Log Out
                        </button>
                      </>
                    ) : (
                      <>
                        <button 
                          onClick={() => setCurrentView('signin')}
                          className="text-slate-700 hover:text-black text-xs font-semibold cursor-pointer"
                        >
                          Sign In
                        </button>
                        <button 
                          onClick={() => setCurrentView('signup')}
                          className="bg-[#2563eb] text-white hover:bg-blue-700 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer"
                        >
                          Sign Up
                        </button>
                      </>
                    )}
                  </div>
                </header>

                {/* Hero Main Content */}
                <div className="relative z-20 flex-1 flex flex-col justify-center px-6 sm:px-12 md:px-24 text-white max-w-4xl pt-16">
                  <h1 className="font-display font-extrabold text-4xl sm:text-6xl md:text-7.5xl tracking-tight leading-[1.08] text-white animate-fade-in-scale">
                    Point at the asset.<br />AeroMap does the rest.
                  </h1>
                  <p className="text-sm sm:text-base md:text-lg font-medium text-slate-200 mt-6 max-w-xl leading-relaxed">
                    Autonomous drone inspection of complex structures, buildings, infrastructure, and stockpiles.
                  </p>
                  <div className="mt-8 flex gap-4">
                    <button 
                      onClick={() => {
                        if (isLoggedIn) {
                          setCurrentView('dashboard');
                        } else {
                          setCurrentView('signin');
                        }
                      }}
                      className="bg-[#2563eb] hover:bg-blue-600 text-white font-bold text-xs px-6 py-3.5 rounded-xl transition flex items-center gap-2 cursor-pointer shadow-lg group btn-scale"
                    >
                      <span>Launch Workspace</span>
                      <ChevronRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  </div>
                </div>

                {/* Bottom space/alignment spacer */}
                <div className="relative z-20 h-20 shrink-0" />
              </div>

              {/* Introductory Quote Banner */}
              <div className="w-full bg-[#f1f5f9]/60 border-y border-slate-200 py-16 px-6 sm:px-12 md:px-24 text-center flex justify-center shrink-0">
                <div className="max-w-4xl">
                  <p className="text-base sm:text-lg md:text-xl font-semibold text-slate-800 leading-relaxed font-display">
                    AeroMap 3D Scan is a first-of-its-kind adaptive scanning software that automates data capture of complex structures. It generates complete, high-fidelity datasets with 100% coverage, in a fraction of the time, with minimal training.
                  </p>
                </div>
              </div>

              {/* Section 1: "Built for sites that don't fit into rectangles" */}
              <div 
                id="solutions-alternating-section"
                className="w-full bg-white py-24 px-6 sm:px-12 md:px-24 flex flex-col items-center gap-16 relative z-20 font-sans border-b border-slate-200"
              >
                <div className="text-center max-w-2xl">
                  <h2 className="font-display font-extrabold text-3xl md:text-4xl text-slate-900 tracking-tight leading-tight">
                    Built for sites that don't fit into rectangles
                  </h2>
                </div>

                {/* Alternating rows */}
                <div className="w-full max-w-6xl space-y-24">
                  
                  {/* Row 1: Inspect complex structures */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
                    <div className="space-y-4">
                      <h3 className="font-display font-extrabold text-2xl text-slate-900">Inspect complex structures</h3>
                      <p className="text-slate-500 text-sm leading-relaxed">
                        Map vertical facades, overhangs, and complex geometries with adaptive flight patterns that adjust to the physical structure in real-time.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200/80 overflow-hidden shadow-lg bg-slate-100 aspect-video flex items-center justify-center relative group">
                      <img src={bridgeWireframe} className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300" alt="Complex Structure Wireframe" />
                      <div className="absolute inset-0 bg-[#2563eb]/5 mix-blend-multiply pointer-events-none" />
                    </div>
                  </div>

                  {/* Row 2: Document asset damage */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center lg:flex-row-reverse">
                    <div className="space-y-4 lg:order-last">
                      <h3 className="font-display font-extrabold text-2xl text-slate-900">Document asset damage</h3>
                      <p className="text-slate-500 text-sm leading-relaxed">
                        Capture sub-millimeter level detail of cracks, corrosion, and damage on concrete, steel, and masonry structures without manual flight risks.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200/80 overflow-hidden shadow-lg bg-slate-100 aspect-video flex items-center justify-center relative group">
                      <img src={concreteDamage} className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300" alt="Concrete Damage Pier" />
                    </div>
                  </div>

                  {/* Row 3: Mapping under overhangs */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
                    <div className="space-y-4">
                      <h3 className="font-display font-extrabold text-2xl text-slate-900">Mapping under overhangs</h3>
                      <p className="text-slate-500 text-sm leading-relaxed">
                        Unlike traditional nadir mapping, AeroMap 3D Scan inspects beneath ceilings, solar panel frames, and bridge decks by tilting the camera upwards.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200/80 overflow-hidden shadow-lg bg-slate-100 aspect-video flex items-center justify-center relative group">
                      <img src={solarOverhang} className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300" alt="Solar Overhang Scanning" />
                    </div>
                  </div>

                  {/* Row 4: Calculate accurate volume stockpile */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center lg:flex-row-reverse">
                    <div className="space-y-4 lg:order-last">
                      <h3 className="font-display font-extrabold text-2xl text-slate-900">Calculate accurate volumes</h3>
                      <p className="text-slate-500 text-sm leading-relaxed">
                        Obtain precise volumetric measurements of stockpiles, quarries, excavation pits, and gravel yards automatically.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200/80 overflow-hidden shadow-lg bg-slate-100 aspect-video flex items-center justify-center relative group">
                      <img src={stockpileDem} className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300" alt="Stockpile Volumetric Map" />
                    </div>
                  </div>

                </div>

                {/* Customer Testimonial */}
                <div className="w-full max-w-4xl bg-slate-50/70 backdrop-blur-sm border border-slate-200 rounded-3xl p-8 md:p-12 shadow-md space-y-6 mt-12 text-center">
                  <span className="text-[#2563eb] text-5xl font-serif block leading-none select-none">“</span>
                  <p className="text-slate-700 italic text-base sm:text-lg md:text-xl font-medium leading-relaxed font-display max-w-3xl mx-auto">
                    AeroMap 3D Scan has completely transformed our inspection workflow. We've cut survey compilation times by 75% while achieving 100% scan coverage on critical infrastructure.
                  </p>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Director of Infrastructure Inspections, National Power Grid
                  </div>
                </div>

              </div>

              {/* Section 2: "From asset to dataset" Workflow */}
              <div 
                id="workflow-section"
                className="w-full bg-[#f8fafc] py-24 px-6 sm:px-12 md:px-24 flex flex-col items-center gap-16 relative z-20 font-sans border-b border-slate-200"
              >
                <div className="text-center max-w-2xl">
                  <h2 className="font-display font-extrabold text-3xl text-slate-900 tracking-tight leading-tight uppercase">
                    From asset to dataset
                  </h2>
                </div>

                {/* 3 Step Workflow Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-6xl">
                  
                  {/* Step 1 */}
                  <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm space-y-4 flex flex-col">
                    <span className="text-[10px] font-extrabold text-[#2563eb] uppercase tracking-widest bg-blue-50 border border-blue-100 rounded px-2 w-fit py-0.5">
                      Step 1
                    </span>
                    <h3 className="font-display font-bold text-base text-slate-800">Define Volume</h3>
                    <p className="text-xs text-slate-500 leading-relaxed flex-1">
                      Use the 2D map viewer to set a bounding box around the physical structure, setting vertical floor and ceiling limits.
                    </p>
                    <div className="bg-slate-50 rounded-xl border border-slate-100 aspect-video flex items-center justify-center p-2 mt-4 select-none">
                      <svg className="h-12 w-12 text-[#2563eb]/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 8h8v8H8V8z" />
                      </svg>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm space-y-4 flex flex-col">
                    <span className="text-[10px] font-extrabold text-[#2563eb] uppercase tracking-widest bg-blue-50 border border-blue-100 rounded px-2 w-fit py-0.5">
                      Step 2
                    </span>
                    <h3 className="font-display font-bold text-base text-slate-800">Capture Data</h3>
                    <p className="text-xs text-slate-500 leading-relaxed flex-1">
                      AeroMap's adaptive flight engine generates optimal capture overlap plans and pilots the drone autonomously.
                    </p>
                    <div className="bg-slate-50 rounded-xl border border-slate-100 aspect-video flex items-center justify-center p-2 mt-4 select-none">
                      <svg className="h-12 w-12 text-[#2563eb]/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm space-y-4 flex flex-col">
                    <span className="text-[10px] font-extrabold text-[#2563eb] uppercase tracking-widest bg-blue-50 border border-blue-100 rounded px-2 w-fit py-0.5">
                      Step 3
                    </span>
                    <h3 className="font-display font-bold text-base text-slate-800">Analyze Data</h3>
                    <p className="text-xs text-slate-500 leading-relaxed flex-1">
                      Export image datasets directly to the photogrammetry engine to build 3D mesh block models.
                    </p>
                    <div className="bg-slate-50 rounded-xl border border-slate-100 aspect-video flex items-center justify-center p-2 mt-4 select-none">
                      <svg className="h-12 w-12 text-[#2563eb]/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                      </svg>
                    </div>
                  </div>

                </div>
              </div>

              {/* Section 3: "Export ready for photogrammetry" */}
              <div className="w-full bg-white py-24 px-6 sm:px-12 md:px-24 flex flex-col items-center gap-12 relative z-20 font-sans border-b border-slate-200">
                <div className="text-center max-w-2xl space-y-4">
                  <h2 className="font-display font-extrabold text-3xl text-slate-900 tracking-tight leading-tight">
                    Export ready for photogrammetry.
                  </h2>
                  <p className="text-slate-500 text-xs leading-relaxed max-w-xl">
                    AeroMap 3D Scan outputs geo-referenced image datasets that are 100% compatible with major engines like Pix4D, Bentley ContextCapture, RealityCapture, and our internal AeroMap engine.
                  </p>
                </div>

                {/* Integration Logos row */}
                <div className="flex flex-wrap items-center justify-center gap-8 lg:gap-12 opacity-50 select-none pb-8 border-b border-slate-100 w-full max-w-4xl">
                  <span className="font-display font-extrabold text-sm tracking-widest text-slate-500">PIX4D</span>
                  <span className="font-display font-bold text-sm tracking-wider text-slate-500 italic">Bentley</span>
                  <span className="font-mono font-bold text-sm text-slate-500 uppercase tracking-widest">RealityCapture</span>
                  <span className="font-sans font-bold text-sm text-slate-500 uppercase tracking-wider">ESRI</span>
                </div>

                {/* Mockup Layout Preview */}
                <div className="w-full max-w-5xl bg-[#f8fafc] border border-slate-200 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-slate-200/80 pb-4 mb-4 select-none">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                    <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                    <span className="text-[9.5px] font-mono text-slate-400 ml-2">AeroMap 3D Survey Workspace Panel</span>
                  </div>
                  
                  {/* Map mockup illustration */}
                  <div className="w-full aspect-video rounded-xl bg-slate-200 border border-slate-350 relative overflow-hidden flex flex-col justify-between p-4">
                    <div className="absolute inset-0 bg-[#e2e8f0] opacity-40 bg-grid-pattern" />
                    
                    {/* Bounding box outline */}
                    <div className="absolute top-[20%] left-[25%] w-[45%] h-[55%] border-2 border-dashed border-[#2563eb] rounded-lg bg-blue-500/10 flex items-center justify-center z-10 animate-pulse">
                      <span className="text-[10px] font-mono font-bold text-[#2563eb] bg-white border border-blue-200 px-2 py-0.5 rounded shadow">
                        Active Bounding Box Volume
                      </span>
                    </div>

                    {/* Camera points */}
                    <div className="absolute top-[15%] left-[20%] w-3 h-3 rounded-full bg-[#2563eb] border border-white shadow" />
                    <div className="absolute top-[18%] left-[75%] w-3 h-3 rounded-full bg-[#2563eb] border border-white shadow" />
                    <div className="absolute top-[80%] left-[45%] w-3 h-3 rounded-full bg-[#2563eb] border border-white shadow" />
                    <div className="absolute top-[50%] left-[15%] w-3 h-3 rounded-full bg-[#2563eb] border border-white shadow" />
                    <div className="absolute top-[40%] left-[80%] w-3 h-3 rounded-full bg-[#2563eb] border border-white shadow" />

                    <div className="flex justify-between items-start z-10 select-none">
                      <div className="bg-white/90 backdrop-blur-sm border border-slate-250 p-2.5 rounded-lg shadow-md space-y-1.5 w-44">
                        <div className="text-[9px] font-bold text-slate-400 uppercase">Geotag Data</div>
                        <div className="text-[10.5px] font-mono font-bold text-slate-800">42 Images Selected</div>
                        <div className="text-[9px] font-mono text-slate-500">EPSG:4326 Datum Projection</div>
                      </div>

                      <div className="bg-white/90 backdrop-blur-sm border border-slate-250 p-2.5 rounded-lg shadow-md space-y-1 w-32 text-right">
                        <div className="text-[9px] font-bold text-slate-400 uppercase">Coverage</div>
                        <div className="text-xs font-bold text-emerald-600">100% Matched</div>
                      </div>
                    </div>

                    <div className="flex justify-end z-10 select-none">
                      <button 
                        onClick={() => {
                          if (isLoggedIn) {
                            setCurrentView('dashboard');
                          } else {
                            setCurrentView('signin');
                          }
                        }}
                        className="bg-slate-950 text-white hover:bg-slate-800 text-[10.5px] font-bold px-4 py-2 rounded-lg transition shadow cursor-pointer"
                      >
                        Enter Mapping Workspace
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 4: "See what AeroMap Autonomy matches" */}
              <div className="w-full bg-[#f8fafc] py-24 px-6 sm:px-12 md:px-24 flex flex-col items-center gap-16 relative z-20 font-sans border-b border-slate-200">
                <div className="text-center max-w-2xl">
                  <h2 className="font-display font-extrabold text-3xl text-slate-900 tracking-tight leading-tight">
                    See what AeroMap Autonomy matches
                  </h2>
                </div>

                {/* 2x2 grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-5xl">
                  
                  {/* Card 1 */}
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex flex-col">
                    <div className="aspect-video bg-slate-100 border-b border-slate-200 flex items-center justify-center p-8 relative select-none">
                      <svg className="h-16 w-16 text-slate-350" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                      <span className="absolute bottom-2 right-2 text-[9px] font-mono text-slate-400 bg-slate-50 border px-1.5 py-0.5 rounded">3D Point Cloud</span>
                    </div>
                    <div className="p-6 space-y-3 flex-1 flex flex-col justify-between">
                      <div>
                        <h3 className="font-display font-bold text-sm text-slate-800">Bridge columns / piers</h3>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                          Capture column piers and underside deck brackets safely without manual flight risks.
                        </p>
                      </div>
                      <button onClick={() => alert('Bridge scan case study...')} className="text-left text-xs font-bold text-[#2563eb] hover:underline mt-2">
                        Read customer story →
                      </button>
                    </div>
                  </div>

                  {/* Card 2 */}
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex flex-col">
                    <div className="aspect-video bg-slate-100 border-b border-slate-200 flex items-center justify-center p-8 relative select-none">
                      <svg className="h-16 w-16 text-slate-350" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071a9 9 0 0114.14 0M1.34 6.81a13.9 13.9 0 0119.32 0" />
                      </svg>
                      <span className="absolute bottom-2 right-2 text-[9px] font-mono text-slate-400 bg-slate-50 border px-1.5 py-0.5 rounded">3D Point Cloud</span>
                    </div>
                    <div className="p-6 space-y-3 flex-1 flex flex-col justify-between">
                      <div>
                        <h3 className="font-display font-bold text-sm text-slate-800">Telecommunications towers</h3>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                          Full 360-degree point clouds of antennas, high-tension lines, and bracket details.
                        </p>
                      </div>
                      <button onClick={() => alert('Telecom scan case study...')} className="text-left text-xs font-bold text-[#2563eb] hover:underline mt-2">
                        Read customer story →
                      </button>
                    </div>
                  </div>

                  {/* Card 3 */}
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex flex-col">
                    <div className="aspect-video bg-slate-100 border-b border-slate-200 flex items-center justify-center p-8 relative select-none">
                      <svg className="h-16 w-16 text-slate-350" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                      <span className="absolute bottom-2 right-2 text-[9px] font-mono text-slate-400 bg-slate-50 border px-1.5 py-0.5 rounded">3D Point Cloud</span>
                    </div>
                    <div className="p-6 space-y-3 flex-1 flex flex-col justify-between">
                      <div>
                        <h3 className="font-display font-bold text-sm text-slate-800">Commercial building roofs</h3>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                          Document commercial structures, complex HVAC systems, and drainage lines autonomously.
                        </p>
                      </div>
                      <button onClick={() => alert('Commercial roof scan case study...')} className="text-left text-xs font-bold text-[#2563eb] hover:underline mt-2">
                        Read customer story →
                      </button>
                    </div>
                  </div>

                  {/* Card 4 */}
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex flex-col">
                    <div className="aspect-video bg-slate-100 border-b border-slate-200 flex items-center justify-center p-8 relative select-none">
                      <svg className="h-16 w-16 text-slate-350" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span className="absolute bottom-2 right-2 text-[9px] font-mono text-slate-400 bg-slate-50 border px-1.5 py-0.5 rounded">3D Point Cloud</span>
                    </div>
                    <div className="p-6 space-y-3 flex-1 flex flex-col justify-between">
                      <div>
                        <h3 className="font-display font-bold text-sm text-slate-800">Electrical substations</h3>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                          Close-range scans of transformers, support insulators, and electrical bays.
                        </p>
                      </div>
                      <button onClick={() => alert('Substation scan case study...')} className="text-left text-xs font-bold text-[#2563eb] hover:underline mt-2">
                        Read customer story →
                      </button>
                    </div>
                  </div>

                </div>
              </div>

              {/* Section 5: Focus on your asset banner */}
              <div className="w-full bg-[#0F172A] text-white py-24 text-center space-y-6 flex flex-col items-center justify-center shrink-0">
                <h2 className="font-display font-extrabold text-3xl sm:text-4xl md:text-5xl text-white tracking-tight leading-tight max-w-2xl px-4">
                  Focus on your asset, not flight mechanics.
                </h2>
                <div className="pt-2">
                  <button 
                    onClick={() => {
                      if (isLoggedIn) {
                        setCurrentView('dashboard');
                      } else {
                        setCurrentView('signup');
                      }
                    }}
                    className="bg-[#2563eb] hover:bg-blue-600 text-white font-bold text-xs px-8 py-4 rounded-xl transition cursor-pointer shadow-lg btn-scale"
                  >
                    Try AeroMap Now
                  </button>
                </div>
              </div>

              {/* Section 6: Learn more about 3D Scan */}
              <div className="w-full bg-white py-24 px-6 sm:px-12 md:px-24 flex flex-col items-center gap-16 relative z-20 font-sans border-b border-slate-200">
                <div className="w-full max-w-5xl flex items-center justify-between">
                  <h2 className="font-display font-extrabold text-2xl text-slate-900 tracking-tight leading-tight">
                    Learn more about 3D Scan
                  </h2>
                  <button onClick={() => alert('Navigating to blog index...')} className="text-xs font-bold text-[#2563eb] hover:underline">
                    View all stories →
                  </button>
                </div>

                {/* Two Column Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-5xl">
                  
                  {/* Blog Card 1 */}
                  <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col bg-[#f8fafc]/40">
                    <div className="aspect-video bg-slate-100 border-b border-slate-200 flex items-center justify-center relative select-none">
                      <span className="text-slate-300 font-bold text-xs uppercase tracking-widest">Guide Thumbnail</span>
                    </div>
                    <div className="p-6 space-y-3">
                      <div className="text-[10px] font-bold text-[#2563eb] uppercase tracking-wider">Bridge Inspections</div>
                      <h3 className="font-display font-bold text-base text-slate-800 leading-snug">How to scan a complex bridge structure with autonomous drones</h3>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        A detailed breakdown on defining structural volumes, aligning vertical constraints, and choosing proper overlaps.
                      </p>
                      <button onClick={() => alert('Reading bridge guide...')} className="text-xs font-bold text-slate-800 hover:text-black hover:underline pt-2 block">
                        Read post →
                      </button>
                    </div>
                  </div>

                  {/* Blog Card 2 */}
                  <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col bg-[#f8fafc]/40">
                    <div className="aspect-video bg-slate-100 border-b border-slate-200 flex items-center justify-center relative select-none">
                      <span className="text-slate-300 font-bold text-xs uppercase tracking-widest">Case Study Thumbnail</span>
                    </div>
                    <div className="p-6 space-y-3">
                      <div className="text-[10px] font-bold text-[#2563eb] uppercase tracking-wider">Cell Towers</div>
                      <h3 className="font-display font-bold text-base text-slate-800 leading-snug">Setting up adaptive photogrammetry overlaps for complex towers</h3>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Learn how modern telecom giants utilize AeroMap 3D Scan to generate full structural reports with 100% detail coverage.
                      </p>
                      <button onClick={() => alert('Reading telecom case study...')} className="text-xs font-bold text-slate-800 hover:text-black hover:underline pt-2 block">
                        Read post →
                      </button>
                    </div>
                  </div>

                </div>
              </div>

              {/* Landing Page Footer */}
              <footer className="w-full bg-[#f8fafc] border-t border-slate-200 py-16 px-8 md:px-24 flex flex-col gap-12 relative z-20 text-slate-500 font-sans text-xs shrink-0">
                
                {/* Top footer row */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-8 w-full max-w-6xl mx-auto border-b border-slate-200 pb-12">
                  <div className="space-y-4 md:col-span-2">
                    <div className="flex items-center gap-2 select-none">
                      <svg className="h-6 w-6 text-[#2563eb] fill-current" viewBox="0 0 24 24">
                        <path d="M2 4h18l-3 6H2V4zm3 8h17l-3 6H5v-6z"/>
                      </svg>
                      <span className="font-display font-bold text-slate-800 text-sm">AeroMap Suite</span>
                    </div>
                    <p className="text-slate-400 text-xs leading-relaxed max-w-sm">
                      Autonomous flight software mapping complex physical sites with high-fidelity photogrammetry adjustments.
                    </p>
                    
                    {/* Newsletter mock */}
                    <form onSubmit={(e) => { e.preventDefault(); alert('Subscribed successfully!'); }} className="flex gap-2 max-w-xs pt-2">
                      <input 
                        type="email" 
                        required 
                        placeholder="Join our newsletter" 
                        className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 text-[11px] focus:outline-none focus:border-[#2563eb] flex-1"
                      />
                      <button type="submit" className="bg-slate-900 text-white hover:bg-slate-800 px-3.5 py-2 rounded-lg font-bold text-[10.5px] cursor-pointer">
                        Join
                      </button>
                    </form>
                  </div>

                  <div className="space-y-3">
                    <div className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">Product</div>
                    <ul className="space-y-2 text-[11px]">
                      <li><button onClick={() => alert('Redirecting...')} className="hover:text-slate-850">AeroMap 3D Scan</button></li>
                      <li><button onClick={() => alert('Redirecting...')} className="hover:text-slate-850">Flight Controller</button></li>
                      <li><button onClick={() => alert('Redirecting...')} className="hover:text-slate-850">API Integrations</button></li>
                    </ul>
                  </div>

                  <div className="space-y-3">
                    <div className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">Solutions</div>
                    <ul className="space-y-2 text-[11px]">
                      <li><button onClick={() => alert('Redirecting...')} className="hover:text-slate-850">Truss Bridges</button></li>
                      <li><button onClick={() => alert('Redirecting...')} className="hover:text-slate-850">Telecom Towers</button></li>
                      <li><button onClick={() => alert('Redirecting...')} className="hover:text-slate-850">Stockpile Volumes</button></li>
                    </ul>
                  </div>

                  <div className="space-y-3">
                    <div className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">Resources</div>
                    <ul className="space-y-2 text-[11px]">
                      <li><button onClick={() => alert('Redirecting...')} className="hover:text-slate-850">Technical Guides</button></li>
                      <li><button onClick={() => alert('Redirecting...')} className="hover:text-slate-850">API Reference</button></li>
                      <li><button onClick={() => alert('Redirecting...')} className="hover:text-slate-850">Contact Sales</button></li>
                    </ul>
                  </div>
                </div>

                {/* Bottom copyright row */}
                <div className="w-full max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-6 text-[10.5px]">
                    <button onClick={() => alert('Privacy Policy details')} className="hover:text-slate-800">Privacy Policy</button>
                    <button onClick={() => alert('Terms of Service details')} className="hover:text-slate-800">Terms of Service</button>
                    <button onClick={() => alert('Licenses info')} className="hover:text-slate-800">Licenses</button>
                  </div>
                  <div>
                    © 2026 AeroMap Robotics. All rights reserved.
                  </div>
                </div>
              </footer>
            </div>
          )}

          {/* AUTH VIEW (SIGN IN & SIGN UP) */}
          {(currentView === 'signin' || currentView === 'signup') && (
            <div className="w-full min-h-screen relative flex items-center justify-center bg-white px-4">

              {/* The Sliding card container */}
              <div className={`auth-card-container relative z-20 ${currentView === 'signup' ? 'right-panel-active' : ''}`}>
                
                {/* SIGN UP FORM (RIGHT SIDE DISPLAY) */}
                <div className="auth-form-container auth-sign-up-container flex flex-col justify-center items-center px-12 py-8 bg-white/95">
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      const formData = new FormData(e.currentTarget);
                      const email = formData.get('email') as string;
                      const name = formData.get('name') as string;
                      if (!email) return;
                      setIsLoggedIn(true);
                      setCurrentUser({ email, name: name || email.split('@')[0] });
                      setCurrentView('dashboard');
                      alert('Account created and logged in successfully!');
                    }}
                    className="w-full max-w-[320px] flex flex-col gap-4 text-center font-sans"
                  >
                    <h2 className="font-display font-extrabold text-2xl text-slate-900 tracking-tight">Create Account</h2>
                    
                    {/* Social Buttons */}
                    <div className="flex items-center justify-center gap-3">
                      {['G', 'f', 'GitHub', 'in'].map((social) => (
                        <button
                          key={social}
                          type="button"
                          onClick={() => alert(`${social} login simulated.`)}
                          className="border border-slate-200 w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-50 transition cursor-pointer text-xs font-bold text-slate-650"
                        >
                          {social === 'GitHub' ? (
                            <svg className="h-4 w-4 text-slate-700 fill-current" viewBox="0 0 24 24">
                              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.11.82-.26.82-.577v-2.234c-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.82 1.102.82 2.222v3.293c0 .319.22.694.825.576C20.565 21.795 24 17.3 24 12c0-6.63-5.37-12-12-12z" />
                            </svg>
                          ) : social}
                        </button>
                      ))}
                    </div>

                    <span className="text-[11px] text-slate-400 font-semibold">Register with E-mail</span>

                    <input
                      name="name"
                      type="text"
                      required
                      placeholder="Name"
                      className="w-full bg-[#f1f5f9] border-none px-4 py-2.5 rounded-lg text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
                    />

                    <input
                      name="email"
                      type="email"
                      required
                      placeholder="Enter E-mail"
                      className="w-full bg-[#f1f5f9] border-none px-4 py-2.5 rounded-lg text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
                    />

                    <input
                      name="password"
                      type="password"
                      required
                      placeholder="Enter Password"
                      className="w-full bg-[#f1f5f9] border-none px-4 py-2.5 rounded-lg text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
                    />

                    <button
                      type="submit"
                      className="w-full bg-[#2563eb] hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wide py-3 rounded-lg shadow-md transition cursor-pointer mt-2"
                    >
                      SIGN UP
                    </button>

                    <button 
                      type="button"
                      onClick={() => setCurrentView('home')}
                      className="text-slate-400 hover:text-slate-600 text-[10.5px] font-semibold underline mt-2"
                    >
                      Back to homepage
                    </button>
                  </form>
                </div>

                {/* SIGN IN FORM (LEFT SIDE DISPLAY) */}
                <div className="auth-form-container auth-sign-in-container flex flex-col justify-center items-center px-12 py-8 bg-white/95">
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      const formData = new FormData(e.currentTarget);
                      const email = formData.get('email') as string;
                      if (!email) return;
                      setIsLoggedIn(true);
                      setCurrentUser({ email, name: email.split('@')[0] || 'User' });
                      setCurrentView('dashboard');
                      alert('Logged in successfully!');
                    }}
                    className="w-full max-w-[320px] flex flex-col gap-4 text-center font-sans"
                  >
                    <h2 className="font-display font-extrabold text-2xl text-slate-900 tracking-tight">Sign In</h2>
                    
                    {/* Social Buttons */}
                    <div className="flex items-center justify-center gap-3">
                      {['G', 'f', 'GitHub', 'in'].map((social) => (
                        <button
                          key={social}
                          type="button"
                          onClick={() => alert(`${social} login simulated.`)}
                          className="border border-slate-200 w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-50 transition cursor-pointer text-xs font-bold text-slate-650"
                        >
                          {social === 'GitHub' ? (
                            <svg className="h-4 w-4 text-slate-700 fill-current" viewBox="0 0 24 24">
                              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.11.82-.26.82-.577v-2.234c-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.82 1.102.82 2.222v3.293c0 .319.22.694.825.576C20.565 21.795 24 17.3 24 12c0-6.63-5.37-12-12-12z" />
                            </svg>
                          ) : social}
                        </button>
                      ))}
                    </div>

                    <span className="text-[11px] text-slate-400 font-semibold">Sign in With Email & Password</span>

                    <input
                      name="email"
                      type="email"
                      required
                      placeholder="Enter E-mail"
                      className="w-full bg-[#f1f5f9] border-none px-4 py-2.5 rounded-lg text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
                    />

                    <input
                      name="password"
                      type="password"
                      required
                      placeholder="Enter Password"
                      className="w-full bg-[#f1f5f9] border-none px-4 py-2.5 rounded-lg text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
                    />

                    <button 
                      type="button" 
                      onClick={() => alert('Password reset link sent (simulated).')}
                      className="text-[10.5px] font-semibold text-slate-400 hover:text-slate-600 self-center"
                    >
                      Forget Password?
                    </button>

                    <button
                      type="submit"
                      className="w-full bg-[#2563eb] hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wide py-3 rounded-lg shadow-md transition cursor-pointer mt-2"
                    >
                      SIGN IN
                    </button>

                    <button 
                      type="button"
                      onClick={() => setCurrentView('home')}
                      className="text-slate-400 hover:text-slate-600 text-[10.5px] font-semibold underline mt-2"
                    >
                      Back to homepage
                    </button>
                  </form>
                </div>

                {/* SLIDING OVERLAY (HANDLES ANIMATED SWAPPING) */}
                <div className="auth-overlay-container">
                  <div className="auth-overlay bg-gradient-to-br from-blue-600 to-indigo-700">
                    
                    {/* Left overlay panel (Sign In trigger button) */}
                    <div className="auth-overlay-panel auth-overlay-left flex flex-col items-center justify-center text-center px-10 gap-4">
                      <h2 className="text-3xl font-display font-extrabold text-white tracking-tight leading-none">Welcome To AeroMap</h2>
                      <p className="text-xs text-blue-100 max-w-[240px] leading-relaxed">
                        To keep connected with us please login with your personal info.
                      </p>
                      <button
                        type="button"
                        onClick={() => setCurrentView('signin')}
                        className="border border-white/80 hover:bg-white/10 text-white font-bold text-xs uppercase tracking-wider px-8 py-3 rounded-xl transition cursor-pointer"
                      >
                        SIGN IN
                      </button>
                    </div>

                    {/* Right overlay panel (Sign Up trigger button) */}
                    <div className="auth-overlay-panel auth-overlay-right flex flex-col items-center justify-center text-center px-10 gap-4">
                      <h2 className="text-3xl font-display font-extrabold text-white tracking-tight leading-none">Hello World</h2>
                      <p className="text-xs text-blue-100 max-w-[240px] leading-relaxed">
                        Sign up now and enjoy our site
                      </p>
                      <button
                        type="button"
                        onClick={() => setCurrentView('signup')}
                        className="border border-white/80 hover:bg-white/10 text-white font-bold text-xs uppercase tracking-wider px-8 py-3 rounded-xl transition cursor-pointer"
                      >
                        SIGN UP
                      </button>
                    </div>

                  </div>
                </div>

              </div>
            </div>
          )}

          {/* DASHBOARD VIEW: LOGGED-IN CONTROL CENTER */}
          {currentView === 'dashboard' && (
            <div className="w-full h-full p-8 flex flex-col items-center justify-start gap-8 bg-grid-pattern overflow-y-auto">
              
              <div className="text-center max-w-2xl mt-4">
                <h1 className="font-display font-extrabold text-2xl text-slate-900 tracking-tight leading-tight uppercase">
                  AeroMap Workspace Hub
                </h1>
                <p className="text-slate-500 text-xs mt-2 leading-relaxed font-semibold">
                  Welcome back{currentUser ? `, ${currentUser.name}` : ''}! Configure datum projections and import drone camera geotagged images, or restore a recent survey workspace.
                </p>
              </div>

              {/* Action cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl mt-4 shrink-0">
                
                {/* Create Project Card */}
                <button
                  onClick={() => setIsWizardOpen(true)}
                  className="group p-6 rounded-2xl bg-white border border-slate-200 text-left hover:border-indigo-650 hover:shadow-xl transition-all duration-200 cursor-pointer flex items-start gap-4"
                >
                  <div className="p-3.5 rounded-xl bg-indigo-50 text-indigo-650 group-hover:scale-105 transition-transform duration-200">
                    <FolderClosed size={26} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-display font-bold text-base text-slate-800 group-hover:text-indigo-600 transition-colors">
                      New Project Setup...
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      Configure datum projections and import drone camera geotagged images.
                    </p>
                  </div>
                  <ChevronRight size={18} className="text-slate-300 mt-1 group-hover:translate-x-1 transition-transform" />
                </button>

                {/* Open Project Card */}
                <button
                  onClick={handleOpenProjectSelect}
                  className="group p-6 rounded-2xl bg-white border border-slate-200 text-left hover:border-indigo-650 hover:shadow-xl transition-all duration-200 cursor-pointer flex items-start gap-4"
                >
                  <div className="p-3.5 rounded-xl bg-slate-100 text-slate-550 group-hover:scale-105 transition-transform duration-200">
                    <HardDrive size={26} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-display font-bold text-base text-slate-800 group-hover:text-indigo-600 transition-colors">
                      Load Open Project...
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      Restore and load local photogrammetry datasets from your disk.
                    </p>
                  </div>
                  <ChevronRight size={18} className="text-slate-300 mt-1 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>

              {/* Recent projects list */}
              <div className="w-full max-w-3xl mt-4">
                <h3 className="font-display font-bold text-[10.5px] text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Clock size={12} />
                  <span>Recent Projects Workspace</span>
                </h3>

                <div className="space-y-3">
                  {projectList.map((project) => (
                    <div
                      key={project.id}
                      onClick={() => handleLoadProject(project)}
                      className="p-4 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition cursor-pointer flex items-center justify-between shadow-sm"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded bg-indigo-50/70 text-indigo-650">
                          <Layers2 size={16} />
                        </div>
                        <div>
                          <div className="font-bold text-slate-800 text-sm">{project.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">{project.path}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-slate-550">
                        <div className="hidden sm:flex flex-col items-end gap-0.5 text-right">
                          <span className="font-semibold text-slate-650">{project.imageCount} images</span>
                          <span className="text-[9px] font-mono">{project.coordinateSystem}</span>
                        </div>
                        <Calendar size={13} className="text-slate-300" />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Are you sure you want to delete project "${project.name}"?`)) {
                              setProjectList(prev => prev.filter(p => p.id !== project.id));
                              if (activeProject?.id === project.id) {
                                setActiveProject(null);
                              }
                            }
                          }}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-550 transition cursor-pointer"
                          title="Delete project"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

          {/* VIEW: 2D FLIGHT MAP PANEL */}
          {currentView === 'map' && activeProject && (
            <MapPanel
              onProcessingComplete={handleProcessingComplete}
              unit={activeProject.unit}
              activeProject={activeProject}
            />
          )}

          {/* VIEW: 3D RAYCLOUD POINT CLOUD */}
          {currentView === 'raycloud' && activeProject && (
            <RayCloudPanel activeProject={activeProject} />
          )}

          {/* VIEW: 3D TEXTURED MESH VIEWER */}
          {currentView === 'mesh' && activeProject && (
            <MeshViewerPanel
              activeProject={activeProject}
              setCurrentView={setCurrentView}
            />
          )}

          {/* VIEW: VOLUMES ANALYSIS PANEL */}
          {currentView === 'volumes' && activeProject && (
            <VolumesPanel
              unit={activeProject.unit}
              activeProject={activeProject}
            />
          )}

          {/* VIEW: PROCESSING SETTINGS (simulated) */}
          {currentView === 'processing' && activeProject && (
            <div className="w-full h-full p-8 flex items-center justify-center bg-grid-pattern">
              <div className="max-w-md p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center shadow-lg space-y-4">
                <Settings size={40} className="mx-auto text-indigo-550 dark:text-indigo-400 animate-spin-slow" />
                <h3 className="font-display font-extrabold text-base text-slate-800 dark:text-white">Processing Options Portal</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Advanced block calibration settings are locked to default. Triangulations and DSM matrices use automatic local parameters.
                </p>
                <button
                  onClick={() => setCurrentView('map')}
                  className="px-4 py-2 bg-indigo-650 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition cursor-pointer btn-scale"
                >
                  Return to Flight Map
                </button>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* Project Wizard Setup Modal */}
      <ProjectWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onFinish={handleCreateProject}
      />

    </div>
  );
}
