/*
 * MineGuard SIH26025 - Autonomous Slope & Structure Stability Monitoring System
 * Hardware Node Firmware (ESP32)
 *
 * Hardware Components:
 *   1. ESP32 DevKit V1
 *   2. HC-SR04 Ultrasonic Distance Sensor (Displacement & Distance)
 *   3. MPU6050 6-Axis Accelerometer/Gyroscope (Tilt angle & Vibration RMS)
 *   4. Active/Passive 5V Buzzer (Local Audio Alert based on backend ML response)
 *
 * Pin Connections:
 *   HC-SR04:
 *     - VCC  -> 5V (VIN)
 *     - GND  -> GND
 *     - TRIG -> GPIO 5
 *     - ECHO -> GPIO 18 (use voltage divider 1k/2k ohm or direct 3.3V safe pin)
 *   MPU6050 (I2C):
 *     - VCC  -> 3.3V
 *     - GND  -> GND
 *     - SCL  -> GPIO 22
 *     - SDA  -> GPIO 21
 *   Buzzer:
 *     - Positive (+) -> GPIO 4
 *     - Negative (-) -> GND
 *
 * Required Arduino IDE Libraries:
 *   - ArduinoJson (by Benoit Blanchon, v6 or v7)
 *   - Adafruit MPU6050 & Adafruit Unified Sensor
 *   - HTTPClient & WiFi (Built-in with ESP32 core)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

// ==========================================
// 1. CONFIGURATION: WI-FI & BACKEND SERVER
// ==========================================
const char* WIFI_SSID     = "YOUR_WIFI_NAME";        // <-- Replace with your Wi-Fi SSID
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";    // <-- Replace with your Wi-Fi Password

// Laptop IP running Python Flask service (port 5000)
// To find your IP on Windows, open cmd and type: ipconfig (e.g. 172.16.184.51 or 192.168.1.X)
const char* SERVER_URL    = "http://172.16.184.51:5000/api/v1/ingest";

// Unique Station Identifier for this physical hardware station (e.g., N01, N02, N03)
const char* NODE_ID       = "N01";

// Reading intervals
const unsigned long SEND_INTERVAL_MS = 2000; // Send telemetry every 2 seconds

// ==========================================
// 2. PIN DEFINITIONS
// ==========================================
#define TRIG_PIN   5
#define ECHO_PIN   18
#define BUZZER_PIN 4

// ==========================================
// 3. SENSORS & BASELINE STATE
// ==========================================
Adafruit_MPU6050 mpu;
bool mpuAvailable = false;

// Initial calibration reference (baseline distance when node is first mounted)
float baselineDistance = -1.0;
unsigned long lastSendTime = 0;

// Current buzzer state received from ML Risk Engine
String currentBuzzerState = "silent";

// ==========================================
// 4. HELPER: MEASURE ULTRASONIC DISTANCE
// ==========================================
float readUltrasonicDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000); // 30ms timeout (~5m range)
  if (duration == 0) {
    return -1.0; // Out of range or sensor disconnected
  }
  float distanceCm = (duration * 0.0343) / 2.0;
  return distanceCm;
}

// ==========================================
// 5. HELPER: MEASURE TILT & VIBRATION (MPU6050)
// ==========================================
void readMPU6050(float &tiltDeg, float &vibrationRms) {
  if (!mpuAvailable) {
    tiltDeg = 0.0;
    vibrationRms = 0.01;
    return;
  }

  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  // Calculate tilt (pitch and roll angles relative to vertical gravity vector 9.8 m/s^2)
  // Pitch = atan2(ay, az) * 180 / PI
  // Roll  = atan2(-ax, sqrt(ay^2 + az^2)) * 180 / PI
  float pitch = atan2(a.acceleration.y, a.acceleration.z) * 180.0 / PI;
  float roll  = atan2(-a.acceleration.x, sqrt(a.acceleration.y * a.acceleration.y + a.acceleration.z * a.acceleration.z)) * 180.0 / PI;
  
  // Overall absolute angular deviation from upright
  tiltDeg = max(abs(pitch), abs(roll));

  // Vibration estimation: Deviation of total acceleration magnitude from standard 1G (9.8 m/s^2)
  float totalAccel = sqrt(a.acceleration.x * a.acceleration.x +
                          a.acceleration.y * a.acceleration.y +
                          a.acceleration.z * a.acceleration.z);
  vibrationRms = abs(totalAccel - 9.80665) / 9.80665; // Normalized vibration magnitude
}

// ==========================================
// 6. HELPER: HANDLE BUZZER ACTION
// ==========================================
void handleBuzzer(String state) {
  if (state == "beep_continuous") {
    // CRITICAL/HIGH RISK: Continuous rapid alarming
    digitalWrite(BUZZER_PIN, HIGH);
    delay(150);
    digitalWrite(BUZZER_PIN, LOW);
    delay(80);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(150);
    digitalWrite(BUZZER_PIN, LOW);
  } else if (state == "beep_once") {
    // MEDIUM/WARNING RISK: Single caution beep
    digitalWrite(BUZZER_PIN, HIGH);
    delay(120);
    digitalWrite(BUZZER_PIN, LOW);
  } else {
    // LOW/NORMAL RISK: Silent
    digitalWrite(BUZZER_PIN, LOW);
  }
}

// ==========================================
// 7. SETUP
// ==========================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n==========================================");
  Serial.println("  MINEGUARD SIH26025 - HARDWARE SENSOR NODE");
  Serial.println("==========================================");

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // Initialize I2C and MPU6050
  Wire.begin(21, 22);
  if (mpu.begin()) {
    Serial.println("[OK] MPU-6050 Inclinometer/Vibration Sensor Connected!");
    mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
    mpu.setGyroRange(MPU6050_RANGE_250_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    mpuAvailable = true;
  } else {
    Serial.println("[WARNING] MPU-6050 not detected. Check I2C wiring (SDA=21, SCL=22).");
  }

  // Connect to Wi-Fi
  Serial.print("[WiFi] Connecting to: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 25) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected successfully!");
    Serial.print("[WiFi] ESP32 IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WiFi] Connection failed. Will retry during main loop.");
  }

  // Baseline calibration reading
  delay(1000);
  float initialDist = readUltrasonicDistanceCm();
  if (initialDist > 0) {
    baselineDistance = initialDist;
    Serial.printf("[Calibration] Initial Baseline Distance: %.2f cm\n", baselineDistance);
  } else {
    baselineDistance = 50.0; // Fallback reference
    Serial.println("[Calibration] Default Baseline set to 50.0 cm");
  }
}

// ==========================================
// 8. MAIN LOOP
// ==========================================
void loop() {
  // Reconnect Wi-Fi if connection dropped
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Reconnecting...");
    WiFi.disconnect();
    WiFi.reconnect();
    delay(1000);
    return;
  }

  unsigned long currentMillis = millis();
  if (currentMillis - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = currentMillis;

    // 1. Read Ultrasonic Distance
    float currentDistance = readUltrasonicDistanceCm();
    if (currentDistance <= 0) {
      currentDistance = baselineDistance; // Use fallback if echo lost
    }

    // Calculate displacement (net movement from baseline)
    float distanceChange = abs(currentDistance - baselineDistance);

    // 2. Read MPU6050 Tilt & Vibration
    float tiltDeg = 0.0;
    float vibrationRms = 0.01;
    readMPU6050(tiltDeg, vibrationRms);

    Serial.println("\n--- [Sensor Telemetry Captured] ---");
    Serial.printf("  Node ID         : %s\n", NODE_ID);
    Serial.printf("  Current Dist    : %.2f cm\n", currentDistance);
    Serial.printf("  Distance Change : %.2f cm\n", distanceChange);
    Serial.printf("  Tilt Angle      : %.2f deg\n", tiltDeg);
    Serial.printf("  Vibration RMS   : %.4f g\n", vibrationRms);

    // 3. Build JSON Payload
    // Allocate JSON document
    StaticJsonDocument<256> doc;
    doc["nodeId"]         = NODE_ID;
    doc["distance"]       = round(currentDistance * 10.0) / 10.0;
    doc["distanceChange"] = round(distanceChange * 10.0) / 10.0;
    doc["tilt"]           = round(tiltDeg * 10.0) / 10.0;
    doc["vibrationRms"]   = round(vibrationRms * 100.0) / 100.0;

    String jsonString;
    serializeJson(doc, jsonString);

    // 4. Transmit HTTP POST to Python ML Service (/api/v1/ingest)
    HTTPClient http;
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(2500); // 2.5 second timeout

    int httpResponseCode = http.POST(jsonString);

    if (httpResponseCode > 0) {
      String response = http.getString();
      Serial.printf("[HTTP] Ingest Success (Code %d): %s\n", httpResponseCode, response.c_str());

      // 5. Parse Backend Response to drive Hardware Buzzer
      StaticJsonDocument<256> respDoc;
      DeserializationError err = deserializeJson(respDoc, response);
      if (!err) {
        const char* riskLevel   = respDoc["riskLevel"] | "LOW";
        int riskScore           = respDoc["riskScore"] | 0;
        const char* buzzerState = respDoc["buzzerState"] | "silent";

        Serial.printf("[ML Decision] Risk: %s | Score: %d/5 | Buzzer: %s\n", riskLevel, riskScore, buzzerState);
        currentBuzzerState = String(buzzerState);
        handleBuzzer(currentBuzzerState);
      }
    } else {
      Serial.printf("[HTTP ERROR] Failed to connect to %s. Code: %d (Error: %s)\n",
                    SERVER_URL, httpResponseCode, http.errorToString(httpResponseCode).c_str());
      // Sound a quick double tick to notify communication fault
      digitalWrite(BUZZER_PIN, HIGH);
      delay(40);
      digitalWrite(BUZZER_PIN, LOW);
    }

    http.end();
  }
}
