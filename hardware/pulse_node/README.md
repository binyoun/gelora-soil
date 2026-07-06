# Pulse node (맥 pulse-ground altar)

The sensing and haptic node of the pulse-ground altar. An ESP32 reads a heartbeat
from a MAX30102 and streams beats-per-minute to the browser, which grows the
flower on the visitor's pulse; and it plays a haptic beat-back in the dome on
command from the app, so the visitor feels the flower's own drifting pulse.

The whole piece runs with or without this board: `src/sensors/pulse.ts` uses a
simulated resting pulse until a real node is connected, so you can develop the
altar entirely in software first. Without a board, no haptic commands are sent.

## Protocol

Newline-delimited ASCII over USB serial, 115200 baud, both directions:

```
node -> app   B<bpm>\n        one beat, e.g. B72
app  -> node   H<strength>\n   fire one haptic pulse, strength 0..100
# ...          comment/log line, ignored by the app
```

The app owns the haptic timing: it computes the flower's own rhythm (which starts
locked to the visitor's pulse, then drifts slower and falters as the flower ages
and dies) and sends one `H` per flower-beat, with strength falling toward death.

## Parts

- ESP32 dev board with a USB-serial bridge (CP2102 or CH340), so it enumerates
  as a serial port the browser can open.
- MAX30102 pulse-oximeter breakout (MAX3010x family), I2C 0x57.
- Adafruit DRV2605L haptic driver, I2C 0x5A, with an LRA (linear resonant
  actuator) for a soft heartbeat thump under the dome.

## Wiring (I2C, shared bus)

| Pin | ESP32 |
| --- | --- |
| MAX30102 + DRV2605 VIN | 3V3 |
| MAX30102 + DRV2605 GND | GND |
| SDA (both) | GPIO21 (default SDA) |
| SCL (both) | GPIO22 (default SCL) |
| DRV2605 OUT+ / OUT- | LRA actuator leads |

The two sensors sit on the same I2C bus at different addresses, so no conflict.

## Build and flash

1. Arduino IDE: install the ESP32 board support (Boards Manager).
2. Library Manager: install "SparkFun MAX3010x Pulse and Proximity Sensor
   Library" (`MAX30105.h`, `heartRate.h`, drives the MAX30102) and "Adafruit
   DRV2605 Library".
3. Open `pulse_node.ino`, select your ESP32 board and port, upload.
4. Serial Monitor at 115200: rest a fingertip on the sensor. You should see a
   `# pulse node ready` line, then `B<bpm>` lines once beats are detected. Sending
   an `H80` line by hand should fire a single thump in the actuator.

## Connect to the piece

1. Serve the app (`npm run dev`) or open the deployed site.
2. Open it in Chrome or Edge (Web Serial is not available in Safari or Firefox;
   there the piece stays on the simulated pulse).
3. Add `?altar=1` to the URL and tap to begin. A `connect pulse` chip appears.
4. Tap `connect pulse`, pick the ESP32's serial port. The readout switches from
   `(sim)` to a live bpm, and the flower begins to grow and breathe on the pulse.

## Contact quality

PPG is most reliable on a fingertip. In the altar, guide the finger or the
fleshy heart-point of the palm to rest lightly and still on the sensor window
under the dome. Resting contact reads best; hard pressure squeezes out the blood
signal and the beat disappears.

## Next on the node

- Warmth. The seed direction (f) adds a PTC heater with a closed-loop thermistor
  so the held object warms with the flower and cools when it dies. That belongs
  in the seed's own node, not this altar node.
- Wireless. If the altar should run without a USB tether, move the transport from
  Web Serial to a WebSocket over Wi-Fi; the B / H line protocol stays the same.
