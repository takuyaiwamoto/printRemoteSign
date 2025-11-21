import http from 'http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { getChannel, broadcast, broadcastSSE } from './lib/channels.js';
import { MAX_FRAME_BYTES } from './lib/constants.js';
import { registerHttpRoutes } from './httpRoutes.js';
import { initArduinoLedController, notifySendTriggered, notifyIdle, notifyRelayBurst, shutdownLed } from './lib/arduinoLedController.js';
const RELAY_VERSION = '0.6.2';

const app = express();
// Lightweight CORS + JSON body for HTTP fallback
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '20mb' }));

initArduinoLedController();

// Register HTTP routes (same behavior as before)
registerHttpRoutes(app, {
  onSendAnimation: () => {
    try { notifySendTriggered(); } catch (err) { console.warn('[server] notifySendTriggered failed', err?.message || err); }
  },
  onRelayKick: () => {
    try { notifyRelayBurst(); } catch (err) { console.warn('[server] notifyRelayBurst failed', err?.message || err); }
  },
  onHardwareTest: (action) => {
    try {
      switch (action) {
        case 'led-blue':
          notifyIdle();
          return true;
        case 'led-rainbow':
          notifySendTriggered();
          return true;
        case 'led-off':
          shutdownLed();
          return true;
        case 'relay-burst':
          notifyRelayBurst();
          return true;
        default:
          return false;
      }
    } catch (err) {
      console.warn('[server] hardware-test handler failed', err?.message || err);
      return false;
    }
  }
});
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const channelName = url.searchParams.get('channel') || 'default';
  const role = url.searchParams.get('role') || 'receiver';
  const ch = getChannel(channelName);
  const client = { ws, role };
  ch.clients.add(client);

  // greet
  try { ws.send(JSON.stringify({ type: 'hello', channel: channelName, role })); } catch (_) {}

  // Send last frame to newly connected receivers
  if (role === 'receiver' && ch.lastFrame) {
    try { ws.send(JSON.stringify({ type: 'frame', data: ch.lastFrame })); } catch (_) {}
  }
  // Send latest config to any client
  if (ch.config && Object.keys(ch.config).length) {
    try { ws.send(JSON.stringify({ type: 'config', data: ch.config })); } catch (_) {}
  }
  // Provide defaults on fresh channels (non-destructive)
  if (!ch.config || !ch.config.animType) {
    ch.config = { ...(ch.config||{}), animType: 'A', animAudioVol: (ch.config?.animAudioVol ?? 30) };
    try { ws.send(JSON.stringify({ type: 'config', data: ch.config })); } catch(_) {}
  }
  if (!ch.config || !ch.config.bgSender) {
    ch.config = { ...(ch.config||{}), bgSender: { mode: 'image', url: 'enoguM.png' } };
    try { ws.send(JSON.stringify({ type: 'config', data: { bgSender: ch.config.bgSender } })); } catch(_) {}
  }
  if (!ch.config || !ch.config.bgReceiver) {
    ch.config = { ...(ch.config||{}), bgReceiver: { mode: 'image', url: 'enoguM.png' } };
    try { ws.send(JSON.stringify({ type: 'config', data: { bgReceiver: ch.config.bgReceiver } })); } catch(_) {}
  }

  ws.on('message', (raw) => {
    let msg = null;
    try { msg = JSON.parse(raw.toString()); } catch (_) {}
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'frame' && typeof msg.data === 'string') {
      // size guard
      if (msg.data.length > MAX_FRAME_BYTES) return;
      ch.lastFrame = msg.data;
      const txt = JSON.stringify({ type: 'frame', data: msg.data });
      broadcast(ch, txt, (c) => c.role === 'receiver');
      broadcastSSE(ch, { type: 'frame', data: msg.data });
      return;
    }

    if (msg.type === 'sendAnimation') {
      try { console.log('[server] sendAnimation via WS from', role, 'channel=', channelName, 'clients=', ch.clients.size); } catch(_) {}
      const relay = JSON.stringify({ type: 'sendAnimation' });
      broadcast(ch, relay, () => true);
      broadcastSSE(ch, { type: 'sendAnimation' });
      try { notifySendTriggered(); } catch (err) { console.warn('[server] notifySendTriggered failed', err?.message || err); }
      return;
    }

    if (msg.type === 'overlayStart') {
      try { console.log('[server] overlayStart via WS from', role, 'channel=', channelName, 'clients=', ch.clients.size); } catch(_) {}
      const relay = JSON.stringify({ type: 'overlayStart' });
      broadcast(ch, relay, () => true);
      broadcastSSE(ch, { type: 'overlayStart' });
      return;
    }

    if (msg.type === 'overlayStop') {
      try { console.log('[server] overlayStop via WS from', role, 'channel=', channelName, 'clients=', ch.clients.size); } catch(_) {}
      const relay = JSON.stringify({ type: 'overlayStop' });
      broadcast(ch, relay, () => true);
      broadcastSSE(ch, { type: 'overlayStop' });
      return;
    }

    // Realtime stroke relay (WebSocket only). Small JSON messages.
    if (msg.type === 'stroke') {
      // Basic validation
      if (!msg.phase) return;
      const relay = JSON.stringify(msg);
      // Broadcast to all roles (senders also見る)
      broadcast(ch, relay, () => true);
      broadcastSSE(ch, msg);
      return;
    }

    if (msg.type === 'clear' || msg.type === 'clearAll') {
      const relay = JSON.stringify({ type: 'clear' });
      broadcast(ch, relay, () => true);
      broadcastSSE(ch, { type: 'clear' });
      ch.lastFrame = null; // new receivers start blank
      return;
    }

    if (msg.type === 'clearMine' && msg.authorId) {
      const relay = JSON.stringify({ type: 'clearMine', authorId: String(msg.authorId) });
      broadcast(ch, relay, () => true);
      broadcastSSE(ch, { type: 'clearMine', authorId: String(msg.authorId) });
      return;
    }

    if (msg.type === 'config' && msg.data && typeof msg.data === 'object') {
      // Ephemeral keys should NOT persist in channel config to avoid replay on new clients
      const ephemeralKeys = new Set(['preCountStart','overlayRemainSec','overlayDescending','overlayWaiting','overlayKick','overlayStopKick','relayKick','ledTest','ledTestTs']);
      const persist = { ...(ch.config || {}) };
      // Merge only non-ephemeral keys
      for (const [k, v] of Object.entries(msg.data)) { if (!ephemeralKeys.has(k)) persist[k] = v; }
      ch.config = persist;
      const payload = JSON.stringify({ type: 'config', data: msg.data });
      broadcast(ch, payload, () => true);
      broadcastSSE(ch, { type: 'config', data: msg.data });
      if (Object.prototype.hasOwnProperty.call(msg.data, 'animKick')) {
        try { notifySendTriggered(); } catch (err) { console.warn('[server] notifySendTriggered failed', err?.message || err); }
      }
      if (Object.prototype.hasOwnProperty.call(msg.data, 'relayKick')) {
        try { notifyRelayBurst(); } catch (err) { console.warn('[server] notifyRelayBurst failed', err?.message || err); }
      }
      if (Object.prototype.hasOwnProperty.call(msg.data, 'ledTest')) {
        const v = String(msg.data.ledTest || '').toLowerCase();
        if (v === 'blue') {
          try { notifyIdle(); } catch (err) { console.warn('[server] notifyIdle (ledTest) failed', err?.message || err); }
        } else if (v === 'off') {
          try { shutdownLed(); } catch (err) { console.warn('[server] shutdownLed (ledTest) failed', err?.message || err); }
        } else if (v === 'rainbow') {
          try { notifySendTriggered(); } catch (err) { console.warn('[server] notifySendTriggered (ledTest) failed', err?.message || err); }
        }
      }
      return;
    }
  });

  ws.on('close', () => {
    ch.clients.delete(client);
  });
});

app.get('/version', (_req, res) => {
  res.json({ name: 'drawing-relay-server', version: RELAY_VERSION });
});

const PORT = process.env.PORT || 8787;
server.listen(PORT, () => {
  console.log(`Relay server listening on :${PORT}`);
});
