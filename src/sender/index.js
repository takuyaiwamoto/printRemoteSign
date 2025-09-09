import { Transport } from './transport.js';
import { CanvasManager } from './canvas.js';
import { wireUI } from './ui.js';

// ---- Version ----
const SHARED_CONST = (window.SenderShared && window.SenderShared.constants) || null;
const SENDER_VERSION = SHARED_CONST?.VERSION || '0.9.4';
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
try { console.log('[sender(esm)] canvas size', { w: canvasEl.width, h: canvasEl.height }); } catch(_) {}

// Other strokes engine draws into `othersEl` if present (overlay)
const otherEngine = (window.SenderShared?.otherStrokes?.create?.({ canvas: (othersEl || cm.canvas), dpr: cm.DPR, bufferMs: 200 }) || null);
try { console.log('[sender(esm)] otherEngine', otherEngine ? 'ready' : 'missing'); } catch(_) {}
function resizeLayers(){
  try {
    if (othersEl) { othersEl.width = canvasEl.width; othersEl.height = canvasEl.height; }
    otherEngine?.resizeToCanvas?.();
    try { console.log('[sender(esm)] resizeLayers', { w: canvasEl.width, h: canvasEl.height, ow: othersEl?.width, oh: othersEl?.height }); } catch(_) {}
  } catch(_) {}
}
resizeLayers();
window.addEventListener('resize', () => cm.fitToViewport(true));

function compositeOthers(){
  if (othersEl){ const k = othersEl.getContext('2d'); if (!k) return; k.save(); k.setTransform(1,0,0,1,0,0); k.clearRect(0,0,othersEl.width, othersEl.height); otherEngine?.compositeTo?.(k); k.restore(); }
  else { const k = cm.ctx; k.save(); k.setTransform(1,0,0,1,0,0); otherEngine?.compositeTo?.(k); k.restore(); }
}
otherEngine?.startRAF?.();
(function raf(){
  try { compositeOthers(); } catch(_) {}
  // stats log every ~30 frames
  try {
    window.__composeTick = (window.__composeTick||0)+1;
    if ((window.__composeTick % 30) === 0) {
      const st = otherEngine?.getStats?.();
      if (st) console.log('[sender(esm)] compose frame', st);
    }
  } catch(_) {}
  requestAnimationFrame(raf);
})();

// ---- Networking ----
const transport = new Transport(SERVER_URL, CHANNEL, { sendIntervalMs: 150 });
try { console.log('[sender(esm)] boot', { server: SERVER_URL, channel: CHANNEL }); } catch(_) {}
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
  try { if (msg && msg.type) console.log('[sender(esm)] WS message', msg.type); } catch(_) {}
  if (msg.type === 'config' && msg.data) {
    // cache overlayStaySec for sender preview timing
    if (typeof msg.data.overlayStaySec !== 'undefined') {
      const s = Number(msg.data.overlayStaySec); if (isFinite(s)) window.__senderOverlayStaySec = Math.max(0, Math.min(120, Math.round(s)));
    }
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
    try { console.log('[sender(esm)] WS sendAnimation received -> start local preview'); } catch(_) {}
    try { startLocalPreviewAnim(); } catch(_) {}
  }
  // strokes from others
  if (msg.type === 'stroke') {
    if (msg.authorId && msg.authorId === AUTHOR_ID) return; 
    try { if (msg.phase === 'start' || msg.phase === 'end') console.log('[sender(esm)] WS stroke', msg.phase, { id: msg.id, author: msg.authorId }); } catch(_) {}
    otherEngine?.handle?.(msg);
  }
  if (msg.type === 'clear') { try { cm.clear(); } catch(_) {} otherEngine?.clearAll?.(); compositeOthers(); }
  if (msg.type === 'clearMine') { const { authorId } = msg; otherEngine?.clearAuthor?.(authorId); compositeOthers(); }
};

