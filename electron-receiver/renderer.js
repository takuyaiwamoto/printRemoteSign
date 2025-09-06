(() => {
  const params = new URLSearchParams(location.search);
  const SERVER = params.get('server') || 'ws://localhost:8787';
  const CHANNEL = params.get('channel') || 'default';

  const statusEl = document.getElementById('status');
  const infoEl = document.getElementById('info');
  const serverLabel = document.getElementById('serverLabel');
  const channelLabel = document.getElementById('channelLabel');

  serverLabel.textContent = SERVER;
  channelLabel.textContent = CHANNEL;

  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');
  const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  const RATIO = 210 / 297; // A4 portrait ratio

  function fitCanvas() {
    const box = canvas.parentElement.getBoundingClientRect();
    let width = box.width;
    let height = Math.round(width / RATIO);
    if (height > box.height) {
      height = box.height;
      width = Math.round(height * RATIO);
    }
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    canvas.width = Math.floor(width * DPR);
    canvas.height = Math.floor(height * DPR);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }

  window.addEventListener('resize', fitCanvas);
  fitCanvas();

  let ws;
  let reconnectTimer = null;
  let lastInfo = '';
  let httpPollTimer = null;

  // Smoother rendering pipeline: coalesce frames, decode off-thread, draw on RAF
  let latestDataURL = null;
  let decoding = false;
  let currentBitmap = null; // ImageBitmap or HTMLImageElement
  let frameVersion = 0;
  let lastDrawnVersion = -1;
  let rafRunning = false;

  // Realtime stroke rendering state
  const strokes = new Map(); // id -> { color, sizeCss, points: [{x,y,time}], drawnUntil: number, ended: boolean }
  const DIST_THRESH_SQ = Math.pow(0.75 * DPR, 2);
  const STROKE_BUFFER_MS = Math.min(1000, Math.max(0, Number(params.get('buffer') || (window.RECEIVER_BUFFER_MS ?? 300))));

  function setStatus(text) { statusEl.textContent = text; }
  function setInfo(text) {
    if (text !== lastInfo) {
      lastInfo = text; infoEl.textContent = text;
    }
  }

  function connect() {
    const url = `${SERVER.replace(/^http/, 'ws').replace(/\/$/, '')}/ws?channel=${encodeURIComponent(CHANNEL)}&role=receiver`;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      setStatus('接続エラー (WS)');
      startHttpPolling();
      return;
    }
    ws.binaryType = 'arraybuffer';
    setStatus('接続中…');

    ws.onopen = () => { setStatus('受信待機'); stopHttpPolling(); };
    ws.onclose = () => {
      setStatus('切断、再接続待ち…');
      if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 1000);
      startHttpPolling();
    };
    ws.onerror = () => { setStatus('通信エラー'); startHttpPolling(); };
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
        ingestFrame(msg.data);
        return;
      }
      if (msg.type === 'clear') {
        clearCanvas();
        strokes.clear();
        return;
      }
      if (msg.type === 'stroke') {
        handleStroke(msg);
        return;
      }
    };
  }

  function startHttpPolling() {
    if (httpPollTimer) return;
    const httpBase = SERVER.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://');
    const u = `${httpBase.replace(/\/$/, '')}/last?channel=${encodeURIComponent(CHANNEL)}`;
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

  function normToCanvas(nx, ny) {
    return { x: nx * canvas.width, y: ny * canvas.height };
  }

  function clearCanvas() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function handleStroke(msg) {
    const phase = msg.phase;
    if (!phase) return;
    if (phase === 'start') {
      const id = String(msg.id || Date.now());
      const pxy = normToCanvas(msg.nx, msg.ny);
      const now = performance.now();
      const p = { x: pxy.x, y: pxy.y, time: now };
      const s = { color: msg.color || '#000', sizeCss: Number(msg.size || 4), points: [p], drawnUntil: 0, ended: false };
      strokes.set(id, s);
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
      // Draw any segments whose endpoint time <= target
      while (s.points.length - 1 > s.drawnUntil) {
        const i = s.drawnUntil + 1; // candidate new endpoint index
        const pt = s.points[i];
        if (pt.time > target) break;

        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.sizeCss * DPR;

        if (i === 1) {
          // First segment: simple line p0->p1
          const p0 = s.points[0], p1 = s.points[1];
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        } else {
          // Middle segments: quadratic bezier between midpoints
          const p0 = s.points[i - 2];
          const p1 = s.points[i - 1];
          const p2 = s.points[i];
          const m1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
          const m2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          ctx.beginPath();
          ctx.moveTo(m1.x, m1.y);
          ctx.quadraticCurveTo(p1.x, p1.y, m2.x, m2.y);
          ctx.stroke();
        }
        s.drawnUntil = i;
      }

      // Finalize ended strokes when all points rendered
      if (s.ended && s.drawnUntil >= s.points.length - 1) {
        const n = s.points.length;
        if (n >= 3) {
          const p0 = s.points[n - 3];
          const p1 = s.points[n - 2];
          const p2 = s.points[n - 1];
          const mPrev = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.strokeStyle = s.color;
          ctx.lineWidth = s.sizeCss * DPR;
          ctx.beginPath();
          ctx.moveTo(mPrev.x, mPrev.y);
          ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
          ctx.stroke();
        } else if (n === 1) {
          const p = s.points[0];
          ctx.beginPath();
          ctx.fillStyle = s.color;
          ctx.arc(p.x, p.y, (s.sizeCss * DPR) / 2, 0, Math.PI * 2);
          ctx.fill();
        }
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
        // Draw latest bitmap scaled to canvas
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // Many frames already contain white background, but ensure full cover
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const srcW = currentBitmap.width || currentBitmap.naturalWidth;
        const srcH = currentBitmap.height || currentBitmap.naturalHeight;
        ctx.drawImage(currentBitmap, 0, 0, srcW, srcH, 0, 0, canvas.width, canvas.height);
        ctx.restore();
        lastDrawnVersion = frameVersion;
      }
      // Always process stroke queues toward target time
      processStrokes();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // Clear once at start for stroke rendering background
  clearCanvas();
  connect();
})();
