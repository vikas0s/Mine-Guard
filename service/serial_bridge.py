"""
MineGuard Serial Bridge
Reads sensor data directly from Arduino / ESP32 via USB Serial (COM Port)
and sends it to the local Flask backend (http://localhost:5000/api/v1/ingest).

Usage:
  python serial_bridge.py             (auto-detects or lists COM ports)
  python serial_bridge.py COM3        (connects to COM3 at 115200 baud)
  python serial_bridge.py COM3 9600   (connects to COM3 at 9600 baud)
"""

import sys
import time
import json
import re
import urllib.request
import urllib.error

try:
    import serial
    import serial.tools.list_ports
except ImportError:
    print("Error: pyserial is required. Run: pip install pyserial")
    sys.exit(1)

BACKEND_URL = "http://localhost:5000/api/v1/ingest"
DEFAULT_BAUD = 115200


def list_ports():
    ports = list(serial.tools.list_ports.comports())
    if not ports:
        print("No serial ports detected. Make sure your Arduino is plugged in via USB.")
        return []
    print("\n--- Available COM Ports ---")
    for i, p in enumerate(ports):
        print(f" [{i + 1}] {p.device} -> {p.description}")
    return ports


def parse_line(line_str, default_node="N01"):
    """
    Parses various Arduino print formats:
    1. JSON: {"nodeId": "N01", "distance": 45.2, "distanceChange": 0.4, "tilt": 2.1, "vibration": 0.01}
    2. Comma-separated: 45.2, 0.4, 2.1, 0.01  (distance, distanceChange, tilt, vibration)
    3. Key-value regex matches
    """
    line_str = line_str.strip()
    if not line_str:
        return None

    # Case 1: JSON
    if line_str.startswith("{") and line_str.endswith("}"):
        try:
            data = json.loads(line_str)
            if "nodeId" not in data and "node_id" not in data:
                data["nodeId"] = default_node
            return data
        except Exception:
            pass

    # Case 2: Comma separated values (e.g. 45.2, 0.4, 2.1, 0.01)
    parts = [p.strip() for p in line_str.split(",")]
    if len(parts) >= 3:
        try:
            # Check if all are floats
            nums = [float(p) for p in parts[:4]]
            return {
                "nodeId": default_node,
                "distance": nums[0],
                "distanceChange": nums[1] if len(nums) > 1 else 0.0,
                "tilt": nums[2] if len(nums) > 2 else 0.0,
                "vibrationRms": nums[3] if len(nums) > 3 else 0.01,
            }
        except ValueError:
            pass

    # Case 3: Regex match for labeled prints
    # e.g.: Distance: 45.2 cm | Tilt: 2.1 deg | Vibration: 0.01 g
    dist_m = re.search(r"(?:distance|dist)[\s:=]+([\d.]+)", line_str, re.I)
    tilt_m = re.search(r"(?:tilt|angle)[\s:=]+([\d.]+)", line_str, re.I)
    vib_m = re.search(r"(?:vibration|vib)[\s:=]+([\d.]+)", line_str, re.I)
    disp_m = re.search(r"(?:change|disp|displacement)[\s:=]+([\d.]+)", line_str, re.I)

    if dist_m or tilt_m:
        dist = float(dist_m.group(1)) if dist_m else 50.0
        disp = float(disp_m.group(1)) if disp_m else 0.0
        tilt = float(tilt_m.group(1)) if tilt_m else 0.0
        vib = float(vib_m.group(1)) if vib_m else 0.01
        return {
            "nodeId": default_node,
            "distance": dist,
            "distanceChange": disp,
            "tilt": tilt,
            "vibrationRms": vib,
        }

    return None


def send_to_backend(payload):
    try:
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            BACKEND_URL,
            data=data_bytes,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            resp_body = resp.read().decode("utf-8")
            return json.loads(resp_body)
    except urllib.error.URLError as e:
        print(f"[Backend Error] Could not connect to {BACKEND_URL}: {e}")
        return None
    except Exception as e:
        print(f"[Error] {e}")
        return None


def main():
    print("==================================================")
    print("      MINEGUARD USB SERIAL -> FIREBASE BRIDGE     ")
    print("==================================================")

    com_port = None
    baud_rate = DEFAULT_BAUD

    if len(sys.argv) > 1:
        com_port = sys.argv[1]
    if len(sys.argv) > 2:
        baud_rate = int(sys.argv[2])

    if not com_port:
        ports = list_ports()
        if not ports:
            return
        choice = input("\nEnter COM port name (e.g. COM3 or COM4): ").strip().upper()
        com_port = choice

    baud_input = input(f"Enter Baud Rate (press Enter for {baud_rate}): ").strip()
    if baud_input:
        try:
            baud_rate = int(baud_input)
        except ValueError:
            pass

    print(f"\nConnecting to {com_port} at {baud_rate} baud...")
    print("NOTE: Please make sure Arduino IDE Serial Monitor is CLOSED,")
    print("otherwise Windows will block access to the COM port!\n")

    try:
        ser = serial.Serial(com_port, baud_rate, timeout=1.0)
        time.sleep(2.0)  # Wait for Arduino reset
        print(f"[OK] Connected to {com_port}! Reading data...\n")
    except Exception as e:
        print(f"[FAILED] Could not open {com_port}: {e}")
        print("Tip: Close Arduino IDE Serial Monitor and check device manager.")
        return

    while True:
        try:
            raw_line = ser.readline().decode("utf-8", errors="ignore").strip()
            if not raw_line:
                continue

            print(f"[Arduino Raw] {raw_line}")
            payload = parse_line(raw_line)

            if payload:
                print(f" -> Sending Telemetry to Backend: {payload}")
                result = send_to_backend(payload)
                if result:
                    print(f" <- ML Assessment: Risk={result.get('riskLevel')} | Score={result.get('riskScore')} | Buzzer={result.get('buzzerState')}\n")
                    # Optionally send buzzer command back to Arduino
                    buzzer_cmd = f"BUZZER:{result.get('buzzerState')}\n"
                    try:
                        ser.write(buzzer_cmd.encode("utf-8"))
                    except Exception:
                        pass
        except KeyboardInterrupt:
            print("\nExiting Serial Bridge...")
            break
        except Exception as e:
            print(f"[Serial Read Error] {e}")
            time.sleep(1.0)

    ser.close()


if __name__ == "__main__":
    main()
