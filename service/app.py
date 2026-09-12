"""
SIH26025 - MineGuard Slope Stability Monitoring Python Service
Flask service connecting ML Risk Predictor with Firebase Firestore.
"""

import os
import sys
import time
import uuid
import random
import threading
from datetime import datetime, timezone
from flask import Flask, jsonify, request
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore

# Setup paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "model")
KEY_PATH = os.path.join(BASE_DIR, "serviceAccountKey.json")

# Initialize Firebase Admin SDK exactly once.
# The key is resolved relative to this file, so the service works even when
# app.py is started from the project root instead of the service directory.
if not firebase_admin._apps:
    cred = credentials.Certificate(KEY_PATH)
    firebase_admin.initialize_app(cred)

db = firestore.client()

# Safely import predictor from model directory without touching predictor.py
sys.path.insert(0, MODEL_DIR)
orig_dir = os.getcwd()
try:
    os.chdir(MODEL_DIR)
    try:
        from model import predictor  # type: ignore
    except ImportError:
        import predictor  # type: ignore
finally:
    os.chdir(orig_dir)

from risk_mapper import compute_final_risk, map_ml_to_ui_risk
from feature_builder import build_features_for_node, add_reading_to_buffer

app = Flask(__name__)
CORS(app)

SIMULATION_ACTIVE = os.environ.get("SIMULATOR_ENABLED", "false").lower() in ("true", "1", "yes")
LAST_ALERTS = {}  # Cache to prevent alert spamming
HISTORY_CACHE = {}  # In-memory history cache to survive Firestore quota exhaustion

# FIX: default raised 5s -> 30s. At 5s, the background loop alone makes
# ~17,000+ Firestore round trips per day even with zero real hardware
# connected, which blows through the Spark (free) plan's daily quota in
# well under 24 hours. 30s cuts that by 6x and is still responsive enough
# for a monitoring dashboard. Override via PREDICTION_INTERVAL_SECONDS.
POLL_INTERVAL = int(os.environ.get("PREDICTION_INTERVAL_SECONDS", 30))

# FIX: quota-exhaustion backoff. Previously a 429 just slept 15s and
# retried immediately, which -- since the underlying cause (too many
# requests) hadn't changed -- burned through the rest of the day's quota
# in a tight retry storm. This now backs off exponentially and caps out
# at a long sleep so one bad day doesn't spiral.
MIN_QUOTA_BACKOFF_SECONDS = 30
MAX_QUOTA_BACKOFF_SECONDS = 600  # 10 minutes


