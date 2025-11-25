/*
 Minimal HikeSafe gateway
 - connects to a serial device (LilyGo running companion_radio)
 - parses framed serial messages (device uses '>' as start, LSB/MSB length)
 - exposes a WebSocket server for apps to send JSON commands and receive device events

 Usage:
  - set env VAR SERIAL_PORT to the serial device path (eg. COM3 on Windows or /dev/ttyUSB0)
  - node index.js

 WebSocket messages (JSON):
  - client -> gateway: { id: "uuid", action: "device.query", params: { appVersion: 3 } }
  - client -> gateway: { id, action: "sendText", params: { toPrefix: "abcdef123456", text: "hi", txtType:0, attempt:0 } }
  - gateway -> client: broadcasts device frames as { type: "device_frame", code: <num>, payloadHex: "...", payloadBase64: "..." }
*/

// attempt to require serialport from either the scoped package or the legacy package name
let SerialPort;
try {
  const sp = require('@serialport/serialport');
  SerialPort = sp.SerialPort || sp;
} catch (e) {
  try {
    const sp2 = require('serialport');
    SerialPort = sp2.SerialPort || sp2;
  } catch (err) {
    console.error('serialport package not found. Please install one of @serialport/serialport or serialport.');
    process.exit(1);
  }
}
const http = require('http');
const WebSocket = require('ws');
const express = require('express');

const CMD_SEND_TXT_MSG = 2;
const CMD_SEND_CHANNEL_TXT_MSG = 3;
const CMD_DEVICE_QEURY = 22;
const CMD_SET_PROFILE = 44;
const CMD_GET_PROFILE = 45;
const CMD_CREATE_LOBBY = 46;
const CMD_JOIN_LOBBY = 47;
const CMD_SET_DEVICE_GPS = 48;

const RESP_CODE_SENT = 6; // used by device to confirm
const RESP_CODE_OK = 0;
const RESP_CODE_ERR = 1;
const RESP_CODE_DEVICE_INFO = 13;
const RESP_CODE_CHANNEL_INFO = 18;
const RESP_CODE_PROFILE = 24;

const DEFAULT_BAUD = parseInt(process.env.SERIAL_BAUD || '115200', 10);
const SERIAL_PORT_PATH = process.env.SERIAL_PORT || process.argv[2] || null;
const WS_PORT = parseInt(process.env.WS_PORT || '8080', 10);

if (!SERIAL_PORT_PATH) {
  console.error('Please provide serial port path as env SERIAL_PORT or first arg');
  console.error('Example: SERIAL_PORT=COM3 node index.js');
  process.exit(1);
}

console.log('Opening serial port', SERIAL_PORT_PATH, 'baud', DEFAULT_BAUD);

const port = new SerialPort({ path: SERIAL_PORT_PATH, baudRate: DEFAULT_BAUD, autoOpen: false });
let serialReady = false;

// receive buffer state machine
let rxBuffer = Buffer.alloc(0);
// Device sends frames prefixed with '>' (0x3E) then LEN LSB, LEN MSB, then payload

function feedSerialData(chunk) {
  rxBuffer = Buffer.concat([rxBuffer, chunk]);
  while (true) {
    // find start marker '>'
    const idx = rxBuffer.indexOf(0x3E); // '>'
    if (idx === -1) {
      // no start marker yet, can drop leading garbage
      if (rxBuffer.length > 256) rxBuffer = Buffer.alloc(0);
      return;
    }
    if (idx > 0) rxBuffer = rxBuffer.slice(idx); // drop leading bytes
    if (rxBuffer.length < 3) return; // need at least start + 2 len bytes
    const len = rxBuffer[1] | (rxBuffer[2] << 8);
    const totalNeeded = 3 + len;
    if (rxBuffer.length < totalNeeded) return; // wait for more data
    const payload = rxBuffer.slice(3, 3 + len);
    handleDeviceFrame(payload);
    rxBuffer = rxBuffer.slice(totalNeeded);
  }
}

function writeFrameToDevice(payloadBuf) {
  const len = payloadBuf.length;
  const hdr = Buffer.from([0x3C, len & 0xff, (len >> 8) & 0xff]); // '<' + len LSB/MSB
  const frame = Buffer.concat([hdr, payloadBuf]);
  if (!serialReady) {
    console.warn('Serial not open: dropping frame intended for device. Payload hex=', frame.toString('hex'));
    return;
  }
  port.write(frame, (err) => {
    if (err) console.error('Error writing frame to device:', err.message);
  });
}

