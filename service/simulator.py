"""
simulator.py - SIH26025 Synthetic Sensor Telemetry Generator
Generates realistic time-series sensor data for monitoring stations
when physical hardware units are offline or in demonstration mode.
"""

import os
import time
import random
from datetime import datetime, timezone
from typing import Dict, Any

import firebase_admin  # type: ignore
from firebase_admin import credentials, firestore  # type: ignore

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KEY_PATH = os.path.join(BASE_DIR, "serviceAccountKey.json")

# Ensure firebase-admin is initialized
if not firebase_admin._apps:
    cred = credentials.Certificate(KEY_PATH)
    firebase_admin.initialize_app(cred)

db = firestore.client()

# In-memory station baseline states for smooth walking telemetry
STATION_STATE: Dict[str, Dict[str, float]] = {}


def get_station_baseline(node_id: str, doc_data: dict = None) -> Dict[str, float]:
    """Retrieves or creates continuous baseline state for realistic sensor walk."""
    if node_id not in STATION_STATE:
        data = doc_data or {}
        STATION_STATE[node_id] = {
            "tilt": float(data.get("tilt", 2.2) or 2.2),
            "displacement": float(data.get("groundMovement", data.get("displacement", 0.35)) or 0.35),
            "distance": float(data.get("distance", 52.0) or 52.0),
            "vibration": float(data.get("vibrationRms", data.get("vibration", 0.04)) or 0.04),
            "temperature": float(data.get("temperature", 25.5) or 25.5),
            "humidity": float(data.get("humidity", 52.0) or 52.0),
            "battery": float(data.get("batteryPercentage", 98.0) or 98.0),
            "anomaly_countdown": random.randint(15, 30)  # Cycles before a subtle risk shift
        }
    return STATION_STATE[node_id]


def generate_station_tick(node_id: str, doc_data: dict = None) -> Dict[str, Any]:
    """Generates next continuous sensor tick with smooth random walk."""
    state = get_station_baseline(node_id, doc_data)
    now_iso = datetime.now(timezone.utc).isoformat()
    now_ts = int(time.time() * 1000)

    # Check for occasional anomaly cycle on specific nodes
    state["anomaly_countdown"] -= 1
    is_anomaly = (state["anomaly_countdown"] <= 0) and (node_id in ("N01", "N02"))

    if is_anomaly:
        # Generate temporary elevated slope hazard
        delta_tilt = random.uniform(0.8, 2.5)
        delta_disp = random.uniform(0.15, 0.45)
        vibration = round(random.uniform(0.4, 1.2), 3)
        if state["anomaly_countdown"] < -4:
            # Reset after ~5 anomaly cycles
            state["anomaly_countdown"] = random.randint(25, 45)
    else:
        # Normal subtle sensor walk
        delta_tilt = random.uniform(-0.15, 0.18)
        delta_disp = random.uniform(-0.02, 0.03)
        vibration = round(random.uniform(0.02, 0.08), 3)

    new_tilt = max(0.2, round(state["tilt"] + delta_tilt, 2))
    new_disp = max(0.05, round(state["displacement"] + delta_disp, 3))
    # Distance inverse to ground movement
    new_dist = max(5.0, round(state["distance"] - (delta_disp * 1.2), 1))

    state["tilt"] = new_tilt
    state["displacement"] = new_disp
    state["distance"] = new_dist
    state["vibration"] = vibration

    reading_id = f"{node_id}_{now_ts}"
    reading_doc = {
        "nodeId": node_id,
        "readingId": reading_id,
        "timestamp": now_iso,
        "createdAt": now_iso,
        "tilt": new_tilt,
        "groundMovement": new_disp,
        "displacement": new_disp,
        "distance": new_dist,
        "distanceChange": round(delta_disp, 3),
        "vibration": vibration,
        "vibrationRms": vibration,
        "temperature": round(state["temperature"] + random.uniform(-0.1, 0.1), 1),
        "humidity": round(state["humidity"] + random.uniform(-0.3, 0.3), 0),
        "batteryPercentage": round(max(80.0, state["battery"] - 0.005), 1),
        "rain": False,
        "flame": False
    }

    # 1. Append time-series reading
    db.collection("readings").document(reading_id).set(reading_doc)

    # 2. Update station latest state
    node_update = {
        "tilt": new_tilt,
        "groundMovement": new_disp,
        "displacement": new_disp,
        "distance": new_dist,
        "distanceChange": round(delta_disp, 3),
        "vibration": vibration,
        "vibrationRms": vibration,
        "temperature": reading_doc["temperature"],
        "humidity": reading_doc["humidity"],
        "batteryPercentage": reading_doc["batteryPercentage"],
        "lastSeen": now_iso,
        "status": "online"
    }
    db.collection("nodes").document(node_id).set(node_update, merge=True)

    return reading_doc


def run_simulation_cycle():
    """Runs a single simulation tick across all active stations in Firestore."""
    try:
        nodes_ref = db.collection("nodes").stream()
        active_nodes = list(nodes_ref)
        if not active_nodes:
            # Seed default N01 and N02 if collection is empty
            for default_id in ["N01", "N02"]:
                generate_station_tick(default_id)
        else:
            for doc in active_nodes:
                generate_station_tick(doc.id, doc.to_dict())
    except Exception as e:
        print(f"[Simulator Error]: {e}")


def start_standalone():
    """Runs continuous simulator loop when run directly from command line."""
    interval = int(os.environ.get("SIMULATOR_INTERVAL_SECONDS", 5))
    print(f"Starting SIH26025 Standalone Sensor Simulator (interval={interval}s)... Press Ctrl+C to stop.")
    while True:
        run_simulation_cycle()
        time.sleep(interval)


if __name__ == "__main__":
    start_standalone()
