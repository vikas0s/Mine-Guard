/*
 * MineGuard SIH26025 - Autonomous Slope & Structure Stability Monitoring System
 * Standard Arduino Firmware (Arduino UNO / Nano / Mega) via USB Serial
 *
 * Hardware Components:
 *   1. Arduino Uno / Nano / Mega
 *   2. HC-SR04 Ultrasonic Distance Sensor
 *   3. MPU6050 Accelerometer/Gyroscope
 *   4. Active Buzzer
 *
 * Pin Connections:
 *   HC-SR04:
 *     - VCC  -> 5V
 *     - GND  -> GND
 *     - TRIG -> Pin 9
 *     - ECHO -> Pin 10
 *   MPU-6050:
 *     - VCC  -> 5V (or 3.3V)
 *     - GND  -> GND
 *     - SCL  -> A5 (on Uno/Nano)
 *     - SDA  -> A4 (on Uno/Nano)
 *   Buzzer:
 *     - Positive (+) -> Pin 8
 *     - Negative (-) -> GND
 *
 * Communication:
 *   Transmits JSON telemetry over USB Serial (115200 baud).
 *   The Python `serial_bridge.py` script automatically ingests this data,
 *   evaluates ML risk, updates Firestore, and controls the buzzer!
 */

#include <Wire.h>

#define TRIG_PIN 9
#define ECHO_PIN 10
#define BUZZER_PIN 8

// MPU6050 I2C address
const int MPU_ADDR = 0x68;

float baselineDistance = -1.0;
unsigned long lastSend = 0;

float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) return 50.0; // fallback if sensor out of range
  return (duration * 0.0343) / 2.0;
}

void readMPU(float &tilt, float &vib) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B); // starting with register 0x3B (ACCEL_XOUT_H)
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 6, true);

  if (Wire.available() >= 6) {
    int16_t AcX = Wire.read() << 8 | Wire.read();
    int16_t AcY = Wire.read() << 8 | Wire.read();
    int16_t AcZ = Wire.read() << 8 | Wire.read();

    float ax = AcX / 16384.0;
    float ay = AcY / 16384.0;
    float az = AcZ / 16384.0;

    // Pitch & Roll in degrees
    float pitch = atan2(ay, az) * 180.0 / 3.14159;
    float roll  = atan2(-ax, sqrt(ay * ay + az * az)) * 180.0 / 3.14159;

    tilt = max(abs(pitch), abs(roll));
    float totalG = sqrt(ax * ax + ay * ay + az * az);
    vib = abs(totalG - 1.0); // vibration deviation from 1G
  } else {
    tilt = 0.0;
    vib = 0.01;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  Wire.begin();
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B); // PWR_MGMT_1 register
  Wire.write(0);    // set to zero (wakes up the MPU-6050)
  Wire.endTransmission(true);

  delay(500);
  baselineDistance = readDistanceCm();
}

void loop() {
  // Check for incoming buzzer commands from Python bridge
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd == "BUZZER:beep_continuous") {
      digitalWrite(BUZZER_PIN, HIGH);
      delay(150);
      digitalWrite(BUZZER_PIN, LOW);
    } else if (cmd == "BUZZER:beep_once") {
      digitalWrite(BUZZER_PIN, HIGH);
      delay(100);
      digitalWrite(BUZZER_PIN, LOW);
    } else if (cmd == "BUZZER:silent") {
      digitalWrite(BUZZER_PIN, LOW);
    }
  }

  if (millis() - lastSend >= 2000) {
    lastSend = millis();

    float dist = readDistanceCm();
    float disp = abs(dist - baselineDistance);
    float tilt = 0.0;
    float vib = 0.01;
    readMPU(tilt, vib);

    // Print clean JSON to Serial
    Serial.print("{\"nodeId\":\"N01\",\"distance\":");
    Serial.print(dist, 1);
    Serial.print(",\"distanceChange\":");
    Serial.print(disp, 1);
    Serial.print(",\"tilt\":");
    Serial.print(tilt, 1);
    Serial.print(",\"vibrationRms\":");
    Serial.print(vib, 2);
    Serial.println("}");
  }
}