// simple hex convert helpers
function hexToBytes(hex) {
  if (!hex) return Buffer.alloc(0);
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const b = Buffer.alloc(Math.ceil(clean.length / 2));
  for (let i = 0; i < clean.length; i += 2) {
    b[i / 2] = parseInt(clean.substr(i, 2), 16);
  }
  return b;
}
function bytesToHex(b) { return Buffer.from(b).toString('hex'); }

// WebSocket server
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let clients = new Set();

// pending requests keyed by client-provided id
const pendingRequests = new Map();

function addPendingRequest(id, ws, expectedCodes, timeoutMs = 5000) {
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
  }
  if (pendingRequests.has(id)) {
    // clear previous
    const pr = pendingRequests.get(id);
    clearTimeout(pr.timer);
    pendingRequests.delete(id);
  }
  const timer = setTimeout(() => {
    try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id, ok: false, error: 'timeout waiting for device' })); } catch (e) {}
    pendingRequests.delete(id);
  }, timeoutMs);
  pendingRequests.set(id, { ws, expectedCodes: new Set(expectedCodes), timer });
  // when ws closes, clean up
  ws.on('close', () => {
    if (pendingRequests.has(id)) {
      clearTimeout(pendingRequests.get(id).timer);
      pendingRequests.delete(id);
    }
  });
  return id;
}
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('WS client connected. total=', clients.size);
  ws.on('message', (msg) => {
    try {
      const obj = JSON.parse(msg.toString());
      handleClientMessage(ws, obj);
    } catch (e) {
      ws.send(JSON.stringify({ ok: false, error: 'invalid json' }));
    }
  });
  ws.on('close', () => { clients.delete(ws); console.log('WS client disconnected. total=', clients.size); });
});

function broadcast(json) {
  const s = JSON.stringify(json);
  for (const c of clients) {
    if (c.readyState === WebSocket.OPEN) c.send(s);
  }
}

