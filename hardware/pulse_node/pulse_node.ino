// vanitas :: pulse-ground altar (Oryn maek) :: sensor + haptic node
//
// Reads a heartbeat from a MAX30102 and streams beats-per-minute to the browser,
// and plays a haptic beat-back in the dome on command from the app.
//
//   OUT  B<bpm>\n        one line per detected beat, e.g. "B72"     (node -> app)
//   IN   H<strength>\n    fire one haptic pulse, strength 0..100     (app -> node)
//
// The app (src/sensors/pulse.ts) opens this port over Web Serial at 115200 baud.
// The haptic plays the flower's OWN drifting rhythm, which lives in the app, so
// the app decides when to beat and sends H on each flower-beat; strength falls as
// the flower dies. The visitor hears their own pulse (in the app's audio) and
// feels the flower's separate, diverging pulse here in the dome.
//
// No hardware, no problem: the app runs a simulated pulse and simply sends no H
// commands until a board is connected.
//
// Board:   ESP32 dev board with a USB-serial bridge (CP2102 / CH340).
// Sensors: MAX30102 pulse breakout (I2C 0x57).
// Haptic:  Adafruit DRV2605L haptic driver (I2C 0x5A) with an LRA actuator.
//          Both share the I2C bus (different addresses), no conflict.
// Libs:    "SparkFun MAX3010x Pulse and Proximity Sensor Library" (MAX30105.h,
//          heartRate.h) and "Adafruit DRV2605 Library" (Arduino Library Manager).
//
// Wiring (I2C, shared):
//     VIN  -> ESP32 3V3        SDA -> ESP32 GPIO21
//     GND  -> ESP32 GND        SCL -> ESP32 GPIO22
//     DRV2605 OUT+/OUT- -> LRA actuator leads.

#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"
#include <Adafruit_DRV2605.h>

MAX30105 sensor;
Adafruit_DRV2605 haptic;
bool hapticReady = false;

// --- pulse sensing (node -> app) ---
const byte RATE_SIZE = 8;
byte rates[RATE_SIZE];
byte rateSpot = 0;
long lastBeatMs = 0;
int beatAvg = 0;
const long FINGER_IR_THRESHOLD = 50000;

// --- haptic beat-back (app -> node) ---
// A soft thump envelope in realtime mode: quick attack, short decay, so it reads
// as a heartbeat rather than a hard click.
String inLine = "";
long hapticStartMs = -1;
int hapticPeak = 0;               // 0..127 realtime drive at the peak
const int HAPTIC_ATTACK_MS = 18;
const int HAPTIC_DECAY_MS = 120;

void setup() {
  Serial.begin(115200);
  delay(200);

  if (!sensor.begin(Wire, I2C_SPEED_FAST)) {
    while (true) {
      Serial.println("# MAX30102 not found, check wiring");
      delay(1500);
    }
  }
  sensor.setup();
  sensor.setPulseAmplitudeRed(0x0A);
  sensor.setPulseAmplitudeGreen(0);

  if (haptic.begin()) {
    haptic.useLRA();                 // configure for a linear resonant actuator
    haptic.setMode(DRV2605_MODE_REALTIME);
    haptic.setRealtimeValue(0);
    hapticReady = true;
  } else {
    Serial.println("# DRV2605 not found (haptic disabled)");
  }

  Serial.println("# pulse node ready");
}

void loop() {
  handleIncoming();     // app -> node commands (H)
  updateHaptic();       // run the haptic thump envelope
  updatePulse();        // node -> app beats (B)
}

// Parse H<strength> lines from the app and arm a haptic thump.
void handleIncoming() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (inLine.length() > 1 && (inLine[0] == 'H' || inLine[0] == 'h')) {
        int strength = inLine.substring(1).toInt();   // 0..100
        strength = constrain(strength, 0, 100);
        hapticPeak = map(strength, 0, 100, 0, 127);
        hapticStartMs = millis();
      }
      inLine = "";
    } else if (inLine.length() < 12) {
      inLine += c;
    }
  }
}

void updateHaptic() {
  if (!hapticReady || hapticStartMs < 0) return;
  long age = millis() - hapticStartMs;
  int value = 0;
  if (age < HAPTIC_ATTACK_MS) {
    value = (int)((long)hapticPeak * age / HAPTIC_ATTACK_MS);
  } else if (age < HAPTIC_ATTACK_MS + HAPTIC_DECAY_MS) {
    long d = age - HAPTIC_ATTACK_MS;
    value = (int)((long)hapticPeak * (HAPTIC_DECAY_MS - d) / HAPTIC_DECAY_MS);
  } else {
    haptic.setRealtimeValue(0);
    hapticStartMs = -1;             // envelope finished
    return;
  }
  haptic.setRealtimeValue(constrain(value, 0, 127));
}

void updatePulse() {
  long ir = sensor.getIR();
  if (ir < FINGER_IR_THRESHOLD) {
    lastBeatMs = 0;                 // no contact: reset so the next hand starts clean
    return;
  }
  if (checkForBeat(ir)) {
    long now = millis();
    if (lastBeatMs > 0) {
      float bpm = 60.0f / ((now - lastBeatMs) / 1000.0f);
      if (bpm > 20 && bpm < 240) {
        rates[rateSpot++] = (byte)bpm;
        rateSpot %= RATE_SIZE;
        int sum = 0;
        for (byte i = 0; i < RATE_SIZE; i++) sum += rates[i];
        beatAvg = sum / RATE_SIZE;
        Serial.print('B');
        Serial.println(beatAvg);
      }
    }
    lastBeatMs = now;
  }
}
