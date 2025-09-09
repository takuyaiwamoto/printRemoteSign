import { Transport } from './transport.js';
import { CanvasManager } from './canvas.js';
import { wireUI } from './ui.js';

// ---- Version ----
const SHARED_CONST = (window.SenderShared && window.SenderShared.constants) || null;
const SENDER_VERSION = SHARED_CONST?.VERSION || '0.9.0';
try { const v = document.getElementById('sender-version'); if (v) v.textContent = `v${SENDER_VERSION}`; } catch { }

// ---- Params ----
const qs = new URLSearchParams(location.search);
const SERVER_URL = (qs.get('server') || (window.SERVER_URL || '')).trim();
const CHANNEL = (qs.get('channel') || (window.CHANNEL || 'default')).trim();
// Hide countdown at boot until receiver clears waiting flag
window.__overlayWaiting = true;

// ---- Canvas setup ----
const canvasEl = document.getElementById('paint');
const othersEl = document.getElementById('others');
const cm = new CanvasManager(canvasEl);
cm.fitToViewport(false);

// Other strokes engine draws into `othersEl` if present (overlay)
const otherEngine = (window.SenderShared?.otherStrokes?.create?.({ canvas: (othersEl || cm.canvas), dpr: cm.DPR, bufferMs: 200 }) || null);
function resizeLayers(){ try { if (othersEl) { othersEl.width = canvasEl.width; othersEl.height = canvasEl.height; } otherEngine?.resizeToCanvas?.(); } catch(_) {} }
resizeLayers();
window.addEventListener('resize', () => cm.fitToViewport(true));

function compositeOthers(){
  if (othersEl){ const k = othersEl.getContext('2d'); if (!k) return; k.save(); k.setTransform(1,0,0,1,0,0); k.clearRect(0,0,othersEl.width, othersEl.height); otherEngine?.compositeTo?.(k); k.restore(); }
  else { const k = cm.ctx; k.save(); k.setTransform(1,0,0,1,0,0); otherEngine?.compositeTo?.(k); k.restore(); }
}
otherEngine?.startRAF?.(); (function raf(){ try { compositeOthers(); } catch(_) {} requestAnimationFrame(raf); })();

// ---- Networking ----
const transport = new Transport(SERVER_URL, CHANNEL, { sendIntervalMs: 150 });
transport.connect();
const AUTHOR_ID = Math.random().toString(36).slice(2, 10);

const __BOOT_AT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
let __lastPreCountTs = 0;

// --- UI elements for cues ---
const __sendBtn = (()=>{ try { return document.getElementById('btn-send'); } catch(_) { return null; } })();
const __startBtn = (()=>{ try { return document.getElementById('btn-overlay-start'); } catch(_) { return null; } })();
function pulseStart(on){ try { __startBtn?.classList.toggle('btn-pulse-blue', !!on); } catch(_) {} }
function pulseSend(on){ try { __sendBtn?.classList.toggle('btn-pulse-red', !!on); } catch(_) {} }
window.__sentThisWindow = false;
// Arrow cue handling
function positionStartArrow(){
  try {
    const el = document.getElementById('startArrowCue'); if (!el) return;
    const btn = __startBtn; if (!btn) return;
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
        el = document.createElement('div'); el.id = 'startArrowCue'; el.className = 'arrow-cue is-anim';
        const inner = document.createElement('div'); inner.className = 'arrow-cue-inner'; inner.textContent = '↓';
        el.appendChild(inner);
        document.body.appendChild(el);
      } else if (!el.querySelector('.arrow-cue-inner')) {
        const inner = document.createElement('div'); inner.className = 'arrow-cue-inner'; inner.textContent = '↓'; el.appendChild(inner);
      }
      el.style.display = 'block'; positionStartArrow();
      window.addEventListener('resize', positionStartArrow);
      window.addEventListener('scroll', positionStartArrow, { passive: true });
      setTimeout(positionStartArrow, 0);
    } else {
      if (el) el.style.display = 'none';
      window.removeEventListener('resize', positionStartArrow);
      window.removeEventListener('scroll', positionStartArrow);
    }
  } catch(_) {}
}
function showStartPrompt(){
  try {
    let tip = document.getElementById('senderPressStart');
    if (!tip) { tip = document.createElement('div'); tip.id='senderPressStart'; tip.style.cssText='position:fixed;inset:0;display:none;place-items:center;z-index:10001;pointer-events:none;'; const t=document.createElement('div'); t.style.cssText='font-size:48px;font-weight:800;color:#ffffff;text-shadow:0 0 10px #3b82f6,0 0 22px #3b82f6,0 0 34px #3b82f6;'; t.textContent='開始を押してください'; tip.appendChild(t); document.body.appendChild(tip); }
    tip.style.display = 'grid';
    pulseStart(true);
  } catch(_) {}
}