// ---- SSE fallback (clear only; strokesはWSで十分だが環境次第で拡張可能) ----
(() => {
  if (!SERVER_URL) return; const toHttp = (u)=> u.replace(/^wss?:\/\//i, (m)=> m.toLowerCase()==='wss://'?'https://':'http://').replace(/\/$/,'');
  try {
    const esUrl = `${toHttp(SERVER_URL)}/events?channel=${encodeURIComponent(CHANNEL)}`;
    try { console.log('[sender(esm)] SSE connect', esUrl); } catch(_) {}
    const es = new EventSource(esUrl);
    es.onopen = () => { try { console.log('[sender(esm)] SSE open'); } catch(_) {} };
    es.onerror = (e) => { try { console.warn('[sender(esm)] SSE error', e); } catch(_) {} };
    es.addEventListener('clear', ()=>{ try { cm.clear(); } catch(_) {} otherEngine?.clearAll?.(); compositeOthers(); });
    es.addEventListener('stroke', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (!msg || msg.type !== 'stroke') return;
        if (msg.authorId && msg.authorId === AUTHOR_ID) return;
        try {
          if (msg.phase==='start' || msg.phase==='end') console.log('[sender(esm)] SSE stroke', msg.phase, { id: msg.id, author: msg.authorId });
          else if (msg.phase==='point') {
            window.__dbgPointC2 = (window.__dbgPointC2||0)+1; if ((window.__dbgPointC2 % 25)===0) console.log('[sender(esm)] SSE stroke point');
          }
        } catch(_) {}
        otherEngine?.handle?.(msg);
      } catch(_) {}
    });
    es.addEventListener('config', (ev)=>{
      try { const j = JSON.parse(ev.data); if (j && j.data && Object.prototype.hasOwnProperty.call(j.data,'animKick')) {
        const ts = Number(j.data.animKick)||0; const last = (window.__senderAnimKickTs||0);
        const bootAt = window.__senderBootAt || (window.__senderBootAt = (typeof performance!=='undefined'?performance.now():Date.now()));
        const nowT = (typeof performance!=='undefined'?performance.now():Date.now());
        if (ts > last && nowT - bootAt > 1500) { window.__senderAnimKickTs = ts; try { console.log('[sender(esm)] SSE animKick accepted -> start local preview', ts); } catch(_) {} try { startLocalPreviewAnim(); } catch(_) {} }
      } } catch(_) {}
    });
    es.addEventListener('sendAnimation', ()=>{ try { console.log('[sender(esm)] SSE sendAnimation -> start local preview'); } catch(_) {} try { startLocalPreviewAnim(); } catch(_) {} });
  } catch(_) {}
})();

