# MineGuard Hardware Integration Guide (ESP32 -> Backend -> Firebase)

This guide provides end-to-end instructions for connecting physical hardware (ESP32 + Sensors) to the MineGuard ML backend and Firebase Cloud Firestore.

---

## 1. System Architecture

```
┌───────────────────────────────────────────────────────────┐
│                    ESP32 Hardware Node                    │
│  - HC-SR04 Ultrasonic (Displacement)                      │
│  - MPU-6050 (Tilt Inclinometer + Vibration RMS)           │
│  - Physical Buzzer (Local Alarm)                          │
└─────────────────────────────┬─────────────────────────────┘
                              │ HTTP POST (every 2s)
                              │ http://<YOUR_LAN_IP>:5000/api/v1/ingest
                              ▼
┌───────────────────────────────────────────────────────────┐
│              Python Flask Service (app.py)                │
│  1. Ingests raw telemetry                                 │
│  2. Evaluates 22 ML features + Safety Override            │
│  3. Responds to ESP32: {"riskLevel", "buzzerState", ...}  │
│  4. Writes data directly to Firebase via Admin SDK:       │
│     - nodes/{nodeId}                                      │
│     - readings/{readingId}                                │
│     - riskAssessments/{nodeId}                            │
│     - alerts/{alertId} (if Warning/Critical)              │
└─────────────────────────────┬─────────────────────────────┘
                              │ Realtime Firestore Sync
                              ▼
┌───────────────────────────────────────────────────────────┐
│               React + Vite Dashboard (App)                │
│  - Live Gauge movement (Ultrasonic, Tilt, Vibration)      │
│  - Audio siren & visual risk alert badge                  │
│  - Realtime interactive station topological node graph    │
└───────────────────────────────────────────────────────────┘
```

---

## 2. Hardware Bill of Materials (BOM)

| Component | Purpose | Recommended Model |
|---|---|---|
| **Microcontroller** | Sensor reading & Wi-Fi communication | ESP32 DevKit V1 (30 or 38 pin) |
| **Distance Sensor** | Measures ground displacement & distance | HC-SR04 or JSN-SR04T (waterproof) |
| **Inclinometer / Accel** | Measures slope angle deviation & vibration | MPU-6050 (GY-521 breakout) |
| **Alert Device** | Local audible siren | 5V Active Buzzer |
| **Power Supply** | Powers ESP32 and sensors | Micro-USB Cable / 5V 2A Adapter |
| **Wires & Breadboard** | Connections | Jumper wires (M-to-M, M-to-F) |

---

## 3. Circuit Wiring & Pinout

### A. HC-SR04 Ultrasonic Sensor
* **VCC** $\to$ `5V` (or `VIN` on ESP32)
* **GND** $\to$ `GND`
* **TRIG** $\to$ `GPIO 5`
* **ECHO** $\to$ `GPIO 18` *(Tip: If using 5V HC-SR04, a simple voltage divider with 1kΩ & 2kΩ resistors on ECHO protects the 3.3V pin)*

### B. MPU-6050 Accelerometer / Gyroscope (I2C)
* **VCC** $\to$ `3.3V`
* **GND** $\to$ `GND`
* **SCL** $\to$ `GPIO 22`
* **SDA** $\to$ `GPIO 21`

### C. 5V Active Buzzer
* **Positive (+)** $\to$ `GPIO 4`
* **Negative (-)** $\to$ `GND`

---

## 4. Software Setup (Arduino IDE)

### Step 1: Install ESP32 Board Core
1. Open **Arduino IDE** $\to$ **File** $\to$ **Preferences**.
2. In **Additional Board Manager URLs**, paste:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Go to **Tools** $\to$ **Board** $\to$ **Boards Manager**, search `esp32`, and install **esp32 by Espressif Systems**.

### Step 2: Install Required Libraries
Open **Sketch** $\to$ **Include Library** $\to$ **Manage Libraries** and install:
1. `ArduinoJson` (by Benoit Blanchon)
2. `Adafruit MPU6050` (by Adafruit)
3. `Adafruit Unified Sensor` (by Adafruit)

---

## 5. Configuring the ESP32 Code

Open [`hardware/MineGuard_ESP32_Node/MineGuard_ESP32_Node.ino`](./MineGuard_ESP32_Node/MineGuard_ESP32_Node.ino):

1. **Set Wi-Fi Credentials**:
   ```cpp
   const char* WIFI_SSID     = "YOUR_WIFI_NAME";
   const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
   ```
2. **Set Backend IP Address**:
   Find your laptop's Wi-Fi IP address on Windows by running `ipconfig` in cmd:
   ```cpp
   const char* SERVER_URL = "http://172.16.184.51:5000/api/v1/ingest";
   ```
   *(Note: Both your ESP32 and your computer must be connected to the same Wi-Fi / Hotspot).*
3. **Set Station Node ID**:
   ```cpp
   const char* NODE_ID = "N01";
   ```

---

## 6. Uploading and Verification

1. Connect the ESP32 to your PC via USB.
2. In Arduino IDE:
   - Select Board: `DOIT ESP32 DEVKIT V1` (or your ESP32 board).
   - Select Port: (e.g., `COM3`, `COM4`).
3. Click **Upload** (Arrow icon).
4. Open the **Serial Monitor** (set baud rate to `115200`).
5. You will see:
   ```text
   [OK] MPU-6050 Inclinometer/Vibration Sensor Connected!
   [WiFi] Connected successfully!
   [Calibration] Initial Baseline Distance: 48.50 cm
   --- [Sensor Telemetry Captured] ---
     Node ID         : N01
     Current Dist    : 48.50 cm
     Distance Change : 0.00 cm
     Tilt Angle      : 1.20 deg
     Vibration RMS   : 0.0120 g
   [HTTP] Ingest Success (Code 200): {"buzzerState":"silent","riskLevel":"LOW","riskScore":0}
   ```

---

## 7. Verifying in Firebase & Web Dashboard

1. **Firebase Console**:
   - Go to [Firebase Console](https://console.firebase.google.com/) $\to$ Your Project $\to$ **Firestore Database**.
   - Check the **`nodes`** collection: Document `N01` will appear automatically!
   - Check the **`readings`** collection: A new telemetry document is stored every 2 seconds.
   - Check the **`riskAssessments`** collection: Real-time ML predictions and scores are synced.
2. **MineGuard Dashboard (`http://localhost:5173`)**:
   - Look at **Station N01**: Live gauges will update in real time without refreshing the browser.
   - **Tilt the MPU6050** past $10^\circ$ or move an obstacle within the ultrasonic sensor path:
     - The risk badge instantly changes to **MEDIUM** or **HIGH**.
     - The physical buzzer on the ESP32 activates (`beep_once` or continuous alarm).
     - The web dashboard sounds the audio siren and renders the warning banner.