def evaluate_node(node_id: str, node_data: dict = None) -> dict:
    """
    Evaluates risk for a given node:
    1. Reads latest readings entries from Firestore to populate rolling buffer.
    2. Builds the 22-feature vector and calls predict_mine_risk().
    3. Applies risk_mapper.py (model mapping + raw safety-net override).
    4. Writes a new timestamped document to riskAssessments with full probabilities dict.
    5. Mirrors riskLevel, riskScore, buzzerState onto nodes/{nodeId}.
    6. Dispatches an alert document if risk transitions to MEDIUM or HIGH.
    """
    if node_data is None:
        doc_snap = db.collection("nodes").document(node_id).get()
        if not doc_snap.exists:
            return {"error": f"Node {node_id} not found"}
        node_data = doc_snap.to_dict()

    try:
        readings_query = db.collection("readings")\
            .where("nodeId", "==", node_id)\
            .limit(10)\
            .stream()
        readings_list = [r.to_dict() for r in readings_query]
        readings_list.sort(key=lambda r: str(r.get("timestamp", r.get("createdAt", ""))))
        for r in readings_list:
            add_reading_to_buffer(node_id, r)
    except Exception as e:
        pass

    tilt = float(node_data.get("tilt", 0.0) or 0.0)
    if "displacement" in node_data:
        disp = float(node_data["displacement"] or 0.0)
    elif "groundMovement" in node_data:
        disp = float(node_data["groundMovement"] or 0.0)
    elif "distanceChange" in node_data:
        disp = float(node_data["distanceChange"] or 0.0)
    else:
        disp = 0.0

    features = build_features_for_node(node_id, node_data)
    ml_result = predictor.predict_mine_risk(features)

    final_risk = compute_final_risk(
        model_risk_level=ml_result.get("risk_level", "NORMAL"),
        critical_probability=ml_result.get("critical_probability", 0.0),
        tilt=tilt,
        displacement=disp
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    now_ms = int(time.time() * 1000)

    node_update = {
        "id": node_id,
        "nodeId": node_id,
        "name": node_data.get("name") or f"Station {node_id}",
        "status": "online",
        "lastSeen": now_iso,
        "lastUpdated": now_iso,
        "tilt": tilt,
        "displacement": disp,
        "groundMovement": disp,
        "distance": float(node_data.get("distance", 0.0) or 0.0),
        "distanceChange": float(node_data.get("distanceChange", 0.0) or 0.0),
        "vibrationRms": float(node_data.get("vibrationRms", node_data.get("vibration", 0.0)) or 0.0),
        "vibration": float(node_data.get("vibrationRms", node_data.get("vibration", 0.0)) or 0.0),
        "riskLevel": final_risk["riskLevel"],
        "riskScore": final_risk["riskScore"],
        "buzzerState": final_risk["buzzerState"],
        "lastRiskAssessment": now_iso,
        "mlPrediction": ml_result
    }

    for extra in ["temperature", "humidity", "batteryPercentage", "flame"]:
        if extra in node_data:
            node_update[extra] = node_data[extra]

    if "position" not in node_data and "positionX" not in node_data:
        existing_idx = 0
        try:
            existing_idx = int(node_id.replace("N", "").replace("n", "").replace("TEST", "").replace("test", ""))
        except Exception:
            existing_idx = 1
        node_update["position"] = {
            "x": 100 + (existing_idx * 160) % 600,
            "y": 150 + ((existing_idx // 4) * 160)
        }

    db.collection("nodes").document(node_id).set(node_update, merge=True)

    assessment_doc = {
        "nodeId": node_id,
        "assessmentId": f"{node_id}_{now_ms}",
        "timestamp": now_iso,
        "updatedAt": now_iso,
        "risk_level": final_risk["riskLevel"],
        "riskLevel": final_risk["riskLevel"],
        "risk_score": final_risk["riskScore"],
        "riskScore": final_risk["riskScore"],
        "buzzer_state": final_risk["buzzerState"],
        "buzzerState": final_risk["buzzerState"],
        "probabilities": ml_result.get("probabilities", {}),
        "critical_probability": ml_result.get("critical_probability", 0.0),
        "critical_threshold": ml_result.get("critical_threshold", 0.2),
        "risk_class": ml_result.get("risk_class", 0),
        "safetyOverrideApplied": final_risk.get("safetyOverrideApplied", False),
        "telemetrySnapshot": {
            "tilt": tilt,
            "displacement": disp,
            "distance": node_data.get("distance", 0.0),
            "vibration": node_data.get("vibration", 0.0),
            "vibrationRms": node_data.get("vibrationRms", 0.0),
            "temperature": node_data.get("temperature", 25.0),
            "batteryPercentage": node_data.get("batteryPercentage", 100.0)
        }
    }

    if node_id not in HISTORY_CACHE:
        HISTORY_CACHE[node_id] = []
    HISTORY_CACHE[node_id].append(assessment_doc)
    if len(HISTORY_CACHE[node_id]) > 100:
        HISTORY_CACHE[node_id] = HISTORY_CACHE[node_id][-100:]

    try:
        db.collection("nodes").document(node_id).set(node_update, merge=True)
    except Exception as e:
        pass

    try:
        new_doc_id = f"{node_id}_{now_ms}"
        db.collection("riskAssessments").document(new_doc_id).set(assessment_doc)
        db.collection("riskAssessments").document(node_id).set(assessment_doc, merge=True)
    except Exception as e:
        pass

    risk_level = final_risk["riskLevel"]
    last_level = LAST_ALERTS.get(node_id)
    if risk_level in ("MEDIUM", "HIGH") and last_level != risk_level:
        try:
            alert_id = f"ALT_{node_id}_{now_ms}"
            alert_doc = {
                "alertId": alert_id,
                "nodeId": node_id,
                "severity": "CRITICAL" if risk_level == "HIGH" else "WARNING",
                "title": f"Slope Hazard Alert - {node_id}",
                "message": f"Risk level reached {risk_level} (Score: {final_risk['riskScore']}/5). Tilt: {tilt:.1f}\u00b0, Displacement: {disp:.2f} cm.",
                "status": "ACTIVE",
                "riskScore": final_risk["riskScore"],
                "createdAt": now_iso,
                "timestamp": datetime.now().strftime("%H:%M:%S")
            }
            db.collection("alerts").document(alert_id).set(alert_doc)
            LAST_ALERTS[node_id] = risk_level
        except Exception:
            pass
    elif risk_level == "LOW":
        LAST_ALERTS[node_id] = "LOW"

    return {
        "nodeId": node_id,
        "finalRisk": final_risk,
        "mlResult": ml_result
    }


def assess_all_nodes():
    """Runs risk assessment across all nodes in Firestore."""
    nodes_ref = db.collection("nodes").stream()
    results = {}
    for doc in nodes_ref:
        data = doc.to_dict()
        res = evaluate_node(doc.id, data)
        results[doc.id] = res
    return results


def _is_quota_error(e: Exception) -> bool:
    msg = str(e)
    return "Quota exceeded" in msg or "429" in msg or "RESOURCE_EXHAUSTED" in msg


def continuous_prediction_loop():
    """
    Continuous background worker.

    FIX: previously, hitting Firestore's quota just slept 15s and retried
    immediately in a tight loop -- since the quota doesn't reset for hours,
    this meant hundreds of wasted retries per day, each one a request that
    also counts against quota, digging the hole deeper. This version backs
    off exponentially (30s, 60s, 120s ... capped at 10 min) while quota
    errors persist, and resets back to POLL_INTERVAL as soon as a cycle
    succeeds again.
    """
    global SIMULATION_ACTIVE
    import simulator

    if SIMULATION_ACTIVE:
        print("[Prediction Loop] WARNING: SIMULATOR_ENABLED is true -- synthetic "
              "sensor data will be written to Firestore on every cycle. Set "
              "SIMULATOR_ENABLED=false for real-hardware-only operation.")

    print(f"[Prediction Loop] Started background loop (interval={POLL_INTERVAL}s, simulator={SIMULATION_ACTIVE})...")
    quota_backoff = MIN_QUOTA_BACKOFF_SECONDS

    while True:
        try:
            if SIMULATION_ACTIVE:
                simulator.run_simulation_cycle()
            assess_all_nodes()
            quota_backoff = MIN_QUOTA_BACKOFF_SECONDS  # reset backoff after a clean cycle
            time.sleep(POLL_INTERVAL)
        except Exception as e:
            if _is_quota_error(e):
                print(f"[Prediction Loop] Firestore quota exceeded -- backing off {quota_backoff}s.")
                time.sleep(quota_backoff)
                quota_backoff = min(quota_backoff * 2, MAX_QUOTA_BACKOFF_SECONDS)
            else:
                print(f"[Prediction Loop Notice]: {e}")
                time.sleep(POLL_INTERVAL)


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "service": "SIH26025 Python Slope Monitoring Service",
        "model": "Random Forest Classifier (sih26025_final_model.pkl)",
        "simulation_active": SIMULATION_ACTIVE,
        "poll_interval_seconds": POLL_INTERVAL,
        "timestamp": datetime.now(timezone.utc).isoformat()
    })


@app.route("/api/nodes/<node_id>/history", methods=["GET"])
def get_node_history(node_id):
    limit_count = request.args.get("limit", 50, type=int)
    limit_count = min(max(1, limit_count), 200)

    cached = HISTORY_CACHE.get(node_id, [])
    if len(cached) >= 3:
        return jsonify({
            "status": "success",
            "source": "cache",
            "nodeId": node_id,
            "count": len(cached[-limit_count:]),
            "history": cached[-limit_count:]
        }), 200

    history = list(cached)

    try:
        assessments_ref = db.collection("riskAssessments")\
            .where("nodeId", "==", node_id)\
            .limit(limit_count * 2)\
            .stream()

        for doc in assessments_ref:
            data = doc.to_dict()
            if "timestamp" in data and "probabilities" in data:
                data["id"] = doc.id
                if not any(h.get("assessmentId") == data.get("assessmentId") for h in history):
                    history.append(data)

        history.sort(key=lambda x: str(x.get("timestamp", "")))
        HISTORY_CACHE[node_id] = history[-100:]
    except Exception as e:
        print(f"[History Endpoint Notice - Quota/Network]: {e}")

    if len(history) < 3:
        now = datetime.now(timezone.utc)
        history = []
        for i in range(12):
            past = datetime.fromtimestamp(now.timestamp() - (11 - i) * 5, tz=timezone.utc).isoformat()
            history.append({
                "id": f"{node_id}_seed_{i}",
                "assessmentId": f"{node_id}_seed_{i}",
                "nodeId": node_id,
                "timestamp": past,
                "risk_level": "LOW",
                "riskLevel": "LOW",
                "risk_score": 0,
                "riskScore": 0,
                "buzzer_state": "silent",
                "buzzerState": "silent",
                "probabilities": {
                    "NORMAL": 0.88,
                    "WARNING": 0.08,
                    "HIGH_RISK": 0.03,
                    "CRITICAL": 0.01
                }
            })
        HISTORY_CACHE[node_id] = history

    result_slice = history[-limit_count:]
    return jsonify({
        "status": "success",
        "nodeId": node_id,
        "count": len(result_slice),
        "history": result_slice
    }), 200


@app.route("/api/assess-all", methods=["POST"])
def trigger_assess_all():
    results = assess_all_nodes()
    return jsonify({"status": "success", "evaluatedNodes": results})


@app.route("/api/assess/<node_id>", methods=["POST"])
def trigger_assess_node(node_id):
    result = evaluate_node(node_id)
    return jsonify({"status": "success", "result": result})


@app.route("/api/simulate/toggle", methods=["POST"])
def toggle_simulation():
    global SIMULATION_ACTIVE
    data = request.get_json(silent=True) or {}
    if "active" in data:
        SIMULATION_ACTIVE = bool(data["active"])
    else:
        SIMULATION_ACTIVE = not SIMULATION_ACTIVE
    return jsonify({"status": "success", "simulation_active": SIMULATION_ACTIVE})


@app.route("/api/simulate/spike/<node_id>", methods=["POST"])
@app.route("/api/nodes/<node_id>/simulate-spike", methods=["POST"])
def simulate_spike(node_id):
    spike_data = {
        "tilt": 28.5,
        "groundMovement": 4.8,
        "displacement": 4.8,
        "distance": 18.2,
        "distanceChange": 3.4,
        "vibration": 1.85,
        "lastSeen": datetime.now(timezone.utc).isoformat()
    }
    db.collection("nodes").document(node_id).set(spike_data, merge=True)
    res = evaluate_node(node_id)
    return jsonify({"status": "spiked", "nodeId": node_id, "evaluation": res})


@app.route("/api/simulate/normalize/<node_id>", methods=["POST"])
@app.route("/api/nodes/<node_id>/simulate-normal", methods=["POST"])
def simulate_normalize(node_id):
    safe_data = {
        "tilt": 2.1,
        "groundMovement": 0.4,
        "displacement": 0.4,
        "distance": 85.0,
        "distanceChange": 0.1,
        "vibration": 0.05,
        "lastSeen": datetime.now(timezone.utc).isoformat()
    }
    db.collection("nodes").document(node_id).set(safe_data, merge=True)
    res = evaluate_node(node_id)
    return jsonify({"status": "normalized", "nodeId": node_id, "evaluation": res})


@app.route("/api/nodes", methods=["POST"])
def create_node():
    data = request.get_json(force=True) or {}
    raw_id = data.get("id") or data.get("nodeId")
    if not raw_id:
        return jsonify({"error": "nodeId is required"}), 400
    node_id = str(raw_id).strip().upper()
    data["id"] = node_id
    data["nodeId"] = node_id
    db.collection("nodes").document(node_id).set(data, merge=True)
    evaluate_node(node_id, data)
    return jsonify({"status": "created", "nodeId": node_id})


@app.route("/api/nodes/<node_id>", methods=["PATCH", "PUT"])
def update_node(node_id):
    data = request.get_json(force=True) or {}
    db.collection("nodes").document(node_id).set(data, merge=True)
    return jsonify({"status": "updated", "nodeId": node_id})


@app.route("/api/nodes/<node_id>", methods=["DELETE"])
def delete_node(node_id):
    db.collection("nodes").document(node_id).delete()
    try:
        db.collection("riskAssessments").document(node_id).delete()
    except Exception:
        pass
    return jsonify({"status": "deleted", "nodeId": node_id})


@app.route("/api/v1/ingest", methods=["POST"])
def ingest_reading():
    data = request.get_json(force=True, silent=True)

    if not data:
        return jsonify({"error": "Missing or invalid JSON body"}), 400

    # Accept both the existing ESP32 field names (snake_case) and the
    # dashboard/backend field names (camelCase).
    node_raw = data.get("nodeId", data.get("node_id"))
    distance_raw = data.get("distance")
    distance_change_raw = data.get("distanceChange", data.get("distance_change"))
    tilt_raw = data.get("tilt")
    vibration_raw = data.get("vibrationRms", data.get("vibration", 0.0))

    required = {
        "nodeId/node_id": node_raw,
        "distance": distance_raw,
        "distanceChange/distance_change": distance_change_raw,
        "tilt": tilt_raw,
    }
    missing = [name for name, value in required.items() if value is None]
    if missing:
        return jsonify({"error": f"Missing fields: {missing}"}), 400

    node_id = str(node_raw).strip().upper()
    timestamp = data.get("timestamp") or datetime.now(timezone.utc).isoformat()

    try:
        reading_doc = {
            "nodeId": node_id,
            "timestamp": timestamp,
            "distance": float(distance_raw),
            "distanceChange": float(distance_change_raw),
            "tilt": float(tilt_raw),
            "vibrationRms": float(vibration_raw or 0.0),
            "displacement": float(
                data.get("displacement", data.get("distanceChange", data.get("distance_change", 0.0)))
                or 0.0
            ),
        }
    except (TypeError, ValueError) as e:
        return jsonify({"error": f"Invalid numeric sensor value: {e}"}), 400

    for extra in ["vibration", "temperature", "humidity", "batteryPercentage", "flame", "groundMovement",
                  "risk_score", "riskScore", "risk_level", "riskLevel"]:
        if extra in data:
            reading_doc[extra] = data[extra]

    try:
        db.collection("readings").add(reading_doc)
    except Exception as e:
        app.logger.error(f"Failed to write reading for {node_id}: {e}")
        return jsonify({"error": "Failed to store reading"}), 500

    try:
        add_reading_to_buffer(node_id, reading_doc)
    except Exception as e:
        app.logger.warning(f"Could not append reading to buffer for {node_id}: {e}")

    try:
        eval_result = evaluate_node(node_id, reading_doc)
        final_risk = eval_result.get("finalRisk", {})

        risk_level = final_risk.get("riskLevel", "LOW")
        risk_score = final_risk.get("riskScore", 0)
        buzzer_state = final_risk.get("buzzerState", "silent")

    except Exception as e:
        app.logger.error(f"Immediate prediction failed for {node_id}: {e}")
        return jsonify({"status": "reading_saved", "prediction": "deferred"}), 202

    return jsonify({
        "riskLevel": risk_level,
        "riskScore": risk_score,
        "buzzerState": buzzer_state,
        "safetyOverrideApplied": final_risk.get("safetyOverrideApplied", False),
    }), 200


if __name__ == "__main__":
    t = threading.Thread(target=continuous_prediction_loop, daemon=True)
    t.start()
    port = int(os.environ.get("PORT", 5000))
    print(f"Starting SIH26025 Python Flask Service on port {port}...")
    app.run(host="0.0.0.0", port=port, debug=False)

# ---------------------------------------------------------------------------
# WHAT CHANGED AND WHY
# ---------------------------------------------------------------------------
# 1. PREDICTION_INTERVAL_SECONDS default raised from 5s to 30s. At 5s the
#    background loop alone made ~17,000+ Firestore calls/day even with
#    zero hardware connected -- easily exhausting the Spark plan's daily
#    quota within hours. Override with an env var if you need faster
#    updates once you're on a plan that supports it.
# 2. Real exponential backoff on Firestore quota errors (30s -> 60s ->
#    120s ... capped at 10 min), instead of a fixed 15s retry. This stops
#    a single quota-exhaustion event from turning into hundreds of wasted,
#    still-failing requests over the rest of the day.
# 3. Startup warning printed if SIMULATOR_ENABLED=true, so it's obvious in
#    your terminal/logs that synthetic data is being written -- this is
#    what caused the "4 nodes with no hardware connected" mystery.
# 4. simulator.py (see that file) no longer silently recreates N01/N02
#    when the nodes collection is empty. Demo nodes now require an
#    explicit `python simulator.py --seed`.
# ---------------------------------------------------------------------------