function handleClientMessage(ws, obj) {
  const id = obj.id || null;
  const action = obj.action;
  const params = obj.params || {};

  if (action === 'device.query') {
    const ver = params.appVersion || 3;
    const payload = Buffer.from([CMD_DEVICE_QEURY, ver]);
    addPendingRequest(id, ws, [RESP_CODE_DEVICE_INFO, RESP_CODE_DISABLED, RESP_CODE_ERR]);
    if (!serialReady) { ws.send(JSON.stringify({ id, ok: false, error: 'serial_unavailable' })); return; }
    writeFrameToDevice(payload);
    return;
  }

  if (action === 'setProfile') {
    // params: profileBase64 OR profileHex OR profile (utf8 string)
    let payloadBuf;
    if (params.profileBase64) {
      payloadBuf = Buffer.from(params.profileBase64, 'base64');
    } else if (params.profileHex) {
      payloadBuf = hexToBytes(params.profileHex);
    } else if (params.profile) {
      payloadBuf = Buffer.from(params.profile, 'utf8');
    } else {
      ws.send(JSON.stringify({ id, ok: false, error: 'missing profile payload' }));
      return;
    }
    const payload = Buffer.concat([Buffer.from([CMD_SET_PROFILE]), payloadBuf]);
    addPendingRequest(id, ws, [RESP_CODE_OK, RESP_CODE_ERR]);
    if (!serialReady) { ws.send(JSON.stringify({ id, ok: false, error: 'serial_unavailable' })); return; }
    writeFrameToDevice(payload);
    return;
  }

  if (action === 'getProfile') {
    const payload = Buffer.from([CMD_GET_PROFILE]);
    addPendingRequest(id, ws, [RESP_CODE_PROFILE, RESP_CODE_ERR]);
    if (!serialReady) { ws.send(JSON.stringify({ id, ok: false, error: 'serial_unavailable' })); return; }
    writeFrameToDevice(payload);
    return;
  }

  if (action === 'createLobby') {
    // params: name (string), optional pskBase64 or psk (utf8/base64)
    if (!params.name) { ws.send(JSON.stringify({ id, ok: false, error: 'missing name' })); return; }
    const nameBuf = Buffer.from(params.name, 'utf8');
    const nameLen = Math.min(nameBuf.length, 32);
    let pskBuf = Buffer.alloc(0);
    if (params.pskBase64) pskBuf = Buffer.from(params.pskBase64, 'base64');
    else if (params.psk) pskBuf = Buffer.from(params.psk, 'utf8');
    const payload = Buffer.concat([Buffer.from([CMD_CREATE_LOBBY, nameLen]), nameBuf.slice(0, nameLen), pskBuf]);
    addPendingRequest(id, ws, [RESP_CODE_CHANNEL_INFO, RESP_CODE_ERR]);
    if (!serialReady) { ws.send(JSON.stringify({ id, ok: false, error: 'serial_unavailable' })); return; }
    writeFrameToDevice(payload);
    return;
  }

  if (action === 'joinLobby') {
    // params: channelIdx (number) and secret (base64 or hex or raw) OR special channelIdx=255 to add by name
    if (typeof params.channelIdx !== 'number') { ws.send(JSON.stringify({ id, ok: false, error: 'missing channelIdx' })); return; }
    const idx = params.channelIdx & 0xff;
    if (idx === 0xFF) {
      // expect name and secret
      if (!params.name || !params.secret) { ws.send(JSON.stringify({ id, ok: false, error: 'missing name or secret' })); return; }
      const nameBuf = Buffer.from(params.name, 'utf8');
      const nameLen = Math.min(nameBuf.length, 32);
      let secretBuf = Buffer.from(params.secret, 'base64');
      if (!secretBuf || secretBuf.length === 0) secretBuf = Buffer.from(params.secret, 'utf8');
      const payload = Buffer.concat([Buffer.from([CMD_JOIN_LOBBY, 0xFF, nameLen]), nameBuf.slice(0, nameLen), secretBuf.slice(0,16)]);
      addPendingRequest(id, ws, [RESP_CODE_OK, RESP_CODE_ERR]);
      if (!serialReady) { ws.send(JSON.stringify({ id, ok: false, error: 'serial_unavailable' })); return; }
      writeFrameToDevice(payload);
    } else {
      if (!params.secret) { ws.send(JSON.stringify({ id, ok: false, error: 'missing secret' })); return; }
      let secretBuf = Buffer.from(params.secret, 'base64');
      if (!secretBuf || secretBuf.length === 0) secretBuf = Buffer.from(params.secret, 'utf8');
      const payload = Buffer.concat([Buffer.from([CMD_JOIN_LOBBY, idx]), secretBuf.slice(0,16)]);
      addPendingRequest(id, ws, [RESP_CODE_OK, RESP_CODE_ERR]);
      if (!serialReady) { ws.send(JSON.stringify({ id, ok: false, error: 'serial_unavailable' })); return; }
      writeFrameToDevice(payload);
    }
    return;
  }

  if (action === 'setDeviceGps') {
    // params: lat (float) lon (float) or latE6 / lonE6 integers
    let latE6 = null, lonE6 = null;
    if (typeof params.lat === 'number' && typeof params.lon === 'number') {
      latE6 = Math.round(params.lat * 1e6);
      lonE6 = Math.round(params.lon * 1e6);
    } else if (typeof params.latE6 === 'number' && typeof params.lonE6 === 'number') {
      latE6 = params.latE6; lonE6 = params.lonE6;
    } else {
      ws.send(JSON.stringify({ id, ok: false, error: 'missing lat/lon' })); return;
    }
    const buf = Buffer.alloc(1 + 4 + 4);
    buf[0] = CMD_SET_DEVICE_GPS;
    buf.writeInt32LE(latE6, 1);
    buf.writeInt32LE(lonE6, 5);
    addPendingRequest(id, ws, [RESP_CODE_OK, RESP_CODE_ERR]);
    if (!serialReady) { ws.send(JSON.stringify({ id, ok: false, error: 'serial_unavailable' })); return; }
    writeFrameToDevice(buf);
    return;
  }

  if (action === 'sendText') {
    // params: toPrefix (hex string 12 chars), text, txtType (0), attempt (0)
    if (!params.toPrefix || !params.text) {
      ws.send(JSON.stringify({ id, ok: false, error: 'missing toPrefix or text' }));
      return;
    }
    const txtType = params.txtType || 0;
    const attempt = params.attempt || 0;
    const ts = Math.floor(Date.now() / 1000);
    const toBuf = hexToBytes(params.toPrefix);
    if (toBuf.length !== 6) {
      ws.send(JSON.stringify({ id, ok: false, error: 'toPrefix must be 6 bytes (12 hex chars)' }));
      return;
    }
    const textBuf = Buffer.from(params.text, 'utf8');
    const payload = Buffer.alloc(1 + 1 + 1 + 4 + 6 + textBuf.length);
    let i = 0;
    payload[i++] = CMD_SEND_TXT_MSG;
    payload[i++] = txtType & 0xff;
    payload[i++] = attempt & 0xff;
    payload.writeUInt32LE(ts, i); i += 4;
    toBuf.copy(payload, i); i += 6;
    textBuf.copy(payload, i);

    addPendingRequest(id, ws, [RESP_CODE_SENT, RESP_CODE_ERR]);
    if (!serialReady) { ws.send(JSON.stringify({ id, ok: false, error: 'serial_unavailable' })); return; }
    writeFrameToDevice(payload);
    return;
  }

  if (action === 'sendChannelText') {
    // params: channelIdx (number), text
    if (typeof params.channelIdx !== 'number' || !params.text) {
      ws.send(JSON.stringify({ id, ok: false, error: 'missing channelIdx or text' }));
      return;
    }
    const txtType = params.txtType || 0;
    const ts = Math.floor(Date.now() / 1000);
    const textBuf = Buffer.from(params.text, 'utf8');
    // payload format in companion: CMD_SEND_CHANNEL_TXT_MSG, txt_type, channel_idx, timestamp(4), text...
    const payload = Buffer.alloc(1 + 1 + 1 + 4 + textBuf.length);
    let i = 0;
    payload[i++] = CMD_SEND_CHANNEL_TXT_MSG;
    payload[i++] = txtType & 0xff;
    payload[i++] = params.channelIdx & 0xff;
    payload.writeUInt32LE(ts, i); i += 4;
    textBuf.copy(payload, i);
    addPendingRequest(id, ws, [RESP_CODE_OK, RESP_CODE_ERR]);
    if (!serialReady) { ws.send(JSON.stringify({ id, ok: false, error: 'serial_unavailable' })); return; }
    writeFrameToDevice(payload);
    return;
  }

  ws.send(JSON.stringify({ id, ok: false, error: 'unknown action' }));
}

