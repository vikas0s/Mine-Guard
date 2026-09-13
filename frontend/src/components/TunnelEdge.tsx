import React from 'react';
import { BaseEdge, EdgeLabelRenderer, EdgeProps, getSmoothStepPath } from 'reactflow';

export interface TunnelEdgeData {
  onDisconnect?: (edgeId: string) => void;
  label?: string;
}

export const TunnelEdge: React.FC<EdgeProps<TunnelEdgeData>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  label,
  data
}) => {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleDisconnect = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data?.onDisconnect) {
      data.onDisconnect(id);
    }
  };

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan group flex items-center space-x-1.5 bg-white/95 backdrop-blur-xs px-2.5 py-1 rounded-full border border-slate-300 shadow-sm text-xs font-semibold text-slate-700 hover:border-red-300 hover:shadow-md transition-all cursor-default"
        >
          <span className="text-[11px] text-slate-600 font-medium">
            {label || 'Tunnel'}
          </span>
          <button
            onClick={handleDisconnect}
            title="Disconnect this tunnel"
            className="w-4 h-4 rounded-full bg-slate-100 hover:bg-red-500 hover:text-white text-slate-400 flex items-center justify-center transition-colors text-xs font-bold leading-none"
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
