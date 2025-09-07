(() => {
  const RECEIVER_VERSION = '0.6.26';
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
  const DEBUG = String(new URLSearchParams(location.search).get('debug') || window.DEBUG_RECEIVER || '') === '1';
  const log = (...a) => { if (DEBUG) console.log('[receiver]', ...a); };

  function fitCanvas() { window.CanvasLayout?.fitCanvas?.(baseCanvas, inkCanvas, DPR, RATIO); }

  // (moved) Resize handler and initial fit are set after transform vars are declared

  let lastInfo = '';

  // Smoother rendering pipeline: coalesce frames, decode off-thread, draw on RAF
  let latestDataURL = null;
  let decoding = false;
  let currentBitmap = null; // ImageBitmap or HTMLImageElement
  let frameVersion = 0;
  let lastDrawnVersion = -1;
  let rafRunning = false;
  let ignoreFrames = false; // ストロークが来始めたらPNGフレームを無視（太さ差異/ぼけ回避）
  const { canvasBox, scaler, rotator } = (window.CanvasLayout?.getElements?.() || {
    canvasBox: document.getElementById('canvasBox'),
    scaler: document.getElementById('scaler'),
    rotator: document.getElementById('rotator'),
  });
  // Receiver-only transforms
  let rotationDeg = 180; // default: 180 per requirement
  let scalePct = 100;
  function applyBoxTransform() {
    window.CanvasLayout?.applyTransform?.({ scalePct, rotationDeg, elements: { canvasBox, scaler, rotator } });
  }

  // Initialize config module (scale/rotate callbacks)
  window.ReceiverConfig?.init?.({
    base: baseCanvas,
    onScaleCb: (v) => { scalePct = v; applyBoxTransform(); log('scaleReceiver applied', { v, factor: v/100 }); },
    onRotateCb: (deg) => { rotationDeg = deg === 180 ? 180 : 0; applyBoxTransform(); log('rotateReceiver applied', { rotationDeg }); },
    onKickCb: () => { tryStartSendAnimation(); },
    logCb: (...a) => log(...a)
  });

  // Now that transform vars are defined, wire resize and do initial fit
  window.addEventListener('resize', () => { log('resize'); fitCanvas(); applyBoxTransform(); try { resizeAuthorLayers(); window.ReceiverConfig?.drawBackground?.(base); } catch(e) { log('drawBackground error on resize', e); } });
  fitCanvas(); applyBoxTransform();

  // Realtime stroke rendering state (moved to StrokeEngine)
  const STROKE_BUFFER_MS = Math.min(1000, Math.max(0, Number(params.get('buffer') || (window.RECEIVER_BUFFER_MS ?? 200))));
  window.StrokeEngine?.init?.({ dpr: DPR, base: baseCanvas, ink: inkCanvas, bufferMs: STROKE_BUFFER_MS });

  function setStatus(text) { statusEl.textContent = text; }
  function setInfo(text) {
    if (text !== lastInfo) {
      lastInfo = text; infoEl.textContent = text;
    }
  }

  // networking moved to ReceiverNet

  function normToCanvas(nx, ny) { return { x: nx * baseCanvas.width, y: ny * baseCanvas.height }; }

  function clearCanvas() {
    if (!base || !ink) return;
    log('clearCanvas');
    window.ReceiverConfig?.drawBackground?.(base);
    ink.save();
    ink.setTransform(1, 0, 0, 1, 0, 0);
    ink.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    ink.restore();
    // composite all author layers
    ink.save(); ink.setTransform(1,0,0,1,0,0); window.StrokeEngine?.compositeTo?.(ink); ink.restore();
  }

  // drawBackground moved to ReceiverConfig

  function applyConfig(data) { window.ReceiverConfig?.applyConfig?.(data); }

  function handleStroke(msg) {
    const phase = msg.phase;
    if (!phase) return;
    if (phase === 'start') {
      ignoreFrames = true; // 以降はPNGフレームを無視
      const id = String(msg.id || Date.now());
      const pxy = normToCanvas(msg.nx, msg.ny);
      const now = performance.now();
      const p = { x: pxy.x, y: pxy.y, time: now };
      const sizeDev = (typeof msg.sizeN === 'number' && isFinite(msg.sizeN)) ? (msg.sizeN * baseCanvas.width) : (Number(msg.size || 4) * DPR);
      const s = { author: String(msg.authorId || 'anon'), tool: (msg.tool||'pen'), color: msg.color || '#000', sizeCss: Number(msg.size || 4), sizeDev, points: [p], drawnUntil: 0, ended: false };
      strokes.set(id, s);
      // 即時に開始点を指定太さで可視化（細く見える問題を避ける）
      const lay = getAuthorLayer(s.author).ctx;
      lay.globalCompositeOperation = (s.tool === 'eraser') ? 'destination-out' : 'source-over';
      lay.beginPath(); lay.fillStyle = s.color; lay.arc(p.x, p.y, s.sizeDev/2, 0, Math.PI*2); lay.fill();
      // 合成
      ink.save(); ink.setTransform(1,0,0,1,0,0); ink.drawImage(getAuthorLayer(s.author).canvas,0,0); ink.restore();
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
          const r = (s.sizeDev || (s.sizeCss * DPR)) / 2;
          ink.arc(p.x, p.y, r, 0, Math.PI * 2);
          ink.fill();
          strokes.delete(id);
          continue;
        } else {
          continue; // wait for enough buffered points
        }
      }

      const ctxL = getAuthorLayer(String(s.author || 'anon')).ctx;
      ctxL.globalCompositeOperation = (s.tool === 'eraser') ? 'destination-out' : 'source-over';
      ctxL.lineJoin = 'round';
      ctxL.lineCap = 'round';
      ctxL.strokeStyle = s.color;
      ctxL.lineWidth = (s.tool==='eraser'?1.3:1.0) * (s.sizeDev || (s.sizeCss * DPR));

      let drew = false;
      const ctx = getAuthorLayer(String(s.author || 'anon')).ctx;
      ctx.globalCompositeOperation = (s.tool === 'eraser') ? 'destination-out' : 'source-over';
      ctx.beginPath();
      ctx.moveTo(s.lastPt.x, s.lastPt.y);

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
          ctx.lineTo(np.x, np.y);
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

      if (drew) ctx.stroke();

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
        try { window.ReceiverConfig?.drawBackground?.(base); } catch(_) {}
        const srcW = currentBitmap.width || currentBitmap.naturalWidth; const srcH = currentBitmap.height || currentBitmap.naturalHeight;
        base.save(); base.setTransform(1,0,0,1,0,0);
        base.drawImage(currentBitmap, 0, 0, srcW, srcH, 0, 0, baseCanvas.width, baseCanvas.height);
        base.restore();
        // Clear ink to prevent double-darkening when a fresh frame arrives
        if (ink && inkCanvas) {
          ink.save();
          ink.setTransform(1, 0, 0, 1, 0, 0);
          ink.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
          window.StrokeEngine?.compositeTo?.(ink);
          ink.restore();
        }
        lastDrawnVersion = frameVersion;
      }
      // Always process stroke queues toward target time, then composite author layers to ink
      window.StrokeEngine?.process?.();
      ink.save(); ink.setTransform(1,0,0,1,0,0); ink.clearRect(0,0,inkCanvas.width, inkCanvas.height);
      window.StrokeEngine?.compositeTo?.(ink);
      ink.restore();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // Clear once at start, apply initial transform, and spin RAF even if no frames arrive
  clearCanvas();
  applyBoxTransform();
  ensureRAF();
  const net = window.ReceiverNet?.create?.({
    server: SERVER,
    channel: CHANNEL,
    onFrame: (data) => { if (!ignoreFrames) ingestFrame(data); },
    onStroke: (m) => { if (m?.phase === 'start') ignoreFrames = true; window.StrokeEngine?.handleStroke?.(m); },
    onClear: (authorId) => {
      if (authorId) { window.StrokeEngine?.clearAuthor?.(String(authorId)); }
      else { window.StrokeEngine?.clearAll?.(); }
      clearCanvas();
    },
    onConfig: (d) => applyConfig(d),
    // Animation trigger from senders
    onAction: (type) => { if (type === 'sendAnimation') tryStartAnimation(); },
    setStatus: (t) => setStatus(t),
    setInfo: (t) => setInfo(t),
    log: (...a) => log(...a)
  });
  net?.start?.();

  // ---- Send animation handling ----
  let animRunning = false;
  function tryStartAnimation(){
    const t = (window.ReceiverConfig?.getAnimType?.() || 'A').toUpperCase();
    if (t === 'B') return tryStartAnimB();
    return tryStartAnimA();
  }

  function tryStartAnimA(){
    if (animRunning) { try { console.log('[receiver] anim already running'); } catch(_) {}; return; }
    animRunning = true; try { console.log('[receiver] anim start'); } catch(_) {}
    const delays = window.ReceiverConfig?.getAnimDelays?.() || { rotateDelaySec:0, moveDelaySec:0 };
    const rotateDelay = Math.max(0, Math.min(10, Number(delays.rotateDelaySec)||0)) * 1000;
    const moveDelay = Math.max(0, Math.min(10, Number(delays.moveDelaySec)||0)) * 1000;
    const rotateDur = 1000; // 1s
    const moveDur = 1500;   // 1.5s

    // Confetti will start together with fireworks (at rotation start)

    // Step 1: after X sec, animate rotation to 180deg
    setTimeout(() => {
      // animate relative +180deg to ensure visible flip from current state
      const startDeg = rotationDeg || 0;
      const endDeg = (startDeg + 180) % 360;
      if (rotator) rotator.style.transition = `transform ${rotateDur}ms ease`;
      rotationDeg = endDeg; applyBoxTransform();
      // Fireworks start together with rotation (confetti at move timing)
      try { startFireworks(4000); } catch(_) {}
      // Step 2: after rotation done + Z sec, move down out of view
      setTimeout(() => {
        const box = canvasBox;
        if (!box) { finish(); return; }
        // Emit confetti right when moving starts (shorter window)
        try { startConfetti(1700); } catch(_) {}
        // animate translateY to push canvas below the window height
        const start = performance.now();
        const from = 0; const to = (window.innerHeight || 2000);
        function moveTick(t){
          const e = Math.min(1, (t-start)/moveDur);
          const y = from + (to-from)*e;
          box.style.transform = `translateY(${y}px)`;
          if (e < 1) requestAnimationFrame(moveTick); else afterMove();
        }
        requestAnimationFrame(moveTick);
      }, rotateDur + moveDelay);
    }, rotateDelay);

    function afterMove(){
      // After 5s, clear drawings (receiver + senders) and reappear at top 80px with rotation 180
      setTimeout(() => {
        // request global clear (senders + receivers)
        try {
          const httpBase = (window.ReceiverNet?.create?.({server:SERVER, channel:CHANNEL})?.util?.toHttpBase?.(SERVER) || SERVER)
            .replace(/^wss?:\/\//,'https://').replace(/\/$/,'');
          fetch(`${httpBase}/clear?channel=${encodeURIComponent(CHANNEL)}`, { method:'POST' }).catch(()=>{});
        } catch(_) {}
        // local clear + reset
        window.StrokeEngine?.clearAll?.(); clearCanvas();
        if (rotator) rotator.style.transition = '';
        if (canvasBox) canvasBox.style.transform = '';
        rotationDeg = 180; applyBoxTransform();
        animRunning = false;
      }, 5000);
    }
    function finish(){ animRunning = false; }
  }

  // Placeholder for Animation B (to be specified later): simple confetti burst only
  function tryStartAnimB(){
    if (animRunning) return; animRunning = true;
    try { startConfetti(2000); } catch(_) {}
    setTimeout(()=>{ animRunning = false; }, 2500);
  }

  // ---- Fireworks overlay (window-wide, 2D canvas) ----
  let fwRunning = false;
  function startFireworks(durationMs = 4000) {
    if (fwRunning) return; fwRunning = true;
    const cv = document.createElement('canvas');
    cv.style.position = 'fixed'; cv.style.inset = '0'; cv.style.zIndex = '9999';
    cv.style.pointerEvents = 'none';
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    function fit(){ cv.width = Math.floor((window.innerWidth||800) * DPR); cv.height = Math.floor((window.innerHeight||600) * DPR); cv.style.width='100%'; cv.style.height='100%'; g.scale(1,1); }
    fit();
    const onResize = () => { fit(); };
    window.addEventListener('resize', onResize);

    const rockets = []; // {x,y,vx,vy,color,exploded}
    const parts = [];   // {x,y,vx,vy,life,color}
    const colors = ['#ff6b6b','#ffd166','#06d6a0','#118ab2','#a78bfa','#f472b6'];
    const GR = 0.10 * DPR;
    const now = () => performance.now();
    const t0 = now();
    let lastSpawn = t0;
    const spawnInterval = 550; // slower spawn pace (~0.55s)
    function spawnRocket(){
      const W = cv.width, H = cv.height;
      const x = (Math.random()*0.8+0.1) * W; const y = H + 5*DPR;
      const vx = (Math.random()-0.5) * 0.3 * DPR;
      const vy = -(1.2 + Math.random()*0.6) * DPR * 8; // upward
      rockets.push({ x, y, vx, vy, color: colors[(Math.random()*colors.length)|0], exploded:false });
    }
    function explode(r){
      const count = 40 + (Math.random()*20|0);
      for (let i=0;i<count;i++){
        const a = (i/count) * Math.PI*2; const sp = 1.5 + Math.random()*1.5;
        const vx = Math.cos(a)*sp*DPR*2, vy = Math.sin(a)*sp*DPR*2;
        parts.push({ x:r.x, y:r.y, vx, vy, life: 600 + (Math.random()*500|0), color: r.color });
      }
    }
    function step(){
      const t = now();
      const elapsed = t - t0;
      // clear with fade trail
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.globalCompositeOperation = 'destination-out';
      g.fillRect(0,0,cv.width,cv.height);
      g.globalCompositeOperation = 'lighter';

      // spawn rockets
      // spawn rockets only during active window; slower pace
      if (t - t0 < durationMs && t - lastSpawn > spawnInterval) { lastSpawn = t; spawnRocket(); }
      // update rockets
      for (let i=rockets.length-1;i>=0;i--){
        const r = rockets[i];
        r.x += r.vx; r.y += r.vy; r.vy += GR*0.4;
        // explode when upward velocity reduces or near top
        if (!r.exploded && (r.vy > -1 || r.y < cv.height*0.25)) { r.exploded = true; explode(r); rockets.splice(i,1); continue; }
        // draw rocket
        g.fillStyle = r.color; g.beginPath(); g.arc(r.x, r.y, 2*DPR, 0, Math.PI*2); g.fill();
      }
      // update particles
      for (let i=parts.length-1;i>=0;i--){
        const p = parts[i]; p.x += p.vx; p.y += p.vy; p.vy += GR*0.2; p.life -= 16;
        if (p.life <= 0) { parts.splice(i,1); continue; }
        g.fillStyle = p.color; g.globalAlpha = Math.max(0, p.life/600);
        g.beginPath(); g.arc(p.x, p.y, 2*DPR, 0, Math.PI*2); g.fill(); g.globalAlpha = 1;
      }
      // after durationMs, stop spawning but let remaining rockets/particles finish naturally
      if (t - t0 >= durationMs && rockets.length === 0 && parts.length === 0) finishFW();
      else requestAnimationFrame(step);
    }
    function finishFW(){
      window.removeEventListener('resize', onResize);
      try { cv.remove(); } catch(_) {}
      fwRunning = false;
    }
    requestAnimationFrame(step);
  }

  // ---- Confetti burst from bottom corners (pre-move) ----
  let cfRunning = false;
function startConfetti(spawnWindowMs = 1700) {
    if (cfRunning) return; cfRunning = true;
    const cv = document.createElement('canvas');
    cv.style.position = 'fixed'; cv.style.inset = '0'; cv.style.zIndex = '9999';
    cv.style.pointerEvents = 'none';
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    function fit(){ cv.width = Math.floor((window.innerWidth||800) * DPR); cv.height = Math.floor((window.innerHeight||600) * DPR); cv.style.width='100%'; cv.style.height='100%'; }
    fit();
    const onResize = () => fit(); window.addEventListener('resize', onResize);

    const parts = []; // {x,y,vx,vy,life,w,h,ang,angV,color,gl,seed,shape}
    const colors = ['#f87171','#fbbf24','#34d399','#60a5fa','#a78bfa','#f472b6','#f59e0b','#22d3ee','#ffd700','#c0c0c0'];
    const now = () => performance.now();
    const t0 = now();
    // クラッカー感: 少し強めの重力、発生間隔を遅め
    const GR = 0.10 * DPR;
    const spawnEvery = 100; // ms
    let lastSpawn = t0;
    function spawnSide(side){
      const W=cv.width, H=cv.height; const y = H - 4*DPR; const x = side==='left' ? 6*DPR : W - 6*DPR;
      const count = 8; // 量を少し増やす
      for (let i=0;i<count;i++){
        // 目標は高さ40%付近（中央やや上）
        const targetX = W*0.5 + (Math.random()-0.5)*0.24*W; // さらに横の広がり
        const targetY = H*0.35 + (Math.random()-0.5)*0.10*H; // 少し低め＆縦の広がり増
        const dx = targetX - x, dy = targetY - y;
        const len = Math.max(1, Math.hypot(dx,dy));
        const ux = dx/len, uy = dy/len; // unit vector toward target
        // 初速を強化し、必ず目標（40%付近）に届くようにvyを補正
        const base = (1.9 + Math.random()*0.8) * DPR * 2.0; // 初速をわずかに低減
        const jx = (Math.random()-0.5)*0.36, jy = (Math.random()-0.5)*0.14; // さらに広げる
        const vx0 = (ux + jx) * base; let vy0 = (uy + jy) * base; // uy negative
        const needVy = -Math.sqrt(Math.max(0.1, 2 * GR * Math.max(5*DPR, (y - targetY))));
        if (vy0 > needVy) vy0 = needVy * (1 + Math.random()*0.05); // 余裕は5%
        const vx = vx0, vy = vy0;
        const isGlitter = Math.random() < 0.30; // 30% glitter（金/銀多め）
        const shape = isGlitter ? 'star' : (Math.random()<0.5 ? 'tri' : 'rect');
        parts.push({ x, y, vx, vy, life: 800 + (Math.random()*400|0), w: 6*DPR, h: 9*DPR, ang: Math.random()*Math.PI, angV:(Math.random()*2-1)*0.14, color: colors[(Math.random()*colors.length)|0], gl: isGlitter, seed: Math.random()*1000, shape });
      }
    }
    function step(){
      const t = now();
      // spawn within window
      if (t - t0 < spawnWindowMs && t - lastSpawn > spawnEvery) { lastSpawn = t; spawnSide('left'); spawnSide('right'); }
      // clear faded trail
      g.clearRect(0,0,cv.width,cv.height);
      // draw
      for (let i=parts.length-1;i>=0;i--){
        const p = parts[i]; p.x += p.vx; p.y += p.vy; p.vy += GR; p.ang += p.angV; p.life -= 16;
        if (p.life <= 0 || p.y > cv.height + 20*DPR) { parts.splice(i,1); continue; }
        g.save(); g.translate(p.x, p.y); g.rotate(p.ang);
        if (p.gl || p.shape==='star') {
          const flick = 0.6 + 0.4*Math.abs(Math.sin((t + p.seed)/120));
          g.globalAlpha = flick; g.fillStyle = (p.color === '#ffd700' || p.color === '#c0c0c0') ? p.color : '#ffd700';
          g.rotate(0.785);
          g.fillRect(-p.w/2, -p.h*0.08, p.w, p.h*0.16);
          g.rotate(Math.PI/2);
          g.fillRect(-p.w/2, -p.h*0.08, p.w, p.h*0.16);
          g.globalAlpha = 1;
        } else if (p.shape === 'tri') {
          g.fillStyle = p.color; g.beginPath(); g.moveTo(0, -p.h/2); g.lineTo(p.w/2, p.h/2); g.lineTo(-p.w/2, p.h/2); g.closePath(); g.fill();
        } else {
          g.fillStyle = p.color; g.fillRect(-p.w/2, -p.h/2, p.w, p.h);
        }
        g.restore();
      }
      if (t - t0 >= spawnWindowMs && parts.length === 0) finishCF(); else requestAnimationFrame(step);
    }
    function finishCF(){ window.removeEventListener('resize', onResize); try { cv.remove(); } catch(_){} cfRunning = false; }
    requestAnimationFrame(step);
  }
})();
