# SIH26025 — Slope & Structure Stability Monitoring System

An autonomous real-time slope and structure stability early warning monitoring system designed for open-cast mines, engineered rock slopes, and critical infrastructure.

---

## 🏛️ Architecture

```
Sensors (or Simulator) ──> Cloud Firestore (nodes, readings, alerts, riskAssessments)
                                  │
      Python Service (Flask) ─────┴──> Loads predictor.py & .pkl artifacts (untouched)
                                       Derives 22 features (rolling buffers & network means)
                                       Runs ML risk prediction + raw sensor safety overrides
                                       Writes riskAssessments + updates nodes/{nodeId} doc
                                  │
      React Frontend (Vite) ──────┘──> Real-time Firestore onSnapshot listeners:
                                       1. Sensor Dashboard (Ultrasonic, Inclinometer, Buzzer)
                                       2. Interactive Station Node Graph (React Flow + Dagre)
```

---

## 📁 Repository Structure

```
Mine_Guard/
├── service/                   # Lightweight Python Flask ML Service
│   ├── model/
│   │   ├── predictor.py       # Pre-trained Random Forest predictor (UNTOUCHED)
│   │   ├── sih26025_final_model.pkl
│   │   ├── sih26025_scaler.pkl
│   │   ├── sih26025_features.pkl
│   │   └── sih26025_config.pkl
│   ├── app.py                 # Flask server & Firestore synchronization worker
│   ├── risk_mapper.py         # 4-class to 3-tier mapping & safety net overrides
│   ├── feature_builder.py     # Computes 22 rolling and network-wide features
│   ├── serviceAccountKey.json # Firebase Admin SDK credentials
│   └── requirements.txt       # Python dependencies
│
├── frontend/                  # Modern React + Vite Frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── Navbar.tsx      # Top bar with view toggle, station switcher & audio alert
│   │   │   └── StationNode.tsx # Custom React Flow node with independent risk tints
│   │   ├── pages/
│   │   │   ├── DashboardPage.tsx # Real-time sensor cards, recharts trend, buzzer
│   │   │   └── NodeGraphPage.tsx # Interactive node graph with Dagre & Firestore CRUD
│   │   ├── firebase.ts        # Cloud Firestore initialization
│   │   ├── types.ts           # Unified data models
│   │   ├── App.tsx            # Real-time onSnapshot listeners & root routing
│   │   └── index.css          # Design system styles
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
```

---

## 🚀 Quick Start Guide

### 1. Start Python ML Flask Service
```bash
# Using the project's Python environment
"c:\Users\vikas\OneDrive\Desktop\Mine Guard\backend\.venv\Scripts\python.exe" service/app.py
```
- Runs on `http://localhost:5000`
- Scans `nodes` in Firestore, generates the 22 features, runs `predict_mine_risk()`, applies safety overrides, writes `riskAssessments`, and updates `nodes/{nodeId}`.

### 2. Start Frontend Dev Server
```bash
cd frontend
npm run dev
```
- Runs on `http://localhost:5173`
- Connects directly to Firestore via `onSnapshot` real-time listeners.

---

## 🎯 Key Specifications Satisfied

1. **Untouched Model Integration**:
   - `service/model/predictor.py` and all `.pkl` files are preserved verbatim.
   - `feature_builder.py` loads `features.pkl` dynamically and computes all 22 required rolling and network-wide stats.
2. **3-Tier Risk System & Single Lookup Table**:
   - `NORMAL` $\to$ `LOW` (Score 0, Buzzer: Silent)
   - `WARNING` $\to$ `MEDIUM` (Score 2–4 based on `critical_probability * 5`, Buzzer: One beep)
   - `HIGH_RISK` / `CRITICAL` $\to$ `HIGH` (Score 5, Buzzer: Continuous beep)
3. **Raw Sensor Safety Overrides**:
   - Tilt $\le 10^\circ$ and Displacement $\le 2\text{ cm}$ $\to$ `LOW`
   - Tilt $> 10^\circ$ or Displacement $> 2\text{ cm}$ $\to$ `MEDIUM`
   - Both severely exceeded ($> 25^\circ$ or $> 5\text{ cm}$) $\to$ `HIGH`
4. **Independent Per-Node Coloring**:
   - In the station graph, each node's border, background tint, and badge reflect strictly its own latest state and prediction from Firestore without shared contamination.
5. **Full Firestore CRUD**:
   - **Create**: Add new monitoring station via modal.
   - **Read**: Live `onSnapshot` updates per node.
   - **Update**: Edit station name or drag stations on canvas (positions sync to Firestore).
   - **Delete**: Remove station document from Firestore.
6. **Government/Engineering Control-Room Aesthetic**:
   - Light `#F8FAFC` background, clean typography, soft card shadows, generous whitespace, confident `#1E40AF` deep blue accent, and accessible risk badges.
