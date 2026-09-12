"""
feature_builder.py
Manages an in-memory buffer of recent readings per node and computes
the 22 features expected by predictor.py.
Loads feature names dynamically from features.pkl.
"""

import os
import joblib
import numpy as np
from collections import deque
from typing import Dict, List, Any

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model")
FEATURES_PATH = os.path.join(MODEL_DIR, "sih26025_features.pkl")

# Load feature list dynamically
try:
    EXPECTED_FEATURES = joblib.load(FEATURES_PATH)
except Exception as e:
    # Fallback to standard 22 features if file load fails
    EXPECTED_FEATURES = [
        'tilt', 'displacement', 'crack_width', 'vibration_rms',
        'tilt_rate', 'displacement_rate', 'crack_growth_rate',
        'tilt_rolling_mean', 'tilt_rolling_std',
        'displacement_rolling_mean', 'displacement_rolling_std',
        'crack_rolling_mean', 'vibration_rolling_mean',
        'network_tilt_mean', 'network_displacement_mean',
        'network_crack_mean', 'network_vibration_mean',
        'tilt_vs_network', 'displacement_vs_network', 'crack_vs_network',
        'tilt_elevated', 'displacement_elevated'
    ]

# In-memory buffer per node (up to 10 latest readings)
NODE_BUFFERS: Dict[str, deque] = {}
BUFFER_MAXLEN = 10


def add_reading_to_buffer(node_id: str, reading: Dict[str, Any]):
    """
    Normalizes reading fields and appends to the node's rolling buffer.
    """
    if node_id not in NODE_BUFFERS:
        NODE_BUFFERS[node_id] = deque(maxlen=BUFFER_MAXLEN)

    # Normalize fields from Firestore document
    tilt = float(reading.get("tilt", 0.0) or 0.0)
    
    # Displacement can come from groundMovement, displacement, or distanceChange
    if "displacement" in reading:
        disp = float(reading["displacement"] or 0.0)
    elif "groundMovement" in reading:
        disp = float(reading["groundMovement"] or 0.0)
    elif "distanceChange" in reading:
        disp = float(reading["distanceChange"] or 0.0)
    else:
        disp = 0.0

    # Crack width
    crack = float(reading.get("crack_width", reading.get("crackWidth", 0.0)) or 0.0)

    # Vibration RMS
    if "vibrationRms" in reading:
        vib = float(reading["vibrationRms"] or 0.0)
    elif "vibration_rms" in reading:
        vib = float(reading["vibration_rms"] or 0.0)
    else:
        vib = float(reading.get("vibration", 0.0) or 0.0)

    sample = {
        "tilt": tilt,
        "displacement": disp,
        "crack_width": crack,
        "vibration_rms": vib
    }
    NODE_BUFFERS[node_id].append(sample)


def build_features_for_node(node_id: str, current_reading: Dict[str, Any] = None) -> Dict[str, float]:
    """
    Computes all 22 required features for the target node using its buffer
    and current network averages.
    """
    if current_reading:
        add_reading_to_buffer(node_id, current_reading)

    buf = NODE_BUFFERS.get(node_id)
    if not buf or len(buf) == 0:
        # If no buffer, initialize with zeroes
        dummy = {"tilt": 0.0, "displacement": 0.0, "crack_width": 0.0, "vibration_rms": 0.0}
        NODE_BUFFERS[node_id] = deque([dummy], maxlen=BUFFER_MAXLEN)
        buf = NODE_BUFFERS[node_id]

    latest = buf[-1]
    prev = buf[-2] if len(buf) > 1 else latest

    # Extract series for rolling stats
    tilts = [s["tilt"] for s in buf]
    disps = [s["displacement"] for s in buf]
    cracks = [s["crack_width"] for s in buf]
    vibs = [s["vibration_rms"] for s in buf]

    # Rates
    tilt_rate = latest["tilt"] - prev["tilt"]
    displacement_rate = latest["displacement"] - prev["displacement"]
    crack_growth_rate = latest["crack_width"] - prev["crack_width"]

    # Rolling stats
    tilt_rolling_mean = float(np.mean(tilts))
    tilt_rolling_std = float(np.std(tilts)) if len(tilts) > 1 else 0.0
    displacement_rolling_mean = float(np.mean(disps))
    displacement_rolling_std = float(np.std(disps)) if len(disps) > 1 else 0.0
    crack_rolling_mean = float(np.mean(cracks))
    vibration_rolling_mean = float(np.mean(vibs))

    # Network-wide means across all known nodes
    network_tilts = []
    network_disps = []
    network_cracks = []
    network_vibs = []

    for nid, nbuf in NODE_BUFFERS.items():
        if nbuf:
            ns = nbuf[-1]
            network_tilts.append(ns["tilt"])
            network_disps.append(ns["displacement"])
            network_cracks.append(ns["crack_width"])
            network_vibs.append(ns["vibration_rms"])

    network_tilt_mean = float(np.mean(network_tilts)) if network_tilts else latest["tilt"]
    network_displacement_mean = float(np.mean(network_disps)) if network_disps else latest["displacement"]
    network_crack_mean = float(np.mean(network_cracks)) if network_cracks else latest["crack_width"]
    network_vibration_mean = float(np.mean(network_vibs)) if network_vibs else latest["vibration_rms"]

    # vs Network
    tilt_vs_network = latest["tilt"] - network_tilt_mean
    displacement_vs_network = latest["displacement"] - network_displacement_mean
    crack_vs_network = latest["crack_width"] - network_crack_mean

    # Elevated flags
    tilt_elevated = 1.0 if latest["tilt"] > 10.0 else 0.0
    displacement_elevated = 1.0 if latest["displacement"] > 2.0 else 0.0

    feature_dict = {
        'tilt': latest["tilt"],
        'displacement': latest["displacement"],
        'crack_width': latest["crack_width"],
        'vibration_rms': latest["vibration_rms"],
        'tilt_rate': tilt_rate,
        'displacement_rate': displacement_rate,
        'crack_growth_rate': crack_growth_rate,
        'tilt_rolling_mean': tilt_rolling_mean,
        'tilt_rolling_std': tilt_rolling_std,
        'displacement_rolling_mean': displacement_rolling_mean,
        'displacement_rolling_std': displacement_rolling_std,
        'crack_rolling_mean': crack_rolling_mean,
        'vibration_rolling_mean': vibration_rolling_mean,
        'network_tilt_mean': network_tilt_mean,
        'network_displacement_mean': network_displacement_mean,
        'network_crack_mean': network_crack_mean,
        'network_vibration_mean': network_vibration_mean,
        'tilt_vs_network': tilt_vs_network,
        'displacement_vs_network': displacement_vs_network,
        'crack_vs_network': crack_vs_network,
        'tilt_elevated': tilt_elevated,
        'displacement_elevated': displacement_elevated
    }

    # Ensure all expected features are present
    for feat in EXPECTED_FEATURES:
        if feat not in feature_dict:
            feature_dict[feat] = 0.0

    return feature_dict
