import React from 'react';
import { Activity, Network, Volume2, VolumeX } from 'lucide-react';
import { MonitoringNode } from '../types';

interface NavbarProps {
  currentTab: 'dashboard' | 'graph';
  onSelectTab: (tab: 'dashboard' | 'graph') => void;
  nodes?: MonitoringNode[];
  selectedNodeId?: string;
  onSelectNode?: (nodeId: string) => void;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  onSimulateSpike?: () => void;
  onSimulateNormalize?: () => void;
  backendOnline?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  audioEnabled,
  onToggleAudio
}) => {
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Brand & Identity */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-700 flex items-center justify-center text-white shadow-sm font-bold text-lg tracking-wider">
              SG
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-slate-900 tracking-tight text-base sm:text-lg">
                  MineGuard
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  SIH26025
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                Slope & Structure Stability Monitoring System
              </p>
            </div>
          </div>

          {/* Clean Primary Navigation Tabs */}
          <nav className="flex items-center bg-slate-100/90 p-1 rounded-xl border border-slate-200 shadow-xs">
            <button
              id="nav-tab-dashboard"
              onClick={() => onSelectTab('dashboard')}
              className={`flex items-center space-x-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                currentTab === 'dashboard'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>Dashboard</span>
            </button>
            <button
              id="nav-tab-graph"
              onClick={() => onSelectTab('graph')}
              className={`flex items-center space-x-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                currentTab === 'graph'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <Network className="w-4 h-4" />
              <span>Station Graph</span>
            </button>
          </nav>

          {/* Right Status & Audio Action */}
          <div className="flex items-center space-x-2.5">
            {/* Audio Siren Mute/Unmute Toggle */}
            <button
              id="btn-toggle-audio"
              onClick={onToggleAudio}
              title={audioEnabled ? 'Audio alerts active (Click to mute)' : 'Muted (Click to enable audio alarm)'}
              className={`p-2 rounded-lg border transition-colors ${
                audioEnabled
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-600'
              }`}
            >
              {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Live Firestore Connection Status */}
            <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-xs text-slate-700 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-semibold">Live</span>
            </div>
          </div>

        </div>
      </div>
    </header>
  );
};
