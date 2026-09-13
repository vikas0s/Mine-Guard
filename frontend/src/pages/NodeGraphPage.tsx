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
  MarkerType,
  ReactFlowProvider
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import {
  Plus,
  LayoutGrid,
  Trash2,
  Edit2,
  X,
  Link2,
  Unlink,
  Layers,
  Sparkles,
  GitBranch,
  CornerDownRight,
  Info
} from 'lucide-react';
import { doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { StationNode, StationNodeData } from '../components/StationNode';
import { MonitoringNode } from '../types';

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
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Tunnel Styling & Mode
  const [tunnelStyle, setTunnelStyle] = useState<'smoothstep' | 'straight' | 'default'>('smoothstep');

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
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

  // Resilient CRUD helpers: Use Admin SDK via Python backend as primary
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
  const persistEdges = useCallback(async (updatedEdges: Edge[]) => {
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

  // Initial load of custom edges from Backend / Firestore / LocalStorage
  useEffect(() => {
    const loadSavedEdges = async () => {
      let saved: Edge[] = [];
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
          saved.push({
            id: `tunnel-${firestoreNodes[i].id}-${firestoreNodes[i + 1].id}`,
            source: firestoreNodes[i].id,
            target: firestoreNodes[i + 1].id,
            sourceHandle: 'bottom-out',
            targetHandle: 'top-in',
            animated: true,
            type: 'smoothstep',
            style: { stroke: '#475569', strokeWidth: 2, strokeDasharray: '5,5' },
            label: `Gallery ${firestoreNodes[i].id}↔${firestoreNodes[i + 1].id}`,
            labelStyle: { fill: '#475569', fontWeight: 600, fontSize: 10 },
            labelBgStyle: { fill: '#ffffff', fillOpacity: 0.95, rx: 4, ry: 4 },
            labelBgPadding: [6, 2],
          });
        }
      }

      setEdges(saved);
      hasLoadedEdgesRef.current = true;
    };

    if (!hasLoadedEdgesRef.current) {
      loadSavedEdges();
    }
  }, [firestoreNodes]);

  // Delete node handler
  const handleDeleteNode = useCallback(async (nodeId: string) => {
    if (window.confirm(`Are you sure you want to delete Station ${nodeId}? This removes it from the cave map and Firestore.`)) {
      try {
        await resilientDeleteDoc(nodeId);
        // Also clean up any edges attached to this node
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
          onSelect: onSelectNode
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
  }, [firestoreNodes, selectedNodeId, handleDeleteNode, handleEditNode, onSelectNode, persistEdges]);

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
      setEdges((eds) => {
        const next = applyEdgeChanges(changes, eds);
        return next;
      });
    },
    []
  );

  // INTERACTIVE DRAG-AND-CONNECT: Connect ANY node to ANY node / multiple nodes
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;

    setEdges((eds) => {
      // Avoid exact duplicate connection
      const alreadyExists = eds.some(
        e => (e.source === connection.source && e.target === connection.target) ||
             (e.source === connection.target && e.target === connection.source)
      );
      if (alreadyExists) return eds;

      const newEdge: Edge = {
        ...connection,
        id: `tunnel-${connection.source}-${connection.target}-${Date.now()}`,
        animated: true,
        type: tunnelStyle,
        style: { stroke: '#475569', strokeWidth: 2, strokeDasharray: '5,5' },
        label: `Tunnel ${connection.source}↔${connection.target}`,
        labelStyle: { fill: '#475569', fontWeight: 600, fontSize: 10 },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.95, rx: 4, ry: 4 },
        labelBgPadding: [6, 2],
      };

      const updated = addEdge(newEdge, eds);
      persistEdges(updated);
      return updated;
    });
  }, [tunnelStyle, persistEdges]);

  // Select edge on click
  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId(prev => prev === edge.id ? null : edge.id);
  }, []);

  // Delete selected edge
  const handleDeleteSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) return;
    setEdges(eds => {
      const updated = eds.filter(e => e.id !== selectedEdgeId);
      persistEdges(updated);
      return updated;
    });
    setSelectedEdgeId(null);
  }, [selectedEdgeId, persistEdges]);

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

  // Cave Preset 1: Branching Gallery (Main Adit to Sub-tunnels)
  const applyBranchingCaveLayout = useCallback(async () => {
    if (firestoreNodes.length === 0) return;
    const root = firestoreNodes[0];
    const newEdges: Edge[] = [];

    // Arrange nodes in branching tree
    const updatedNodes = firestoreNodes.map((fn, idx) => {
      if (idx === 0) {
        return { ...fn, position: { x: 300, y: 80 } };
      }
      const side = idx % 2 === 1 ? -1 : 1;
      const row = Math.ceil(idx / 2);
      return {
        ...fn,
        position: {
          x: 300 + side * (180 + (row - 1) * 60),
          y: 80 + row * 170
        }
      };
    });

    // Connect root to all first-level branches, and subsequent nodes to previous
    for (let i = 1; i < firestoreNodes.length; i++) {
      const parent = i <= 2 ? root : firestoreNodes[Math.floor((i - 1) / 2)];
      newEdges.push({
        id: `tunnel-${parent.id}-${firestoreNodes[i].id}-${Date.now()}`,
        source: parent.id,
        target: firestoreNodes[i].id,
        sourceHandle: 'bottom-out',
        targetHandle: 'top-in',
        animated: true,
        type: tunnelStyle,
        style: { stroke: '#3b82f6', strokeWidth: 2, strokeDasharray: '5,5' },
        label: `Gallery ${parent.id}→${firestoreNodes[i].id}`,
        labelStyle: { fill: '#1e40af', fontWeight: 600, fontSize: 10 },
        labelBgStyle: { fill: '#eff6ff', fillOpacity: 0.95, rx: 4, ry: 4 },
        labelBgPadding: [6, 2],
      });
    }

    setEdges(newEdges);
    persistEdges(newEdges);

    // Save node positions
    for (const un of updatedNodes) {
      if (un.position) {
        resilientUpdateDoc(un.id, { position: un.position, positionX: un.position.x, positionY: un.position.y });
      }
    }

    setTimeout(() => reactFlowInstance.fitView({ padding: 0.2 }), 60);
  }, [firestoreNodes, tunnelStyle, persistEdges, reactFlowInstance]);

  // Cave Preset 2: Perimeter Ring / Loop Tunnel (Continuous ventilation circuit)
  const applyRingTunnelLayout = useCallback(async () => {
    if (firestoreNodes.length < 2) return;
    const count = firestoreNodes.length;
    const radius = Math.max(200, count * 60);
    const centerX = 350;
    const centerY = 260;

    const newEdges: Edge[] = [];
    const updatedNodes = firestoreNodes.map((fn, idx) => {
      const angle = (idx / count) * 2 * Math.PI - Math.PI / 2;
      const x = Math.round(centerX + radius * Math.cos(angle));
      const y = Math.round(centerY + radius * Math.sin(angle));
      return { ...fn, position: { x, y } };
    });

    // Form circular loop
    for (let i = 0; i < count; i++) {
      const src = firestoreNodes[i];
      const tgt = firestoreNodes[(i + 1) % count];
      newEdges.push({
        id: `tunnel-loop-${src.id}-${tgt.id}-${Date.now()}`,
        source: src.id,
        target: tgt.id,
        animated: true,
        type: 'smoothstep',
        style: { stroke: '#059669', strokeWidth: 2, strokeDasharray: '4,4' },
        label: `Ring ${src.id}↔${tgt.id}`,
        labelStyle: { fill: '#065f46', fontWeight: 600, fontSize: 10 },
        labelBgStyle: { fill: '#ecfdf5', fillOpacity: 0.95, rx: 4, ry: 4 },
        labelBgPadding: [6, 2],
      });
    }

    setEdges(newEdges);
    persistEdges(newEdges);

    for (const un of updatedNodes) {
      if (un.position) {
        resilientUpdateDoc(un.id, { position: un.position, positionX: un.position.x, positionY: un.position.y });
      }
    }

    setTimeout(() => reactFlowInstance.fitView({ padding: 0.2 }), 60);
  }, [firestoreNodes, persistEdges, reactFlowInstance]);

  // Cave Preset 3: Clear all edges (clean slate)
  const handleClearAllEdges = useCallback(() => {
    if (window.confirm('Clear all tunnel connections? You can redraw custom tunnels between any stations.')) {
      setEdges([]);
      persistEdges([]);
      setSelectedEdgeId(null);
    }
  }, [persistEdges]);

  // Connect Tunnels Modal submit
  const handleCreateCustomTunnel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectSource || !connectTarget || connectSource === connectTarget) {
      alert('Please select two different stations to connect.');
      return;
    }

    const newEdge: Edge = {
      id: `tunnel-${connectSource}-${connectTarget}-${Date.now()}`,
      source: connectSource,
      target: connectTarget,
      animated: true,
      type: tunnelStyle,
      style: { stroke: '#475569', strokeWidth: 2, strokeDasharray: '5,5' },
      label: connectTunnelName.trim() || `Tunnel ${connectSource}↔${connectTarget}`,
      labelStyle: { fill: '#475569', fontWeight: 600, fontSize: 10 },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.95, rx: 4, ry: 4 },
      labelBgPadding: [6, 2],
    };

    setEdges(eds => {
      const updated = addEdge(newEdge, eds);
      persistEdges(updated);
      return updated;
    });

    setIsConnectModalOpen(false);
    setConnectTunnelName('');
  };

  // Add new station modal submit
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

      {/* Top Floating Control Bar: Station Management & Cave Mapping */}
      <div className="absolute top-4 left-4 z-10 flex flex-wrap items-center gap-2 bg-white/95 backdrop-blur-sm p-1.5 rounded-xl border border-slate-200 shadow-md">
        
        {/* Add Station */}
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

        {/* Connect Tunnel Modal Trigger */}
        <button
          onClick={() => {
            if (firestoreNodes.length >= 2) {
              setConnectSource(firestoreNodes[0].id);
              setConnectTarget(firestoreNodes[1].id);
              setConnectTunnelName(`Gallery ${firestoreNodes[0].id}↔${firestoreNodes[1].id}`);
            }
            setIsConnectModalOpen(true);
          }}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors"
          title="Connect any two stations with a named tunnel corridor"
        >
          <Link2 className="w-3.5 h-3.5 text-indigo-600" />
          <span>Connect Tunnel</span>
        </button>

        {/* Auto Layout */}
        <button
          id="btn-auto-layout"
          onClick={handleAutoLayout}
          title="Arrange monitoring stations automatically using Dagre"
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
        >
          <LayoutGrid className="w-3.5 h-3.5 text-slate-600" />
          <span>Auto-Layout</span>
        </button>

        <div className="h-4 w-px bg-slate-200 mx-0.5"></div>

        {/* Cave Map Presets Dropdown */}
        <div className="flex items-center space-x-1">
          <button
            onClick={applyBranchingCaveLayout}
            title="Create a Branching Cave/Mine Gallery with Central Incline"
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-50 text-slate-700 hover:bg-blue-50 hover:text-blue-700 border border-slate-200 transition-colors"
          >
            <GitBranch className="w-3.5 h-3.5 text-blue-600" />
            <span>Cave Branches</span>
          </button>

          <button
            onClick={applyRingTunnelLayout}
            title="Create a Circular Loop / Ring Tunnel Ventilation Circuit"
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-50 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            <span>Loop Ring</span>
          </button>

          <button
            onClick={handleClearAllEdges}
            title="Remove all connections to draw custom tunnels from scratch"
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-50 text-slate-700 hover:bg-red-50 hover:text-red-700 border border-slate-200 transition-colors"
          >
            <Unlink className="w-3.5 h-3.5 text-slate-500" />
            <span>Clear Tunnels</span>
          </button>
        </div>

        <div className="h-4 w-px bg-slate-200 mx-0.5"></div>

        {/* Tunnel Corridor Style Toggle */}
        <div className="flex items-center space-x-1 bg-slate-100 p-0.5 rounded-lg text-xs font-medium text-slate-600">
          <span className="text-[10px] uppercase font-bold text-slate-400 px-1">Tunnel:</span>
          <button
            onClick={() => setTunnelStyle('smoothstep')}
            className={`px-2 py-1 rounded text-xs transition-colors ${
              tunnelStyle === 'smoothstep' ? 'bg-white font-bold text-blue-700 shadow-xs' : 'hover:text-slate-900'
            }`}
            title="Orthogonal 90° mine cross-cut corridors"
          >
            Cross-Cut
          </button>
          <button
            onClick={() => setTunnelStyle('default')}
            className={`px-2 py-1 rounded text-xs transition-colors ${
              tunnelStyle === 'default' ? 'bg-white font-bold text-blue-700 shadow-xs' : 'hover:text-slate-900'
            }`}
            title="Smooth natural cave gallery curves"
          >
            Curved
          </button>
          <button
            onClick={() => setTunnelStyle('straight')}
            className={`px-2 py-1 rounded text-xs transition-colors ${
              tunnelStyle === 'straight' ? 'bg-white font-bold text-blue-700 shadow-xs' : 'hover:text-slate-900'
            }`}
            title="Straight blast drift tunnels"
          >
            Straight
          </button>
        </div>
      </div>

      {/* Top Right: Active Stations & Tunnels Count Badge */}
      <div className="absolute top-4 right-4 z-10 flex items-center space-x-2">
        <div className="bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 font-medium shadow-sm flex items-center space-x-2">
          <span><strong className="text-slate-900">{nodes.length}</strong> Stations</span>
          <span className="text-slate-300">•</span>
          <span><strong className="text-blue-700">{edges.length}</strong> Tunnels</span>
        </div>
      </div>

      {/* Interactive Helper Hint (Bottom Left) */}
      <div className="absolute bottom-4 left-4 z-10 bg-white/90 backdrop-blur-sm px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-600 shadow-sm flex items-center space-x-2 max-w-md pointer-events-none">
        <Info className="w-4 h-4 text-blue-600 flex-shrink-0" />
        <span>
          <strong>Cave Map Tip:</strong> Drag from any <strong>Blue dot</strong> to an <strong>Emerald dot</strong> to build custom tunnels. Connect any node to multiple nodes!
        </span>
      </div>

      {/* Selected Edge Floating Action Bar (Delete Tunnel) */}
      {selectedEdgeId && (
        <div className="absolute bottom-4 right-4 z-10 flex items-center space-x-2 bg-white p-2 rounded-xl border border-blue-200 shadow-lg animate-in fade-in slide-in-from-bottom-2">
          <div className="text-xs text-slate-700 font-semibold px-2">
            Selected Tunnel: <span className="font-mono text-blue-700 font-bold">{selectedEdgeId}</span>
          </div>
          <button
            onClick={handleDeleteSelectedEdge}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-600" />
            <span>Delete Tunnel</span>
          </button>
          <button
            onClick={() => setSelectedEdgeId(null)}
            className="p-1 text-slate-400 hover:text-slate-600 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* React Flow Canvas */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={onEdgeClick}
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

      {/* Connect Tunnels Modal */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-sm w-full p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <Link2 className="w-4 h-4 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900">Connect Cave Tunnels</h3>
              </div>
              <button onClick={() => setIsConnectModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomTunnel} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">From Station (Source)</label>
                <select
                  value={connectSource}
                  onChange={(e) => setConnectSource(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg p-2 font-medium"
                >
                  <option value="">Select source station...</option>
                  {firestoreNodes.map(n => (
                    <option key={n.id} value={n.id}>
                      {n.id} - {n.name || `Station ${n.id}`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">To Station (Destination)</label>
                <select
                  value={connectTarget}
                  onChange={(e) => setConnectTarget(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg p-2 font-medium"
                >
                  <option value="">Select target station...</option>
                  {firestoreNodes.map(n => (
                    <option key={n.id} value={n.id} disabled={n.id === connectSource}>
                      {n.id} - {n.name || `Station ${n.id}`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tunnel / Gallery Name (Optional)</label>
                <input
                  type="text"
                  value={connectTunnelName}
                  onChange={(e) => setConnectTunnelName(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg p-2"
                  placeholder="e.g. Main Incline Drift, Cross-Cut 1"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsConnectModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!connectSource || !connectTarget || connectSource === connectTarget}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 transition-colors flex items-center space-x-1.5"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>Build Tunnel</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                  placeholder="e.g. Cave Sector 4 Incline"
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
