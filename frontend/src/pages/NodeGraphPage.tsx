import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Connection,
  Node,
  Edge,
  NodeChange,
  EdgeChange,
  useReactFlow,
  ConnectionLineType,
  ReactFlowProvider
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import {
  Plus,
  LayoutGrid,
  Trash2,
  X,
  Link2,
  Unlink,
  GitBranch,
  ChevronDown
} from 'lucide-react';
import { doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { StationNode, StationNodeData } from '../components/StationNode';
import { TunnelEdge, TunnelEdgeData } from '../components/TunnelEdge';
import { MonitoringNode } from '../types';

interface NodeGraphPageProps {
  nodes: MonitoringNode[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
}

const nodeTypes = {
  stationNode: StationNode,
};

const edgeTypes = {
  tunnelEdge: TunnelEdge,
};

// Dagre layout helper
const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, nodesep: 90, ranksep: 110 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 230, height: 170 });
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
        y: nodeWithPosition.y - 85,
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
  const [edges, setEdges] = useState<Edge<TunnelEdgeData>[]>([]);

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isTunnelManagerOpen, setIsTunnelManagerOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<MonitoringNode | null>(null);

  // Form states for Add Station
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [initialTilt, setInitialTilt] = useState(1.5);
  const [initialDisp, setInitialDisp] = useState(0.2);

  // Form states for Connect Tunnels
  const [connectSource, setConnectSource] = useState('');
  const [connectTarget, setConnectTarget] = useState('');
  const [connectTunnelName, setConnectTunnelName] = useState('');

  const reactFlowInstance = useReactFlow();
  const API_BASE = 'http://localhost:5000';
  const hasLoadedEdgesRef = useRef(false);

  // Disconnect a specific tunnel (called from edge [x] button or modal)
  const handleDisconnectTunnel = useCallback((edgeId: string) => {
    setEdges(prev => {
      const updated = prev.filter(e => e.id !== edgeId);
      persistEdges(updated);
      return updated;
    });
  }, []);

  // Resilient CRUD helpers
  const resilientSetDoc = async (nodeId: string, data: any) => {
    try {
      const res = await fetch(`${API_BASE}/api/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, id: nodeId, nodeId })
      });
      if (!res.ok) throw new Error(await res.text());
    } catch {
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
    } catch {
      await updateDoc(doc(db, 'nodes', nodeId), data);
    }
  };

  const resilientDeleteDoc = async (nodeId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/nodes/${nodeId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error(await res.text());
    } catch {
      await deleteDoc(doc(db, 'nodes', nodeId));
    }
  };

  // Edge persistence helper (Firestore + LocalStorage cache)
  const persistEdges = useCallback(async (updatedEdges: Edge<TunnelEdgeData>[]) => {
    try {
      localStorage.setItem('mineguard_cave_tunnels', JSON.stringify(updatedEdges));
      await fetch(`${API_BASE}/api/network/edges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edges: updatedEdges })
      });
    } catch (err) {
      console.warn('Notice persisting edges to backend:', err);
    }
  }, []);

  // Helper to format an edge with the custom interactive TunnelEdge
  const createTunnelEdge = useCallback((
    source: string,
    target: string,
    label?: string,
    sourceHandle?: string,
    targetHandle?: string
  ): Edge<TunnelEdgeData> => {
    const id = `tunnel-${source}-${target}-${Date.now()}`;
    return {
      id,
      source,
      target,
      sourceHandle,
      targetHandle,
      type: 'tunnelEdge',
      animated: true,
      style: { stroke: '#475569', strokeWidth: 2, strokeDasharray: '5,5' },
      label: label || `Gallery ${source}↔${target}`,
      data: {
        label: label || `Gallery ${source}↔${target}`,
        onDisconnect: handleDisconnectTunnel
      }
    };
  }, [handleDisconnectTunnel]);

  // Initial load of custom edges from Backend / Firestore / LocalStorage
  useEffect(() => {
    const loadSavedEdges = async () => {
      let saved: Edge<TunnelEdgeData>[] = [];
      try {
        const res = await fetch(`${API_BASE}/api/network/edges`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            saved = data;
          }
        }
      } catch {
        // Ignore network errors on initial edge load
      }

      if (saved.length === 0) {
        const local = localStorage.getItem('mineguard_cave_tunnels');
        if (local) {
          try {
            saved = JSON.parse(local);
          } catch {
            saved = [];
          }
        }
      }

      // If still no edges, seed a default initial chain between available nodes
      if (saved.length === 0 && firestoreNodes.length > 1) {
        for (let i = 0; i < firestoreNodes.length - 1; i++) {
          saved.push(createTunnelEdge(
            firestoreNodes[i].id,
            firestoreNodes[i + 1].id,
            `Gallery ${firestoreNodes[i].id}↔${firestoreNodes[i + 1].id}`,
            'bottom-out',
            'top-in'
          ));
        }
      } else {
        // Attach onDisconnect handler to saved edges
        saved = saved.map(e => ({
          ...e,
          type: 'tunnelEdge',
          data: {
            ...e.data,
            onDisconnect: handleDisconnectTunnel
          }
        }));
      }

      setEdges(saved);
      hasLoadedEdgesRef.current = true;
    };

    if (!hasLoadedEdgesRef.current) {
      loadSavedEdges();
    }
  }, [firestoreNodes, createTunnelEdge, handleDisconnectTunnel]);

  // Delete node handler
  const handleDeleteNode = useCallback(async (nodeId: string) => {
    if (window.confirm(`Are you sure you want to delete Station ${nodeId}? This removes it from the cave map and Firestore.`)) {
      try {
        await resilientDeleteDoc(nodeId);
        setEdges(prev => {
          const filtered = prev.filter(e => e.source !== nodeId && e.target !== nodeId);
          persistEdges(filtered);
          return filtered;
        });
      } catch (err) {
        console.error('Failed to delete node from Firestore:', err);
        alert('Failed to delete node: ' + err);
      }
    }
  }, [persistEdges]);

  // Edit node trigger
  const handleEditNode = useCallback((nodeData: MonitoringNode) => {
    setEditingNode(nodeData);
    setNewName(nodeData.name || '');
    setIsEditModalOpen(true);
  }, []);

  // Quick connect trigger from a station node card
  const handleConnectFromNode = useCallback((sourceNodeId: string) => {
    setConnectSource(sourceNodeId);
    const otherNode = firestoreNodes.find(n => n.id !== sourceNodeId);
    if (otherNode) {
      setConnectTarget(otherNode.id);
      setConnectTunnelName(`Gallery ${sourceNodeId}↔${otherNode.id}`);
    }
    setIsTunnelManagerOpen(true);
  }, [firestoreNodes]);

  // Map Firestore nodes to React Flow nodes WITHOUT wiping custom edges
  useEffect(() => {
    if (!firestoreNodes) return;

    const flowNodes: Node<StationNodeData>[] = firestoreNodes.map((fn, index) => {
      const posX = fn.position?.x ?? fn.positionX ?? (80 + (index % 3) * 290);
      const posY = fn.position?.y ?? fn.positionY ?? (80 + Math.floor(index / 3) * 230);

      return {
        id: fn.id,
        type: 'stationNode',
        position: { x: posX, y: posY },
        data: {
          ...fn,
          isSelected: fn.id === selectedNodeId,
          onDelete: handleDeleteNode,
          onEdit: handleEditNode,
          onSelect: onSelectNode,
          onConnectFrom: handleConnectFromNode
        },
      };
    });

    setNodes(flowNodes);

    // Clean up edges only if a connected node no longer exists in Firestore
    if (hasLoadedEdgesRef.current) {
      const validNodeIds = new Set(firestoreNodes.map(n => n.id));
      setEdges(prev => {
        const validEdges = prev.filter(e => validNodeIds.has(e.source) && validNodeIds.has(e.target));
        if (validEdges.length !== prev.length) {
          persistEdges(validEdges);
        }
        return validEdges;
      });
    }
  }, [firestoreNodes, selectedNodeId, handleDeleteNode, handleEditNode, onSelectNode, handleConnectFromNode, persistEdges]);

  // Handle manual dragging: Update Firestore document when drag stops
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
    (changes: EdgeChange[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    []
  );

  // INTERACTIVE DRAG-AND-CONNECT
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;

    setEdges((eds) => {
      // Avoid duplicate connection
      const alreadyExists = eds.some(
        e => (e.source === connection.source && e.target === connection.target) ||
             (e.source === connection.target && e.target === connection.source)
      );
      if (alreadyExists) return eds;

      const newEdge = createTunnelEdge(
        connection.source,
        connection.target,
        `Tunnel ${connection.source}↔${connection.target}`,
        connection.sourceHandle || undefined,
        connection.targetHandle || undefined
      );

      const updated = addEdge(newEdge, eds);
      persistEdges(updated);
      return updated;
    });
  }, [createTunnelEdge, persistEdges]);

  // Apply Dagre auto-layout
  const handleAutoLayout = useCallback(async () => {
    const layouted = getLayoutedElements(nodes, edges, 'TB');
    setNodes([...layouted.nodes]);
    setEdges([...layouted.edges]);

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

  // Cave Preset: Branching Cave
  const applyBranchingCaveLayout = useCallback(async () => {
    if (firestoreNodes.length === 0) return;
    const root = firestoreNodes[0];
    const newEdges: Edge<TunnelEdgeData>[] = [];

    const updatedNodes = firestoreNodes.map((fn, idx) => {
      if (idx === 0) return { ...fn, position: { x: 300, y: 80 } };
      const side = idx % 2 === 1 ? -1 : 1;
      const row = Math.ceil(idx / 2);
      return {
        ...fn,
        position: {
          x: 300 + side * (190 + (row - 1) * 60),
          y: 80 + row * 180
        }
      };
    });

    for (let i = 1; i < firestoreNodes.length; i++) {
      const parent = i <= 2 ? root : firestoreNodes[Math.floor((i - 1) / 2)];
      newEdges.push(createTunnelEdge(
        parent.id,
        firestoreNodes[i].id,
        `Gallery ${parent.id}→${firestoreNodes[i].id}`,
        'bottom-out',
        'top-in'
      ));
    }

    setEdges(newEdges);
    persistEdges(newEdges);

    for (const un of updatedNodes) {
      if (un.position) {
        resilientUpdateDoc(un.id, { position: un.position, positionX: un.position.x, positionY: un.position.y });
      }
    }

    setIsTemplatesOpen(false);
    setTimeout(() => reactFlowInstance.fitView({ padding: 0.2 }), 60);
  }, [firestoreNodes, createTunnelEdge, persistEdges, reactFlowInstance]);

  // Cave Preset: Perimeter Loop Ring
  const applyRingTunnelLayout = useCallback(async () => {
    if (firestoreNodes.length < 2) return;
    const count = firestoreNodes.length;
    const radius = Math.max(200, count * 65);
    const centerX = 350;
    const centerY = 260;

    const newEdges: Edge<TunnelEdgeData>[] = [];
    const updatedNodes = firestoreNodes.map((fn, idx) => {
      const angle = (idx / count) * 2 * Math.PI - Math.PI / 2;
      const x = Math.round(centerX + radius * Math.cos(angle));
      const y = Math.round(centerY + radius * Math.sin(angle));
      return { ...fn, position: { x, y } };
    });

    for (let i = 0; i < count; i++) {
      const src = firestoreNodes[i];
      const tgt = firestoreNodes[(i + 1) % count];
      newEdges.push(createTunnelEdge(src.id, tgt.id, `Ring ${src.id}↔${tgt.id}`));
    }

    setEdges(newEdges);
    persistEdges(newEdges);

    for (const un of updatedNodes) {
      if (un.position) {
        resilientUpdateDoc(un.id, { position: un.position, positionX: un.position.x, positionY: un.position.y });
      }
    }

    setIsTemplatesOpen(false);
    setTimeout(() => reactFlowInstance.fitView({ padding: 0.2 }), 60);
  }, [firestoreNodes, createTunnelEdge, persistEdges, reactFlowInstance]);

  // Disconnect / Clear all edges
  const handleClearAllEdges = useCallback(() => {
    if (window.confirm('Disconnect and clear all tunnels? You can build custom connections anytime.')) {
      setEdges([]);
      persistEdges([]);
      setIsTemplatesOpen(false);
    }
  }, [persistEdges]);

  // Connect Tunnels Modal submit
  const handleCreateCustomTunnel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectSource || !connectTarget || connectSource === connectTarget) {
      alert('Please select two different stations to connect.');
      return;
    }

    // Check duplicate
    const exists = edges.some(
      e => (e.source === connectSource && e.target === connectTarget) ||
           (e.source === connectTarget && e.target === connectSource)
    );
    if (exists) {
      alert('These two stations are already connected by a tunnel.');
      return;
    }

    const newEdge = createTunnelEdge(
      connectSource,
      connectTarget,
      connectTunnelName.trim() || `Gallery ${connectSource}↔${connectTarget}`
    );

    setEdges(eds => {
      const updated = addEdge(newEdge, eds);
      persistEdges(updated);
      return updated;
    });

    setConnectTunnelName('');
  };

  // Add new station modal submit
  const handleCreateNode = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = newId.trim().toUpperCase();
    if (!id) return;

    try {
      const defaultData: Partial<MonitoringNode> = {
        name: newName.trim() || `Station ${id}`,
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

  // Edit station modal submit
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

      {/* Simplified, Clean, Uncongested Top Control Bar */}
      <div className="absolute top-4 left-4 z-10 flex items-center space-x-2 bg-white/95 backdrop-blur-sm p-1.5 rounded-xl border border-slate-200 shadow-sm">
        
        {/* 1. Add Station */}
        <button
          id="btn-add-node"
          onClick={() => {
            const nextNum = firestoreNodes.length + 1;
            setNewId(`N0${nextNum}`);
            setNewName(`Station N0${nextNum}`);
            setIsAddModalOpen(true);
          }}
          className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-700 text-white hover:bg-blue-800 transition-colors shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Node</span>
        </button>

        {/* 2. Connect / Disconnect Tunnels Hub */}
        <button
          onClick={() => {
            if (firestoreNodes.length >= 2 && !connectSource) {
              setConnectSource(firestoreNodes[0].id);
              setConnectTarget(firestoreNodes[1].id);
            }
            setIsTunnelManagerOpen(true);
          }}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 hover:bg-slate-50 border border-slate-300 transition-colors shadow-xs"
          title="Connect or disconnect station tunnels"
        >
          <Link2 className="w-3.5 h-3.5 text-indigo-600" />
          <span>Connect Tunnels</span>
          <span className="ml-1 px-1.5 py-0.2 bg-indigo-50 text-indigo-700 font-bold rounded-full text-[10px]">
            {edges.length}
          </span>
        </button>

        {/* 3. Auto-Layout */}
        <button
          id="btn-auto-layout"
          onClick={handleAutoLayout}
          title="Auto arrange stations"
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 hover:bg-slate-50 border border-slate-300 transition-colors shadow-xs"
        >
          <LayoutGrid className="w-3.5 h-3.5 text-slate-500" />
          <span>Auto-Layout</span>
        </button>

        {/* 4. Compact Templates Menu */}
        <div className="relative">
          <button
            onClick={() => setIsTemplatesOpen(prev => !prev)}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <span>Templates</span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {isTemplatesOpen && (
            <div className="absolute top-full left-0 mt-1.5 w-44 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-30 animate-in fade-in zoom-in-95">
              <button
                onClick={applyBranchingCaveLayout}
                className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-700 flex items-center space-x-2"
              >
                <GitBranch className="w-3.5 h-3.5 text-blue-600" />
                <span>Cave Branching</span>
              </button>
              <button
                onClick={applyRingTunnelLayout}
                className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 flex items-center space-x-2"
              >
                <Link2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Perimeter Loop</span>
              </button>
              <div className="h-px bg-slate-100 my-1"></div>
              <button
                onClick={handleClearAllEdges}
                className="w-full text-left px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 flex items-center space-x-2"
              >
                <Unlink className="w-3.5 h-3.5" />
                <span>Disconnect All</span>
              </button>
            </div>
          )}
        </div>

      </div>

      {/* Top Right: Compact Status Badge */}
      <div className="absolute top-4 right-4 z-10 bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 font-medium shadow-sm flex items-center space-x-2">
        <span><strong className="text-slate-900">{nodes.length}</strong> Stations</span>
        <span className="text-slate-300">•</span>
        <span><strong className="text-blue-700">{edges.length}</strong> Tunnels</span>
      </div>

      {/* React Flow Canvas */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: '#2563eb', strokeWidth: 2, strokeDasharray: '4,4' }}
        fitView
        attributionPosition="bottom-right"
        className="bg-slate-50"
      >
        <Background color="#cbd5e1" gap={20} size={1} />
        <Controls className="!bg-white !border-slate-200 !shadow-sm !rounded-lg" />
      </ReactFlow>

      {/* CONNECT & DISCONNECT TUNNELS MANAGER MODAL */}
      {isTunnelManagerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full p-6 animate-in fade-in zoom-in-95">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <Link2 className="w-4 h-4 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900">Connect & Disconnect Tunnels</h3>
              </div>
              <button
                onClick={() => setIsTunnelManagerOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Section 1: Connect Two Stations */}
            <form onSubmit={handleCreateCustomTunnel} className="space-y-3 mt-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <div className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                + Create New Connection
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">From Station</label>
                  <select
                    value={connectSource}
                    onChange={(e) => setConnectSource(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white font-medium"
                  >
                    <option value="">Select station...</option>
                    {firestoreNodes.map(n => (
                      <option key={n.id} value={n.id}>
                        {n.id} - {n.name || `Station ${n.id}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">To Station</label>
                  <select
                    value={connectTarget}
                    onChange={(e) => setConnectTarget(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white font-medium"
                  >
                    <option value="">Select station...</option>
                    {firestoreNodes.map(n => (
                      <option key={n.id} value={n.id} disabled={n.id === connectSource}>
                        {n.id} - {n.name || `Station ${n.id}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <input
                  type="text"
                  value={connectTunnelName}
                  onChange={(e) => setConnectTunnelName(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                  placeholder="Optional Tunnel Name (e.g. Gallery 1, Main Drift)"
                />
              </div>

              <button
                type="submit"
                disabled={!connectSource || !connectTarget || connectSource === connectTarget}
                className="w-full py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 transition-colors flex items-center justify-center space-x-1.5 shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Connect Tunnel</span>
              </button>
            </form>

            {/* Section 2: Active Tunnels (Disconnect One-Click) */}
            <div className="mt-5">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Active Connections ({edges.length})
                </span>
                {edges.length > 0 && (
                  <button
                    onClick={handleClearAllEdges}
                    className="text-[11px] font-semibold text-red-600 hover:text-red-700"
                  >
                    Disconnect All
                  </button>
                )}
              </div>

              {edges.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400">
                  No tunnels connected. Select two stations above to create a tunnel connection.
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                  {edges.map((edge) => (
                    <div
                      key={edge.id}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-slate-200 text-xs hover:border-slate-300 transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-slate-800 px-1.5 py-0.5 bg-slate-100 rounded text-[11px]">
                          {edge.source}
                        </span>
                        <span className="text-slate-400">⟷</span>
                        <span className="font-bold text-slate-800 px-1.5 py-0.5 bg-slate-100 rounded text-[11px]">
                          {edge.target}
                        </span>
                        {edge.label && (
                          <span className="text-slate-500 text-[11px] truncate max-w-[120px]">
                            ({edge.label})
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() => handleDisconnectTunnel(edge.id)}
                        title="Disconnect this connection"
                        className="px-2 py-1 text-[11px] font-semibold rounded-md bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 border border-red-200 transition-colors flex items-center space-x-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Disconnect</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="mt-5 pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setIsTunnelManagerOpen(false)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
              >
                Done
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ADD STATION MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-sm w-full p-6 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Add Monitoring Station</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateNode} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Station ID (e.g. N04)</label>
                <input
                  type="text"
                  required
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500 uppercase font-mono font-bold"
                  placeholder="N04"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Station Label / Zone</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g. South Drift Sensor"
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

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 transition-colors flex items-center space-x-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Station</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT STATION MODAL */}
      {isEditModalOpen && editingNode && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-sm w-full p-6 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Edit Station {editingNode.id}</h3>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Station Label / Zone Name</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 transition-colors"
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

export const NodeGraphPage: React.FC<NodeGraphPageProps> = (props) => {
  return (
    <ReactFlowProvider>
      <NodeGraphContent {...props} />
    </ReactFlowProvider>
  );
};
