(() => {
  const SENDER_VERSION = '0.7.3';
  try { const v = document.getElementById('sender-version'); if (v) v.textContent = `v${SENDER_VERSION}`; } catch (_) {}
  const RATIO = 210 / 297; // A4 縦: 幅 / 高さ（約 0.707）
  const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  const SDEBUG = String((new URLSearchParams(location.search)).get('sdebug') || window.DEBUG_SENDER || '') === '1';
  const slog = (...a) => { if (SDEBUG) console.log('[sender]', ...a); };

  const wrap = document.getElementById('canvas-wrap');
  const canvas = document.getElementById('paint');
  const ctx = canvas.getContext('2d');

  const sizeInput = document.getElementById('size');
  const colorInput = document.getElementById('color');
  const clearBtn = document.getElementById('clear');
  const saveBtn = document.getElementById('save');
  const clearAllBtn = document.getElementById('btn-clear-all');
  const eraserBtn = document.getElementById('btn-eraser');
  const sizeBtns = Array.from(document.querySelectorAll('.size-btn'));
  const colorBtns = Array.from(document.querySelectorAll('.color-btn'));
  const clearSideBtn = document.getElementById('btn-clear');

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
  let realtimeEverUsed = false; // 一度でも座標ストリームを使ったらフレーム送信を抑制
  const AUTHOR_ID = Math.random().toString(36).slice(2, 10);
  try { const b = document.getElementById('author-badge'); if (b) b.textContent = `ID:${AUTHOR_ID}`; } catch(_) {}
  let eraserActive = false;

  // 他者描画レイヤとスムージング
  const otherLayers = new Map(); // authorId -> {canvas, ctx}
  const otherStrokes = new Map(); // strokeId -> state
  const OTHER_BUFFER_MS = 200;

  function getOtherLayer(author) {
    if (!otherLayers.has(author)) {
      const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
      const k = c.getContext('2d'); k.imageSmoothingEnabled = true; k.imageSmoothingQuality = 'high';
      otherLayers.set(author, { canvas: c, ctx: k });
    }
    return otherLayers.get(author);
  }
  function resizeOtherLayers() {
    for (const { canvas: c } of otherLayers.values()) {
      const off = document.createElement('canvas'); off.width = canvas.width; off.height = canvas.height;
      off.getContext('2d').drawImage(c, 0, 0, c.width, c.height, 0, 0, off.width, off.height);
      c.width = off.width; c.height = off.height;
      c.getContext('2d').drawImage(off, 0, 0);
    }
  }
  function composeOthers() {
    ctx.save(); ctx.setTransform(1,0,0,1,0,0);
    for (const { canvas: c } of otherLayers.values()) ctx.drawImage(c, 0, 0);
    ctx.restore();
  }
  function processOtherStrokes() {
    const now = performance.now();
    const target = now - OTHER_BUFFER_MS;
    let changed = false;
    for (const [id, s] of otherStrokes) {
      const ready = (()=>{ for (let i=s.points.length-1;i>=2;i--) if (s.points[i].time<=target) return i; return 0; })();
      if (s.curIndex === undefined) {
        if (ready>=2) { s.curIndex=2; s.t=0; const p0=s.points[0], p1=s.points[1]; s.lastPt={x:(p0.x+p1.x)/2, y:(p0.y+p1.y)/2}; }
        else continue;
      }
      const layer = getOtherLayer(s.author).ctx;
      layer.globalCompositeOperation = (s.tool === 'eraser') ? 'destination-out' : 'source-over';
      layer.lineJoin='round'; layer.lineCap='round'; layer.strokeStyle=s.color; layer.lineWidth=s.sizeDev || (s.sizeCss*DPR);
      let drew=false; layer.beginPath(); layer.moveTo(s.lastPt.x, s.lastPt.y);
      const q=(m1,p1,m2,t)=>{const a=1-t; return {x:a*a*m1.x+2*a*t*p1.x+t*t*m2.x,y:a*a*m1.y+2*a*t*p1.y+t*t*m2.y}};
      while (s.curIndex<=ready) {
        const i=s.curIndex; const p0=s.points[i-2], p1=s.points[i-1], p2=s.points[i];
        const m1={x:(p0.x+p1.x)/2,y:(p0.y+p1.y)/2}, m2={x:(p1.x+p2.x)/2,y:(p1.y+p2.y)/2};
        const segLen=Math.hypot(m2.x-m1.x,m2.y-m1.y)+1e-3; const stepPx=Math.max(0.8*DPR,0.5*(s.sizeDev||s.sizeCss*DPR));
        const dt=Math.min(0.35, Math.max(0.02, stepPx/segLen));
        const dur=Math.max(1,(s.points[i].time||0)-(s.points[i-1].time||0)); const timeT=Math.max(0,Math.min(1,(target-(s.points[i-1].time||0))/dur));
        const desired=(i<ready)?1:timeT;
        while(s.t<desired-1e-6){ const nt=Math.min(desired,s.t+dt); const np=q(m1,p1,m2,nt); layer.lineTo(np.x,np.y); s.lastPt=np; s.t=nt; drew=true; if(s.t>=1-1e-6)break; }
        if (s.t>=1-1e-6){ s.curIndex++; s.t=0; s.lastPt={...m2}; } else break;
      }
      if (drew){ layer.stroke(); changed=true; }
      if (s.ended && s.curIndex > s.points.length-1) otherStrokes.delete(id);
    }
    if (changed) composeOthers();
    requestAnimationFrame(processOtherStrokes);
  }
  requestAnimationFrame(processOtherStrokes);

  // --- Transport helpers -------------------------------------------------
  const toHttpBase = (u) => u.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://').replace(/\/$/, '');
  const toWsBase = (u) => u.replace(/^http/, 'ws').replace(/\/$/, '');
  function wsSend(obj) {
    if (!wsReady) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch (_) { return false; }
  }
  function httpPost(path, body) {
    if (!SERVER_URL) return;
    const u = `${toHttpBase(SERVER_URL)}${path}?channel=${encodeURIComponent(CHANNEL)}`;
    fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
  }

  // SSE fallback to receive others' strokes even if WS broadcast doesn't include senders
  let es = null;
  function connectSSE() {
    if (!SERVER_URL || es) return;
    const url = `${toHttpBase(SERVER_URL)}/events?channel=${encodeURIComponent(CHANNEL)}`;
    try { es = new EventSource(url); } catch(_) { return; }
    es.addEventListener('stroke', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.authorId && msg.authorId === AUTHOR_ID) return;
        if (!msg || msg.type !== 'stroke') return;
        if (msg.phase === 'start') {
          const sizeDev = (typeof msg.sizeN === 'number' && isFinite(msg.sizeN)) ? (msg.sizeN * canvas.width) : (Number(msg.size||4) * DPR);
          const p = { x: msg.nx*canvas.width, y: msg.ny*canvas.height, time: performance.now() };
          otherStrokes.set(msg.id, { author:String(msg.authorId||'anon'), color: msg.color||'#000', sizeCss:Number(msg.size||4), sizeDev, points:[p], drawnUntil:0, ended:false });
          const lay = getOtherLayer(String(msg.authorId||'anon')).ctx; lay.beginPath(); lay.fillStyle = msg.color||'#000'; lay.arc(p.x,p.y,sizeDev/2,0,Math.PI*2); lay.fill(); composeOthers();
          if (SDEBUG) slog('sse other start', { id: msg.id, author: msg.authorId });
        } else if (msg.phase === 'point') {
          const s = otherStrokes.get(msg.id); if (!s) return; const p = { x: msg.nx*canvas.width, y: msg.ny*canvas.height, time: performance.now() }; s.points.push(p);
        } else if (msg.phase === 'end') { const s = otherStrokes.get(msg.id); if (!s) return; s.ended = true; if (SDEBUG) slog('sse other end', { id: msg.id }); }
      } catch(_) {}
    });
    es.addEventListener('clear', () => {
      ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.restore();
      for (const {canvas:c,ctx:k} of otherLayers.values()) k.clearRect(0,0,c.width,c.height);
      if (SDEBUG) slog('sse clear all');
    });
  }

  function connectWS() {
    if (!SERVER_URL) return;
    const url = `${toWsBase(SERVER_URL)}/ws?channel=${encodeURIComponent(CHANNEL)}&role=sender`;
    slog('ws connecting', { url });
    try { ws = new WebSocket(url); } catch (e) { httpFallback = !!SERVER_URL; slog('ws construct error', e?.message||e); return; }
    ws.onopen = () => { wsReady = true; httpFallback = false; slog('ws open'); /* 首描画のためのフレーム送信は不要 */ };
    ws.onclose = () => { wsReady = false; slog('ws close'); setTimeout(connectWS, 1000); };
    ws.onerror = () => { wsReady = false; httpFallback = !!SERVER_URL; slog('ws error'); };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : 'null');
        if (msg && msg.type) slog('ws message', msg.type);
        if (msg && msg.type === 'config' && msg.data && msg.data.bgSender) {
          if (typeof msg.data.bgSender === 'string') {
            ctx.save(); ctx.setTransform(1,0,0,1,0,0);
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.restore();
          } else if (msg.data.bgSender.mode === 'image' && msg.data.bgSender.url) {
            const img = new Image();
            img.onload = () => { ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.drawImage(img,0,0,img.naturalWidth,img.naturalHeight,0,0,canvas.width,canvas.height); ctx.restore(); };
            img.src = msg.data.bgSender.url;
          }
        }
        if (msg && msg.type === 'stroke') {
          // 旧クライアントから authorId が無い場合も“他人”として扱う
          if (msg.authorId && msg.authorId === AUTHOR_ID) return;
          if (msg.phase === 'start') {
            const sizeDev = (typeof msg.sizeN === 'number' && isFinite(msg.sizeN)) ? (msg.sizeN * canvas.width) : (Number(msg.size||4) * DPR);
            const p = { x: msg.nx*canvas.width, y: msg.ny*canvas.height, time: performance.now() };
            otherStrokes.set(msg.id, { author:String(msg.authorId||'anon'), color: msg.color||'#000', sizeCss:Number(msg.size||4), sizeDev, points:[p], drawnUntil:0, ended:false });
            const lay = getOtherLayer(String(msg.authorId||'anon')).ctx; lay.beginPath(); lay.fillStyle = msg.color||'#000'; lay.arc(p.x,p.y,sizeDev/2,0,Math.PI*2); lay.fill(); composeOthers();
            slog('other start', { id: msg.id, author: msg.authorId });
          } else if (msg.phase === 'point') {
            const s = otherStrokes.get(msg.id); if (!s) return; const p = { x: msg.nx*canvas.width, y: msg.ny*canvas.height, time: performance.now() }; s.points.push(p);
          } else if (msg.phase === 'end') { const s = otherStrokes.get(msg.id); if (!s) return; s.ended = true; }
        }
        if (msg && msg.type === 'clear') {
          ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.restore();
          for (const {canvas:c,ctx:k} of otherLayers.values()) k.clearRect(0,0,c.width,c.height);
          slog('clear all received');
        }
        if (msg && msg.type === 'clearMine') {
          const lay = otherLayers.get(String(msg.authorId)); if (lay) { lay.ctx.clearRect(0,0,lay.canvas.width, lay.canvas.height); composeOthers(); }
          if (msg.authorId === AUTHOR_ID) { ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.restore(); }
          slog('clear mine received', msg.authorId);
        }
      } catch(_) {}
    };
  }
  connectWS();
  connectSSE();

  function sendFrame(force = false) {
    const dataURL = canvas.toDataURL('image/png');
    if (wsSend({ type: 'frame', data: dataURL })) return;
    if (httpFallback) httpPost('/frame', { data: dataURL });
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
    // リアルタイム座標を使う場合はフレーム送信しない
    if (!realtimeEverUsed) sendFrame(true);
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
      const cssW = canvas.width / DPR;
      const sizeN = brushSizeCssPx / cssW; // キャンバス幅に対する相対太さ
      if (wsReady) {
        try { ws.send(JSON.stringify({ type: 'stroke', phase: 'start', id, nx, ny, color: brushColor, size: brushSizeCssPx, sizeN, authorId: AUTHOR_ID, tool: (eraserActive?'eraser':'pen') })); } catch (_) {}
        slog('send start', { id, author: AUTHOR_ID, nx, ny, size: brushSizeCssPx, sizeN });
      } else {
        postStroke({ type: 'stroke', phase: 'start', id, nx, ny, color: brushColor, size: brushSizeCssPx, sizeN, authorId: AUTHOR_ID, tool:(eraserActive?'eraser':'pen') });
        slog('queue start(HTTP)', { id, author: AUTHOR_ID });
      }
      realtimeEverUsed = true;
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
    // set composite mode for eraser
    if (eraserActive) ctx.globalCompositeOperation = 'destination-out';
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
    if (eraserActive) { composeOthers(); }

    // Realtime stroke point
    if ((wsReady || (httpFallback && SERVER_URL)) && currentStrokeId) {
      const nx = x / canvas.width, ny = y / canvas.height;
      if (wsReady) {
        try { ws.send(JSON.stringify({ type: 'stroke', phase: 'point', id: currentStrokeId, nx, ny, authorId: AUTHOR_ID, tool:(eraserActive?'eraser':'pen') })); } catch (_) {}
        if (SDEBUG && (points.length % 10 === 0)) slog('send point', { id: currentStrokeId, nx, ny });
      } else {
        queuePoint({ type: 'stroke', phase: 'point', id: currentStrokeId, nx, ny, authorId: AUTHOR_ID, tool:(eraserActive?'eraser':'pen') });
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

    // reset composite after erasing
    if (eraserActive) ctx.globalCompositeOperation = 'source-over';
    // リアルタイム座標が使えている場合はフレーム送信しない（太さやエッジの差異を避ける）
    if (!realtimeEverUsed) sendFrame(true);

    // Realtime stroke end
    if ((wsReady || (httpFallback && SERVER_URL)) && currentStrokeId) {
      if (wsReady) {
        try { ws.send(JSON.stringify({ type: 'stroke', phase: 'end', id: currentStrokeId, authorId: AUTHOR_ID, tool:(eraserActive?'eraser':'pen') })); } catch (_) {}
        slog('send end', { id: currentStrokeId });
      } else {
        postStrokeBatchFlush();
        postStroke({ type: 'stroke', phase: 'end', id: currentStrokeId, authorId: AUTHOR_ID, tool:(eraserActive?'eraser':'pen') });
        slog('queue end(HTTP)', { id: currentStrokeId });
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

  // 右サイド: 太さ・色のボタン
  const SIZE_PRESETS = { thin: brushSizeCssPx, normal: Math.max(brushSizeCssPx * 2, 8), thick: Math.max(brushSizeCssPx * 3.5, 14) };
  function setActive(list, el) {
    list.forEach(b => { b.classList.toggle('active', b === el); b.setAttribute('aria-pressed', b === el ? 'true' : 'false'); });
  }
  sizeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-size');
      const val = Math.floor(SIZE_PRESETS[key] || brushSizeCssPx);
      brushSizeCssPx = val;
      ctx.lineWidth = brushSizeCssPx * DPR;
      if (sizeInput) sizeInput.value = String(brushSizeCssPx);
      setActive(sizeBtns, btn);
    });
  });
  colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const col = btn.getAttribute('data-color');
      if (!col) return;
      brushColor = col;
      ctx.strokeStyle = brushColor;
      if (colorInput) colorInput.value = brushColor;
      setActive(colorBtns, btn);
    });
  });

  // 全消去（白で塗りつぶし）
  clearBtn?.addEventListener('click', () => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    if (!realtimeEverUsed) sendFrame(true);
    if (wsReady) {
      try { ws.send(JSON.stringify({ type: 'clear' })); } catch (_) {}
    } else if (httpFallback && SERVER_URL) {
      const httpBase = SERVER_URL.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://');
      fetch(`${httpBase.replace(/\/$/, '')}/clear?channel=${encodeURIComponent(CHANNEL)}`, { method: 'POST' }).catch(() => {});
    }
  });
  clearAllBtn?.addEventListener('click', () => clearBtn?.click() ?? (function(){
    // 直接実行（ヘッダが無い場合）
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    if (!realtimeEverUsed) sendFrame(true);
    if (wsReady) {
      try { ws.send(JSON.stringify({ type: 'clear' })); } catch (_) {}
    } else if (httpFallback && SERVER_URL) {
      const httpBase = SERVER_URL.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://');
      fetch(`${httpBase.replace(/\/$/, '')}/clear?channel=${encodeURIComponent(CHANNEL)}`, { method: 'POST' }).catch(() => {});
    }
  })());

  eraserBtn?.addEventListener('click', () => {
    eraserActive = !eraserActive;
    eraserBtn.classList.toggle('is-active', eraserActive);
  });

  // ---- HTTP stroke batching helpers ----
  let postQueue = [];
  let postTimer = null;
  function postStroke(ev) {
    httpPost('/stroke', ev);
  }
  function queuePoint(ev) {
    postQueue.push(ev);
    if (!postTimer) postTimer = setTimeout(postStrokeBatchFlush, 40); // ~25fps network cadence
  }
  function postStrokeBatchFlush() {
    if (!postQueue.length) { if (postTimer) { clearTimeout(postTimer); postTimer = null; } return; }
    const batch = postQueue;
    postQueue = [];
    httpPost('/stroke', { batch });
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
  window.addEventListener('resize', () => { fitToViewport(true); resizeOtherLayers(); composeOthers(); });
})();
