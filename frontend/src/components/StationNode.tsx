import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Radio, AlertTriangle, ShieldCheck, ShieldAlert, Trash2, Edit2, Zap } from 'lucide-react';
import { MonitoringNode, RiskLevel } from '../types';

export interface StationNodeData extends MonitoringNode {
  onDelete?: (id: string) => void;
  onEdit?: (node: MonitoringNode) => void;
  onSelect?: (id: string) => void;
  isSelected?: boolean;
}

export const StationNode: React.FC<NodeProps<StationNodeData>> = ({ id, data }) => {
  const riskLevel: RiskLevel = data.riskLevel || 'LOW';
  const riskScore = data.riskScore ?? (riskLevel === 'HIGH' ? 5 : riskLevel === 'MEDIUM' ? 3 : 0);
  const buzzerState = data.buzzerState || 'silent';
  
  // Ultrasonic distance & displacement
  const distance = data.distance !== undefined ? Number(data.distance).toFixed(1) : '--';
  const displacement = data.groundMovement !== undefined 
    ? Number(data.groundMovement).toFixed(2)
    : (data.displacement !== undefined ? Number(data.displacement).toFixed(2) : '--');
  const tilt = data.tilt !== undefined ? Number(data.tilt).toFixed(1) : '--';
  const battery = data.batteryPercentage !== undefined ? Math.round(data.batteryPercentage) : 100;

  // Color coding by individual node risk level (light tints & clear borders)
  const getRiskStyles = () => {
    switch (riskLevel) {
      case 'HIGH':
        return {
          wrapper: 'border-red-300 bg-red-50/50 shadow-red-100',
          badge: 'bg-red-100 text-red-700 border-red-200',
          dot: 'bg-red-500',
          icon: <ShieldAlert className="w-3.5 h-3.5 text-red-600" />
        };
      case 'MEDIUM':
        return {
          wrapper: 'border-amber-300 bg-amber-50/50 shadow-amber-100',
          badge: 'bg-amber-100 text-amber-700 border-amber-200',
          dot: 'bg-amber-500',
          icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
        };
      case 'LOW':
      default:
        return {
          wrapper: 'border-emerald-300 bg-emerald-50/40 shadow-emerald-50',
          badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
          dot: 'bg-emerald-500',
          icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
        };
    }
  };

  const riskStyle = getRiskStyles();

  return (
    <div 
      onClick={() => data.onSelect && data.onSelect(id)}
      className={`min-w-[210px] rounded-xl bg-white border-2 shadow-sm transition-all duration-200 p-3 relative cursor-pointer hover:shadow-md ${
        data.isSelected ? 'ring-2 ring-blue-500 ring-offset-2' : ''
      } ${riskStyle.wrapper}`}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-slate-400" />

      {/* Header: Node ID, Name & Controls */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
        <div className="flex items-center space-x-1.5">
          <span className="font-bold text-slate-800 text-sm tracking-tight">
            {id}
          </span>
          {data.name && (
            <span className="text-xs text-slate-500 font-medium truncate max-w-[80px]">
              {data.name}
            </span>
          )}
        </div>

        {/* Action icons */}
        <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => data.onEdit && data.onEdit(data)}
            title="Edit station details"
            className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => data.onDelete && data.onDelete(id)}
            title="Delete station"
            className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Risk Badge & Buzzer status */}
      <div className="flex items-center justify-between mt-2.5">
        <div className={`flex items-center space-x-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${riskStyle.badge}`}>
          {riskStyle.icon}
          <span>{riskLevel}</span>
          <span className="opacity-60 text-[10px]">({riskScore}/5)</span>
        </div>

        {/* Buzzer Indicator */}
        <div className="flex items-center space-x-1">
          {buzzerState === 'beep_continuous' ? (
            <div className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold animate-buzzer-fast">
              <Radio className="w-3 h-3 text-red-600" />
              <span>ALARM</span>
            </div>
          ) : buzzerState === 'beep_once' ? (
            <div className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-medium animate-buzzer-pulse">
              <Radio className="w-3 h-3 text-amber-600" />
              <span>BEEP</span>
            </div>
          ) : (
            <span className="text-[11px] text-slate-400 flex items-center space-x-1 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
              <span>Silent</span>
            </span>
          )}
        </div>
      </div>

      {/* Real-time telemetry micro readout */}
      <div className="grid grid-cols-3 gap-1.5 mt-3 pt-2.5 border-t border-slate-100 text-center">
        <div className="bg-slate-50/80 rounded p-1">
          <div className="text-[10px] text-slate-500 font-medium">Tilt</div>
          <div className="text-xs font-bold text-slate-800">{tilt}°</div>
        </div>
        <div className="bg-slate-50/80 rounded p-1">
          <div className="text-[10px] text-slate-500 font-medium">Disp</div>
          <div className="text-xs font-bold text-slate-800">{displacement} <span className="text-[9px] font-normal text-slate-400">cm</span></div>
        </div>
        <div className="bg-slate-50/80 rounded p-1">
          <div className="text-[10px] text-slate-500 font-medium">Dist</div>
          <div className="text-xs font-bold text-slate-800">{distance} <span className="text-[9px] font-normal text-slate-400">cm</span></div>
        </div>
      </div>

      {/* Footer micro status */}
      <div className="flex items-center justify-between mt-2 pt-1 text-[10px] text-slate-400">
        <div className="flex items-center space-x-1">
          <Zap className="w-3 h-3 text-amber-500" />
          <span>{battery}%</span>
        </div>
        <span className="truncate">
          {data.lastSeen ? 'Live' : 'Standby'}
        </span>
      </div>

      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-slate-400" />
    </div>
  );
};
