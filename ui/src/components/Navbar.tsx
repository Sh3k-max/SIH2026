import React, { useState } from 'react';
import { Layers, FolderClosed, Cpu, HelpCircle, HardDrive } from 'lucide-react';
import { toast } from 'react-toastify';

interface NavbarProps {
  activeProjectName: string | null;
  onNewProjectClick: () => void;
  onOpenProjectClick: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeProjectName,
  onNewProjectClick,
  onOpenProjectClick
}) => {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);

  return (
    <header className="bg-white/70 backdrop-blur-md border-b border-[#E2E8F0]/80 text-[#0F172A] flex justify-between items-center px-6 h-14 w-full shrink-0 z-35 relative font-sans select-none">
      
      {/* Brand logo & navigation dropdowns */}
      <div className="flex items-center gap-8 h-full">
        <div className="font-display font-extrabold text-xl text-[#2563eb] flex items-center tracking-tight">
          <Layers className="mr-2 text-[#2563eb] animate-pulse" size={22} />
          AeroMap 3D
        </div>

        <nav className="hidden md:flex h-full items-center text-sm font-medium">
          {/* Project dropdown menu */}
          <div className="relative h-full flex items-center">
            <button
              onClick={() => setProjectMenuOpen(!projectMenuOpen)}
              className="flex items-center h-full px-4 text-slate-600 hover:text-[#0F172A] hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Project <i className="fa-solid fa-chevron-down ml-1.5 text-[10px] text-slate-400"></i>
            </button>
            {projectMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setProjectMenuOpen(false)} />
                <div className="absolute left-0 top-14 w-52 rounded-lg bg-white border border-[#E2E8F0] shadow-xl py-1.5 z-40 text-slate-700">
                  <button
                    onClick={() => {
                      onNewProjectClick();
                      setProjectMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2.5 text-xs font-semibold cursor-pointer text-slate-700 hover:text-[#0F172A]"
                  >
                    <FolderClosed size={15} className="text-[#2563eb]" />
                    <span>New Project...</span>
                  </button>
                  <button
                    onClick={() => {
                      onOpenProjectClick();
                      setProjectMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2.5 text-xs font-semibold cursor-pointer text-slate-700 hover:text-[#0F172A]"
                  >
                    <HardDrive size={15} className="text-slate-400" />
                    <span>Open Project...</span>
                  </button>
                </div>
              </>
            )}
          </div>

          <button className="flex items-center h-full px-4 text-slate-500 hover:text-[#0F172A] hover:bg-slate-50 transition-all cursor-pointer">
            Process
          </button>
          <button className="flex items-center h-full px-4 text-slate-500 hover:text-[#0F172A] hover:bg-slate-50 transition-all cursor-pointer">
            View
          </button>

          {/* Help dropdown menu */}
          <div className="relative h-full flex items-center">
            <button
              onClick={() => setHelpMenuOpen(!helpMenuOpen)}
              className="flex items-center h-full px-4 text-slate-600 hover:text-[#0F172A] hover:bg-slate-50 cursor-pointer"
            >
              Help <i className="fa-solid fa-chevron-down ml-1.5 text-[10px] text-slate-400"></i>
            </button>
            {helpMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setHelpMenuOpen(false)} />
                <div className="absolute left-0 top-14 w-48 rounded-lg bg-white border border-[#E2E8F0] shadow-xl py-1.5 z-40 text-slate-700">
                  <button
                    onClick={() => {
                      toast.info('AeroMap 3D Mapping & Photogrammetry Suite — v1.0.0 (Release Build)');
                      setHelpMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2 text-xs font-semibold cursor-pointer text-slate-700 hover:text-[#0F172A]"
                  >
                    <Cpu size={14} className="text-[#2563eb]" />
                    <span>About AeroMap 3D</span>
                  </button>
                  <button
                    onClick={() => {
                      toast.info('Opening AeroMap 3D documentation & tutorials...');
                      setHelpMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2 text-xs font-semibold cursor-pointer text-slate-700 hover:text-[#0F172A]"
                  >
                    <HelpCircle size={14} className="text-[#2563eb]" />
                    <span>Documentation</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </nav>
      </div>
 
      <div className="flex items-center gap-4">
        {activeProjectName ? (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded bg-blue-50 border border-[#dbeafe] text-xs font-semibold text-[#2563eb]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2563eb] animate-pulse" />
            <span>Active: {activeProjectName}</span>
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded bg-slate-50 border border-[#E2E8F0] text-xs font-semibold text-slate-500 italic">
            <span>No Active Project</span>
          </div>
        )}
      </div>

    </header>
  );
};
