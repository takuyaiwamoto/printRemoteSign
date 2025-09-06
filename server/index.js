import http from 'http';
import express from 'express';
import { WebSocketServer } from 'ws';

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

    // Realtime stroke relay (WebSocket only). Small JSON messages.
    if (msg.type === 'stroke') {
      // Basic validation
      if (!msg.phase) return;
      const relay = JSON.stringify(msg);
      broadcast(ch, relay, (c) => c.role === 'receiver');
      return;
    }

    if (msg.type === 'clear') {
      const relay = JSON.stringify({ type: 'clear' });
      broadcast(ch, relay, (c) => c.role === 'receiver');
      // Also reset lastFrame so new receivers start blank
      ch.lastFrame = null;
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

// HTTP fallback endpoints (optional). Useful when proxies block WebSockets.
app.get('/last', (req, res) => {
  const channelName = req.query.channel || 'default';
  const ch = getChannel(channelName);
  res.json({ type: 'frame', data: ch.lastFrame || null });
});

app.post('/frame', (req, res) => {
  const channelName = req.query.channel || 'default';
  const ch = getChannel(channelName);
  const data = req.body?.data;
  if (typeof data !== 'string' || data.length > 10 * 1024 * 1024) {
    return res.status(400).json({ error: 'invalid_or_too_large' });
  }
  ch.lastFrame = data;
  const txt = JSON.stringify({ type: 'frame', data });
  broadcast(ch, txt, (c) => c.role === 'receiver');
  res.json({ ok: true });
});

const PORT = process.env.PORT || 8787;
server.listen(PORT, () => {
  console.log(`Relay server listening on :${PORT}`);
});
