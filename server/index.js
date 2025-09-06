import http from 'http';
import express from 'express';
import { WebSocketServer } from 'ws';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// channel => { lastFrame: string | null, clients: Set<{ws, role}> }
const channels = new Map();

function getChannel(name) {
  if (!channels.has(name)) channels.set(name, { lastFrame: null, clients: new Set() });
  return channels.get(name);
}

function broadcast(channel, data, predicate = () => true) {
  for (const c of channel.clients) {
    if (c.ws.readyState === 1 && predicate(c)) {
      try { c.ws.send(data); } catch (_) {}
    }
  }
}

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
      return;
    }
  });

  ws.on('close', () => {
    ch.clients.delete(client);
  });
});

app.get('/', (_req, res) => {
  res.type('text/plain').send('OK: drawing-relay-server');
});

const PORT = process.env.PORT || 8787;
server.listen(PORT, () => {
  console.log(`Relay server listening on :${PORT}`);
});

