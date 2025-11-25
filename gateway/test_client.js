// Simple test client for HikeSafe gateway
// Usage: node test_client.js
// Requires gateway already running on ws://localhost:8080

const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  console.log('Connected to gateway WS');

  // Send device.query
  const q = { id: 'q1', action: 'device.query', params: { appVersion: 3 } };
  console.log('Sending device.query ->', q);
  ws.send(JSON.stringify(q));

  // After 1.5s send a test sendText (replace toPrefix with a real 6-byte hex prefix)
  setTimeout(() => {
    const msg = {
      id: 'm1',
      action: 'sendText',
      params: {
        toPrefix: 'abcdef012345', // example 6-byte hex; replace with real prefix
        text: 'Hello from test client!'
      }
    };
    console.log('Sending sendText ->', msg);
    ws.send(JSON.stringify(msg));
  }, 1500);
  
  // After 3s send a setProfile
  setTimeout(() => {
    const profile = { id: 'p1', action: 'setProfile', params: { profile: 'Test profile from client' } };
    console.log('Sending setProfile ->', profile);
    ws.send(JSON.stringify(profile));
  }, 3000);

  // After 4s request profile back
  setTimeout(() => {
    const gp = { id: 'p2', action: 'getProfile', params: {} };
    console.log('Sending getProfile ->', gp);
    ws.send(JSON.stringify(gp));
  }, 4000);
});

ws.on('message', (m) => {
  try {
    const obj = JSON.parse(m.toString());
    console.log('RECV:', JSON.stringify(obj, null, 2));
  } catch (e) {
    console.log('RECV (raw):', m.toString());
  }
});

ws.on('close', () => console.log('WS closed'));
ws.on('error', (err) => console.error('WS error', err));
