import React from 'react';
import { Home, Map, Box, Layers, Settings, LogOut, Globe, Columns } from 'lucide-react';
import { toast } from 'react-toastify';

interface SidebarProps {
  currentView: string;
  setCurrentView: (view: string) => void;
  hasActiveProject: boolean;
  onSignOut?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  setCurrentView,
  hasActiveProject,
  onSignOut
}) => {
  const navItems = [
    { id: 'dashboard', label: 'Home', icon: Home, requiresProject: false },
    { id: 'map', label: 'Map View', icon: Map, requiresProject: true },
    { id: 'raycloud', label: 'RayCloud', icon: Box, requiresProject: true },
    { id: 'mesh', label: '3D Mesh', icon: Globe, requiresProject: true },
    { id: 'compare', label: 'Compare', icon: Columns, requiresProject: true },
    { id: 'volumes', label: 'Volumes', icon: Layers, requiresProject: true },
    { id: 'processing', label: 'Processing', icon: Settings, requiresProject: true }
  ];

  const handleNavClick = (id: string, requiresProject: boolean) => {
    if (requiresProject && !hasActiveProject) {
      toast.warning('Please create or load a project first!');
      return;
    }
    setCurrentView(id);
  };

  return (
    <aside className="w-20 bg-white border-r border-[#E2E8F0] flex flex-col items-center py-6 shrink-0 transition-colors duration-200 select-none">
      <div className="flex flex-col gap-8 w-full items-center">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          const isDisabled = item.requiresProject && !hasActiveProject;

          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id, item.requiresProject)}
              className={`group flex flex-col items-center gap-1.5 py-2 px-1 w-full text-center relative transition-all duration-150 cursor-pointer ${
                isDisabled
                  ? 'opacity-30 cursor-not-allowed text-slate-300'
                  : isActive
                    ? 'text-[#2563eb] font-semibold bg-blue-50/50'
                    : 'text-slate-450 hover:text-[#0F172A] hover:bg-slate-50'
              }`}
              title={isDisabled ? `${item.label} (Requires active project)` : item.label}
            >
              {/* Highlight bar */}
              {isActive && (
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#2563eb] rounded-r" />
              )}
              
              <Icon 
                size={22} 
                className={`transition-transform duration-150 group-hover:scale-110 ${
                  isActive ? 'stroke-[2.5px]' : 'stroke-[1.8px]'
                }`} 
              />
              <span className="text-[10px] tracking-wide font-medium block">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {onSignOut && (
        <div className="mt-auto w-full flex justify-center border-t border-[#E2E8F0] pt-4 px-2">
          <button
            onClick={onSignOut}
            className="flex flex-col items-center gap-1.5 py-2 px-1 w-full text-center text-slate-400 hover:text-red-650 hover:bg-red-50/50 rounded-xl transition cursor-pointer"
            title="Sign out of Aevora"
          >
            <LogOut size={20} className="stroke-[1.8px]" />
            <span className="text-[10px] tracking-wide font-medium">Sign Out</span>
          </button>
        </div>
      )}
    </aside>
  );
};
