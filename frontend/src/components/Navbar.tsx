import React from 'react';
import { Activity, Network, Radio, Volume2, VolumeX, ShieldAlert, Sparkles } from 'lucide-react';
import { MonitoringNode } from '../types';

interface NavbarProps {
  currentTab: 'dashboard' | 'graph';
  onSelectTab: (tab: 'dashboard' | 'graph') => void;
  nodes: MonitoringNode[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  onSimulateSpike?: () => void;
  onSimulateNormalize?: () => void;
  backendOnline: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  nodes,
  selectedNodeId,
  onSelectNode,
  audioEnabled,
  onToggleAudio,
  onSimulateSpike,
  onSimulateNormalize,
  backendOnline
}) => {
  const selectedNode = nodes.find(n => n.id === selectedNodeId);

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Brand & Identity */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-blue-700 flex items-center justify-center text-white shadow-sm font-bold text-lg tracking-wider">
              SG
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-slate-900 tracking-tight text-base">
                  MineGuard
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  SIH26025
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                Slope & Structure Stability Monitoring System
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              id="nav-tab-dashboard"
              onClick={() => onSelectTab('dashboard')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md text-sm font-medium transition-all ${
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
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md text-sm font-medium transition-all ${
                currentTab === 'graph'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <Network className="w-4 h-4" />
              <span>Station Graph</span>
            </button>
          </nav>

          {/* Actions & Node Selector */}
          <div className="flex items-center space-x-3">
            
            {/* Quick Station Selector (for Dashboard view) */}
            {currentTab === 'dashboard' && (
              <div className="flex items-center space-x-2">
                <label htmlFor="station-select" className="text-xs font-medium text-slate-500 hidden md:block">
                  Station:
                </label>
                <div className="relative">
                  <select
                    id="station-select"
                    value={selectedNodeId}
                    onChange={(e) => onSelectNode(e.target.value)}
                    className="bg-slate-50 border border-slate-300 text-slate-800 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-28 sm:w-36 p-1.5 font-medium pr-8"
                  >
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.id} {n.name ? `(${n.name})` : ''} - {n.riskLevel || 'LOW'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Quick Demo Controls for Jury Evaluation */}
            <div className="hidden lg:flex items-center space-x-1.5 border-l border-slate-200 pl-3">
              <button
                id="btn-simulate-spike"
                onClick={onSimulateSpike}
                title="Simulate sudden strata tilt/displacement spike to trigger HIGH risk"
                className="px-2.5 py-1 text-xs font-medium rounded-md bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 flex items-center space-x-1"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-red-600" />
                <span>Test Hazard</span>
              </button>
              <button
                id="btn-simulate-norm"
                onClick={onSimulateNormalize}
                title="Reset station to normal stable levels"
                className="px-2.5 py-1 text-xs font-medium rounded-md bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 flex items-center space-x-1"
              >
                <Sparkles className="w-3.5 h-3.5 text-green-600" />
                <span>Reset Safe</span>
              </button>
            </div>

            {/* Buzzer Sound Toggle */}
            <button
              id="btn-toggle-audio"
              onClick={onToggleAudio}
              title={audioEnabled ? 'Mute buzzer audio' : 'Enable audio alarm for HIGH risk'}
              className={`p-2 rounded-lg border transition-colors ${
                audioEnabled
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-600'
              }`}
            >
              {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Live Firestore indicator */}
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs text-slate-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="hidden sm:inline font-medium">Firestore Live</span>
            </div>

          </div>

        </div>
      </div>
    </header>
  );
};
