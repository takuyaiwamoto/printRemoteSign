(() => {
  const SENDER_VERSION = '0.6.1';
  try { const v = document.getElementById('sender-version'); if (v) v.textContent = `v${SENDER_VERSION}`; } catch (_) {}
  const RATIO = 210 / 297; // A4 縦: 幅 / 高さ（約 0.707）
  const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));

  const wrap = document.getElementById('canvas-wrap');
  const canvas = document.getElementById('paint');
  const ctx = canvas.getContext('2d');

  const sizeInput = document.getElementById('size');
  const colorInput = document.getElementById('color');
  const clearBtn = document.getElementById('clear');
  const saveBtn = document.getElementById('save');

  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;
  let points = [];
  const DIST_THRESH_SQ = Math.pow(0.75 * DPR, 2); // 近すぎる点は無視（手ぶれ低減）
  let brushSizeCssPx = Number(sizeInput?.value || 4);
  let brushColor = colorInput?.value || '#000000';

  // --- Sync (optional): send frames to a WebSocket relay server ---
  const qs = new URLSearchParams(location.search);
  const SERVER_URL = (qs.get('server') || (window.SERVER_URL || '')).trim();
  const CHANNEL = (qs.get('channel') || (window.CHANNEL || 'default')).trim();
  let ws = null;
  let wsReady = false;
  let lastSent = 0;
  const SEND_INTERVAL_MS = 150; // throttle during drawing (unused if disabled)
  const SEND_FRAMES_DURING_DRAW = false; // 逐次描画は座標で行うため、描画中のフレーム送信は既定で無効化
  let httpFallback = false;
  let currentStrokeId = null;

  function connectWS() {
    if (!SERVER_URL) return;
    const url = `${SERVER_URL.replace(/^http/, 'ws').replace(/\/$/, '')}/ws?channel=${encodeURIComponent(CHANNEL)}&role=sender`;
    try { ws = new WebSocket(url); } catch (_) { httpFallback = !!SERVER_URL; return; }
    ws.onopen = () => { wsReady = true; httpFallback = false; sendFrame(true); };
    ws.onclose = () => { wsReady = false; setTimeout(connectWS, 1000); };
    ws.onerror = () => { wsReady = false; httpFallback = !!SERVER_URL; };
  }
  connectWS();

  function sendFrame(force = false) {
    const dataURL = canvas.toDataURL('image/png');
    if (wsReady) {
      try { ws.send(JSON.stringify({ type: 'frame', data: dataURL })); } catch (_) {}
      return;
    }
    if (httpFallback && SERVER_URL) {
      // HTTP fallback: POST the latest frame
      const httpBase = SERVER_URL.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://');
      const u = `${httpBase.replace(/\/$/, '')}/frame?channel=${encodeURIComponent(CHANNEL)}`;
      fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: dataURL }) }).catch(() => {});
    }
  }
  function maybeSendFrame() {
    const now = Date.now();
    if (now - lastSent >= SEND_INTERVAL_MS) {
      sendFrame();
      lastSent = now;
    }
  }

  // 画面に収まる最大サイズで A4 縦比率を維持してラップ要素とキャンバスをリサイズ
  function fitToViewport(preserve = false) {
    const pad = 24; // 余白
    const toolbarH = (document.querySelector('.toolbar')?.offsetHeight || 60) + pad;
    const maxW = Math.max(300, window.innerWidth - pad * 2);
    const maxH = Math.max(300, window.innerHeight - toolbarH - pad);

    // ビューポートに収まる幅・高さを算出
    let width, height;
    if (maxW / maxH >= RATIO) {
      height = maxH;
      width = Math.round(height * RATIO);
    } else {
      width = maxW;
      height = Math.round(width / RATIO);
    }

    wrap.style.width = width + 'px';
    wrap.style.height = height + 'px';

    // キャンバスの表示サイズ（CSSピクセル）
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    // 既存描画を保持する場合はオフスクリーンに退避してから再設定
    let prev = null;
    if (preserve && canvas.width && canvas.height) {
      prev = document.createElement('canvas');
      prev.width = canvas.width;
      prev.height = canvas.height;
      prev.getContext('2d').drawImage(canvas, 0, 0);
    }

    // 実際の描画解像度は DPR を掛ける
    const pixelW = Math.floor(width * DPR);
    const pixelH = Math.floor(height * DPR);
    canvas.width = pixelW;
    canvas.height = pixelH;

    // 描画設定（線端丸めなど）
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSizeCssPx * DPR;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (prev) {
      // 前の内容を新しいサイズへスケール描画
      ctx.drawImage(prev, 0, 0, prev.width, prev.height, 0, 0, canvas.width, canvas.height);
    } else {
      // 初期の用紙風背景（薄いグリッド/余白などは不要なら削除）
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // サイズ変更時も現在の状態を送信
    sendFrame(true);
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const xCss = (e.clientX ?? (e.touches?.[0]?.clientX || 0)) - rect.left;
    const yCss = (e.clientY ?? (e.touches?.[0]?.clientY || 0)) - rect.top;
    const x = xCss * DPR;
    const y = yCss * DPR;
    return { x, y };
  }

  function startDraw(e) {
    e.preventDefault();
    isDrawing = true;
    const { x, y } = getPos(e);
    lastX = x; lastY = y;
    points = [{ x, y }];
    // Realtime stroke start (WebSocket only)
    if (wsReady || (httpFallback && SERVER_URL)) {
      const nx = x / canvas.width, ny = y / canvas.height;
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      currentStrokeId = id;
      if (wsReady) {
        try { ws.send(JSON.stringify({ type: 'stroke', phase: 'start', id, nx, ny, color: brushColor, size: brushSizeCssPx })); } catch (_) {}
      } else {
        postStroke({ type: 'stroke', phase: 'start', id, nx, ny, color: brushColor, size: brushSizeCssPx });
      }
    }
  }

  function draw(e) {
    if (!isDrawing) return;
    const { x, y } = getPos(e);
    const lx = lastX, ly = lastY;
    const dx = x - lx, dy = y - ly;
    if (dx * dx + dy * dy < DIST_THRESH_SQ) return; // 変化が小さすぎるときは無視

    points.push({ x, y });

    const n = points.length;
    if (n === 2) {
      // 開始直後は直線でつなぐ
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.stroke();
    } else if (n >= 3) {
      // 中点ベジェ法: m1=(p0,p1の中点), m2=(p1,p2の中点) を p1 を制御点とする二次曲線で結ぶ
      const p0 = points[n - 3];
      const p1 = points[n - 2];
      const p2 = points[n - 1];
      const m1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const m2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      ctx.beginPath();
      ctx.moveTo(m1.x, m1.y);
      ctx.quadraticCurveTo(p1.x, p1.y, m2.x, m2.y);
      ctx.stroke();
    }

    lastX = x;
    lastY = y;
    // 描画中のフレーム送信は既定で無効（座標ストリームを優先）
    if (SEND_FRAMES_DURING_DRAW) maybeSendFrame();

    // Realtime stroke point
    if ((wsReady || (httpFallback && SERVER_URL)) && currentStrokeId) {
      const nx = x / canvas.width, ny = y / canvas.height;
      if (wsReady) {
        try { ws.send(JSON.stringify({ type: 'stroke', phase: 'point', id: currentStrokeId, nx, ny })); } catch (_) {}
      } else {
        queuePoint({ type: 'stroke', phase: 'point', id: currentStrokeId, nx, ny });
      }
    }
  }

  function endDraw() {
    if (!isDrawing) return;
    isDrawing = false;

    // 末端の処理（タップや短い線への対応）
    const n = points.length;
    if (n === 1) {
      // 点を描く（塗りつぶしの円）
      ctx.beginPath();
      ctx.fillStyle = brushColor;
      ctx.arc(points[0].x, points[0].y, (brushSizeCssPx * DPR) / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (n >= 3) {
      // 最後の中点から最終点までを結ぶ
      const p0 = points[n - 3];
      const p1 = points[n - 2];
      const p2 = points[n - 1];
      const mPrev = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      ctx.beginPath();
      ctx.moveTo(mPrev.x, mPrev.y);
      ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
      ctx.stroke();
    }
    points = [];

    // 最終フレーム送信
    sendFrame(true);

    // Realtime stroke end
    if ((wsReady || (httpFallback && SERVER_URL)) && currentStrokeId) {
      if (wsReady) {
        try { ws.send(JSON.stringify({ type: 'stroke', phase: 'end', id: currentStrokeId })); } catch (_) {}
      } else {
        postStrokeBatchFlush();
        postStroke({ type: 'stroke', phase: 'end', id: currentStrokeId });
      }
      currentStrokeId = null;
    }
  }

  // 入力ハンドラ登録（Pointer / Mouse / Touch いずれでも動作）
  const supportsPointer = 'onpointerdown' in window;
  if (supportsPointer) {
    canvas.addEventListener('pointerdown', startDraw);
    canvas.addEventListener('pointermove', draw);
    window.addEventListener('pointerup', endDraw);
    canvas.addEventListener('pointerleave', endDraw);
  } else {
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseleave', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    window.addEventListener('touchend', endDraw);
  }

  // UI: 線の太さ・色
  sizeInput?.addEventListener('input', (e) => {
    brushSizeCssPx = Number(e.target.value);
    ctx.lineWidth = brushSizeCssPx * DPR;
  });
  colorInput?.addEventListener('input', (e) => {
    brushColor = e.target.value;
    ctx.strokeStyle = brushColor;
  });

  // 全消去（白で塗りつぶし）
  clearBtn?.addEventListener('click', () => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    sendFrame(true);
    if (wsReady) {
      try { ws.send(JSON.stringify({ type: 'clear' })); } catch (_) {}
    } else if (httpFallback && SERVER_URL) {
      const httpBase = SERVER_URL.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://');
      fetch(`${httpBase.replace(/\/$/, '')}/clear?channel=${encodeURIComponent(CHANNEL)}`, { method: 'POST' }).catch(() => {});
    }
  });

  // ---- HTTP stroke batching helpers ----
  let postQueue = [];
  let postTimer = null;
  function postStroke(ev) {
    const httpBase = SERVER_URL.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://');
    fetch(`${httpBase.replace(/\/$/, '')}/stroke?channel=${encodeURIComponent(CHANNEL)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev), keepalive: true
    }).catch(() => {});
  }
  function queuePoint(ev) {
    postQueue.push(ev);
    if (!postTimer) postTimer = setTimeout(postStrokeBatchFlush, 40); // ~25fps network cadence
  }
  function postStrokeBatchFlush() {
    if (!postQueue.length) { if (postTimer) { clearTimeout(postTimer); postTimer = null; } return; }
    const batch = postQueue;
    postQueue = [];
    const httpBase = SERVER_URL.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://');
    fetch(`${httpBase.replace(/\/$/, '')}/stroke?channel=${encodeURIComponent(CHANNEL)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch }), keepalive: true
    }).catch(() => {});
    if (postTimer) { clearTimeout(postTimer); postTimer = null; }
  }

  // 保存（PNG ダウンロード）
  saveBtn?.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'drawing-a4.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });

  // 初期化 & リサイズ（内容保持）
  fitToViewport(false);
  window.addEventListener('resize', () => fitToViewport(true));
})();
