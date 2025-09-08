import http from 'http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { getChannel, broadcast, broadcastSSE } from './lib/channels.js';
import { registerHttpRoutes } from './httpRoutes.js';
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
// Register HTTP routes (same behavior as before)
registerHttpRoutes(app);
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
  // Provide default animation type B on fresh channels
  if (!ch.config || !ch.config.animType) {
    ch.config = { ...(ch.config||{}), animType: 'B', animAudioVol: (ch.config?.animAudioVol ?? 30) };
    try { ws.send(JSON.stringify({ type: 'config', data: ch.config })); } catch(_) {}
  }

  ws.on('message', (raw) => {
    let msg = null;
    try { msg = JSON.parse(raw.toString()); } catch (_) {}
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'frame' && typeof msg.data === 'string') {
      // naive size guard (10MB)
      if (msg.data.length > 10 * 1024 * 1024) return;
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
      return;
    }

    if (msg.type === 'overlayStart') {
      try { console.log('[server] overlayStart via WS from', role, 'channel=', channelName, 'clients=', ch.clients.size); } catch(_) {}
      const relay = JSON.stringify({ type: 'overlayStart' });
      broadcast(ch, relay, () => true);
      broadcastSSE(ch, { type: 'overlayStart' });
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
      // Merge into channel config and broadcast
      ch.config = { ...(ch.config || {}), ...msg.data };
      const payload = JSON.stringify({ type: 'config', data: msg.data });
      broadcast(ch, payload, () => true);
      broadcastSSE(ch, { type: 'config', data: msg.data });
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
