# HikeSafe Gateway

## Purpose

This is a minimal Node.js gateway that bridges a HikeSafe LoRa node running the `companion_radio` firmware to WebSocket JSON clients (e.g. a React Native app).

## How it works

- The LilyGo device (running `companion_radio`) uses a framed serial protocol where outgoing frames are prefixed with `>` then 2 bytes length (LSB/MSB) then payload. Incoming frames from clients to device must be prefixed with `<` and then the 2 byte length followed by payload.
- This gateway opens a serial port to the device, parses incoming frames, and broadcasts them to connected WebSocket clients as JSON. It also accepts JSON commands over WebSocket and writes framed payloads to the device.

## Quick start

1. Install dependencies:

```bash
cd gateway
npm install
```

2. Run the gateway (set your serial port):

On Windows (PowerShell):

```powershell
$env:SERIAL_PORT='COM3'
node index.js
```

On Linux/macOS:

```bash
SERIAL_PORT=/dev/ttyUSB0 node index.js
```

3. Connect from your app (WebSocket):

- ws://<gateway-host>:8080

## Example WebSocket messages

- Query device info:

```json
{ "id": "1", "action": "device.query", "params": { "appVersion": 3 } }
```

- Send a direct text message (to a contact by 6-byte prefix in hex):

```json
{
  "id": "2",
  "action": "sendText",
  "params": { "toPrefix": "abcdef012345", "text": "Hello from app!" }
}
```

- Send a channel message (channel index must exist on device):

```json
{
  "id": "3",
  "action": "sendChannelText",
  "params": { "channelIdx": 0, "text": "Hello channel!" }
}
```

## Incoming device frames

Gateway broadcasts parsed frames as JSON objects like:

```json
{
  "type": "device_frame",
  "code": 130,
  "payloadHex": "82...",
  "payloadBase64": "..."
}
```

You can inspect `code` to know what the payload means (see `examples/companion_radio/MyMesh.cpp` for `PUSH_CODE_` and `RESP_CODE_` meanings).

## Notes

- This gateway is intentionally minimal. It does not implement authentication or persistent storage. For production use you should add TLS, authentication, and persistent message/history storage.
- If you want the mobile app to talk directly to the device over BLE or TCP, you can — the repo already contains `SerialBLEInterface` and `SerialWifiInterface` examples in `examples/companion_radio`.

## Next steps I can implement for you

- Add simple request/response correlation (return device replies mapped to the request id).
- Persist messages into a small SQLite DB.
- Provide a React Native example that connects to this gateway and demonstrates the JSON actions above.