function handleDeviceFrame(payload) {
  if (!payload || payload.length === 0) return;
  const code = payload[0];
  const hex = payload.toString('hex');
  const b64 = payload.toString('base64');

  // quick decode for common responses
  const info = { type: 'device_frame', code, payloadHex: hex, payloadBase64: b64 };

  // if RESP_CODE_SENT (6) we can attempt to parse fields (see MyMesh::handleCmdFrame)
  if (code === RESP_CODE_SENT) {
    // payload example in MyMesh: RESP_CODE_SENT (1 byte), floodFlag (1 byte), expected_ack (4), est_timeout(4)
    if (payload.length >= 9) {
      const sentMode = payload[1];
      const expectedAck = payload.readUInt32LE(2);
      const estTimeout = payload.readUInt32LE(6);
      info.sent = { flood: sentMode === 1, expectedAck, estTimeout };
    }
  }

  // check pending requests and resolve first match
  for (const [pid, pr] of pendingRequests) {
    if (pr.expectedCodes && pr.expectedCodes.has(code)) {
      clearTimeout(pr.timer);
      try {
        if (pr.ws && pr.ws.readyState === WebSocket.OPEN) {
          const resp = { id: pid, ok: (code !== RESP_CODE_ERR && code !== RESP_CODE_DISABLED), response: info };
          pr.ws.send(JSON.stringify(resp));
        }
      } catch (e) {
        // ignore send errors
      }
      pendingRequests.delete(pid);
      break; // resolve only first matching request
    }
  }

  // broadcast to connected clients
  broadcast(info);
}

port.open((err) => {
  if (err) {
    console.error('Failed to open serial port:', err.message);
    console.log('Continuing without serial device. WebSocket server will run but device writes will be dropped.');
    serialReady = false;
    server.listen(WS_PORT, () => {
      console.log('WebSocket server listening on port', WS_PORT);
    });
    return;
  }
  console.log('Serial port opened. Starting gateway...');
  serialReady = true;

  port.on('data', (chunk) => {
    feedSerialData(chunk);
  });

  port.on('error', (err) => { console.error('Serial port error:', err.message); });

  server.listen(WS_PORT, () => {
    console.log('WebSocket server listening on port', WS_PORT);
  });
});

// simple HTTP health endpoint
app.get('/health', (req, res) => res.json({ ok: true }));

// Export for testing
module.exports = { feedSerialData, writeFrameToDevice }; 
