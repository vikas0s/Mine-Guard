import { useMemo, useState, useEffect } from 'react';
import {
  Ruler,
  Activity,
  Compass,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Radio,
  Battery,
  Thermometer,
  Droplets,
  Flame,
  Clock,
  TrendingUp,
  Volume2,
  BrainCircuit,
  Layers
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Legend
} from 'recharts';

// Safe wrapper to resolve Recharts class component JSX typing conflict in React 18/19
const SafeReferenceLine: React.ComponentType<any> = ReferenceLine as any;

import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { MonitoringNode, SensorReading, AlertNotification, RiskAssessment } from '../types';

interface DashboardPageProps {
  nodes: MonitoringNode[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
  readings: SensorReading[];
  alerts: AlertNotification[];
  audioEnabled: boolean;
  onSimulateSpike: () => void;
  onSimulateNormalize: () => void;
}

// A node is considered ONLINE if it has reported within roughly
// 4x the expected send interval (5s loop -> 20s window). Adjust
// ONLINE_THRESHOLD_MS if your hardware/simulator interval changes.
const ONLINE_THRESHOLD_MS = 20000;

function isNodeOnline(lastSeen: string | number | undefined): boolean {
  if (!lastSeen) return false;
  const lastSeenTime = new Date(lastSeen).getTime();
  if (Number.isNaN(lastSeenTime)) return false;
  return Date.now() - lastSeenTime < ONLINE_THRESHOLD_MS;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  nodes,
  selectedNodeId,
  onSelectNode,
  readings,
  alerts,
  audioEnabled,
  onSimulateSpike,
  onSimulateNormalize
}) => {
  const node = nodes.find(n => n.id === selectedNodeId) || nodes[0];

  // Filter readings for selected node and format for chart
  const chartData = useMemo(() => {
    if (!node) return [];
    const nodeReadings = readings
      .filter(r => r.nodeId === node.id)
      .slice(-20); // last 20 readings

    if (nodeReadings.length === 0) {
      // Provide initial fallback point from current node state
      const now = new Date();
      return Array.from({ length: 10 }).map((_, i) => {
        const t = new Date(now.getTime() - (9 - i) * 10000);
        return {
          time: t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          tilt: Number(node.tilt || 0),
          displacement: Number(node.groundMovement || node.displacement || 0),
          distance: Number(node.distance || 50)
        };
      });
    }

    return nodeReadings.map((r, index) => {
      let timeLabel = `T-${nodeReadings.length - index}`;
      if (r.timestamp) {
        try {
          const d = new Date(r.timestamp);
          timeLabel = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch {
          // fallback
        }
      }
      return {
        time: timeLabel,
        tilt: Number(r.tilt ?? node.tilt ?? 0),
        displacement: Number(r.groundMovement ?? r.displacement ?? node.groundMovement ?? node.displacement ?? 0),
        distance: Number(r.distance ?? node.distance ?? 0)
      };
    });
  }, [node, readings]);

  const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:5000';
  const [historyAssessments, setHistoryAssessments] = useState<RiskAssessment[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(true);

  // Fetch initial prediction history and subscribe to live riskAssessments for this station
  useEffect(() => {
    if (!node?.id) return;
    setHistoryLoading(true);

    // 1. Initial history fetch from Python service endpoint
    fetch(`${API_BASE}/api/nodes/${node.id}/history?limit=50`)
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        if (data.history && Array.isArray(data.history)) {
          setHistoryAssessments(data.history);
        }
      })
      .catch(err => console.warn('History fetch notice:', err.message || err))
      .finally(() => setHistoryLoading(false));

    // 2. Real-time subscription to riskAssessments
    try {
      const q = query(collection(db, 'riskAssessments'), where('nodeId', '==', node.id));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added' || change.type === 'modified') {
            const item = change.doc.data() as RiskAssessment;
            if (item.timestamp && (item.probabilities || item.riskScore !== undefined || item.risk_score !== undefined)) {
              setHistoryAssessments(prev => {
                const docId = change.doc.id;
                const existingIdx = prev.findIndex(p =>
                  p.id === docId ||
                  p.assessmentId === item.assessmentId ||
                  p.timestamp === item.timestamp
                );
                let updated;
                if (existingIdx >= 0) {
                  updated = [...prev];
                  updated[existingIdx] = { ...item, id: docId };
                } else {
                  updated = [...prev, { ...item, id: docId }];
                }
                updated.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                return updated.slice(-50);
              });
            }
          }
        });
      }, (err) => {
        console.warn('Realtime riskAssessments onSnapshot notice:', err);
      });

      return () => unsubscribe();
    } catch (err) {
      console.warn('Subscription setup notice:', err);
    }
  }, [node?.id]);

  // Compute prediction chart data
  const predictionChartData = useMemo(() => {
    return historyAssessments.map((a, idx) => {
      let timeLabel = `T-${historyAssessments.length - idx}`;
      try {
        const d = new Date(a.timestamp);
        timeLabel = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch { }

      const score = Number(a.risk_score ?? a.riskScore ?? 0);
      const probs = a.probabilities || a.mlPrediction?.probabilities || {};

      const normal = Math.round((Number(probs.NORMAL ?? 0)) * 100);
      const warning = Math.round((Number(probs.WARNING ?? 0)) * 100);
      const highRisk = Math.round((Number(probs.HIGH_RISK ?? 0)) * 100);
      const critical = Math.round((Number(probs.CRITICAL ?? 0)) * 100);

      const isLatest = idx === historyAssessments.length - 1;

      return {
        time: timeLabel,
        timestamp: a.timestamp,
        score,
        level: a.risk_level ?? a.riskLevel ?? 'LOW',
        normal,
        warning,
        highRisk,
        critical,
        isLatest
      };
    });
  }, [historyAssessments]);

  if (!node) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center p-8 bg-white rounded-xl shadow-sm border border-slate-200">
          <Activity className="w-8 h-8 text-slate-400 mx-auto animate-spin" />
          <h3 className="mt-3 text-base font-semibold text-slate-700">Connecting to Firestore...</h3>
          <p className="text-sm text-slate-500 mt-1">Listening for active monitoring nodes</p>
        </div>
      </div>
    );
  }

  const riskLevel = node.riskLevel || 'LOW';
  const riskScore = node.riskScore ?? (riskLevel === 'HIGH' ? 5 : riskLevel === 'MEDIUM' ? 3 : 0);
  const buzzerState = node.buzzerState || 'silent';

  const tiltVal = Number(node.tilt || 0);
  const dispVal = Number(node.groundMovement || node.displacement || 0);
  const distVal = Number(node.distance || 0);
  const distChange = Number(node.distanceChange || 0);

  // Real online/synced status, derived from lastSeen instead of hardcoded
  const nodeOnline = isNodeOnline(node.lastSeen);

  return (
    <div className="space-y-6 pb-12">

      {/* Station Selector Pill Bar & Status Header */}
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Station {node.id}
            </h1>
            {node.name && (
              <span className="text-sm font-medium text-slate-500 px-2.5 py-0.5 bg-slate-100 rounded-md">
                {node.name}
              </span>
            )}
            {/* FIX: was hardcoded to always show ONLINE - now derived from node.lastSeen */}
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${nodeOnline
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-slate-100 text-slate-500 border-slate-200'
              }`}>
              <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${nodeOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                }`}></span>
              {nodeOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          <div className="flex items-center space-x-4 text-xs text-slate-500 mt-1">
            <span className="flex items-center">
              <Clock className="w-3.5 h-3.5 mr-1 text-slate-400" />
              Last reading: {node.lastSeen ? new Date(node.lastSeen).toLocaleTimeString() : 'No data yet'}
            </span>
            <span>•</span>
            <span>Firmware: SIH26025 v2.4</span>
          </div>
        </div>

        {/* Quick Node Switcher Buttons */}
        <div className="flex items-center flex-wrap gap-2">
          <span className="text-xs font-medium text-slate-500 mr-1">Switch Station:</span>
          {nodes.map(n => {
            const isSelected = n.id === node.id;
            const rLevel = n.riskLevel || 'LOW';
            return (
              <button
                key={n.id}
                onClick={() => onSelectNode(n.id)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${isSelected
                    ? 'bg-blue-700 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
              >
                <span>{n.id}</span>
                <span
                  className={`w-2 h-2 rounded-full ${rLevel === 'HIGH' ? 'bg-red-500' : rLevel === 'MEDIUM' ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Primary Telemetry Cards (5 Core Metrics) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">

        {/* 1. Distance (Ultrasonic) */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Distance (Ultrasonic)</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Ruler className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">
              {distVal.toFixed(1)} <span className="text-sm font-normal text-slate-500">cm</span>
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-xs">
              <span className="text-slate-500">Delta:</span>
              <span className={`font-semibold ${distChange > 0 ? 'text-amber-600' : 'text-slate-700'}`}>
                {distChange >= 0 ? `+${distChange.toFixed(1)}` : distChange.toFixed(1)} cm
              </span>
            </div>
          </div>
        </div>

        {/* 2. Displacement / Ground Movement */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Displacement</span>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${dispVal > 2.0 ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'
              }`}>
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">
              {dispVal.toFixed(2)} <span className="text-sm font-normal text-slate-500">cm</span>
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-xs">
              <span className="text-slate-500">Safe Limit:</span>
              <span className={`font-semibold ${dispVal > 2.0 ? 'text-amber-600 font-bold' : 'text-emerald-600'}`}>
                ≤ 2.00 cm
              </span>
            </div>
          </div>
        </div>

        {/* 3. Tilt (Inclinometer) */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Tilt (Angle)</span>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tiltVal > 10.0 ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'
              }`}>
              <Compass className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">
              {tiltVal.toFixed(1)} <span className="text-sm font-normal text-slate-500">°</span>
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-xs">
              <span className="text-slate-500">Safe Limit:</span>
              <span className={`font-semibold ${tiltVal > 10.0 ? 'text-amber-600 font-bold' : 'text-emerald-600'}`}>
                ≤ 10.0°
              </span>
            </div>
          </div>
        </div>

        {/* 4. Risk Level & Score */}
        <div className={`rounded-xl p-5 border shadow-sm flex flex-col justify-between ${riskLevel === 'HIGH'
            ? 'bg-red-50/50 border-red-200'
            : riskLevel === 'MEDIUM'
              ? 'bg-amber-50/50 border-amber-200'
              : 'bg-emerald-50/40 border-emerald-200'
          }`}>
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Risk Level</span>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center">
              {riskLevel === 'HIGH' && <ShieldAlert className="w-5 h-5 text-red-600" />}
              {riskLevel === 'MEDIUM' && <AlertTriangle className="w-5 h-5 text-amber-600" />}
              {riskLevel === 'LOW' && <ShieldCheck className="w-5 h-5 text-emerald-600" />}
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline space-x-2">
              <span className={`text-2xl font-black ${riskLevel === 'HIGH' ? 'text-red-700' : riskLevel === 'MEDIUM' ? 'text-amber-700' : 'text-emerald-700'
                }`}>
                {riskLevel}
              </span>
              <span className="text-xs font-bold text-slate-600">
                Score {riskScore}/5
              </span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-1.5 mt-2 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${riskLevel === 'HIGH' ? 'bg-red-600' : riskLevel === 'MEDIUM' ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                style={{ width: `${(riskScore / 5) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* 5. Buzzer Status */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Buzzer Alert</span>
            <div className="w-8 h-8 rounded-lg bg-slate-50 text-slate-600 flex items-center justify-center">
              <Radio className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-center space-x-2">
              {buzzerState === 'beep_continuous' ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full bg-red-600 animate-buzzer-fast"></span>
                  <span className="text-lg font-bold text-red-700">Continuous Beep</span>
                </>
              ) : buzzerState === 'beep_once' ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full bg-amber-500 animate-buzzer-pulse"></span>
                  <span className="text-lg font-bold text-amber-700">One Beep</span>
                </>
              ) : (
                <>
                  <span className="w-3.5 h-3.5 rounded-full bg-slate-300"></span>
                  <span className="text-lg font-bold text-slate-700">Silent</span>
                </>
              )}
            </div>
            {/* FIX: was hardcoded to always show "Active" - now reflects real online status */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
              <span>Hardware Synced:</span>
              <span className={`font-medium ${nodeOnline ? 'text-emerald-600' : 'text-slate-400'}`}>
                {nodeOnline ? 'Active' : 'Stale'}
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* Middle Section: Line Chart & Environmental / Secondary Telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Trend Line Chart (Displacement & Tilt) */}
        <div className="lg:col-span-2 bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <TrendingUp className="w-4 h-4 text-blue-700" />
                <span>Strata Deformation Trend (Recent Readings)</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Real-time tracking of displacement (cm) vs inclinometer tilt (°) with safety threshold lines
              </p>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis yAxisId="left" stroke="#3b82f6" fontSize={11} domain={[0, 'auto']} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" fontSize={11} domain={[0, 'auto']} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderColor: '#e2e8f0',
                    borderRadius: '0.5rem',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    fontSize: '12px'
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />

                {/* Safe Limit Thresholds */}
                <SafeReferenceLine yAxisId="left" y={2.0} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Disp 2cm Limit', fill: '#ef4444', fontSize: 10 }} />
                <SafeReferenceLine yAxisId="right" y={10.0} stroke="#f97316" strokeDasharray="4 4" label={{ value: 'Tilt 10° Limit', fill: '#f97316', fontSize: 10 }} />

                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="displacement"
                  name="Displacement (cm)"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#2563eb' }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="tilt"
                  name="Tilt (°)"
                  stroke="#d97706"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#d97706' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Secondary Telemetry & Environmental Status */}
        <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 mb-1">
              Station Telemetry
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Auxiliary sensors and battery health status
            </p>

            <div className="space-y-3.5">
              {/* Battery */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <div className="flex items-center space-x-2.5">
                  <Battery className="w-4 h-4 text-slate-600" />
                  <span className="text-xs font-semibold text-slate-700">Battery Level</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-slate-900">
                    {node.batteryPercentage !== undefined ? `${Math.round(node.batteryPercentage)}%` : '100%'}
                  </span>
                </div>
              </div>

              {/* Temperature */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <div className="flex items-center space-x-2.5">
                  <Thermometer className="w-4 h-4 text-slate-600" />
                  <span className="text-xs font-semibold text-slate-700">Temperature</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-slate-900">
                    {node.temperature !== undefined ? `${node.temperature.toFixed(1)} °C` : '25.0 °C'}
                  </span>
                </div>
              </div>

              {/* Humidity */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <div className="flex items-center space-x-2.5">
                  <Droplets className="w-4 h-4 text-slate-600" />
                  <span className="text-xs font-semibold text-slate-700">Humidity</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-slate-900">
                    {node.humidity !== undefined ? `${node.humidity.toFixed(0)}%` : '50%'}
                  </span>
                </div>
              </div>

              {/* Vibration RMS */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <div className="flex items-center space-x-2.5">
                  <Activity className="w-4 h-4 text-slate-600" />
                  <span className="text-xs font-semibold text-slate-700">Vibration (RMS)</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-slate-900">
                    {Number(node.vibrationRms || node.vibration || 0).toFixed(3)} g
                  </span>
                </div>
              </div>

              {/* Flame / Gas */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <div className="flex items-center space-x-2.5">
                  <Flame className="w-4 h-4 text-slate-600" />
                  <span className="text-xs font-semibold text-slate-700">Hazardous Gas / Flame</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-semibold text-emerald-600">
                    {node.flame ? 'FLAME DETECTED' : 'Normal'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Jury Simulation Controls */}
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center space-x-2">
            <button
              onClick={onSimulateSpike}
              className="w-1/2 py-2 px-3 text-xs font-semibold rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors flex items-center justify-center space-x-1"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-red-600" />
              <span>Simulate Spike</span>
            </button>
            <button
              onClick={onSimulateNormalize}
              className="w-1/2 py-2 px-3 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors flex items-center justify-center space-x-1"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Reset Safe</span>
            </button>
          </div>
        </div>

      </div>

      {/* NEW Section: Live ML Risk Prediction Trend & Model Confidence Breakdown */}
      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-5 border-b border-slate-100 gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
              <BrainCircuit className="w-5 h-5 text-blue-700" />
              <span>Risk Prediction Trend</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Continuous Machine Learning inferences over time for Station {node.id}, tracking 0–5 risk score trajectory and 4-class classification confidence
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600 mr-1.5 animate-pulse"></span>
              Random Forest ML Engine (22 Features)
            </span>
          </div>
        </div>

        {predictionChartData.length < 3 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 bg-slate-50/70 rounded-xl border border-dashed border-slate-200">
            <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-2.5">
              <Clock className="w-5 h-5 animate-pulse text-blue-600" />
            </div>
            <h4 className="text-sm font-semibold text-slate-800">Collecting prediction history…</h4>
            <p className="text-xs text-slate-500 max-w-sm mt-1">
              The continuous Python prediction loop is processing live sensor cycles. ML risk score progression and probability breakdown will plot here automatically.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Chart 1: Risk Score Over Time (0 - 5) */}
            <div className="border border-slate-100 rounded-xl p-4 bg-slate-50/40">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Risk Score Trajectory (0–5)
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    Bands: LOW (0–1) • MEDIUM (2–4) • HIGH (5)
                  </span>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded border ${node.riskLevel === 'HIGH'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : node.riskLevel === 'MEDIUM'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  }`}>
                  Current: {node.riskScore ?? (node.riskLevel === 'HIGH' ? 5 : node.riskLevel === 'MEDIUM' ? 3 : 0)}/5
                </span>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={predictionChartData} margin={{ top: 10, right: 20, left: -15, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} tickLine={false} />
                    <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} stroke="#64748b" fontSize={10} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        borderColor: '#e2e8f0',
                        borderRadius: '0.5rem',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        fontSize: '11px'
                      }}
                      formatter={(val: any) => [`Score: ${val}/5`, 'Risk Score']}
                    />
                    {/* Horizontal Reference Bands */}
                    <SafeReferenceLine y={1} stroke="#16a34a" strokeDasharray="3 3" strokeWidth={1} label={{ value: 'LOW (0-1)', fill: '#16a34a', fontSize: 10, position: 'insideTopLeft' }} />
                    <SafeReferenceLine y={4} stroke="#d97706" strokeDasharray="3 3" strokeWidth={1} label={{ value: 'MEDIUM (2-4)', fill: '#d97706', fontSize: 10, position: 'insideTopLeft' }} />
                    <SafeReferenceLine y={5} stroke="#dc2626" strokeDasharray="3 3" strokeWidth={1} label={{ value: 'HIGH (5)', fill: '#dc2626', fontSize: 10, position: 'insideTopLeft' }} />

                    <Line
                      type="stepAfter"
                      dataKey="score"
                      name="Risk Score"
                      stroke="#1e40af"
                      strokeWidth={2.5}
                      dot={(props) => {
                        const { cx, cy, payload } = props;
                        const isHigh = payload.score >= 5;
                        const isMed = payload.score >= 2 && payload.score < 5;
                        const dotColor = isHigh ? '#dc2626' : isMed ? '#d97706' : '#16a34a';
                        return (
                          <circle
                            key={props.key}
                            cx={cx}
                            cy={cy}
                            r={payload.isLatest ? 5.5 : 3}
                            fill={dotColor}
                            stroke="#ffffff"
                            strokeWidth={payload.isLatest ? 2 : 1}
                          />
                        );
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 2: Model Confidence Breakdown (4-Class Stacked Area) */}
            <div className="border border-slate-100 rounded-xl p-4 bg-slate-50/40">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Model Confidence Distribution
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    Live 4-class probability breakdown shifting over time (0–100%)
                  </span>
                </div>
                <div className="flex items-center space-x-1.5 text-[10px] text-slate-500 font-medium">
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  <span>Stacked 100%</span>
                </div>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={predictionChartData} margin={{ top: 10, right: 20, left: -15, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} tickLine={false} />
                    <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} stroke="#64748b" fontSize={10} tickLine={false} unit="%" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        borderColor: '#e2e8f0',
                        borderRadius: '0.5rem',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        fontSize: '11px'
                      }}
                      formatter={(val: any, name: any) => [`${val}%`, name]}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '4px' }} />

                    {/* Stacked Areas for the 4 Classes */}
                    <Area type="monotone" dataKey="normal" stackId="1" name="NORMAL" stroke="#16a34a" fill="#dcfce7" fillOpacity={0.8} />
                    <Area type="monotone" dataKey="warning" stackId="1" name="WARNING" stroke="#d97706" fill="#fef3c7" fillOpacity={0.85} />
                    <Area type="monotone" dataKey="highRisk" stackId="1" name="HIGH_RISK" stroke="#ea580c" fill="#ffedd5" fillOpacity={0.85} />
                    <Area type="monotone" dataKey="critical" stackId="1" name="CRITICAL" stroke="#dc2626" fill="#fee2e2" fillOpacity={0.9} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* Bottom Section: Active Alerts Feed */}
      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 text-red-600" />
              <span>Safety & Hazard Alerts Feed</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live records from Firestore alerts collection for MEDIUM and HIGH risks
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
            {alerts.length} Total Alerts
          </span>
        </div>

        {alerts.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-400">
            No active hazard alerts recorded. All stations operating within normal parameters.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto pr-1">
            {alerts.slice(0, 8).map(alert => (
              <div key={alert.id} className="py-3 flex items-start justify-between">
                <div className="flex items-start space-x-3">
                  <div className="mt-0.5">
                    {alert.severity === 'CRITICAL' || alert.severity === 'HIGH' ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500 block animate-pulse"></span>
                    ) : (
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 block"></span>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-slate-900">
                        {alert.title || `Alert: ${alert.nodeId}`}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.2 rounded border ${alert.severity === 'CRITICAL' || alert.severity === 'HIGH'
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>
                        {alert.severity || 'WARNING'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      {alert.message || alert.description || 'Threshold exceeded'}
                    </p>
                  </div>
                </div>
                <span className="text-[11px] text-slate-400 whitespace-nowrap ml-4">
                  {alert.timestamp || (alert.createdAt ? new Date(alert.createdAt).toLocaleTimeString() : 'Recent')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};