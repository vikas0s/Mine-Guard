"""
simulator.py - SIH26025 Synthetic Sensor Telemetry Generator
Generates realistic time-series sensor data for monitoring stations
when physical hardware units are offline or in demonstration mode.

FIX (see notes at bottom): this version NEVER auto-creates nodes.
It only ever ticks nodes that already exist in Firestore. If you
want demo nodes, create them explicitly (see seed_demo_nodes()).
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

    state["anomaly_countdown"] -= 1
    is_anomaly = (state["anomaly_countdown"] <= 0) and (node_id in ("N01", "N02"))

    if is_anomaly:
        delta_tilt = random.uniform(0.8, 2.5)
        delta_disp = random.uniform(0.15, 0.45)
        vibration = round(random.uniform(0.4, 1.2), 3)
        if state["anomaly_countdown"] < -4:
            state["anomaly_countdown"] = random.randint(25, 45)
    else:
        delta_tilt = random.uniform(-0.15, 0.18)
        delta_disp = random.uniform(-0.02, 0.03)
        vibration = round(random.uniform(0.02, 0.08), 3)

    new_tilt = max(0.2, round(state["tilt"] + delta_tilt, 2))
    new_disp = max(0.05, round(state["displacement"] + delta_disp, 3))
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

    db.collection("readings").document(reading_id).set(reading_doc)

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
    """
    Runs a single simulation tick across all EXISTING active stations in Firestore.

    FIX: previously this auto-created N01/N02 out of thin air whenever the
    'nodes' collection was empty. That silently reintroduced phantom demo
    nodes any time the real collection got cleared. It now does nothing if
    there are no nodes -- ticking only ever happens for nodes that already
    exist (created deliberately via seed_demo_nodes(), the API, or real
    hardware posting to /api/v1/ingest).
    """
    try:
        nodes_ref = db.collection("nodes").stream()
        active_nodes = list(nodes_ref)
        if not active_nodes:
            print("[Simulator] No nodes exist yet -- nothing to simulate. "
                  "Call seed_demo_nodes() explicitly if you want demo data.")
            return
        for doc in active_nodes:
            generate_station_tick(doc.id, doc.to_dict())
    except Exception as e:
        print(f"[Simulator Error]: {e}")


def seed_demo_nodes(node_ids=None):
    """
    Explicitly create demo nodes for local testing / presentations.

    This is now the ONLY way demo nodes get created -- it must be called
    on purpose (e.g. `python simulator.py --seed`), never automatically.
    """
    node_ids = node_ids or ["N01", "N02"]
    for node_id in node_ids:
        generate_station_tick(node_id)
    print(f"[Simulator] Seeded demo nodes: {node_ids}")


def start_standalone():
    """Runs continuous simulator loop when run directly from command line."""
    import sys
    if "--seed" in sys.argv:
        seed_demo_nodes()
        return

    interval = int(os.environ.get("SIMULATOR_INTERVAL_SECONDS", 30))
    print(f"Starting SIH26025 Standalone Sensor Simulator (interval={interval}s)... "
          f"Press Ctrl+C to stop. (Run with --seed to create demo nodes first.)")
    while True:
        run_simulation_cycle()
        time.sleep(interval)


if __name__ == "__main__":
    start_standalone()

# ---------------------------------------------------------------------------
# WHAT CHANGED AND WHY
# ---------------------------------------------------------------------------
# 1. run_simulation_cycle() no longer auto-creates N01/N02 when the nodes
#    collection is empty. This was the source of the "4 phantom nodes"
#    mystery -- an empty collection would silently regenerate demo nodes
#    on the very next simulation tick, making it look like they never
#    got deleted.
# 2. Added seed_demo_nodes() as an explicit, opt-in way to create demo
#    nodes when you actually want them (e.g. before a presentation).
#    Run `python simulator.py --seed` to use it.
# 3. Default SIMULATOR_INTERVAL_SECONDS raised from 5s to 30s to reduce
#    Firestore read/write volume when running standalone.
# ---------------------------------------------------------------------------