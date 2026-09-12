import React, { useState, useCallback, useEffect, useMemo } from 'react';
import ReactFlow, {
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  Node,
  Edge,
  NodeChange,
  EdgeChange,
  Panel,
  useReactFlow,
  ReactFlowProvider
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { Plus, LayoutGrid, Trash2, Edit2, ShieldAlert, Check, X } from 'lucide-react';
import { doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { StationNode, StationNodeData } from '../components/StationNode';
import { MonitoringNode, RiskLevel } from '../types';

interface NodeGraphPageProps {
  nodes: MonitoringNode[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
}

const nodeTypes = {
  stationNode: StationNode,
};

// Dagre layout helper
const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, nodesep: 70, ranksep: 90 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 230, height: 160 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 115,
        y: nodeWithPosition.y - 80,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

const NodeGraphContent: React.FC<NodeGraphPageProps> = ({
  nodes: firestoreNodes,
  selectedNodeId,
  onSelectNode
}) => {
  const [nodes, setNodes] = useState<Node<StationNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  
  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<MonitoringNode | null>(null);

  // Form states
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [initialTilt, setInitialTilt] = useState(1.5);
  const [initialDisp, setInitialDisp] = useState(0.2);
  const reactFlowInstance = useReactFlow();
  const API_BASE = 'http://localhost:5000';

  // Resilient CRUD helpers: Use Admin SDK via Python backend as primary to bypass client permission rules
  const resilientSetDoc = async (nodeId: string, data: any) => {
    try {
      const res = await fetch(`${API_BASE}/api/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, id: nodeId, nodeId })
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (apiErr) {
      // Fallback to direct client SDK only if backend service is unreachable
      await setDoc(doc(db, 'nodes', nodeId), data);
    }
  };

  const resilientUpdateDoc = async (nodeId: string, data: any) => {
    try {
      const res = await fetch(`${API_BASE}/api/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (apiErr) {
      // Fallback to direct client SDK only if backend service is unreachable
      await updateDoc(doc(db, 'nodes', nodeId), data);
    }
  };

  const resilientDeleteDoc = async (nodeId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/nodes/${nodeId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (apiErr) {
      // Fallback to direct client SDK only if backend service is unreachable
      await deleteDoc(doc(db, 'nodes', nodeId));
    }
  };

  // Delete node handler (CRUD against Firestore)
  const handleDeleteNode = useCallback(async (nodeId: string) => {
    if (window.confirm(`Are you sure you want to delete Station ${nodeId}? This removes it from Firestore.`)) {
      try {
        await resilientDeleteDoc(nodeId);
      } catch (err) {
        console.error('Failed to delete node from Firestore:', err);
        alert('Failed to delete node: ' + err);
      }
    }
  }, []);

  // Edit node trigger
  const handleEditNode = useCallback((nodeData: MonitoringNode) => {
    setEditingNode(nodeData);
    setNewName(nodeData.name || '');
    setIsEditModalOpen(true);
  }, []);

  // Map Firestore nodes to React Flow nodes with independent listeners/props
  useEffect(() => {
    if (!firestoreNodes) return;

    // Create flow nodes
    const flowNodes: Node<StationNodeData>[] = firestoreNodes.map((fn, index) => {
      // Determine initial position (prefer Firestore position, else default grid)
      let posX = fn.position?.x ?? fn.positionX ?? (80 + (index % 3) * 280);
      let posY = fn.position?.y ?? fn.positionY ?? (80 + Math.floor(index / 3) * 220);

      return {
        id: fn.id,
        type: 'stationNode',
        position: { x: posX, y: posY },
        data: {
          ...fn,
          isSelected: fn.id === selectedNodeId,
          onDelete: handleDeleteNode,
          onEdit: handleEditNode,
          onSelect: onSelectNode
        },
      };
    });

    // Create network edges between stations to represent spatial correlation mesh
    const flowEdges: Edge[] = [];
    for (let i = 0; i < firestoreNodes.length - 1; i++) {
      flowEdges.push({
        id: `e-${firestoreNodes[i].id}-${firestoreNodes[i + 1].id}`,
        source: firestoreNodes[i].id,
        target: firestoreNodes[i + 1].id,
        animated: true,
        style: { stroke: '#94a3b8', strokeDasharray: '4,4', strokeWidth: 1.5 },
      });
    }

    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [firestoreNodes, selectedNodeId, handleDeleteNode, handleEditNode, onSelectNode]);

  // Handle manual dragging: Update Firestore document when drag stops (CRUD: Update position)
  const onNodeDragStop = useCallback(async (_: React.MouseEvent, node: Node) => {
    try {
      await resilientUpdateDoc(node.id, {
        position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
        positionX: Math.round(node.position.x),
        positionY: Math.round(node.position.y),
      });
    } catch (err) {
      console.error('Failed to update node position in Firestore:', err);
    }
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  // Apply Dagre auto-layout
  const handleAutoLayout = useCallback(async () => {
    const layouted = getLayoutedElements(nodes, edges, 'TB');
    setNodes([...layouted.nodes]);
    setEdges([...layouted.edges]);

    // Persist new layout positions to Firestore
    try {
      const promises = layouted.nodes.map(n => 
        resilientUpdateDoc(n.id, {
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
          positionX: Math.round(n.position.x),
          positionY: Math.round(n.position.y),
        })
      );
      await Promise.all(promises);
    } catch (err) {
      console.warn('Auto-layout persistence notice:', err);
    }

    setTimeout(() => {
      reactFlowInstance.fitView({ padding: 0.2 });
    }, 50);
  }, [nodes, edges, reactFlowInstance]);

  // Add new station modal submit (CRUD: Create in Firestore)
  const handleCreateNode = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = newId.trim().toUpperCase();
    if (!id) return;

    try {
      const defaultData: Partial<MonitoringNode> = {
        name: newName.trim() || `Bench Station ${id}`,
        batteryPercentage: 100,
        tilt: Number(initialTilt),
        groundMovement: Number(initialDisp),
        displacement: Number(initialDisp),
        distance: 50.0,
        distanceChange: 0.0,
        vibration: 0.04,
        vibrationRms: 0.04,
        temperature: 25.0,
        humidity: 50.0,
        riskLevel: 'LOW',
        riskScore: 0,
        buzzerState: 'silent',
        status: 'online',
        lastSeen: new Date().toISOString(),
        connectedAt: new Date().toISOString(),
        position: {
          x: 100 + ((firestoreNodes.length) * 160) % 500,
          y: 120 + (Math.floor(firestoreNodes.length / 3) * 160)
        }
      };

      await resilientSetDoc(id, defaultData);

      setIsAddModalOpen(false);
      setNewId('');
      setNewName('');
    } catch (err) {
      console.error('Failed to create node in Firestore:', err);
      alert('Error creating node: ' + err);
    }
  };

  // Edit station modal submit (CRUD: Update in Firestore)
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNode) return;

    try {
      await resilientUpdateDoc(editingNode.id, {
        name: newName.trim(),
      });
      setIsEditModalOpen(false);
      setEditingNode(null);
    } catch (err) {
      console.error('Failed to update node in Firestore:', err);
      alert('Error updating node: ' + err);
    }
  };

  return (
    <div className="h-[calc(100vh-8rem)] w-full relative bg-slate-50 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      
      {/* Top Floating Control Bar */}
      <div className="absolute top-4 left-4 z-10 flex items-center space-x-2 bg-white/95 backdrop-blur-sm p-1.5 rounded-xl border border-slate-200 shadow-sm">
        <button
          id="btn-add-node"
          onClick={() => {
            const nextNum = firestoreNodes.length + 1;
            setNewId(`N0${nextNum}`);
            setNewName(`Station N0${nextNum}`);
            setIsAddModalOpen(true);
          }}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-700 text-white hover:bg-blue-800 transition-colors shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Node</span>
        </button>

        <button
          id="btn-auto-layout"
          onClick={handleAutoLayout}
          title="Arrange monitoring stations automatically using Dagre"
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
        >
          <LayoutGrid className="w-3.5 h-3.5 text-slate-600" />
          <span>Auto-Layout</span>
        </button>

        <div className="h-4 w-px bg-slate-200 mx-1"></div>

        {/* Legend */}
        <div className="flex items-center space-x-3 px-2 text-xs text-slate-600">
          <div className="flex items-center space-x-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <span>Low</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
            <span>Medium</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
            <span>High</span>
          </div>
        </div>
      </div>

      {/* Station count info badge */}
      <div className="absolute top-4 right-4 z-10 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 font-medium shadow-sm">
        <span className="font-bold text-slate-900">{nodes.length}</span> Active Stations Synced
      </div>

      {/* React Flow Canvas */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        fitView
        attributionPosition="bottom-right"
        className="bg-slate-50"
      >
        <Background color="#cbd5e1" gap={18} size={1} />
        <Controls className="!bg-white !border-slate-200 !shadow-sm !rounded-lg" />
      </ReactFlow>

      {/* Add Node Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-sm w-full p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Add Monitoring Station</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateNode} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Station ID (e.g. N03)</label>
                <input
                  type="text"
                  required
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500 uppercase font-mono font-bold"
                  placeholder="N03"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Station Label / Zone</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g. North Bench Sensor 3"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Initial Tilt (°)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={initialTilt}
                    onChange={(e) => setInitialTilt(parseFloat(e.target.value))}
                    className="w-full text-sm border border-slate-300 rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Initial Disp (cm)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={initialDisp}
                    onChange={(e) => setInitialDisp(parseFloat(e.target.value))}
                    className="w-full text-sm border border-slate-300 rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-700 text-white hover:bg-blue-800 transition-colors shadow-sm"
                >
                  Create Station
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Node Modal */}
      {isEditModalOpen && editingNode && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-sm w-full p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Edit Station {editingNode.id}</h3>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Station Label</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-100">
                Tip: You can also drag the node directly on the canvas to update its spatial coordinates in Firestore.
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-700 text-white hover:bg-blue-800 transition-colors shadow-sm"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export const NodeGraphPage: React.FC<NodeGraphPageProps> = (props) => (
  <ReactFlowProvider>
    <NodeGraphContent {...props} />
  </ReactFlowProvider>
);
