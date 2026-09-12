/*
 * MineGuard SIH26025 - Autonomous Slope & Structure Stability Monitoring System
 * Hardware Node Firmware: ESP32 + ADXL345 + IR Sensor (Crack / Rock Displacement) + KY-006 Buzzer
 *
 * Pin Connections:
 *   ADXL345 Accelerometer/Inclinometer (I2C):
 *     - VCC -> 3.3V
 *     - GND -> GND
 *     - SDA -> GPIO 23
 *     - SCL -> GPIO 22
 *
 *   IR Obstacle/Crack Detection Sensor (Replaces Ultrasonic Sensor):
 *     - VCC -> 5V (or 3.3V depending on module)
 *     - GND -> GND
 *     - OUT -> GPIO 18 (Active LOW: LOW = Crack/Rock Displacement Detected, HIGH = Normal)
 *
 *   KY-006 Passive/Active Buzzer:
 *     - Positive (+) -> GPIO 25
 *     - Negative (-) -> GND
 *
 *   Built-in LED:
 *     - GPIO 2
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <time.h>
#include <math.h>

#include <Adafruit_Sensor.h>
#include <Adafruit_ADXL345_U.h>

// =====================================================
// WIFI CONFIG
// =====================================================
const char* WIFI_SSID     = "EBD";
const char* WIFI_PASSWORD = "12345678";

// =====================================================
// BACKEND CONFIG (PORT 5000)
// =====================================================
const char* SERVER_URL = "http://10.247.73.140:5000/api/v1/ingest";

// =====================================================
// NODE CONFIG
// =====================================================
const char* NODE_ID = "N02";

// =====================================================
// PIN DEFINITIONS
// =====================================================
#define SDA_PIN 23
#define SCL_PIN 22
#define IR_PIN 18
#define BUZZER_PIN 25
#define LED_PIN 2

// IR Active LOW logic:
// Most IR proximity modules output LOW when obstacle/crack is detected
#define IR_ACTIVE_LOW true

// =====================================================
// ADXL345 OBJECT
// =====================================================
Adafruit_ADXL345_Unified accel = Adafruit_ADXL345_Unified(12345);

// =====================================================
// THRESHOLDS
// =====================================================
const float TILT_THRESHOLD = 15.0; // 15 degrees tilt limit

// =====================================================
// VARIABLES
// =====================================================
unsigned long lastSendTime = 0;
const unsigned long SEND_INTERVAL = 2000; // Send telemetry every 2 seconds

// =====================================================
// WIFI CONNECTION
// =====================================================
void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) {
        digitalWrite(LED_PIN, HIGH);
        return;
    }

    Serial.println("\nConnecting to Wi-Fi...");
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    delay(500);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        digitalWrite(LED_PIN, !digitalRead(LED_PIN)); // Blink LED
        Serial.print(".");
        delay(500);
        attempts++;
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
        digitalWrite(LED_PIN, HIGH);
        Serial.println("[WiFi] Connected successfully!");
        Serial.print("ESP32 IP: ");
        Serial.println(WiFi.localIP());
    } else {
        digitalWrite(LED_PIN, LOW);
        Serial.println("[WiFi] Connection FAILED.");
    }
}

// =====================================================
// TIME SYNCHRONIZATION
// =====================================================
void setupTime() {
    if (WiFi.status() != WL_CONNECTED) return;
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    struct tm timeinfo;
    if (getLocalTime(&timeinfo, 5000)) {
        Serial.println("[Time] NTP Synchronized.");
    }
}

String getTimestamp() {
    struct tm timeinfo;
    if (getLocalTime(&timeinfo, 1000)) {
        char buffer[30];
        strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
        return String(buffer);
    }
    return String(millis() / 1000);
}

// =====================================================
// CALCULATE TILT (PITCH / ROLL)
// =====================================================
float calculateTilt(float X, float Y, float Z) {
    return atan2(sqrt(X * X + Y * Y), fabs(Z)) * 180.0 / PI;
}

// =====================================================
// READ ADXL345
// =====================================================
void readADXL345(float &tilt, float &vibration) {
    sensors_event_t event;
    accel.getEvent(&event);

    float ax = event.acceleration.x / 9.80665;
    float ay = event.acceleration.y / 9.80665;
    float az = event.acceleration.z / 9.80665;

    tilt = calculateTilt(ax, ay, az);
    float magnitude = sqrt(ax * ax + ay * ay + az * az);
    vibration = fabs(magnitude - 1.0);
}

// =====================================================
// READ IR SENSOR (CRACK / DISPLACEMENT DETECTION)
// =====================================================
bool readIRSensor() {
    int irState = digitalRead(IR_PIN);
    if (IR_ACTIVE_LOW) {
        return (irState == LOW);
    } else {
        return (irState == HIGH);
    }
}

// =====================================================
// LOCAL RISK SCORE CALCULATION (SAFETY NET)
// =====================================================
int calculateRisk(float tilt, bool irTriggered) {
    int riskScore = 0;
    if (tilt > TILT_THRESHOLD) {
        riskScore += 3;
    }
    if (irTriggered) {
        riskScore += 3; // Crack or rock displacement detected
    }
    return riskScore;
}

String getRiskLevel(int riskScore) {
    if (riskScore >= 5) return "HIGH";
    if (riskScore >= 2) return "MEDIUM";
    return "LOW";
}

// =====================================================
// BUZZER CONTROL
// =====================================================
void updateBuzzer(String riskLevel) {
    if (riskLevel == "HIGH") {
        tone(BUZZER_PIN, 2000);
        Serial.println("BUZZER: HIGH - CONTINUOUS ALARM");
    } else if (riskLevel == "MEDIUM") {
        // Caution chirp
        tone(BUZZER_PIN, 2000);
        delay(120);
        noTone(BUZZER_PIN);
    } else {
        noTone(BUZZER_PIN);
    }
}

// =====================================================
// SEND DATA TO BACKEND & SYNC FIREBASE
// =====================================================
void sendData(bool irTriggered, float tilt, float vibration, int riskScore, String riskLevel) {
    if (WiFi.status() != WL_CONNECTED) {
        connectWiFi();
        if (WiFi.status() != WL_CONNECTED) return;
    }

    HTTPClient http;
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(3000);

    // If IR detects crack opening, map to effective displacement (3.0 cm)
    // so backend ML feature engineering captures the ground movement:
    float effectiveDisplacement = irTriggered ? 3.0 : 0.0;

    String json = "{";
    json += "\"node_id\":\"" + String(NODE_ID) + "\",";
    json += "\"timestamp\":\"" + getTimestamp() + "\",";
    json += "\"ir_triggered\":" + String(irTriggered ? "true" : "false") + ",";
    json += "\"distance\":0.0,";
    json += "\"distance_change\":" + String(effectiveDisplacement, 2) + ",";
    json += "\"displacement\":" + String(effectiveDisplacement, 2) + ",";
    json += "\"tilt\":" + String(tilt, 2) + ",";
    json += "\"vibration\":" + String(vibration, 4) + ",";
    json += "\"risk_score\":" + String(riskScore) + ",";
    json += "\"risk_level\":\"" + riskLevel + "\"";
    json += "}";

    Serial.println("\n========== TELEMETRY SENT ==========");
    Serial.println(json);

    int responseCode = http.POST(json);
    Serial.printf("HTTP Response Code: %d\n", responseCode);

    if (responseCode > 0) {
        String response = http.getString();
        Serial.println("Server Response (Backend ML + Firebase Sync):");
        Serial.println(response);

        if (responseCode == 200) {
            Serial.println(">>> [SUCCESS] Saved in Firebase & Live on Dashboard! <<<");
        }
    } else {
        Serial.printf("[HTTP ERROR] %s\n", http.errorToString(responseCode).c_str());
    }

    http.end();
    Serial.println("====================================");
}

// =====================================================
// SETUP
// =====================================================
void setup() {
    Serial.begin(115200);
    delay(1000);

    Serial.println("\n========================================");
    Serial.println("  MINEGUARD NODE 02 (ESP32 + ADXL345 + IR)");
    Serial.println("  IR CRACK SENSOR (REPLACING ULTRASONIC)");
    Serial.println("========================================");

    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, LOW);

    pinMode(IR_PIN, INPUT);
    Serial.println("[1] IR Crack/Proximity Sensor Initialized (Pin 18).");

    pinMode(BUZZER_PIN, OUTPUT);
    noTone(BUZZER_PIN);
    Serial.println("[2] KY-006 Buzzer Initialized (Pin 25).");

    Wire.begin(SDA_PIN, SCL_PIN);
    if (!accel.begin()) {
        Serial.println("[ERROR] ADXL345 NOT FOUND! Check I2C wiring (SDA=23, SCL=22).");
        while (1) {
            digitalWrite(LED_PIN, HIGH); delay(200);
            digitalWrite(LED_PIN, LOW); delay(200);
        }
    }
    accel.setRange(ADXL345_RANGE_16_G);
    Serial.println("[3] ADXL345 Accelerometer Initialized.");

    connectWiFi();
    setupTime();

    Serial.println("\n[OK] NODE N02 READY - Streaming to Backend & Dashboard.");
}

// =====================================================
// MAIN LOOP
// =====================================================
void loop() {
    bool irTriggered = readIRSensor();

    float tilt = 0.0;
    float vibration = 0.0;
    readADXL345(tilt, vibration);

    int riskScore = calculateRisk(tilt, irTriggered);
    String riskLevel = getRiskLevel(riskScore);
    updateBuzzer(riskLevel);

    Serial.println("\n----------------------------------------");
    Serial.printf("Node ID      : %s\n", NODE_ID);
    Serial.printf("IR Status    : %s\n", irTriggered ? "CRACK / DISPLACEMENT DETECTED" : "NORMAL (SURFACE INTACT)");
    Serial.printf("Tilt Angle   : %.2f deg\n", tilt);
    Serial.printf("Vibration    : %.4f g\n", vibration);
    Serial.printf("Risk Score   : %d/5\n", riskScore);
    Serial.printf("Risk Level   : %s\n", riskLevel.c_str());
    Serial.println("----------------------------------------");

    if (millis() - lastSendTime >= SEND_INTERVAL) {
        lastSendTime = millis();
        sendData(irTriggered, tilt, vibration, riskScore, riskLevel);
    }

    delay(200);
}