// ---- Extra WS listener with receiver role (for legacy servers that only broadcast to receivers) ----
(() => {
  if (!SERVER_URL) return;
  const toWs = (u)=> u.replace(/^http/i, 'ws').replace(/\/$/,'');
  let wsListen = null; let timer = null;
  function open(){
    const url = `${toWs(SERVER_URL)}/ws?channel=${encodeURIComponent(CHANNEL)}&role=receiver`;
    try { wsListen = new WebSocket(url); } catch (e) { try { console.warn('[sender(esm)] listenWS construct error', e?.message||e); } catch(_) {} schedule(); return; }
    wsListen.onopen = ()=>{ try { console.log('[sender(esm)] listenWS open', url); } catch(_) {} };
    wsListen.onerror = (e)=>{ try { console.warn('[sender(esm)] listenWS error', e); } catch(_) {} };
    wsListen.onclose = ()=>{ try { console.warn('[sender(esm)] listenWS close, retry'); } catch(_) {} schedule(); };
    wsListen.onmessage = (ev)=>{
      let msg=null; try { msg = JSON.parse(typeof ev.data==='string'?ev.data:'null'); } catch(_) {}
      if (!msg || !msg.type) return;
      try { console.log('[sender(esm)] listenWS message', msg.type); } catch(_) {}
      if (msg.type === 'stroke') { if (msg.authorId && msg.authorId === AUTHOR_ID) return; try { if (msg.phase==='start'||msg.phase==='end') console.log('[sender(esm)] listenWS stroke', msg.phase, {id:msg.id, author:msg.authorId}); } catch(_) {} otherEngine?.handle?.(msg); return; }
      if (msg.type === 'clear') { try { cm.clear(); } catch(_) {} otherEngine?.clearAll?.(); compositeOthers(); return; }
      if (msg.type === 'clearMine') { const { authorId } = msg; otherEngine?.clearAuthor?.(authorId); compositeOthers(); return; }
      if (msg.type === 'sendAnimation') { try { console.log('[sender(esm)] listenWS sendAnimation -> start preview'); } catch(_) {} try { startLocalPreviewAnim(); } catch(_) {} return; }
      if (msg.type === 'config' && msg.data) {
        // animKick handling
        if (Object.prototype.hasOwnProperty.call(msg.data, 'animKick')) {
          const ts = Number(msg.data.animKick)||0; const last = (window.__senderAnimKickTs||0);
          const bootAt = window.__senderBootAt || (window.__senderBootAt = (typeof performance!=='undefined'?performance.now():Date.now()));
          const nowT = (typeof performance!=='undefined'?performance.now():Date.now());
          if (ts > last && nowT - bootAt > 1500) { window.__senderAnimKickTs = ts; try { console.log('[sender(esm)] listenWS animKick accepted -> start preview', ts); } catch(_) {} try { startLocalPreviewAnim(); } catch(_) {} }
        }
      }
    };
  }
  function schedule(){ if (timer) return; timer = setTimeout(()=>{ timer=null; open(); }, 1000); }
  open();
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
try { __sendBtn?.addEventListener('click', () => {
  window.__sentThisWindow = true; pulseSend(false); try { showSendArrow(false); } catch(_) {}
  // NOTE: Fast local clear disabled to avoid blank snapshot on sender during animation
  try { console.log('[sender(esm)] send clicked'); } catch(_) {}
  // Preview will start via WS broadcast for all senders
}); } catch(_) {}
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
    vid.muted = true; vid.playsInline = true; vid.preload = 'auto'; vid.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;';
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
  inkImg.style.cssText='position:absolute;inset:0;width:100%;height:100%;opacity:1;transition:opacity 0ms linear;z-index:2;';
  // Do NOT clear local canvas here; keep it visible until global clear after move
  // Disable local inputs while animating
  overlay.addEventListener('pointerdown', (e)=> { try { console.log('[sender(esm) preview] pointer blocked'); } catch(_) {} e.preventDefault(); }, { once: false });
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
          ok = true; try { console.log('[sender(esm) preview] video source selected', url); } catch(_) {} break;
        } catch(_) { /* try next */ }
      }
      try { if (ok) { await vid.play().catch(()=>{}); try { console.log('[sender(esm) preview] video play started'); } catch(_) {} } } catch(_) {}
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
    try { inkImg.style.transition = 'opacity 2000ms linear'; inkImg.style.opacity = '0'; console.log('[sender(esm) preview] ink fade-out start'); } catch(_) {}
    // Prepare freeze canvas for last video frame
    let vidFreeze = document.getElementById('senderAnimVideoFreeze');
    if (!vidFreeze) { vidFreeze = document.createElement('canvas'); vidFreeze.id = 'senderAnimVideoFreeze'; vidFreeze.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:1;display:none;'; inner.appendChild(vidFreeze); }
    let videoEnded = false; if (vid) {
      try {
        vid.onended = ()=>{
          videoEnded = true;
          try {
            const sw = vid.videoWidth||0, sh = vid.videoHeight||0;
            const cw = inkImg.width || inkSnap.width, ch = inkImg.height || inkSnap.height;
            // cover-fit compute
            let sx=0, sy=0, sWidth=sw, sHeight=sh;
            const sRatio = sw/sh, cRatio = cw/ch;
            if (sRatio > cRatio) { sWidth = sh*cRatio; sx = (sw - sWidth)/2; } else if (sRatio < cRatio) { sHeight = sw/cRatio; sy = (sh - sHeight)/2; }
            vidFreeze.width = cw; vidFreeze.height = ch;
            const k = vidFreeze.getContext('2d'); k.clearRect(0,0,cw,ch);
            // draw last frame
            k.drawImage(vid, sx, sy, sWidth, sHeight, 0, 0, cw, ch);
            // hide video, show freeze
            vid.style.display = 'none'; vidFreeze.style.display = 'block';
            console.log('[sender(esm) preview] video ended -> freeze canvas drawn');
          } catch(e){ try { console.warn('[sender(esm) preview] freeze draw failed', e); } catch(_) {} }
          try { console.log('[sender(esm) preview] schedule move(B)', { moveDelay }); } catch(_) {}
          setTimeout(()=> startMove(), moveDelay);
        };
      } catch(_) {}
    }
    const startedAt = performance.now();
    const fadeIn = () => { try { inkImg.style.transition = 'opacity 400ms ease'; inkImg.style.opacity = '1'; console.log('[sender(esm) preview] ink fade-in start'); setTimeout(()=>{ try { console.log('[sender(esm) preview] ink fade-in done'); } catch(_) {} }, 450); } catch(_) {} };
      const poll = setInterval(()=>{
        const t = performance.now();
        if ((videoEnded) || (vid && vid.currentTime >= 10) || (!vid && (t - startedAt >= 10000))) {
          clearInterval(poll); fadeIn();
        }
      }, 100);
    } else {
      // A: move after rotateDur + moveDelay (match receiver)
      setTimeout(()=> startMove(), rotateDur + moveDelay);
    }
  }, rotateDelay);

  function startMove(){
    try { console.log('[sender(esm) preview] move down start', { moveDur }); } catch(_) {}
    inner.style.transition = `transform ${moveDur}ms ease`;
    inner.style.transform = 'translateY(120%)';
    setTimeout(()=>{
      // Global clear after move completes
      try {
        const httpBase = (transport?.toHttpBase?.(SERVER_URL) || SERVER_URL).replace(/^wss?:\/\//i, (m)=> m.toLowerCase()==='wss://'?'https://':'http://').replace(/\/$/,'');
        const url = `${httpBase}/clear?channel=${encodeURIComponent(CHANNEL)}`;
        console.log('[sender(esm) preview] POST /clear', url);
        fetch(url, { method: 'POST' })
          .then(r=>{ console.log('[sender(esm) preview] clear result', { ok: r.ok, status: r.status }); })
          .catch(e=>{ console.warn('[sender(esm) preview] clear error', e); });
      } catch(e) { try { console.warn('[sender(esm) preview] clear build error', e); } catch(_) {} }
      try { overlay.remove(); console.log('[sender(esm) preview] overlay removed'); } catch(_) {}
      window.__senderPreviewStarted = false;
    }, moveDur + 30);
  }
    // animKick kick-off for all senders (WS broadcast)
    if (Object.prototype.hasOwnProperty.call(msg.data, 'animKick')) {
      const ts = Number(msg.data.animKick)||0;
      window.__senderAnimKickTs = window.__senderAnimKickTs || 0;
      const bootAt = window.__senderBootAt || (window.__senderBootAt = (typeof performance!=='undefined'?performance.now():Date.now()));
      const nowT = (typeof performance!=='undefined'?performance.now():Date.now());
      if (ts > window.__senderAnimKickTs && nowT - bootAt > 1500) {
        window.__senderAnimKickTs = ts;
        try { console.log('[sender(esm)] config.animKick accepted -> start local preview', ts); } catch(_) {}
        try { startLocalPreviewAnim(); } catch(_) {}
      } else {
        try { console.log('[sender(esm)] config.animKick ignored', { ts, last: window.__senderAnimKickTs, bootDelta: Math.round(nowT-bootAt) }); } catch(_) {}
        try {
          if ((nowT - bootAt) <= 1500 && !window.__senderAnimKickRetry) {
            const wait = 1550 - (nowT - bootAt);
            window.__senderAnimKickRetry = setTimeout(()=>{
              window.__senderAnimKickRetry = null;
              if ((window.__senderAnimKickTs||0) < ts && !window.__senderPreviewStarted) {
                window.__senderAnimKickTs = ts; try { console.log('[sender(esm)] animKick delayed accept after boot'); } catch(_) {}
                try { startLocalPreviewAnim(); } catch(_) {}
              }
            }, Math.max(100, wait));
          }
        } catch(_) {}
      }
    }
}