// ---- Send button arrow (red) ----
function positionSendArrow(){
  try {
    const el = document.getElementById('sendArrowCue'); if (!el) return;
    const btn = __sendBtn; if (!btn) return;
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
        el = document.createElement('div'); el.id = 'sendArrowCue'; el.className = 'arrow-cue arrow-cue-red is-anim';
        const inner = document.createElement('div'); inner.className = 'arrow-cue-inner'; inner.textContent = '↓';
        el.appendChild(inner); document.body.appendChild(el);
      } else if (!el.querySelector('.arrow-cue-inner')) {
        const inner = document.createElement('div'); inner.className = 'arrow-cue-inner'; inner.textContent = '↓'; el.appendChild(inner);
      }
      el.style.display = 'block'; positionSendArrow();
      window.addEventListener('resize', positionSendArrow);
      window.addEventListener('scroll', positionSendArrow, { passive: true });
      setTimeout(positionSendArrow, 0);
    } else {
      if (el) el.style.display = 'none';
      window.removeEventListener('resize', positionSendArrow);
      window.removeEventListener('scroll', positionSendArrow);
    }
  } catch(_) {}
}

transport.onmessage = (msg) => {
  if (msg.type === 'config' && msg.data) {
    // cache anim settings for preview (follow receiver)
    try {
      if (typeof msg.data.animType === 'string') {
        window.__senderAnimType = (String(msg.data.animType).toUpperCase()==='A') ? 'A' : 'B';
      }
      if (msg.data.animReceiver && typeof msg.data.animReceiver === 'object') {
        const x = Number(msg.data.animReceiver.rotateDelaySec);
        const z = Number(msg.data.animReceiver.moveDelaySec);
        if (isFinite(x)) window.__senderAnimDelayRotate = Math.max(0, Math.min(10, Math.round(x)));
        if (isFinite(z)) window.__senderAnimDelayMove = Math.max(0, Math.min(10, Math.round(z)));
      }
    } catch(_) {}
    // Background
    if (msg.data.bgSender) {
      if (typeof msg.data.bgSender === 'string') { cm.setBackgroundWhite(); }
      else if (msg.data.bgSender.mode === 'image' && msg.data.bgSender.url) { cm.setBackgroundImage(msg.data.bgSender.url); }
    }
    // preCount start (guard boot/stale)
    if (Object.prototype.hasOwnProperty.call(msg.data, 'preCountStart')) {
      const ts = Number(msg.data.preCountStart)||0; const nowT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (ts > __lastPreCountTs && nowT - __BOOT_AT > 1500) {
        __lastPreCountTs = ts;
        let pc = document.getElementById('senderPreCount');
        if (!pc) { pc = document.createElement('div'); pc.id='senderPreCount'; pc.style.cssText='position:fixed;inset:0;display:grid;place-items:center;z-index:10000;pointer-events:none;'; const inner=document.createElement('div'); inner.id='senderPreCountNum'; inner.style.cssText='font-size:160px;font-weight:900;color:#fff;text-shadow:0 0 14px #3b82f6,0 0 26px #3b82f6,0 0 40px #3b82f6;'; inner.textContent='3'; pc.appendChild(inner); document.body.appendChild(pc); }
        const num = document.getElementById('senderPreCountNum') || pc.firstChild;
        let n = Math.max(0, Math.round(Number(window.__preCountSec||3))); pc.style.display='grid'; num.textContent=String(n||0);
        if (window.__senderPreTimer) { clearInterval(window.__senderPreTimer); window.__senderPreTimer = null; }
        window.__senderPreTimer = setInterval(()=>{ n -= 1; if (n > 0) num.textContent = String(n); else { clearInterval(window.__senderPreTimer); window.__senderPreTimer = null; pc.style.display='none'; }}, 1000);
      }
    }
    // waiting tip + flag
    if (Object.prototype.hasOwnProperty.call(msg.data, 'overlayWaiting')) {
      window.__overlayWaiting = !!msg.data.overlayWaiting;
      // Start button pulse while waiting
      pulseStart(window.__overlayWaiting === true);
      showStartArrow(window.__overlayWaiting === true);
      if (window.__overlayWaiting) { window.__sentThisWindow = false; pulseSend(false); try { const el = document.getElementById('sendArrowCue'); if (el) el.style.display='none'; } catch(_) {} }
      let tip = document.getElementById('senderPressStart');
      if (!tip) { tip = document.createElement('div'); tip.id='senderPressStart'; tip.style.cssText='position:fixed;inset:0;display:none;place-items:center;z-index:10001;pointer-events:none;'; const t=document.createElement('div'); t.style.cssText='font-size:48px;font-weight:800;color:#ffffff;text-shadow:0 0 10px #3b82f6,0 0 22px #3b82f6,0 0 34px #3b82f6;'; t.textContent='開始を押してください'; tip.appendChild(t); document.body.appendChild(tip); }
      tip.style.display = window.__overlayWaiting ? 'grid' : 'none';
      const cd = document.getElementById('senderCountdown'); if (cd && window.__overlayWaiting) cd.style.display='none';
    }
    if (typeof msg.data.overlayWarnSec !== 'undefined') { const v = Number(msg.data.overlayWarnSec); if (isFinite(v)) window.__overlayWarnSec = Math.max(0, Math.min(60, Math.round(v))); }
    if (typeof msg.data.preCountSec !== 'undefined') { const v = Number(msg.data.preCountSec); if (isFinite(v)) window.__preCountSec = Math.max(0, Math.min(10, Math.round(v))); }
    // remain countdown (show only when not waiting)
    if (typeof msg.data.overlayRemainSec !== 'undefined') {
      const left = Math.max(0, Math.floor(Number(msg.data.overlayRemainSec)||0));
      let el = document.getElementById('senderCountdown');
      if (!el) { el = document.createElement('div'); el.id='senderCountdown'; el.style.cssText='position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9999;font-size:44px;color:#fff;text-shadow:0 0 8px #3b82f6,0 0 16px #3b82f6,0 0 24px #3b82f6;pointer-events:none;'; el.textContent='終了まで0秒'; document.body.appendChild(el); }
      if (left > 0 && !window.__overlayWaiting) {
        el.style.display='block'; el.textContent=`終了まで${left}秒`;
        const warn = Math.max(0, Math.min(60, Math.round(Number(window.__overlayWarnSec||10))));
        if (left <= warn) { el.style.color='#fca5a5'; el.style.textShadow='0 0 10px #ef4444,0 0 22px #ef4444,0 0 34px #ef4444'; }
        else { el.style.color='#fff'; el.style.textShadow='0 0 8px #3b82f6,0 0 16px #3b82f6,0 0 24px #3b82f6'; }
        // Send button pulse when in warn window and not yet sent
        const warnOn = (left <= Math.max(0, Math.min(60, Math.round(Number(window.__overlayWarnSec||10))))) && !window.__sentThisWindow;
        pulseSend(warnOn);
        // Also show a red arrow pointing at the send button
        const canShow = warnOn && !(__sendBtn?.disabled);
        try { showSendArrow(canShow); } catch(_) {}
      } else {
        // countdown ended or waiting state: hide and reset cues
        el.style.display='none';
        pulseSend(false); try { showSendArrow(false); } catch(_) {}
        if (left === 0 && !window.__sentThisWindow) {
          // Encourage to press start again immediately
          showStartPrompt(); showStartArrow(true);
      }
    }
  }
  }
  // Local preview animation sync with receiver
  if (msg.type === 'sendAnimation') {
    try { startLocalPreviewAnim(); } catch(_) {}
  }
  // strokes from others
  if (msg.type === 'stroke') { if (msg.authorId && msg.authorId === AUTHOR_ID) return; otherEngine?.handle?.(msg); }
  if (msg.type === 'clear') { try { cm.clear(); } catch(_) {} otherEngine?.clearAll?.(); compositeOthers(); }
  if (msg.type === 'clearMine') { const { authorId } = msg; otherEngine?.clearAuthor?.(authorId); compositeOthers(); }
};

