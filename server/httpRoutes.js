import express from 'express';
import { getChannel, broadcast, broadcastSSE } from './lib/channels.js';

// Register HTTP routes on an existing Express app (no behavior change)
function registerHttpRoutes(app) {
  // Lightweight CORS + JSON body for HTTP fallback
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '20mb' }));

  app.get('/', (_req, res) => { res.type('text/plain').send('OK: drawing-relay-server'); });

  // Server-Sent Events endpoint for receivers behind WS-blocking proxies
  app.get('/events', (req, res) => {
    const channelName = req.query.channel || 'default';
    const ch = getChannel(channelName);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    ch.sse.add(res);
    try { res.write(`event: hello\ndata: ${JSON.stringify({ channel: channelName })}\n\n`); } catch (_) {}
    if (ch.lastFrame) {
      try { res.write(`event: frame\ndata: ${JSON.stringify({ type:'frame', data: ch.lastFrame })}\n\n`); } catch (_) {}
    }
    const keep = setInterval(() => { try { res.write(':keep-alive\n\n'); } catch (_) {} }, 15000);
    req.on('close', () => { clearInterval(keep); ch.sse.delete(res); });
  });

  // HTTP fallback endpoints
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
    broadcastSSE(ch, { type: 'frame', data });
    res.json({ ok: true });
  });

  // HTTP fallback for strokes: accepts single or batched events
  app.post('/stroke', (req, res) => {
    const channelName = req.query.channel || 'default';
    const ch = getChannel(channelName);
    const body = req.body || {};
    const events = Array.isArray(body.batch) ? body.batch : [body];
    for (const e of events) {
      if (!e || e.type !== 'stroke' || !e.phase) continue;
      const msg = { type: 'stroke', phase: e.phase, id: e.id, nx: e.nx, ny: e.ny, color: e.color, size: e.size, sizeN: e.sizeN, authorId: String(e.authorId||''), tool: e.tool || 'pen' };
      const txt = JSON.stringify(msg);
      broadcast(ch, txt, (c) => c.role === 'receiver');
      broadcastSSE(ch, msg);
    }
    res.json({ ok: true });
  });

  app.post('/clear', (req, res) => {
    const channelName = req.query.channel || 'default';
    const ch = getChannel(channelName);
    const msg = { type: 'clear' };
    const txt = JSON.stringify(msg);
    broadcast(ch, txt, () => true);
    broadcastSSE(ch, msg);
    ch.lastFrame = null;
    res.json({ ok: true });
  });

  // HTTP fallback for sendAnimation trigger
  app.post('/anim', (req, res) => {
    const channelName = req.query.channel || 'default';
    const ch = getChannel(channelName);
    const msg = { type: 'sendAnimation' };
    const txt = JSON.stringify(msg);
    try { console.log('[server] /anim trigger channel=', channelName, 'clients=', ch.clients.size); } catch(_) {}
    broadcast(ch, txt, () => true);
    broadcastSSE(ch, msg);
    res.json({ ok: true });
  });

  // HTTP fallback for overlayStart trigger
  app.post('/overlay', (req, res) => {
    const channelName = req.query.channel || 'default';
    const ch = getChannel(channelName);
    const msg = { type: 'overlayStart' };
    const txt = JSON.stringify(msg);
    try { console.log('[server] /overlay trigger channel=', channelName, 'clients=', ch.clients.size); } catch(_) {}
    broadcast(ch, txt, () => true);
    broadcastSSE(ch, msg);
    res.json({ ok: true });
  });

  app.get('/config', (req, res) => {
    const channelName = req.query.channel || 'default';
    const ch = getChannel(channelName);
    res.json(ch.config || {});
  });
  app.post('/config', (req, res) => {
    const channelName = req.query.channel || 'default';
    const ch = getChannel(channelName);
    const data = req.body?.data;
    if (!data || typeof data !== 'object') return res.status(400).json({ error: 'invalid' });
    ch.config = { ...(ch.config || {}), ...data };
    const payload = JSON.stringify({ type: 'config', data });
    broadcast(ch, payload, () => true);
    broadcastSSE(ch, { type: 'config', data });
    res.json({ ok: true });
  });

  // HTTP fallback for clearMine
  app.post('/clearMine', (req, res) => {
    const channelName = req.query.channel || 'default';
    const ch = getChannel(channelName);
    const authorId = String(req.body?.authorId || '');
    if (!authorId) return res.status(400).json({ error: 'missing_authorId' });
    const msg = { type: 'clearMine', authorId };
    const txt = JSON.stringify(msg);
    broadcast(ch, txt, () => true);
    broadcastSSE(ch, msg);
    res.json({ ok: true });
  });
}

export { registerHttpRoutes };
