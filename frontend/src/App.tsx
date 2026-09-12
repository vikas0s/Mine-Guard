import { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from './firebase';
import { Navbar } from './components/Navbar';
import { DashboardPage } from './pages/DashboardPage';
import { NodeGraphPage } from './pages/NodeGraphPage';
import { MonitoringNode, SensorReading, AlertNotification } from './types';

const API_BASE = 'http://localhost:5000';

export function App() {
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'graph'>('dashboard');
  const [nodes, setNodes] = useState<MonitoringNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('N01');
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [alerts, setAlerts] = useState<AlertNotification[]>([]);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(false);
  const [backendOnline, setBackendOnline] = useState<boolean>(false);

  const audioContextRef = useRef<AudioContext | null>(null);

  // 1. Subscribe to Firestore `nodes` collection in real-time
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'nodes'), (snapshot) => {
      const nodeList: MonitoringNode[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        nodeList.push({
          id: docSnap.id,
          nodeId: docSnap.id,
          ...data
        } as MonitoringNode);
      });
      // Sort predictably by ID (e.g. N01, N02)
      nodeList.sort((a, b) => a.id.localeCompare(b.id));
      setNodes(nodeList);

      // Ensure a valid node is selected
      if (nodeList.length > 0) {
        setSelectedNodeId(prev => {
          const exists = nodeList.some(n => n.id === prev);
          return exists ? prev : nodeList[0].id;
        });
      }
    }, (error) => {
      console.error("Error subscribing to nodes collection:", error);
    });

    return () => unsubscribe();
  }, []);

  // 2. Subscribe to Firestore `readings` collection in real-time
  useEffect(() => {
    const q = query(collection(db, 'readings'), limit(150));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const readingList: SensorReading[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        readingList.push({
          id: docSnap.id,
          ...data
        } as SensorReading);
      });
      // Sort by timestamp ascending
      readingList.sort((a, b) => {
        const tA = new Date(a.timestamp || a.createdAt || 0).getTime();
        const tB = new Date(b.timestamp || b.createdAt || 0).getTime();
        return tA - tB;
      });
      setReadings(readingList);
    }, (error) => {
      console.warn("Notice: readings subscription error:", error);
    });

    return () => unsubscribe();
  }, []);

  // 3. Subscribe to Firestore `alerts` collection in real-time
  useEffect(() => {
    const q = query(collection(db, 'alerts'), limit(30));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const alertList: AlertNotification[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        alertList.push({
          id: docSnap.id,
          ...data
        } as AlertNotification);
      });
      // Sort newest first
      alertList.sort((a, b) => {
        const tA = new Date(a.createdAt || a.timestamp || 0).getTime();
        const tB = new Date(b.createdAt || b.timestamp || 0).getTime();
        return tB - tA;
      });
      setAlerts(alertList);
    }, (error) => {
      console.warn("Notice: alerts subscription error:", error);
    });

    return () => unsubscribe();
  }, []);

  // 4. Check Python Backend Service connectivity
  useEffect(() => {
    const checkBackend = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/health`);
        if (res.ok) {
          setBackendOnline(true);
        }
      } catch {
        setBackendOnline(false);
      }
    };
    checkBackend();
    const interval = setInterval(checkBackend, 10000);
    return () => clearInterval(interval);
  }, []);

  // 5. Sound synthesizer for HIGH risk buzzer alarm
  useEffect(() => {
    if (!audioEnabled) return;
    const activeNode = nodes.find(n => n.id === selectedNodeId);
    if (!activeNode) return;

    if (activeNode.buzzerState === 'beep_continuous' || activeNode.riskLevel === 'HIGH') {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') {
          ctx.resume();
        }
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, ctx.currentTime); // 880 Hz beep
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } catch (err) {
        console.warn("Web audio playback failed:", err);
      }
    }
  }, [nodes, selectedNodeId, audioEnabled]);

  // Simulation handlers calling Python service
  const handleSimulateSpike = async () => {
    try {
      await fetch(`${API_BASE}/api/simulate/spike/${selectedNodeId}`, { method: 'POST' });
    } catch (err) {
      console.warn("Spike triggered locally or backend offline:", err);
    }
  };

  const handleSimulateNormalize = async () => {
    try {
      await fetch(`${API_BASE}/api/simulate/normalize/${selectedNodeId}`, { method: 'POST' });
    } catch (err) {
      console.warn("Normalize triggered locally or backend offline:", err);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC]">
      <Navbar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        nodes={nodes}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        audioEnabled={audioEnabled}
        onToggleAudio={() => setAudioEnabled(prev => !prev)}
        onSimulateSpike={handleSimulateSpike}
        onSimulateNormalize={handleSimulateNormalize}
        backendOnline={backendOnline}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {currentTab === 'dashboard' ? (
          <DashboardPage
            nodes={nodes}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            readings={readings}
            alerts={alerts}
            audioEnabled={audioEnabled}
            onSimulateSpike={handleSimulateSpike}
            onSimulateNormalize={handleSimulateNormalize}
          />
        ) : (
          <NodeGraphPage
            nodes={nodes}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-3 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>SIH26025 — Slope & Structure Stability Monitoring System</span>
          <div className="flex items-center space-x-3">
            <span className="flex items-center space-x-1">
              <span className={`w-2 h-2 rounded-full ${backendOnline ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
              <span>Python ML Service: {backendOnline ? 'Online (Port 5000)' : 'Connecting...'}</span>
            </span>
            <span>•</span>
            <span>Firestore: Synced</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
