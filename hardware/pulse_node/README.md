# Pulse node (맥 pulse-ground altar)

The sensor half of the pulse-ground altar. An ESP32 reads a heartbeat from a
MAX30102 and streams beats-per-minute to the browser, which grows the flower on
the visitor's pulse.

The whole piece runs with or without this board: `src/sensors/pulse.ts` uses a
simulated resting pulse until a real node is connected, so you can develop the
altar entirely in software first.

## Protocol

Newline-delimited ASCII over USB serial, 115200 baud:

```
B<bpm>\n      one line per detected beat, e.g. B72
# ...         any line starting with # is a comment/log, ignored by the app
```

That is the entire contract. Anything the app cannot parse is dropped.

## Parts

- ESP32 dev board with a USB-serial bridge (CP2102 or CH340), so it enumerates
  as a serial port the browser can open.
- MAX30102 pulse-oximeter breakout (MAX3010x family).

## Wiring (I2C)

| MAX30102 | ESP32 |
| --- | --- |
| VIN | 3V3 |
| GND | GND |
| SDA | GPIO21 (default SDA) |
| SCL | GPIO22 (default SCL) |

## Build and flash

1. Arduino IDE: install the ESP32 board support (Boards Manager).
2. Library Manager: install "SparkFun MAX3010x Pulse and Proximity Sensor
   Library" (provides `MAX30105.h` and `heartRate.h`; it drives the MAX30102).
3. Open `pulse_node.ino`, select your ESP32 board and port, upload.
4. Serial Monitor at 115200: rest a fingertip on the sensor. You should see a
   `# pulse node ready` line, then `B<bpm>` lines once beats are detected.

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

## Not in this node yet

- Haptic beat-back (DRV2605 + LRA). In the plan the dome plays the *flower's*
  drifting rhythm, which originates in the app, so it needs the app to send that
  rhythm back to the board (Web Serial is bidirectional, or move to WebSocket).
  That is a later step, tracked in the build plan, not this first sensing node.