// ---- SSE fallback (clear only; strokesはWSで十分だが環境次第で拡張可能) ----
(() => {
  if (!SERVER_URL) return; const toHttp = (u)=> u.replace(/^wss?:\/\//i, (m)=> m.toLowerCase()==='wss://'?'https://':'http://').replace(/\/$/,'');
  try { const es = new EventSource(`${toHttp(SERVER_URL)}/events?channel=${encodeURIComponent(CHANNEL)}`); es.addEventListener('clear', ()=>{ try { cm.clear(); } catch(_) {} otherEngine?.clearAll?.(); compositeOthers(); }); } catch(_) {}
})();

// ---- Outgoing strokes ----
let realtimeEverUsed = false;
cm.onStrokeStart = ({ id, nx, ny, color, size, sizeN, tool }) => { if (SERVER_URL) { transport.sendStroke({ type:'stroke', phase:'start', id, nx, ny, color, size, sizeN, tool:(tool||'pen'), authorId: AUTHOR_ID }); realtimeEverUsed = true; } };
let postQueue = []; let postTimer = null;
function flushBatch(){ if (!postQueue.length){ if (postTimer){ clearTimeout(postTimer); postTimer=null;} return;} const batch = postQueue; postQueue = []; transport.sendStrokeBatch(batch); if (postTimer){ clearTimeout(postTimer); postTimer=null; } }
cm.onStrokePoint = ({ id, nx, ny, tool }) => { if (!SERVER_URL) return; transport.wsReady ? transport.sendStroke({ type:'stroke', phase:'point', id, nx, ny, tool:(tool||'pen'), authorId: AUTHOR_ID }) : (postQueue.push({ type:'stroke', phase:'point', id, nx, ny, tool:(tool||'pen'), authorId: AUTHOR_ID }), postTimer ??= setTimeout(flushBatch, 40)); };
cm.onStrokeEnd = ({ id, tool }) => { if (!SERVER_URL) return; flushBatch(); transport.sendStroke({ type:'stroke', phase:'end', id, tool:(tool||'pen'), authorId: AUTHOR_ID }); if (!realtimeEverUsed) transport.sendFrameNow(canvasEl.toDataURL('image/png')); };

// ---- UI wiring ----
wireUI({ canvasManager: cm, transport, authorId: AUTHOR_ID, onResize: resizeLayers });
// Hook into send/start buttons to clear pulses on click
try { __sendBtn?.addEventListener('click', () => { window.__sentThisWindow = true; pulseSend(false); try { showSendArrow(false); } catch(_) {} setTimeout(()=>{ try{ startLocalPreviewAnim(); } catch(_){} }, 400); }); } catch(_) {}
try { __startBtn?.addEventListener('click', () => { pulseStart(false); showStartArrow(false); window.__sentThisWindow = false; }); } catch(_) {}

// Ensure the start tip is visible immediately after page reload if waiting
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
    pulseStart(true); showStartArrow(true); try { showSendArrow(false); } catch(_) {}
    const cd = document.getElementById('senderCountdown'); if (cd) cd.style.display='none';
  }
} catch(_) {}

