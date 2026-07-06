// vanitas :: pulse-ground altar (Oryn maek) :: sensor node
//
// Reads a heartbeat from a MAX30102 pulse sensor and prints the beats-per-minute
// over USB serial in the exact protocol the web app expects:
//
//     B<bpm>\n     one line per detected beat, e.g. "B72"
//
// The browser (src/sensors/pulse.ts) opens this port over Web Serial at 115200
// baud and feeds each beat into the flower's growth. No hardware, no problem:
// the app runs a simulated pulse until a real board is connected.
//
// Board:   any ESP32 dev board with a USB-serial bridge (CP2102 / CH340).
// Sensor:  MAX30102 breakout (the MAX3010x family; the SparkFun MAX3010x library
//          drives the MAX30102 as well as the MAX30105).
// Library: "SparkFun MAX3010x Pulse and Proximity Sensor Library"
//          (Arduino Library Manager). Provides MAX30105.h + heartRate.h.
//
// Wiring (I2C):
//     MAX30102 VIN -> ESP32 3V3
//     MAX30102 GND -> ESP32 GND
//     MAX30102 SDA -> ESP32 GPIO21 (default SDA)
//     MAX30102 SCL -> ESP32 GPIO22 (default SCL)
//
// Contact: PPG is most reliable on a fingertip. In the altar, guide the finger
// (or the fleshy heart-point of the palm) to rest lightly and still on the
// sensor window under the brass/porcelain dome. Too much pressure kills the
// signal; aim for resting contact.

#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"

MAX30105 sensor;

// Rolling average over the last few beats, so the reported BPM is steady rather
// than jumping on every interval. The app derives its own "calm" (steadiness)
// metric on top of this.
const byte RATE_SIZE = 8;
byte rates[RATE_SIZE];
byte rateSpot = 0;
long lastBeatMs = 0;
int beatAvg = 0;

// Below this IR reading there is no finger/palm on the sensor. While absent we
// stay silent (the app falls back to its simulated pulse after a short timeout).
const long FINGER_IR_THRESHOLD = 50000;

void setup() {
  Serial.begin(115200);
  delay(200);

  if (!sensor.begin(Wire, I2C_SPEED_FAST)) {
    // Sensor not found. Retry forever so a loose cable recovers on reseat.
    while (true) {
      Serial.println("# MAX30102 not found, check wiring");
      delay(1500);
    }
  }

  // Gentle red LED, green off: enough for a clean PPG without cooking the sensor.
  sensor.setup();
  sensor.setPulseAmplitudeRed(0x0A);
  sensor.setPulseAmplitudeGreen(0);

  Serial.println("# pulse node ready");
}

void loop() {
  long ir = sensor.getIR();

  if (ir < FINGER_IR_THRESHOLD) {
    // No contact: reset the running average so the next hand starts clean.
    lastBeatMs = 0;
    return;
  }

  if (checkForBeat(ir)) {
    long now = millis();
    if (lastBeatMs > 0) {
      long delta = now - lastBeatMs;
      float bpm = 60.0f / (delta / 1000.0f);
      if (bpm > 20 && bpm < 240) {
        rates[rateSpot++] = (byte)bpm;
        rateSpot %= RATE_SIZE;

        int sum = 0;
        for (byte i = 0; i < RATE_SIZE; i++) sum += rates[i];
        beatAvg = sum / RATE_SIZE;

        // The one line the app parses.
        Serial.print('B');
        Serial.println(beatAvg);
      }
    }
    lastBeatMs = now;
  }
}
