(() => {
  const RECEIVER_VERSION = '0.6.4';
  const params = new URLSearchParams(location.search);
  const SERVER = params.get('server') || 'ws://localhost:8787';
  const CHANNEL = params.get('channel') || 'default';

  const statusEl = document.getElementById('status');
  const infoEl = document.getElementById('info');
  const serverLabel = document.getElementById('serverLabel');
  const channelLabel = document.getElementById('channelLabel');

  serverLabel.textContent = SERVER;
  channelLabel.textContent = CHANNEL;
  try { const v = document.getElementById('receiver-version'); if (v) v.textContent = `v${RECEIVER_VERSION}`; } catch (_) {}

  const baseCanvas = document.getElementById('base');
  const inkCanvas = document.getElementById('ink');
  const base = baseCanvas?.getContext('2d');
  const ink = inkCanvas?.getContext('2d');
  const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  const RATIO = 210 / 297; // A4 portrait ratio

  function fitCanvas() {
    if (!baseCanvas || !inkCanvas) return;
    const box = baseCanvas.parentElement.getBoundingClientRect();
    let width = box.width;
    let height = Math.round(width / RATIO);
    if (height > box.height) {
      height = box.height;
      width = Math.round(height * RATIO);
    }
    for (const c of [baseCanvas, inkCanvas]) {
      c.style.width = width + 'px';
      c.style.height = height + 'px';
      c.width = Math.floor(width * DPR);
      c.height = Math.floor(height * DPR);
    }
    if (base) { base.imageSmoothingEnabled = true; base.imageSmoothingQuality = 'high'; }
    if (ink) { ink.imageSmoothingEnabled = true; ink.imageSmoothingQuality = 'high'; }
  }

  window.addEventListener('resize', fitCanvas);
  fitCanvas();

  let ws;
  let reconnectTimer = null;
  let lastInfo = '';
  let httpPollTimer = null;
  let es = null; // EventSource fallback
  const toHttpBase = (u) => u.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://').replace(/\/$/, '');
  const toWsBase = (u) => u.replace(/^http/, 'ws').replace(/\/$/, '');

  // Smoother rendering pipeline: coalesce frames, decode off-thread, draw on RAF
  let latestDataURL = null;
  let decoding = false;
  let currentBitmap = null; // ImageBitmap or HTMLImageElement
  let frameVersion = 0;
  let lastDrawnVersion = -1;
  let rafRunning = false;
  let ignoreFrames = false; // ストロークが来始めたらPNGフレームを無視（太さ差異/ぼけ回避）
  let bgMode = 'white';
  let bgImage = null; // ImageBitmap or HTMLImageElement
  const canvasBox = document.getElementById('canvasBox');

  // Realtime stroke rendering state
  const strokes = new Map(); // id -> { color, sizeCss, points: [{x,y,time}], drawnUntil: number, ended: boolean }
  const DIST_THRESH_SQ = Math.pow(0.75 * DPR, 2);
  const STROKE_BUFFER_MS = Math.min(1000, Math.max(0, Number(params.get('buffer') || (window.RECEIVER_BUFFER_MS ?? 200))));

  function setStatus(text) { statusEl.textContent = text; }
  function setInfo(text) {
    if (text !== lastInfo) {
      lastInfo = text; infoEl.textContent = text;
    }
  }

  function connect() {
    const url = `${toWsBase(SERVER)}/ws?channel=${encodeURIComponent(CHANNEL)}&role=receiver`;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      setStatus('接続エラー (WS)');
      startHttpPolling();
      return;
    }
    ws.binaryType = 'arraybuffer';
    setStatus('接続中…');

    ws.onopen = () => { setStatus('受信待機'); stopHttpPolling(); stopSSE(); };
    ws.onclose = () => {
      setStatus('切断、再接続待ち…');
      if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 1000);
      startHttpPolling();
      startSSE();
    };
    ws.onerror = () => { setStatus('通信エラー'); startHttpPolling(); startSSE(); };
    ws.onmessage = async (ev) => {
      let msg;
      try {
        msg = typeof ev.data === 'string' ? JSON.parse(ev.data) : null;
      } catch (_) {
        return; // ignore
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'hello') {
        setInfo('接続済み');
        return;
      }
      if (msg.type === 'frame' && typeof msg.data === 'string') {
        if (!ignoreFrames) ingestFrame(msg.data);
        return;
      }
      if (msg.type === 'clear') {
        clearCanvas();
        strokes.clear();
        return;
      }
      if (msg.type === 'config' && msg.data) { applyConfig(msg.data); return; }
      if (msg.type === 'stroke') {
        handleStroke(msg);
        return;
      }
    };
  }

  function startHttpPolling() {
    if (httpPollTimer) return;
    const httpBase = toHttpBase(SERVER);
    const u = `${httpBase}/last?channel=${encodeURIComponent(CHANNEL)}`;
    const tick = async () => {
      try {
        const r = await fetch(u, { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          if (j && j.type === 'frame' && typeof j.data === 'string' && j.data) {
            ingestFrame(j.data);
          }
        }
      } catch (_) {}
    };
    httpPollTimer = setInterval(tick, 300);
    tick();
  }

  function stopHttpPolling() {
    if (httpPollTimer) { clearInterval(httpPollTimer); httpPollTimer = null; }
  }

  function startSSE() {
    if (es) return;
    const httpBase = toHttpBase(SERVER);
    const url = `${httpBase}/events?channel=${encodeURIComponent(CHANNEL)}`;
    try {
      es = new EventSource(url, { withCredentials: false });
    } catch (_) {
      return;
    }
    setStatus('SSE接続中…');
    es.addEventListener('hello', () => setStatus('受信待機 (SSE)'));
    es.addEventListener('frame', (ev) => {
      try { const j = JSON.parse(ev.data); if (j && j.data) ingestFrame(j.data); } catch (_) {}
    });
    es.addEventListener('stroke', (ev) => {
      try { handleStroke(JSON.parse(ev.data)); } catch (_) {}
    });
    es.addEventListener('clear', () => { clearCanvas(); strokes.clear(); });
    es.addEventListener('config', (ev) => { try { const j = JSON.parse(ev.data); if (j && j.data) applyConfig(j.data); } catch (_) {} });
    es.onerror = () => { /* will auto-retry; keep http polling too */ };
  }

  function stopSSE() {
    if (es) { try { es.close(); } catch (_) {}; es = null; }
  }

  function normToCanvas(nx, ny) {
    return { x: nx * baseCanvas.width, y: ny * baseCanvas.height };
  }

  function clearCanvas() {
    if (!base || !ink) return;
    base.save();
    base.setTransform(1, 0, 0, 1, 0, 0);
    if (bgMode === 'image' && bgImage) {
      const sw = bgImage.width || bgImage.naturalWidth; const sh = bgImage.height || bgImage.naturalHeight;
      base.drawImage(bgImage, 0, 0, sw, sh, 0, 0, baseCanvas.width, baseCanvas.height);
    } else {
      base.fillStyle = '#ffffff';
      base.fillRect(0, 0, baseCanvas.width, baseCanvas.height);
    }
    base.restore();
    ink.save();
    ink.setTransform(1, 0, 0, 1, 0, 0);
    ink.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    ink.restore();
  }

  function applyConfig(data) {
    if (data.bgReceiver) {
      if (typeof data.bgReceiver === 'string') { bgMode = data.bgReceiver; bgImage = null; clearCanvas(); }
      else if (data.bgReceiver.mode === 'image' && data.bgReceiver.url) {
        const inUrl = data.bgReceiver.url;
        const candidates = [];
        if (/^https?:/i.test(inUrl)) {
          candidates.push(inUrl);
        } else {
          try { candidates.push(new URL(inUrl, location.href).href); } catch(_) {}
          try { candidates.push(new URL('../' + inUrl, location.href).href); } catch(_) {}
        }
        (async () => {
          for (const url of candidates) {
            try {
              if (typeof createImageBitmap === 'function') {
                const bmp = await createImageBitmap(await (await fetch(url)).blob());
                bgImage = bmp; bgMode = 'image'; clearCanvas(); return;
              } else {
                await new Promise((res, rej) => { const img = new Image(); img.onload = () => { bgImage = img; bgMode = 'image'; clearCanvas(); res(); }; img.onerror = rej; img.src = url; });
                return;
              }
            } catch(_) { /* try next */ }
          }
          bgMode = 'white'; bgImage = null; clearCanvas();
        })();
      }
    }
    if (typeof data.scaleReceiver === 'number') {
      const v = Math.max(1, Math.min(100, Math.round(Number(data.scaleReceiver) || 100)));
      const factor = v / 100;
      if (canvasBox) canvasBox.style.transform = `scale(${factor})`;
    }
  }

  function handleStroke(msg) {
    const phase = msg.phase;
    if (!phase) return;
    if (phase === 'start') {
      ignoreFrames = true; // 以降はPNGフレームを無視
      const id = String(msg.id || Date.now());
      const pxy = normToCanvas(msg.nx, msg.ny);
      const now = performance.now();
      const p = { x: pxy.x, y: pxy.y, time: now };
      const s = { color: msg.color || '#000', sizeCss: Number(msg.size || 4), points: [p], drawnUntil: 0, ended: false };
      strokes.set(id, s);
      // 即時に開始点を指定太さで可視化（細く見える問題を避ける）
      if (ink) {
        ink.beginPath();
        ink.fillStyle = s.color;
        ink.arc(p.x, p.y, (s.sizeCss * DPR) / 2, 0, Math.PI * 2);
        ink.fill();
      }
      return;
    }
    const id = String(msg.id || '');
    const s = strokes.get(id);
    if (!s) return;
    if (phase === 'point') {
      const pxy = normToCanvas(msg.nx, msg.ny);
      const now = performance.now();
      const p = { x: pxy.x, y: pxy.y, time: now };
      const last = s.points[s.points.length - 1];
      const dx = p.x - last.x, dy = p.y - last.y;
      if (dx * dx + dy * dy < DIST_THRESH_SQ) return;
      s.points.push(p);
      return;
    }
    if (phase === 'end') {
      s.ended = true;
      return;
    }
  }

  function processStrokes() {
    const now = performance.now();
    const target = now - STROKE_BUFFER_MS;

    for (const [id, s] of strokes) {
      // We start rendering once we have at least 3 points and the third point is within target
      const readySegment = (() => {
        for (let i = s.points.length - 1; i >= 2; i--) {
          if (s.points[i].time <= target) return i; // segment defined by (i-2,i-1,i)
        }
        return 0;
      })();

      // Initialize per-stroke cursor
      if (s.curIndex === undefined) {
        if (readySegment >= 2) {
          s.curIndex = 2; // working on segment using points[0],points[1],points[2]
          s.t = 0;
          const p0 = s.points[0], p1 = s.points[1];
          s.lastPt = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }; // m1
        } else if (s.ended && s.points.length === 1) {
          const p = s.points[0];
          ink.beginPath();
          ink.fillStyle = s.color;
          ink.arc(p.x, p.y, (s.sizeCss * DPR) / 2, 0, Math.PI * 2);
          ink.fill();
          strokes.delete(id);
          continue;
        } else {
          continue; // wait for enough buffered points
        }
      }

      ink.lineJoin = 'round';
      ink.lineCap = 'round';
      ink.strokeStyle = s.color;
      ink.lineWidth = s.sizeCss * DPR;

      let drew = false;
      ink.beginPath();
      ink.moveTo(s.lastPt.x, s.lastPt.y);

      // Helper to sample quadratic Bezier
      const qPoint = (m1, p1, m2, t) => {
        const a = 1 - t;
        const x = a * a * m1.x + 2 * a * t * p1.x + t * t * m2.x;
        const y = a * a * m1.y + 2 * a * t * p1.y + t * t * m2.y;
        return { x, y };
      };

      while (s.curIndex <= readySegment) {
        const i = s.curIndex;
        const p0 = s.points[i - 2];
        const p1 = s.points[i - 1];
        const p2 = s.points[i];
        const m1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        const m2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

        const segLen = Math.hypot(m2.x - m1.x, m2.y - m1.y) + 1e-3;
        const stepPx = Math.max(0.8 * DPR, 0.5 * s.sizeCss * DPR);
        const dt = Math.min(0.35, Math.max(0.02, stepPx / segLen));

        // Desired progress within this segment based on time buffer
        const dur = Math.max(1, (p2.time || 0) - (p1.time || 0));
        const timeT = Math.max(0, Math.min(1, (target - (p1.time || 0)) / dur));
        const desiredT = (i < readySegment) ? 1 : timeT;
        while (s.t < desiredT - 1e-6) {
          const nextT = Math.min(desiredT, s.t + dt);
          const np = qPoint(m1, p1, m2, nextT);
          ink.lineTo(np.x, np.y);
          s.lastPt = np;
          s.t = nextT;
          drew = true;
          // If we reached 1, move to next segment
          if (s.t >= 1 - 1e-6) break;
        }

        if (s.t >= 1 - 1e-6) {
          s.curIndex++;
          s.t = 0;
          s.lastPt = { ...m2 };
        } else {
          break;
        }
      }

      if (drew) ink.stroke();

      // Clean up ended strokes when all segments consumed and last segment finished
      const lastSegment = s.points.length - 1;
      if (s.ended && s.curIndex > lastSegment) {
        strokes.delete(id);
      }
    }
  }

  function ingestFrame(dataURL) {
    latestDataURL = dataURL;
    decodeIfIdle();
    ensureRAF();
  }

  async function decodeIfIdle() {
    if (decoding || !latestDataURL) return;
    decoding = true;
    const toDecode = latestDataURL;
    try {
      let bmp = null;
      if (typeof createImageBitmap === 'function') {
        const blob = await (await fetch(toDecode)).blob();
        bmp = await createImageBitmap(blob);
      } else {
        // Fallback for older environments
        bmp = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = toDecode;
        });
      }
      currentBitmap = bmp;
      frameVersion++;
    } catch (_) {
      // ignore decode errors
    } finally {
      decoding = false;
      // If a new frame arrived while decoding, decode again to catch up
      if (latestDataURL !== toDecode) decodeIfIdle();
    }
  }

  function ensureRAF() {
    if (rafRunning) return;
    rafRunning = true;
    const loop = () => {
      if (frameVersion !== lastDrawnVersion && currentBitmap) {
        // Draw background then latest bitmap to base layer
        base.save();
        base.setTransform(1, 0, 0, 1, 0, 0);
        if (bgMode === 'image' && bgImage) {
          const sw = bgImage.width || bgImage.naturalWidth; const sh = bgImage.height || bgImage.naturalHeight;
          base.drawImage(bgImage, 0, 0, sw, sh, 0, 0, baseCanvas.width, baseCanvas.height);
        } else { base.fillStyle = '#ffffff'; base.fillRect(0, 0, baseCanvas.width, baseCanvas.height); }
        const srcW = currentBitmap.width || currentBitmap.naturalWidth; const srcH = currentBitmap.height || currentBitmap.naturalHeight;
        base.drawImage(currentBitmap, 0, 0, srcW, srcH, 0, 0, baseCanvas.width, baseCanvas.height);
        base.restore();
        // Clear ink to prevent double-darkening when a fresh frame arrives
        if (ink && inkCanvas) {
          ink.save();
          ink.setTransform(1, 0, 0, 1, 0, 0);
          ink.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
          ink.restore();
        }
        lastDrawnVersion = frameVersion;
      }
      // Always process stroke queues toward target time
      processStrokes();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // Clear once at start and spin RAF even if no frames arrive (for stroke streaming)
  clearCanvas();
  ensureRAF();
  connect();
})();
