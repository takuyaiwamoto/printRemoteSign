(() => {
  const SHARED_CONST = (window.SenderShared && window.SenderShared.constants) || null;
  const SENDER_VERSION = SHARED_CONST?.VERSION || '0.9.6';
  try { const v = document.getElementById('sender-version'); if (v) v.textContent = `v${SENDER_VERSION}`; } catch (_) {}
  // ----- constants / debug -----
  const RATIO = SHARED_CONST?.RATIO_A4 ?? (210 / 297); // A4 縦: 幅 / 高さ（約 0.707）
  const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, SHARED_CONST?.DPR_MAX ?? 3));
  const ERASER_SCALE = 3.0;            // 消しゴムはペンの3倍
  const OTHER_BUFFER_MS = SHARED_CONST?.OTHER_BUFFER_MS ?? 200;      // 他者描画のスムージング遅延
  const SEND_INTERVAL_MS = 150;        // PNG送信の間引き（通常OFF）
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
  const clearMineBtn = document.getElementById('btn-clear-mine');
  const eraserBtn = document.getElementById('btn-eraser');
  const sendBtn = document.getElementById('btn-send');
  const overlayStartBtn = document.getElementById('btn-overlay-start');
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
  const SEND_FRAMES_DURING_DRAW = false; // 逐次描画は座標で行うため、描画中のフレーム送信は既定で無効化
  let httpFallback = false;
  let currentStrokeId = null;
  let realtimeEverUsed = false; // 一度でも座標ストリームを使ったらフレーム送信を抑制
  const AUTHOR_ID = Math.random().toString(36).slice(2, 10);
  try { const b = document.getElementById('author-badge'); if (b) b.textContent = `ID:${AUTHOR_ID}`; } catch(_) {}
  let eraserActive = false;
  // --- Pulse helpers (visual cues) ---
  const pulseStart = (on)=>{ try { overlayStartBtn?.classList.toggle('btn-pulse-blue', !!on); } catch(_) {} };
  const pulseSend = (on)=>{ try { sendBtn?.classList.toggle('btn-pulse-red', !!on); } catch(_) {} };
  let sentThisWindow = false; // reset when waiting or new session starts
  // Arrow cue handling for legacy build
  function positionStartArrow(){
    try {
      const el = document.getElementById('startArrowCue'); if (!el) return;
      const btn = overlayStartBtn; if (!btn) return;
      const r = btn.getBoundingClientRect();
      el.style.left = (r.left + r.width/2) + 'px';
      el.style.top = r.top + 'px';
    } catch(_) {}
  }
  function showStartArrow(on){
    try {
      let el = document.getElementById('startArrowCue');
      if (on) {
        if (!el) {
          el = document.createElement('div'); el.id='startArrowCue'; el.className='arrow-cue is-anim';
          const inner = document.createElement('div'); inner.className='arrow-cue-inner'; inner.textContent='↓'; el.appendChild(inner);
          document.body.appendChild(el);
        } else if (!el.querySelector('.arrow-cue-inner')) {
          const inner = document.createElement('div'); inner.className='arrow-cue-inner'; inner.textContent='↓'; el.appendChild(inner);
        }
        el.style.display='block'; positionStartArrow();
        window.addEventListener('resize', positionStartArrow);
        window.addEventListener('scroll', positionStartArrow, { passive:true });
        setTimeout(positionStartArrow, 0);
      } else {
        if (el) el.style.display='none';
        window.removeEventListener('resize', positionStartArrow);
        window.removeEventListener('scroll', positionStartArrow);
      }
    } catch(_) {}
  }

  // Send arrow (red)
  function positionSendArrow(){
    try {
      const el = document.getElementById('sendArrowCue'); if (!el) return;
      const btn = sendBtn; if (!btn) return;
      const r = btn.getBoundingClientRect();
      el.style.left = (r.left + r.width/2) + 'px';
      el.style.top = r.top + 'px';
    } catch(_) {}
  }
  function showSendArrow(on){
    try {
      let el = document.getElementById('sendArrowCue');
      if (on) {
        if (!el) {
          el = document.createElement('div'); el.id='sendArrowCue'; el.className='arrow-cue arrow-cue-red is-anim';
          const inner = document.createElement('div'); inner.className='arrow-cue-inner'; inner.textContent='↓'; el.appendChild(inner);
          document.body.appendChild(el);
        } else if (!el.querySelector('.arrow-cue-inner')) {
          const inner = document.createElement('div'); inner.className='arrow-cue-inner'; inner.textContent='↓'; el.appendChild(inner);
        }
        el.style.display='block'; positionSendArrow();
        window.addEventListener('resize', positionSendArrow);
        window.addEventListener('scroll', positionSendArrow, { passive:true });
        setTimeout(positionSendArrow, 0);
      } else {
        if (el) el.style.display='none';
        window.removeEventListener('resize', positionSendArrow);
        window.removeEventListener('scroll', positionSendArrow);
      }
    } catch(_) {}
  }

  // ---- Sender preview overlay (follows receiver animType/delays; no audio) ----
  // Config cache from server (defaults match receiver)
  let __S_PREVIEW_ANIM_TYPE = 'B';
  let __S_PREVIEW_ROT_DELAY_SEC = 0;
  let __S_PREVIEW_MOVE_DELAY_SEC = 0;
  let __S_PREVIEW_STAY_SEC = 0;
  function __applySenderAnimConfigFromMsg(data){
    try {
      if (!data || typeof data !== 'object') return;
      if (typeof data.animType === 'string') {
        __S_PREVIEW_ANIM_TYPE = (String(data.animType).toUpperCase()==='A') ? 'A' : 'B';
      }
      if (data.animReceiver && typeof data.animReceiver === 'object') {
        const x = Number(data.animReceiver.rotateDelaySec); const z = Number(data.animReceiver.moveDelaySec);
        if (isFinite(x)) __S_PREVIEW_ROT_DELAY_SEC = Math.max(0, Math.min(10, Math.round(x)));
        if (isFinite(z)) __S_PREVIEW_MOVE_DELAY_SEC = Math.max(0, Math.min(10, Math.round(z)));
      }
      if (typeof data.overlayStaySec !== 'undefined') {
        const s = Number(data.overlayStaySec); if (isFinite(s)) __S_PREVIEW_STAY_SEC = Math.max(0, Math.min(120, Math.round(s)));
      }
    } catch(_) {}
  }

  function startLocalPreviewAnim(){
    if (window.__senderPreviewStarted) { try { console.log('[sender preview] already running; skip'); } catch(_) {} return; }
    window.__senderPreviewStarted = true;
    try { console.log('[sender preview] start', { animType: __S_PREVIEW_ANIM_TYPE, rotDelay: __S_PREVIEW_ROT_DELAY_SEC, moveDelay: __S_PREVIEW_MOVE_DELAY_SEC }); } catch(_) {}
    const wrapEl = document.getElementById('canvas-wrap') || wrap;
    if (!wrapEl) { try { console.warn('[sender preview] wrap element not found'); } catch(_) {} return; }
    let overlay = document.getElementById('senderAnimOverlay');
    if (!overlay) { overlay = document.createElement('div'); overlay.id='senderAnimOverlay'; overlay.style.cssText='position:fixed;inset:0;z-index:10050;display:block;pointer-events:auto;background:transparent;'; document.body.appendChild(overlay); try { console.log('[sender preview] overlay created'); } catch(_) {} }
    let box = document.getElementById('senderAnimBox'); if (!box) { box = document.createElement('div'); box.id='senderAnimBox'; overlay.appendChild(box); }
    box.style.cssText='position:absolute;overflow:hidden;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.35);background:#000;';
    const r = wrapEl.getBoundingClientRect(); box.style.left=Math.round(r.left)+'px'; box.style.top=Math.round(r.top)+'px'; box.style.width=Math.round(r.width)+'px'; box.style.height=Math.round(r.height)+'px';
    let inner = document.getElementById('senderAnimInner'); if (!inner) { inner = document.createElement('div'); inner.id='senderAnimInner'; box.appendChild(inner); }
    inner.style.cssText='position:absolute;inset:0;transform-origin:center center;';

    // Ink-only snapshot (self + others), to fade like receiver
    const inkSnap = document.createElement('canvas'); inkSnap.width = canvas.width; inkSnap.height = canvas.height; const ig = inkSnap.getContext('2d');
    try { ig.drawImage(selfLayer.canvas, 0, 0); } catch(_) {}
    try { otherEngine?.compositeTo?.(ig); } catch(_) {}
    try {
      const img = ig.getImageData(0,0,inkSnap.width,inkSnap.height);
      const d = img.data;
      for (let i=0;i<d.length;i+=4){ const r=d[i],gg=d[i+1],b=d[i+2]; if (r>245 && gg>245 && b>245) d[i+3]=0; }
      ig.putImageData(img,0,0);
    } catch(e) { try { console.warn('[sender preview] ink mask failed', e); } catch(_) {} }
    let inkImg = document.getElementById('senderAnimInk'); if (!inkImg) { inkImg = document.createElement('canvas'); inkImg.id = 'senderAnimInk'; inner.appendChild(inkImg); }
    inkImg.width = inkSnap.width; inkImg.height = inkSnap.height; const i2 = inkImg.getContext('2d'); i2.clearRect(0,0,inkImg.width,inkImg.height); i2.drawImage(inkSnap,0,0);
    inkImg.style.cssText='position:absolute;inset:0;width:100%;height:100%;opacity:1;transition:opacity 0ms linear;z-index:2;';

    // Optional video (animType B); audio is not used
    let vid = document.getElementById('senderAnimVideo');
    if (__S_PREVIEW_ANIM_TYPE === 'B') {
      if (!vid) { vid=document.createElement('video'); vid.id='senderAnimVideo'; inner.appendChild(vid); }
      vid.muted=true; vid.playsInline=true; vid.preload='auto'; vid.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;';
      // create freeze canvas for last frame capture
      let vfreeze = document.getElementById('senderAnimVideoFreeze');
      if (!vfreeze) { vfreeze = document.createElement('canvas'); vfreeze.id='senderAnimVideoFreeze'; vfreeze.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:1;display:none;'; inner.appendChild(vfreeze); }
      const candidates=[
        'electron-receiver/assets/backVideo1.mp4',
        '../electron-receiver/assets/backVideo1.mp4',
        'assets/backVideo1.mp4','../assets/backVideo1.mp4','backVideo1.mp4','../backVideo1.mp4'
      ];
      (async()=>{
        let ok=false; for(const url of candidates){
          try{
            await new Promise((res,rej)=>{ const onOk=()=>{ cleanup(); res(); }; const onErr=()=>{ cleanup(); rej(new Error('e')); }; function cleanup(){ vid.removeEventListener('loadedmetadata', onOk); vid.removeEventListener('error', onErr);} vid.addEventListener('loadedmetadata', onOk, {once:true}); vid.addEventListener('error', onErr, {once:true}); vid.src=url; vid.load(); });
            ok=true; try { console.log('[sender preview] video source selected', url); } catch(_) {}
            break;
          } catch(err){ try { console.warn('[sender preview] video source failed', url, err?.message||err); } catch(_) {} }
        }
        try{ if(ok) { await vid.play().catch(()=>{}); try { console.log('[sender preview] video play started'); } catch(_) {} } }catch(_){}
      })();
    } else {
      // Ensure any previous video element is hidden when animType=A
      try { if (vid) vid.remove(); } catch(_) {}
      vid = null;
    }

    // Do NOT clear local canvas here; keep it until global clear after move
    overlay.addEventListener('pointerdown', (e)=> { try { console.log('[sender preview] pointer blocked'); } catch(_) {} e.preventDefault(); }, { once:false });

    const rotateDur = 1000; // ms
    const moveDur = 1500;   // ms
    const rotateDelay = Math.max(0, Math.min(10, Number(__S_PREVIEW_ROT_DELAY_SEC)||0)) * 1000;
    const moveDelay = Math.max(0, Math.min(10, Number(__S_PREVIEW_MOVE_DELAY_SEC)||0)) * 1000;

    // Start: after rotateDelay (sender side does not rotate visually; only timing aligns)
    setTimeout(()=>{
      inner.style.transform='translateY(0)'; inner.style.transition=`transform ${rotateDur}ms ease`;

      if (__S_PREVIEW_ANIM_TYPE === 'B') {
        // B: fade-out snapshot for 2s from rotation start, then later fade-in near video end/10s
        // fade-out 2s
        try { inkImg.style.transition = 'opacity 2000ms linear'; inkImg.style.opacity = '0'; console.log('[sender preview] ink fade-out start'); } catch(_) {}
        let videoEnded = false; if (vid) { try { vid.onended = ()=>{ videoEnded = true; try { const d=Number(vid.duration||0); vid.pause(); if (isFinite(d) && d>0) { try { vid.currentTime = Math.max(0, d - 0.05); } catch(_) {} } console.log('[sender preview] video ended + paused at last frame', { duration: d }); } catch(_) {} try { console.log('[sender preview] schedule move(B)', { moveDelay }); } catch(_) {} setTimeout(()=> startMove(), moveDelay); }; } catch(_) {} }
        // Trigger fade-in at earliest of: video end OR reaching 10s
        const fadeIn = () => { try { inkImg.style.transition = 'opacity 400ms ease'; inkImg.style.opacity = '1'; console.log('[sender preview] ink fade-in start'); setTimeout(()=>{ try { console.log('[sender preview] ink fade-in done'); } catch(_) {} }, 450); } catch(_) {} };
        const startedAt = performance.now();
        const poll = setInterval(()=>{
          const t = performance.now();
          if ((videoEnded) || (vid && vid.currentTime >= 10) || (!vid && (t - startedAt >= 10000))) {
            clearInterval(poll); fadeIn();
          }
        }, 100);
      } else {
        // A: schedule move after rotation completes + moveDelay (match receiver A)
        try { console.log('[sender preview] schedule move(A)', { whenMs: rotateDur + moveDelay }); } catch(_) {}
        setTimeout(()=> startMove(), rotateDur + moveDelay);
      }
    }, rotateDelay);

    function startMove(){
      try { console.log('[sender preview] move down start', { moveDur }); } catch(_) {}
      inner.style.transition = `transform ${moveDur}ms ease`;
      inner.style.transform = 'translateY(120%)';
      setTimeout(()=>{
        // Global clear after move completes
        try {
          const httpBase = (toHttpBase(SERVER_URL) || SERVER_URL).replace(/\/$/,'');
          const url = `${httpBase}/clear?channel=${encodeURIComponent(CHANNEL)}`;
          console.log('[sender preview] POST /clear', url);
          fetch(url, { method: 'POST' }).then(r=>{ console.log('[sender preview] clear result', { ok: r.ok, status: r.status }); }).catch(e=>{ console.warn('[sender preview] clear error', e); });
        } catch(e) { try { console.warn('[sender preview] clear build error', e); } catch(_) {} }
        try{ overlay.remove(); console.log('[sender preview] overlay removed'); }catch(_){}
        window.__senderPreviewStarted=false;
      }, moveDur + 30);
    }
  }
  function showStartPrompt(){
    try {
      let tip = document.getElementById('senderPressStart');
      if (!tip) { tip = document.createElement('div'); tip.id='senderPressStart'; tip.style.cssText='position:fixed;inset:0;display:none;place-items:center;z-index:10001;pointer-events:none;'; const t=document.createElement('div'); t.style.cssText='font-size:48px;font-weight:800;color:#ffffff;text-shadow:0 0 10px #3b82f6,0 0 22px #3b82f6,0 0 34px #3b82f6;'; t.textContent='開始を押してください'; tip.appendChild(t); document.body.appendChild(tip); }
      tip.style.display = 'grid';
      pulseStart(true);
    } catch(_) {}
  }

  // 背景と自分/他者レイヤ構成
  let bgMode = 'white';
  let bgImage = null; // HTMLImageElement
  function drawBackground() {
    ctx.save(); ctx.setTransform(1,0,0,1,0,0);
    if (bgMode === 'image' && bgImage) {
      ctx.drawImage(bgImage, 0,0, bgImage.naturalWidth, bgImage.naturalHeight, 0,0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    }
    ctx.restore();
  }

  const selfLayer = { canvas: document.createElement('canvas'), ctx: null };
  selfLayer.canvas.width = 1; selfLayer.canvas.height = 1; selfLayer.ctx = selfLayer.canvas.getContext('2d');
  selfLayer.ctx.imageSmoothingEnabled = true; selfLayer.ctx.imageSmoothingQuality = 'high';

  // 他者描画（共有エンジン）
  // Remote strokes already include effective eraser size; avoid double scaling here
  const otherEngine = (window.SenderShared?.otherStrokes?.create?.({ canvas, dpr: DPR, bufferMs: OTHER_BUFFER_MS, eraserScale: 1.0 }) || null);
  if (SDEBUG) slog('otherEngine', otherEngine ? 'ready' : 'missing');
  function resizeOtherLayers() {
    // 自分レイヤ
    {
      const off = document.createElement('canvas'); off.width = canvas.width; off.height = canvas.height;
      off.getContext('2d').drawImage(selfLayer.canvas, 0, 0, selfLayer.canvas.width, selfLayer.canvas.height, 0, 0, off.width, off.height);
      selfLayer.canvas.width = off.width; selfLayer.canvas.height = off.height;
      selfLayer.ctx = selfLayer.canvas.getContext('2d');
      selfLayer.ctx.imageSmoothingEnabled = true; selfLayer.ctx.imageSmoothingQuality = 'high';
      selfLayer.ctx.drawImage(off, 0, 0);
    }
    otherEngine?.resizeToCanvas?.();
  }
  function composeOthers() {
    ctx.save(); ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    drawBackground();
    otherEngine?.compositeTo?.(ctx);
    ctx.drawImage(selfLayer.canvas, 0, 0);
    ctx.restore();
  }

  // small helpers for self drawing
  function selfCtx() { return selfLayer.ctx; }
  function setCompositeForTool(c, erasing) { c.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'; }
  function setStrokeStyle(c) { c.lineJoin='round'; c.lineCap='round'; c.strokeStyle = brushColor; c.lineWidth = (eraserActive?ERASER_SCALE:1.0) * brushSizeCssPx * DPR; }
  // 他者ストロークの描画ループは共有エンジンに任せる
  otherEngine?.startRAF?.();
  // Ensure remote strokes are visible even when local user is idle
  let __composeTick = 0;
  (function __composeRAF(){
    try {
      composeOthers();
      if ((++__composeTick % 30) === 0) {
        const st = otherEngine?.getStats?.();
        if (st) slog('compose frame', st);
      }
    } catch(_) {}
    requestAnimationFrame(__composeRAF);
  })();

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
        otherEngine?.handle?.(msg);
        if (SDEBUG) {
          if (msg.phase === 'start') slog('sse other start', { id: msg.id, author: msg.authorId });
          else if (msg.phase === 'point') { if (!window.__dbgPointC) window.__dbgPointC = 0; if ((++window.__dbgPointC % 15) === 0) slog('sse other point', { id: msg.id }); }
          else if (msg.phase === 'end') slog('sse other end', { id: msg.id });
        }
      } catch(_) {}
    });
    es.addEventListener('clear', () => {
      // 受け手側: 背景は維持し、描画のみ消す
      selfLayer.ctx.clearRect(0,0,selfLayer.canvas.width,selfLayer.canvas.height);
      otherEngine?.clearAll?.();
      composeOthers();
      if (SDEBUG) slog('sse clear all');
    });
    es.addEventListener('clearMine', (ev) => {
      try {
        const j = JSON.parse(ev.data);
        const aid = String(j?.authorId||'');
        otherEngine?.clearAuthor?.(aid);
        composeOthers();
        if (SDEBUG) slog('sse clear mine', aid);
      } catch(_) {}
    });
    es.addEventListener('config', (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m && m.data) __applySenderAnimConfigFromMsg(m.data);
      } catch(_) {}
    });
    es.addEventListener('sendAnimation', () => {
      try { console.log('[sender(main)] SSE sendAnimation -> start local preview'); } catch(_) {}
      try { pulseSend(false); showSendArrow(false); } catch(_) {}
      try { window.__sentThisWindow = true; } catch(_) {}
      try { startLocalPreviewAnim(); } catch(_) {}
    });
  }

  // Default to waiting to avoid showing countdown at boot
  window.__overlayWaiting = true;
  
  // ---- Extra WS listener (receiver role) to receive server broadcasts even if not sent to senders ----
  (function listenAsReceiver(){
    if (!SERVER_URL) return;
    const url = `${toWsBase(SERVER_URL)}/ws?channel=${encodeURIComponent(CHANNEL)}&role=receiver`;
    let wsListen = null; let retry = null;
    function open(){
      try { wsListen = new WebSocket(url); } catch(e) { schedule(); return; }
      wsListen.onopen = () => { try { console.log('[sender(main)] listenWS open', url); } catch(_) {} };
      wsListen.onerror = () => { schedule(); };
      wsListen.onclose = () => { schedule(); };
      wsListen.onmessage = (ev) => {
        let msg = null; try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : 'null'); } catch(_) {}
        if (!msg || !msg.type) return;
        try { console.log('[sender(main)] listenWS message', msg.type); } catch(_) {}
        if (msg.type === 'clear') {
          // 背景は維持し、描画のみ消す
          try { selfLayer.ctx.clearRect(0,0,selfLayer.canvas.width,selfLayer.canvas.height); } catch(_) {}
          try { otherEngine?.clearAll?.(); } catch(_) {}
          try { composeOthers(); } catch(_) {}
          return;
        }
        if (msg.type === 'clearMine') {
          try { otherEngine?.clearAuthor?.(String(msg.authorId||'')); composeOthers(); } catch(_) {}
          return;
        }
        if (msg.type === 'config' && msg.data && Object.prototype.hasOwnProperty.call(msg.data,'clearMineAuthor')) {
          try { const aid = String(msg.data.clearMineAuthor||''); otherEngine?.clearAuthor?.(aid); composeOthers(); } catch(_) {}
          return;
        }
      };
    }
    function schedule(){ if (retry) return; retry = setTimeout(()=>{ retry=null; open(); }, 1000); }
    open();
  })();
  function connectWS() {
    if (!SERVER_URL) return;
    const url = `${toWsBase(SERVER_URL)}/ws?channel=${encodeURIComponent(CHANNEL)}&role=sender`;
    slog('ws connecting', { url });
    try { ws = new WebSocket(url); } catch (e) { httpFallback = !!SERVER_URL; slog('ws construct error', e?.message||e); return; }
    ws.onopen = () => { wsReady = true; httpFallback = false; slog('ws open'); /* 首描画のためのフレーム送信は不要 */ };
    ws.onclose = () => { wsReady = false; slog('ws close'); setTimeout(connectWS, 1000); };
    ws.onerror = () => { wsReady = false; httpFallback = !!SERVER_URL; slog('ws error'); };
    const __BOOT_AT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let __lastPreCountTs = 0;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : 'null');
        if (msg && msg.type) slog('ws message', msg.type);
          if (msg && msg.type === 'config' && msg.data) {
            try { __applySenderAnimConfigFromMsg(msg.data); } catch(_) {}
          }
          if (msg && msg.type === 'config' && msg.data && Object.prototype.hasOwnProperty.call(msg.data, 'overlayRemainSec')) {
            const left = Math.max(0, Math.floor(Number(msg.data.overlayRemainSec)||0));
            let el = document.getElementById('senderCountdown');
            if (!el) { el = document.createElement('div'); el.id = 'senderCountdown'; el.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9999;font-size:44px;color:#fff;text-shadow:0 0 8px #3b82f6,0 0 16px #3b82f6,0 0 24px #3b82f6;pointer-events:none;'; el.textContent = '終了まで0秒'; document.body.appendChild(el); }
            const isWaiting = !!window.__overlayWaiting;
            if (left > 0 && !isWaiting) {
              el.style.display = 'block'; el.textContent = `終了まで${left}秒`;
              const warn = Math.max(0, Math.min(60, Math.round(Number(window.__overlayWarnSec||10))));
              if (left <= warn) { el.style.color = '#fca5a5'; el.style.textShadow = '0 0 6px #ef4444,0 0 12px #ef4444,0 0 18px #ef4444'; }
              else { el.style.color = '#fff'; el.style.textShadow = '0 0 8px #3b82f6,0 0 16px #3b82f6,0 0 24px #3b82f6'; }
              // cue for send button when in warning window and not yet sent
              const warnOn = (left <= warn) && !sentThisWindow;
              pulseSend(warnOn);
              const canShow = warnOn && !(sendBtn?.disabled);
              try { showSendArrow(canShow); } catch(_) {}
            } else {
              el.style.display = 'none';
              pulseSend(false);
              try { showSendArrow(false); } catch(_) {}
              if (left === 0 && !sentThisWindow) {
                showStartPrompt();
              }
            }
        if (msg && msg.type === 'config' && msg.data && Object.prototype.hasOwnProperty.call(msg.data,'clearMineAuthor')) {
          try {
            const aid = String(msg.data.clearMineAuthor||'');
            const ts = Number(msg.data.cmTs)||0; window.__lastClearMineTs = window.__lastClearMineTs||0;
            if (ts && ts > window.__lastClearMineTs) { window.__lastClearMineTs = ts; otherEngine?.clearAuthor?.(aid); composeOthers(); if (aid === AUTHOR_ID) { ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.restore(); } try { console.log('[sender(main)] WS config.clearMineAuthor', aid, ts); } catch(_) {} }
          } catch(_) {}
        }
          }
        if (msg && msg.type === 'config' && msg.data && Object.prototype.hasOwnProperty.call(msg.data,'preCountStart')) {
          try {
            const ts = Number(msg.data.preCountStart)||0;
            const nowT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            if (!(ts > __lastPreCountTs && nowT - __BOOT_AT > 1500)) { /* ignore stale/boot */ return; }
            __lastPreCountTs = ts;
            let pc = document.getElementById('senderPreCount');
            if (!pc) {
              pc = document.createElement('div'); pc.id = 'senderPreCount';
              pc.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;z-index:10000;pointer-events:none;';
              const inner = document.createElement('div'); inner.id='senderPreCountNum'; inner.style.cssText='font-size:160px;font-weight:900;color:#fff;text-shadow:0 0 14px #3b82f6,0 0 26px #3b82f6,0 0 40px #3b82f6;'; inner.textContent='3'; pc.appendChild(inner);
              document.body.appendChild(pc);
            }
            const num = document.getElementById('senderPreCountNum') || pc.firstChild;
            const preN = Math.max(0, Math.round(Number(window.__preCountSec||3)));
            let n=preN; pc.style.display='grid'; num.textContent=String(n||0);
            if (window.__senderPreTimer) { clearInterval(window.__senderPreTimer); window.__senderPreTimer=null; }
            window.__senderPreTimer = setInterval(()=>{ n-=1; if(n>0){ num.textContent=String(n);} else { clearInterval(window.__senderPreTimer); window.__senderPreTimer=null; pc.style.display='none'; } }, 1000);
          } catch(_) {}
        }
        if (msg && msg.type === 'config' && msg.data && Object.prototype.hasOwnProperty.call(msg.data,'overlayWarnSec')) {
          const v = Number(msg.data.overlayWarnSec); if (isFinite(v)) window.__overlayWarnSec = Math.max(0, Math.min(60, Math.round(v)));
        }
        if (msg && msg.type === 'config' && msg.data && Object.prototype.hasOwnProperty.call(msg.data,'preCountSec')) {
          const v = Number(msg.data.preCountSec); if (isFinite(v)) window.__preCountSec = Math.max(0, Math.min(10, Math.round(v)));
        }
        if (msg && msg.type === 'config' && msg.data && Object.prototype.hasOwnProperty.call(msg.data,'overlayWaiting')) {
          window.__overlayWaiting = !!msg.data.overlayWaiting;
          // start button pulse while waiting; reset send when back to waiting
          pulseStart(window.__overlayWaiting === true);
          showStartArrow(window.__overlayWaiting === true);
          if (window.__overlayWaiting) { sentThisWindow = false; pulseSend(false); try { showSendArrow(false); } catch(_) {} }
          const el = document.getElementById('senderCountdown'); if (el && window.__overlayWaiting) el.style.display = 'none';
        }
        // NOTE: overlayDescending is ignored for the tip. Tip is controlled only by overlayWaiting.
        if (msg && msg.type === 'config' && msg.data && Object.prototype.hasOwnProperty.call(msg.data,'overlayWaiting')) {
          try {
            let tip = document.getElementById('senderPressStart');
            if (!tip) { tip = document.createElement('div'); tip.id='senderPressStart'; tip.style.cssText='position:fixed;inset:0;display:none;place-items:center;z-index:10001;pointer-events:none;'; const t=document.createElement('div'); t.style.cssText='font-size:48px;font-weight:800;color:#ffffff;text-shadow:0 0 10px #3b82f6,0 0 22px #3b82f6,0 0 34px #3b82f6;'; t.textContent='開始を押してください'; tip.appendChild(t); document.body.appendChild(tip); }
            tip.style.display = msg.data.overlayWaiting ? 'grid' : 'none';
            if (msg.data.overlayWaiting) showStartArrow(true); else showStartArrow(false);
          } catch(_) {}
        }
        if (msg && msg.type === 'config' && msg.data && Object.prototype.hasOwnProperty.call(msg.data,'animKick')) {
          const ts = Number(msg.data.animKick)||0;
          window.__senderAnimKickTs = window.__senderAnimKickTs || 0;
          const bootAt = window.__senderBootAt || (window.__senderBootAt = (typeof performance!=='undefined'?performance.now():Date.now()));
          const nowT = (typeof performance!=='undefined'?performance.now():Date.now());
          if (ts > window.__senderAnimKickTs && nowT - bootAt > 1500) {
            window.__senderAnimKickTs = ts;
            try { console.log('[sender(main)] config.animKick accepted -> start local preview', ts); } catch(_) {}
            try { startLocalPreviewAnim(); } catch(_) {}
          } else {
            try { console.log('[sender(main)] config.animKick ignored', { ts, last: window.__senderAnimKickTs, bootDelta: Math.round(nowT-bootAt) }); } catch(_) {}
            // If ignored due to boot window, schedule a one-shot retry after the remaining time
            try {
              if ((nowT - bootAt) <= 1500 && !window.__senderAnimKickRetry) {
                const wait = 1550 - (nowT - bootAt);
                window.__senderAnimKickRetry = setTimeout(()=>{
                  window.__senderAnimKickRetry = null;
                  if ((window.__senderAnimKickTs||0) < ts && !window.__senderPreviewStarted) {
                    window.__senderAnimKickTs = ts; try { console.log('[sender(main)] animKick delayed accept after boot'); } catch(_) {}
                    try { startLocalPreviewAnim(); } catch(_) {}
                  }
                }, Math.max(100, wait));
              }
            } catch(_) {}
          }
        }
        if (msg && msg.type === 'config' && msg.data && msg.data.bgSender) {
          if (typeof msg.data.bgSender === 'string') {
            bgMode = 'white'; bgImage = null; composeOthers();
          } else if (msg.data.bgSender.mode === 'image' && msg.data.bgSender.url) {
            const img = new Image(); img.onload = () => { bgMode = 'image'; bgImage = img; composeOthers(); }; img.src = msg.data.bgSender.url;
          }
        }
        if (msg && msg.type === 'stroke') {
          // 他者のストロークのみ反映（自分はローカルで描画済み）
          if (msg.authorId && msg.authorId === AUTHOR_ID) { if (SDEBUG) slog('ws stroke (self) ignored', msg.id); return; }
          if (SDEBUG) slog('ws stroke from', msg.authorId||'unknown', msg.phase, msg.id);
          otherEngine?.handle?.(msg);
        }
        if (msg && msg.type === 'sendAnimation') {
          try { console.log('[sender(main)] WS sendAnimation received -> start local preview'); } catch(_) {}
          try { pulseSend(false); showSendArrow(false); } catch(_) {}
          try { startLocalPreviewAnim(); } catch(_) {}
        }
        if (msg && msg.type === 'clear') {
          // 背景は維持し、描画のみ消す
          selfLayer.ctx.clearRect(0,0,selfLayer.canvas.width,selfLayer.canvas.height);
          otherEngine?.clearAll?.();
          composeOthers();
          slog('clear all received');
        }
        if (msg && msg.type === 'clearMine') {
          otherEngine?.clearAuthor?.(String(msg.authorId)); composeOthers();
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

  // 画面に収まる最大サイズで A4 縦比率を維持してラップ要素の幅のみ制御
  // 高さは CSS の aspect-ratio で自動決定し、その実サイズからキャンバス解像度を設定
  function fitToViewport(preserve = false) {
    if (window.SenderShared?.layout?.fitToViewport) {
      window.SenderShared.layout.fitToViewport({ canvas, wrap, DPR, ratio: RATIO, preserve });
      // draw initial background if none
      if (!preserve) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      return;
    }
    const pad = 24; // 余白
    const toolbarH = (document.querySelector('.toolbar')?.offsetHeight || 60) + pad;
    const maxW = Math.max(300, window.innerWidth - pad * 2);
    let maxH = Math.max(300, window.innerHeight - toolbarH - pad);

    // 狭幅（1カラム）ではツール群の高さも差し引いて、キャンバスとボタンを同一画面に収める
    const isNarrow = window.matchMedia('(max-width: 900px)').matches;
    if (isNarrow) {
      const tools = document.querySelector('.side-tools');
      const hint = document.querySelector('.hint');
      const toolsH = (tools?.offsetHeight || 0);
      const hintH = (hint?.offsetHeight || 0);
      maxH = Math.max(200, maxH - toolsH - hintH - 8); // ちょい余白
    }

    // 収まる最大幅（高さ制限からも算出）
    const widthFromH = Math.round(maxH * RATIO);
    const targetW = Math.min(maxW, widthFromH);

    // ラップは幅のみ指定（高さは aspect-ratio で決まる）
    wrap.style.width = targetW + 'px';
    wrap.style.height = '';
    // キャンバス表示サイズは常にラップにフィット
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    // 狭幅のとき、ツール行の幅をキャンバス幅に合わせる（左端を揃える）
    try {
      const tools = document.querySelector('.side-tools');
      const narrow = window.matchMedia('(max-width: 900px)').matches;
      if (tools) tools.style.setProperty('--tools-width', narrow ? (targetW + 'px') : 'auto');
      if (tools && !narrow) tools.style.removeProperty('--tools-width');
    } catch(_) {}

    // 既存描画を保持する場合はオフスクリーンに退避してから再設定
    let prev = null;
    if (preserve && canvas.width && canvas.height) {
      prev = document.createElement('canvas');
      prev.width = canvas.width;
      prev.height = canvas.height;
      prev.getContext('2d').drawImage(canvas, 0, 0);
    }

    // 実際の描画解像度はラップの実サイズに基づき DPR を掛ける
    const rect = wrap.getBoundingClientRect();
    const pixelW = Math.floor(rect.width * DPR);
    const pixelH = Math.floor(rect.height * DPR);
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
    if (window.SenderShared?.pointer?.eventToCanvasXY) return window.SenderShared.pointer.eventToCanvasXY(canvas, e);
    // Fallback (legacy)
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX ?? (e.touches?.[0]?.clientX || 0));
    const cy = (e.clientY ?? (e.touches?.[0]?.clientY || 0));
    const nx = rect.width ? (cx - rect.left) / rect.width : 0;
    const ny = rect.height ? (cy - rect.top) / rect.height : 0;
    return { x: nx * canvas.width, y: ny * canvas.height };
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
      const effectiveCss = eraserActive ? (ERASER_SCALE * brushSizeCssPx) : brushSizeCssPx;
      const sizeN = effectiveCss / cssW; // キャンバス幅に対する相対太さ
      if (wsReady) {
        try { ws.send(JSON.stringify({ type: 'stroke', phase: 'start', id, nx, ny, color: brushColor, size: effectiveCss, sizeN, authorId: AUTHOR_ID, tool: (eraserActive?'eraser':'pen') })); } catch (_) {}
        slog('send start', { id, author: AUTHOR_ID, nx, ny, size: brushSizeCssPx, sizeN });
      } else {
        postStroke({ type: 'stroke', phase: 'start', id, nx, ny, color: brushColor, size: effectiveCss, sizeN, authorId: AUTHOR_ID, tool:(eraserActive?'eraser':'pen') });
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
    const tctx = selfCtx();
    setCompositeForTool(tctx, eraserActive); setStrokeStyle(tctx);
    if (n === 2) {
      tctx.beginPath();
      tctx.moveTo(points[0].x, points[0].y);
      tctx.lineTo(points[1].x, points[1].y);
      tctx.stroke();
    } else if (n >= 3) {
      const p0 = points[n - 3];
      const p1 = points[n - 2];
      const p2 = points[n - 1];
      const m1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const m2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      tctx.beginPath();
      tctx.moveTo(m1.x, m1.y);
      tctx.quadraticCurveTo(p1.x, p1.y, m2.x, m2.y);
      tctx.stroke();
    }

    lastX = x;
    lastY = y;
    // 描画中のフレーム送信は既定で無効（座標ストリームを優先）
    if (SEND_FRAMES_DURING_DRAW) maybeSendFrame();
    composeOthers();

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
      const tctx = selfCtx(); tctx.beginPath(); tctx.fillStyle = brushColor; setCompositeForTool(tctx, eraserActive);
      tctx.arc(points[0].x, points[0].y, ((eraserActive?ERASER_SCALE:1.0) * brushSizeCssPx * DPR) / 2, 0, Math.PI * 2); tctx.fill();
    } else if (n >= 3) {
      const p0 = points[n - 3]; const p1 = points[n - 2]; const p2 = points[n - 1];
      const mPrev = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const tctx = selfCtx(); setCompositeForTool(tctx, eraserActive);
      tctx.beginPath(); tctx.moveTo(mPrev.x, mPrev.y); tctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y); tctx.stroke();
    }
    points = [];

    // reset composite after erasing
    if (eraserActive) ctx.globalCompositeOperation = 'source-over';
    // reset composite after eraser
    selfLayer.ctx.globalCompositeOperation = 'source-over';
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

    // リサイズ保留があればここで反映（ペン入力中のサイズ変化で座標ズレを防ぐ）
    applyPendingResizeIfNeeded();
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
  if (sizeBtns.length === 1) {
    // 単一ボタンで thin -> normal -> thick をトグル
    const order = ['thin','normal','thick'];
    let idx = 1; // 初期はnormal見た目
    const btn = sizeBtns[0];
    const stroke = btn.querySelector('.stroke');
    function applyByKey(key){
      const val = Math.floor(SIZE_PRESETS[key] || brushSizeCssPx);
      brushSizeCssPx = val; ctx.lineWidth = brushSizeCssPx * DPR;
      if (sizeInput) sizeInput.value = String(brushSizeCssPx);
      // 見た目（stroke-* クラスを切替）
      if (stroke){ stroke.classList.remove('stroke-thin','stroke-normal','stroke-thick'); stroke.classList.add('stroke-' + key); }
    }
    btn.addEventListener('click', () => { idx = (idx + 1) % order.length; applyByKey(order[idx]); });
    applyByKey(order[idx]);
  } else {
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
  }
  colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const col = btn.getAttribute('data-color');
      if (!col) return;
      brushColor = col;
      ctx.strokeStyle = brushColor;
      if (colorInput) colorInput.value = brushColor;
      setActive(colorBtns, btn);
      // If eraser is active, turn it off on color change
      if (eraserActive) {
        eraserActive = false;
        try { eraserBtn?.classList.remove('is-active'); } catch(_) {}
      }
    });
  });

  // 全消去（白で塗りつぶし）
  clearBtn?.addEventListener('click', () => {
    // 自分のレイヤのみをクリアし、背景は維持
    selfLayer.ctx.clearRect(0,0,selfLayer.canvas.width,selfLayer.canvas.height);
    composeOthers();
    if (wsReady) {
      try { ws.send(JSON.stringify({ type: 'clear' })); } catch (_) {}
    } else if (httpFallback && SERVER_URL) {
      const httpBase = SERVER_URL.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://');
      fetch(`${httpBase.replace(/\/$/, '')}/clear?channel=${encodeURIComponent(CHANNEL)}`, { method: 'POST' }).catch(() => {});
    }
  });
  clearAllBtn?.addEventListener('click', () => clearBtn?.click() ?? (function(){
    // グローバル全消し（全員のキャンバス）
    selfLayer.ctx.clearRect(0,0,selfLayer.canvas.width,selfLayer.canvas.height);
    otherEngine?.clearAll?.();
    composeOthers();
    if (wsReady) {
      try { ws.send(JSON.stringify({ type: 'clear' })); } catch (_) {}
    } else if (httpFallback && SERVER_URL) {
      const httpBase = SERVER_URL.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://');
      fetch(`${httpBase.replace(/\/$/, '')}/clear?channel=${encodeURIComponent(CHANNEL)}`, { method: 'POST' }).catch(() => {});
    }
  })());

  // ---- Clear only my strokes (broadcast to all) ----
  clearMineBtn?.addEventListener('click', () => {
    try { console.log('[sender(main)] clearMine clicked'); } catch(_) {}
    try {
      // 1) locally clear my own layer (selfLayer) and re-compose
      selfLayer.ctx.clearRect(0,0,selfLayer.canvas.width,selfLayer.canvas.height);
      composeOthers();
      // 2) build payload
      const payload = { type:'clearMine', authorId: AUTHOR_ID };
      // 3) try WS send
      let wsSent = false;
      try {
        if (wsReady) { ws.send(JSON.stringify(payload)); wsSent = true; try { console.log('[sender(main)] clearMine sent via WS'); } catch(_) {} }
      } catch (e) { try { console.warn('[sender(main)] clearMine WS send error', e?.message||e); } catch(_) {} }
      // 4) always attempt HTTP as well (at-least-once delivery)
      try {
        if (SERVER_URL) { httpPost('/clearMine', { authorId: AUTHOR_ID }); try { console.log('[sender(main)] clearMine POST /clearMine'); } catch(_) {} }
        else { try { console.warn('[sender(main)] SERVER_URL not set; cannot broadcast clearMine'); } catch(_) {} }
      } catch (e) { try { console.warn('[sender(main)] clearMine HTTP send error', e?.message||e); } catch(_) {} }
      // 5) Also broadcast via config as compatibility fallback
      try {
        const kick = { type: 'config', data: { clearMineAuthor: AUTHOR_ID, cmTs: Date.now() } };
        if (wsReady) { try { ws.send(JSON.stringify(kick)); console.log('[sender(main)] clearMine config WS'); } catch(_) {} }
        else if (SERVER_URL) { httpPost('/config', kick); try { console.log('[sender(main)] clearMine config POST'); } catch(_) {} }
      } catch(_) {}
    } catch(_) {}
  });

  // ---- Send animation trigger (broadcast to receivers) ----
  sendBtn?.addEventListener('click', () => {
    try { console.log('[sender(main)] send button clicked'); } catch(_) {}
    sentThisWindow = true; pulseSend(false); try { showSendArrow(false); } catch(_) {}
    setTimeout(()=>{ try{ startLocalPreviewAnim(); } catch(_){} }, 400);
    if (wsReady) {
      try { console.log('[sender(main)] sending sendAnimation via WS'); ws.send(JSON.stringify({ type: 'sendAnimation' })); } catch (_) {}
    } else if (httpFallback && SERVER_URL) {
      const httpBase = SERVER_URL.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://');
      try { console.log('[sender(main)] sending sendAnimation via HTTP fallback'); } catch(_) {}
      fetch(`${httpBase.replace(/\/$/, '')}/anim?channel=${encodeURIComponent(CHANNEL)}`, { method: 'POST' }).catch(() => {});
    }
    // Also send as config (for older server compatibility)
    try {
      const data = { type:'config', data:{ animKick: Date.now() } };
      if (wsReady) { try { console.log('[sender(main)] sending animKick via WS'); } catch(_) {}; ws.send(JSON.stringify(data)); }
      else if (httpFallback && SERVER_URL) {
        const httpBase = SERVER_URL.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://');
        try { console.log('[sender(main)] sending animKick via HTTP fallback'); } catch(_) {}
        fetch(`${httpBase.replace(/\/$/, '')}/config?channel=${encodeURIComponent(CHANNEL)}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data: data.data }) }).catch(()=>{});
      }
    } catch(_) {}
  });

  // ---- Overlay start trigger (for overlay window) ----
  overlayStartBtn?.addEventListener('click', () => {
    try { console.log('[sender(main)] overlay start button clicked'); } catch(_) {}
    pulseStart(false); showStartArrow(false); sentThisWindow = false; // entering session
    if (wsReady) {
      try { console.log('[sender(main)] sending overlayStart via WS'); ws.send(JSON.stringify({ type: 'overlayStart' })); } catch (_) {}
      // 互換性のため config でもキックを送る
      try { ws.send(JSON.stringify({ type:'config', data:{ overlayKick: Date.now() } })); } catch(_) {}
    } else if (httpFallback && SERVER_URL) {
      const httpBase = SERVER_URL.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://');
      try { console.log('[sender(main)] sending overlayStart via HTTP fallback'); } catch(_) {}
      fetch(`${httpBase.replace(/\/$/, '')}/overlay?channel=${encodeURIComponent(CHANNEL)}`, { method: 'POST' }).catch(() => {});
      // config経由のフォールバック
      fetch(`${httpBase.replace(/\/$/, '')}/config?channel=${encodeURIComponent(CHANNEL)}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data: { overlayKick: Date.now() } }) }).catch(()=>{});
    }
  });

  // Ensure the start tip is visible on reload while waiting
  try {
    if (window.__overlayWaiting) {
      let tip = document.getElementById('senderPressStart');
      if (!tip) {
        tip = document.createElement('div'); tip.id='senderPressStart';
        tip.style.cssText='position:fixed;inset:0;display:none;place-items:center;z-index:10001;pointer-events:none;';
        const t=document.createElement('div'); t.style.cssText='font-size:48px;font-weight:800;color:#ffffff;text-shadow:0 0 10px #3b82f6,0 0 22px #3b82f6,0 0 34px #3b82f6;'; t.textContent='開始を押してください';
        tip.appendChild(t); document.body.appendChild(tip);
      }
      tip.style.display = 'grid';
      pulseStart(true); showStartArrow(true);
      const el = document.getElementById('senderCountdown'); if (el) el.style.display = 'none';
    }
  } catch(_) {}

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
  resizeOtherLayers(); composeOthers();
  let resizePending = false;
  window.addEventListener('resize', () => {
    if (isDrawing) { resizePending = true; return; }
    fitToViewport(true); resizeOtherLayers(); composeOthers();
  });
  // 描画終了時に保留リサイズを反映
  function applyPendingResizeIfNeeded(){
    if (!resizePending) return; resizePending = false;
    fitToViewport(true); resizeOtherLayers(); composeOthers();
  }
})();
