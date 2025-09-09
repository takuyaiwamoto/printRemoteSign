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
try { __sendBtn?.addEventListener('click', () => { window.__sentThisWindow = true; pulseSend(false); try { showSendArrow(false); } catch(_) {} }); } catch(_) {}
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
