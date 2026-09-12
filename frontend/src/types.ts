export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type BuzzerState = 'silent' | 'beep_once' | 'beep_continuous';

export interface MonitoringNode {
  id: string;
  nodeId?: string;
  name?: string;
  batteryPercentage?: number;
  connectedAt?: string;
  distance?: number;
  distanceChange?: number;
  distanceStatus?: string;
  groundMovement?: number;
  displacement?: number;
  groundMovementRate?: number;
  groundMovementStatus?: string;
  tilt?: number;
  tiltStatus?: string;
  vibration?: number;
  vibrationRms?: number;
  vibrationStatus?: string;
  temperature?: number;
  humidity?: number;
  gasValue?: number;
  gasStatus?: string;
  soilValue?: number;
  soilStatus?: string;
  rain?: boolean;
  flame?: boolean;
  irTriggered?: boolean;
  status?: string;
  lastSeen?: string;
  lastRiskAssessment?: string;
  riskLevel?: RiskLevel;
  riskScore?: number;
  buzzerState?: BuzzerState;
  position?: { x: number; y: number };
  positionX?: number;
  positionY?: number;
  mlPrediction?: {
    risk_level: string;
    risk_class: number;
    critical_probability: number;
    critical_threshold: number;
    probabilities: Record<string, number>;
  };
}

export interface SensorReading {
  id: string;
  readingId?: string | number;
  nodeId: string;
  timestamp: string;
  createdAt?: string;
  distance?: number;
  distanceChange?: number;
  groundMovement?: number;
  displacement?: number;
  irTriggered?: boolean;
  tilt?: number;
  vibration?: number;
  vibrationRms?: number;
  temperature?: number;
  humidity?: number;
  gasValue?: number;
  soilValue?: number;
  batteryPercentage?: number;
}

export interface RiskAssessment {
  id?: string;
  nodeId: string;
  assessmentId?: string;
  riskLevel?: RiskLevel;
  risk_level?: RiskLevel;
  riskScore?: number;
  risk_score?: number;
  buzzerState?: BuzzerState;
  buzzer_state?: BuzzerState;
  timestamp: string;
  updatedAt?: string;
  safetyOverrideApplied?: boolean;
  critical_probability?: number;
  critical_threshold?: number;
  risk_class?: number;
  probabilities?: {
    NORMAL?: number;
    WARNING?: number;
    HIGH_RISK?: number;
    CRITICAL?: number;
    [key: string]: number | undefined;
  };
  mlPrediction?: any;
  telemetrySnapshot?: Record<string, any>;
}

export interface AlertNotification {
  id: string;
  alertId?: string;
  nodeId?: string;
  severity?: 'LOW' | 'WARNING' | 'HIGH' | 'CRITICAL';
  title?: string;
  message?: string;
  description?: string;
  timestamp?: string;
  riskScore?: number;
  createdAt?: string;
}
