// Channel state and broadcast helpers (no behavior change)

// channel => { lastFrame: string | null, clients: Set<{ws, role}>, sse: Set<res>, config: object }
const channels = new Map();

function getChannel(name) {
  if (!channels.has(name)) channels.set(name, { lastFrame: null, clients: new Set(), sse: new Set(), config: {} });
  return channels.get(name);
}

function broadcast(channel, data, predicate = () => true) {
  for (const c of channel.clients) {
    if (c.ws.readyState === 1 && predicate(c)) {
      try { c.ws.send(data); } catch (_) {}
    }
  }
}

function broadcastSSE(channel, eventObj) {
  const payload = `event: ${eventObj.type}\n` +
                  `data: ${JSON.stringify(eventObj)}\n\n`;
  for (const res of channel.sse) {
    try { res.write(payload); } catch (_) {}
  }
}

export { channels, getChannel, broadcast, broadcastSSE };

