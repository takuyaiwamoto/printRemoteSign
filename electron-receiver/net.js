(() => {
  function toHttpBase(u) {
    return u.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://').replace(/\/$/, '');
  }
  function toWsBase(u) {
    return u.replace(/^http/, 'ws').replace(/\/$/, '');
  }

  function create({ server, channel, onFrame, onStroke, onClear, onConfig, onAction, setStatus, setInfo, log }) {
    let SERVER = (server || '').trim();
    let CHANNEL = (channel || 'default').trim();
    let ws = null;
    let reconnectTimer = null;
    let wsOpen = false;
    let httpPollTimer = null;
    let es = null; // EventSource
    let configPollTimer = null;
    let lastOverlayKick = 0;
    const bootAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    const debug = (...a) => { try { log && log(...a); } catch(_) {} };

    function startHttpPolling() {
      if (httpPollTimer) return;
      const httpBase = toHttpBase(SERVER);
      const u = `${httpBase}/last?channel=${encodeURIComponent(CHANNEL)}`;
      const tick = async () => {
        try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (j && j.type==='frame' && typeof j.data==='string' && j.data) onFrame && onFrame(j.data); } } catch(_) {}
      };
      httpPollTimer = setInterval(tick, 300);
      tick();
    }
    function stopHttpPolling() { if (httpPollTimer) { clearInterval(httpPollTimer); httpPollTimer = null; } }

    function startSSE() {
      if (es) return;
      const httpBase = toHttpBase(SERVER);
      const url = `${httpBase}/events?channel=${encodeURIComponent(CHANNEL)}`;
      try { es = new EventSource(url, { withCredentials: false }); } catch(_) { return; }
      setStatus && setStatus('SSE接続中…');
      es.addEventListener('hello', () => setStatus && setStatus('受信待機 (SSE)'));
      es.addEventListener('frame', (ev) => { try { const j = JSON.parse(ev.data); if (j && j.data) onFrame && onFrame(j.data); } catch(_) {} });
      es.addEventListener('stroke', (ev) => { try { const m = JSON.parse(ev.data); onStroke && onStroke(m); } catch(_) {} });
      es.addEventListener('clear', () => { onClear && onClear(); });
      es.addEventListener('clearMine', (ev) => { try { const m = JSON.parse(ev.data); onClear && onClear(String(m?.authorId||'')); } catch(_) {} });
      es.addEventListener('sendAnimation', () => { try { console.log('[receiver] SSE sendAnimation (event)'); } catch(_) {}; onAction && onAction('sendAnimation'); });
      es.addEventListener('config', (ev) => {
        try {
          const j = JSON.parse(ev.data);
          if (j && j.data) {
            onConfig && onConfig(j.data);
            if (Object.prototype.hasOwnProperty.call(j.data, 'overlayKick')) {
              const ts = Number(j.data.overlayKick) || 0;
              const nowT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
              if (ts > lastOverlayKick && nowT - bootAt > 1500) {
                lastOverlayKick = ts; try { console.log('[receiver] SSE overlayKick accepted', ts); } catch(_) {}
                onAction && onAction('overlayStart');
              } else {
                try { console.log('[receiver] SSE overlayKick ignored', { ts, lastOverlayKick, bootDelta: Math.round(nowT - bootAt) }); } catch(_) {}
              }
            }
          }
        } catch(_) {}
      });
      es.addEventListener('overlayStart', () => { try { console.log('[receiver] SSE overlayStart (event)'); } catch(_) {}; onAction && onAction('overlayStart'); });
      es.onerror = () => { /* auto retry; keep polling too */ };
    }
    function stopSSE() { if (es) { try { es.close(); } catch(_) {}; es = null; } }

    // Config polling with backoff; disabled while WS is open
    let configDelay = 2000;
    function scheduleConfigPoll() {
      if (configPollTimer) return;
      configPollTimer = setTimeout(async () => {
        configPollTimer = null;
        if (wsOpen) { configDelay = 2000; return; }
        const httpBase = toHttpBase(SERVER);
        const url = `${httpBase}/config?channel=${encodeURIComponent(CHANNEL)}`;
        try {
          const r = await fetch(url, { cache: 'no-store' });
          if (r.ok) { const j = await r.json(); if (j && typeof j === 'object') onConfig && onConfig(j); configDelay = 2000; }
          else { configDelay = Math.min(15000, Math.round(configDelay * 1.7)); }
        } catch(_) { configDelay = Math.min(15000, Math.round(configDelay * 1.7)); }
        scheduleConfigPoll();
      }, configDelay);
    }
    function startConfigPolling() { if (!wsOpen) scheduleConfigPoll(); }
    function stopConfigPolling() { if (configPollTimer) { clearTimeout(configPollTimer); configPollTimer = null; } configDelay = 2000; }

    function connect() {
      const url = `${toWsBase(SERVER)}/ws?channel=${encodeURIComponent(CHANNEL)}&role=receiver`;
      try { ws = new WebSocket(url); } catch (e) { setStatus && setStatus('接続エラー (WS)'); startHttpPolling(); return; }
      ws.binaryType = 'arraybuffer';
      setStatus && setStatus('接続中…');

      ws.onopen = () => { wsOpen = true; try { console.log('[receiver] WS open'); } catch(_) {}; setStatus && setStatus('受信待機'); stopHttpPolling(); stopSSE(); stopConfigPolling(); };
      ws.onclose = () => {
        wsOpen = false;
        setStatus && setStatus('切断、再接続待ち…');
        if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 1000);
        startHttpPolling(); startConfigPolling(); startSSE();
      };
      ws.onerror = () => { wsOpen = false; setStatus && setStatus('通信エラー'); startHttpPolling(); startSSE(); startConfigPolling(); };
      ws.onmessage = (ev) => {
        let msg = null; try { msg = typeof ev.data === 'string' ? JSON.parse(ev.data) : null; } catch(_) {}
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'hello') { setInfo && setInfo('接続済み'); return; }
        if (msg.type === 'frame' && typeof msg.data === 'string') { onFrame && onFrame(msg.data); return; }
        if (msg.type === 'clear') { onClear && onClear(); return; }
        if (msg.type === 'sendAnimation') { try { console.log('[receiver] WS sendAnimation (message)'); } catch(_) {}; onAction && onAction('sendAnimation'); return; }
        if (msg.type === 'clearMine') { onClear && onClear(msg.authorId); return; }
        if (msg.type === 'config' && msg.data) { try { console.log('[receiver] WS config'); } catch(_) {}; onConfig && onConfig(msg.data); if (Object.prototype.hasOwnProperty.call(msg.data, 'overlayKick')) { const ts=Number(msg.data.overlayKick)||0; const nowT=(typeof performance!=='undefined'?performance.now():Date.now()); if (ts>lastOverlayKick && nowT-bootAt>1500){ lastOverlayKick=ts; try{ console.log('[receiver] WS overlayKick accepted', ts);}catch(_){} onAction && onAction('overlayStart'); } else { try{ console.log('[receiver] WS overlayKick ignored',{ts,lastOverlayKick,bootDelta:Math.round(nowT-bootAt)});}catch(_){} } } return; }
        if (msg.type === 'stroke') { onStroke && onStroke(msg); return; }
        if (msg.type === 'overlayStart') { try { console.log('[receiver] WS overlayStart (message)'); } catch(_) {}; onAction && onAction('overlayStart'); return; }
      };
    }

    return {
      start() { connect(); },
      stop() { try { ws && ws.close(); } catch(_) {}; stopHttpPolling(); stopSSE(); stopConfigPolling(); if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } },
      update({ server, channel }) { SERVER = (server || SERVER).trim(); CHANNEL = (channel || CHANNEL).trim(); },
      util: { toHttpBase, toWsBase }
    };
  }

  window.ReceiverNet = { create };
})();