// ---- Local preview overlay (video + current drawing), synchronized by sendAnimation ----
function startLocalPreviewAnim(){
  if (window.__senderPreviewStarted) return; window.__senderPreviewStarted = true;
  // Build overlay elements
  const wrapEl = document.getElementById('canvas-wrap') || cm.wrap || canvasEl.parentElement;
  if (!wrapEl) return;
  let overlay = document.getElementById('senderAnimOverlay');
  if (!overlay) {
    overlay = document.createElement('div'); overlay.id='senderAnimOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10050;display:block;pointer-events:auto;background:transparent;';
    document.body.appendChild(overlay);
  }
  // box clipped to canvas rect
  let box = document.getElementById('senderAnimBox');
  if (!box) { box = document.createElement('div'); box.id='senderAnimBox'; overlay.appendChild(box); }
  box.style.cssText = 'position:absolute;overflow:hidden;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.35);background:#000;';
  const r = wrapEl.getBoundingClientRect();
  box.style.left = Math.round(r.left) + 'px';
  box.style.top = Math.round(r.top) + 'px';
  box.style.width = Math.round(r.width) + 'px';
  box.style.height = Math.round(r.height) + 'px';
  // inner moves/rotates; fill with video + snapshot
  let inner = document.getElementById('senderAnimInner');
  if (!inner) { inner = document.createElement('div'); inner.id='senderAnimInner'; box.appendChild(inner); }
  inner.style.cssText = 'position:absolute;inset:0;transform-origin:center center;';
  // Build video element for animType=B only (no audio)
  let vid = document.getElementById('senderAnimVideo');
  const animType = (window.__senderAnimType === 'A') ? 'A' : 'B';
  if (animType === 'B') {
    if (!vid) { vid = document.createElement('video'); vid.id='senderAnimVideo'; inner.appendChild(vid); }
    vid.muted = true; vid.playsInline = true; vid.preload = 'auto'; vid.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
  } else { try { if (vid) vid.remove(); } catch(_) {} vid = null; }
  // Ink-only snapshot (self + others) — fade like receiver
  const inkSnap = document.createElement('canvas'); inkSnap.width = canvasEl.width; inkSnap.height = canvasEl.height;
  const g = inkSnap.getContext('2d');
  try { g.drawImage(cm ? cm.canvas : canvasEl, 0, 0); } catch(_) {} // self layer isn't directly exposed; fallback to canvas content
  // Prefer others overlay if available
  try {
    if (othersEl && othersEl.width>0) g.drawImage(othersEl, 0, 0);
    else otherEngine?.compositeTo?.(g);
  } catch(_) {}
  let inkImg = document.getElementById('senderAnimInk');
  if (!inkImg) { inkImg = document.createElement('canvas'); inkImg.id='senderAnimInk'; inner.appendChild(inkImg); }
  inkImg.width = inkSnap.width; inkImg.height = inkSnap.height;
  const sg = inkImg.getContext('2d'); sg.clearRect(0,0,inkImg.width,inkImg.height); sg.drawImage(inkSnap,0,0);
  inkImg.style.cssText='position:absolute;inset:0;width:100%;height:100%;opacity:1;transition:opacity 0ms linear;';
  // Clear local canvas before move (do not broadcast)
  try { cm.clear(); } catch(_) {}
  try { otherEngine?.clearAll?.(); compositeOthers(); } catch(_) {}
  // Disable local inputs while animating
  overlay.addEventListener('pointerdown', (e)=> e.preventDefault(), { once: false });
  // Load candidate video (same as receiver) if B
  if (animType === 'B') {
    const candidates = [
      'electron-receiver/assets/backVideo1.mp4', '../electron-receiver/assets/backVideo1.mp4',
      'assets/backVideo1.mp4', '../assets/backVideo1.mp4', 'backVideo1.mp4', '../backVideo1.mp4',
      (window.ASSET_BASE ? (window.ASSET_BASE.replace(/\/$/,'') + '/assets/backVideo1.mp4') : '')
    ].filter(Boolean);
    (async () => {
      let ok = false;
      for (const url of candidates) {
        try {
          await new Promise((res,rej)=>{ const onOk=()=>{ cleanup(); res(); }; const onErr=()=>{ cleanup(); rej(new Error('e')); }; function cleanup(){ vid.removeEventListener('loadedmetadata', onOk); vid.removeEventListener('error', onErr);} vid.addEventListener('loadedmetadata', onOk, { once:true }); vid.addEventListener('error', onErr, { once:true }); vid.src=url; vid.load(); });
          ok = true; break;
        } catch(_) { /* try next */ }
      }
      try { if (ok) await vid.play().catch(()=>{}); } catch(_) {}
    })();
  }

  // Schedule following receiver timings
  const rotateDur = 1000, moveDur = 1500;
  const rotateDelay = Math.max(0, Math.min(10, Number(window.__senderAnimDelayRotate||0))) * 1000;
  const moveDelay = Math.max(0, Math.min(10, Number(window.__senderAnimDelayMove||0))) * 1000;

  setTimeout(()=>{
    // Sender side: do not rotate visually; just align timing
    inner.style.transform = 'translateY(0)';
    inner.style.transition = `transform ${rotateDur}ms ease`;

    if (animType === 'B') {
      // fade-out ink for 2s, then fade-in at earliest of video end or 10s
      try { inkImg.style.transition = 'opacity 2000ms linear'; inkImg.style.opacity = '0'; } catch(_) {}
      let videoEnded = false; if (vid) { try { vid.onended = ()=>{ videoEnded = true; }; } catch(_) {} }
      const startedAt = performance.now();
      const fadeIn = () => { try { inkImg.style.transition = 'opacity 400ms ease'; inkImg.style.opacity = '1'; } catch(_) {} };
      const poll = setInterval(()=>{
        const t = performance.now();
        if ((videoEnded) || (vid && vid.currentTime >= 10) || (!vid && (t - startedAt >= 10000))) {
          clearInterval(poll); fadeIn();
          setTimeout(()=> startMove(), moveDelay);
        }
      }, 100);
    } else {
      // A: move after rotateDur + moveDelay (no rotation)
      setTimeout(()=> startMove(), rotateDur + moveDelay);
    }
  }, rotateDelay);

  function startMove(){
    inner.style.transition = `transform ${moveDur}ms ease`;
    inner.style.transform = 'translateY(120%)';
    setTimeout(()=>{ try { overlay.remove(); } catch(_) {} window.__senderPreviewStarted = false; }, moveDur + 30);
  }
}
