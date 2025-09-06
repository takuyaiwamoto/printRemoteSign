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
        drawDataURL(msg.data);
      }
    };
  }

  function startHttpPolling() {
    if (httpPollTimer) return;
    const u = `${SERVER.replace(/\/$/, '')}/last?channel=${encodeURIComponent(CHANNEL)}`;
    const tick = async () => {
      try {
        const r = await fetch(u, { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          if (j && j.type === 'frame' && typeof j.data === 'string' && j.data) {
            drawDataURL(j.data);
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

  function drawDataURL(dataURL) {
    const img = new Image();
    img.onload = () => {
      // Clear and draw scaled to fit
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    };
    img.src = dataURL;
  }

  connect();
})();
