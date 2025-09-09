import { Transport } from './transport.js';
import { CanvasManager } from './canvas.js';
import { wireUI } from './ui.js';

const SHARED_CONST = (window.SenderShared && window.SenderShared.constants) || null;
const SENDER_VERSION = SHARED_CONST?.VERSION || '0.9.0';
try { const v = document.getElementById('sender-version'); if (v) v.textContent = `v${SENDER_VERSION}`; } catch { }

const qs = new URLSearchParams(location.search);
const SERVER_URL = (qs.get('server') || (window.SERVER_URL || '')).trim();
const CHANNEL = (qs.get('channel') || (window.CHANNEL || 'default')).trim();

const canvasEl = document.getElementById('paint');
const cm = new CanvasManager(canvasEl);
cm.fitToViewport(false);
window.addEventListener('resize', () => cm.fitToViewport(true));

const transport = new Transport(SERVER_URL, CHANNEL, { sendIntervalMs: 150 });
transport.connect();
// authorId for this tab (ephemeral per access)
const AUTHOR_ID = Math.random().toString(36).slice(2, 10);

// other strokes engine (shared)
const otherEngine = (window.SenderShared?.otherStrokes?.create?.({ canvas: cm.canvas, dpr: cm.DPR, bufferMs: 200 }) || null);
function resizeLayers() { otherEngine?.resizeToCanvas?.(); }
function composeOthers() { const ctx = cm.ctx; ctx.save(); ctx.setTransform(1,0,0,1,0,0); otherEngine?.compositeTo?.(ctx); ctx.restore(); }
otherEngine?.startRAF?.();

const __BOOT_AT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
let __lastPreCountTs = 0;
transport.onmessage = (msg) => {
  if (msg.type === 'config' && msg.data) {
    if (msg.data.bgSender) {
      if (typeof msg.data.bgSender === 'string') { cm.setBackgroundWhite(); }
      else if (msg.data.bgSender.mode === 'image' && msg.data.bgSender.url) { cm.setBackgroundImage(msg.data.bgSender.url); }
    }
    // Pre-count 3-2-1 in center for all senders
    if (Object.prototype.hasOwnProperty.call(msg.data, 'preCountStart')) {
      const ts = Number(msg.data.preCountStart)||0;
      const nowT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (!(ts > __lastPreCountTs && nowT - __BOOT_AT > 1500)) { /* ignore stale/boot */ }
      else {
        __lastPreCountTs = ts;
      let pc = document.getElementById('senderPreCount');
      if (!pc) {
        pc = document.createElement('div'); pc.id = 'senderPreCount';
        pc.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;z-index:10000;pointer-events:none;';
        const inner = document.createElement('div');
        inner.id = 'senderPreCountNum';
        inner.style.cssText = 'font-size:160px;font-weight:900;color:#fff;text-shadow:0 0 14px #3b82f6,0 0 26px #3b82f6,0 0 40px #3b82f6;';
        inner.textContent = '3'; pc.appendChild(inner);
        document.body.appendChild(pc);
      }
      const num = document.getElementById('senderPreCountNum') || pc.firstChild;
      let n = Math.max(0, Math.round(Number(window.__preCountSec||3)));
      pc.style.display = 'grid'; num.textContent = String(n || 0);
      if (window.__senderPreTimer) { clearInterval(window.__senderPreTimer); window.__senderPreTimer = null; }
      window.__senderPreTimer = setInterval(()=>{
        n -= 1; if (n > 0) { num.textContent = String(n); }
        else { clearInterval(window.__senderPreTimer); window.__senderPreTimer = null; pc.style.display='none'; }
      }, 1000);
      }
    }
    // Show tip while waiting (image visible and idle)
    if (Object.prototype.hasOwnProperty.call(msg.data, 'overlayWaiting')) {
      let tip = document.getElementById('senderPressStart');
      if (!tip) { tip = document.createElement('div'); tip.id = 'senderPressStart'; tip.style.cssText = 'position:fixed;inset:0;display:none;place-items:center;z-index:10001;pointer-events:none;'; const t=document.createElement('div'); t.style.cssText='font-size:48px;font-weight:800;color:#ffffff;text-shadow:0 0 10px #3b82f6,0 0 22px #3b82f6,0 0 34px #3b82f6;'; t.textContent='開始を押してください'; tip.appendChild(t); document.body.appendChild(tip); }
      tip.style.display = msg.data.overlayWaiting ? 'grid' : 'none';
    }
    if (typeof msg.data.overlayWarnSec !== 'undefined') { const v=Number(msg.data.overlayWarnSec); if (isFinite(v)) window.__overlayWarnSec = Math.max(0, Math.min(60, Math.round(v))); }
    if (typeof msg.data.preCountSec !== 'undefined') { const v=Number(msg.data.preCountSec); if (isFinite(v)) window.__preCountSec = Math.max(0, Math.min(10, Math.round(v))); }
    // Overlay countdown relay for senders (with warn color)
    if (typeof msg.data.overlayRemainSec !== 'undefined') {
      const left = Math.max(0, Math.floor(Number(msg.data.overlayRemainSec)||0));
      let el = document.getElementById('senderCountdown');
      if (!el) {
        el = document.createElement('div'); el.id = 'senderCountdown';
        el.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9999;font-size:44px;color:#fff;text-shadow:0 0 8px #3b82f6,0 0 16px #3b82f6,0 0 24px #3b82f6;pointer-events:none;';
        el.textContent = '終了まで0秒'; document.body.appendChild(el);
      }
      if (left > 0) {
        el.style.display = 'block'; el.textContent = `終了まで${left}秒`;
        const warn = Math.max(0, Math.min(60, Math.round(Number(window.__overlayWarnSec||10))));
        if (left <= warn) { el.style.color = '#fca5a5'; el.style.textShadow = '0 0 10px #ef4444,0 0 22px #ef4444,0 0 34px #ef4444'; }
        else { el.style.color = '#fff'; el.style.textShadow = '0 0 8px #3b82f6,0 0 16px #3b82f6,0 0 24px #3b82f6'; }
      } else { el.style.display = 'none'; }
    }
  }
  if (msg.type === 'stroke') {
    // authorId が無い古いクライアントも“他人”として表示する
    if (msg.authorId && msg.authorId === AUTHOR_ID) return; // ignore own
    otherEngine?.handle?.(msg);
  }
  if (msg.type === 'clear') {
    // clear all layers (including my local canvas)
    try { cm.clear(); } catch(_) {}
    otherEngine?.clearAll?.();
    composeOthers();
  }
  if (msg.type === 'clearMine') {
    const { authorId } = msg; otherEngine?.clearAuthor?.(authorId); composeOthers();
  }
};

// Ensure "clear" reaches senders even when WS is blocked: listen via SSE too
(() => {
  if (!SERVER_URL) return;
  function toHttpBase(u) { return u.replace(/^wss?:\/\//i, (m) => m.toLowerCase()==='wss://'?'https://':'http://').replace(/\/$/, ''); }
  try {
    const es = new EventSource(`${toHttpBase(SERVER_URL)}/events?channel=${encodeURIComponent(CHANNEL)}`);
    es.addEventListener('clear', () => { try { cm.clear(); } catch(_) {} otherEngine?.clearAll?.(); composeOthers(); });
  } catch(_) { /* ignore: environments without EventSource */ }
})();

let realtimeEverUsed = false;
cm.onStrokeStart = ({ id, nx, ny, color, size, sizeN }) => {
  if (SERVER_URL) {
    transport.sendStroke({ type: 'stroke', phase: 'start', id, nx, ny, color, size, sizeN });
    realtimeEverUsed = true;
  }
};
let postQueue = [];
let postTimer = null;
function flushBatch() {
  if (!postQueue.length) { if (postTimer) { clearTimeout(postTimer); postTimer = null; } return; }
  const batch = postQueue; postQueue = [];
  transport.sendStrokeBatch(batch);
  if (postTimer) { clearTimeout(postTimer); postTimer = null; }
}
cm.onStrokePoint = ({ id, nx, ny }) => {
  if (!SERVER_URL) return;
  // WSなら逐次、HTTPならバッチ
  transport.wsReady ? transport.sendStroke({ type: 'stroke', phase: 'point', id, nx, ny })
                    : (postQueue.push({ type: 'stroke', phase: 'point', id, nx, ny }), postTimer ??= setTimeout(flushBatch, 40));
};
cm.onStrokeEnd = ({ id }) => {
  if (!SERVER_URL) return;
  flushBatch();
  transport.sendStroke({ type: 'stroke', phase: 'end', id });
  if (!realtimeEverUsed) transport.sendFrameNow(canvasEl.toDataURL('image/png'));
};

wireUI({ canvasManager: cm, transport, authorId: AUTHOR_ID, onResize: resizeLayers });
    // Pre-count 3-2-1 in center for all senders
    if (Object.prototype.hasOwnProperty.call(msg.data, 'preCountStart')) {
      let pc = document.getElementById('senderPreCount');
      if (!pc) {
        pc = document.createElement('div'); pc.id = 'senderPreCount';
        pc.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;z-index:10000;pointer-events:none;';
        const inner = document.createElement('div');
        inner.id = 'senderPreCountNum';
        inner.style.cssText = 'font-size:160px;font-weight:900;color:#fff;text-shadow:0 0 14px #3b82f6,0 0 26px #3b82f6,0 0 40px #3b82f6;';
        inner.textContent = '3'; pc.appendChild(inner);
        document.body.appendChild(pc);
      }
      const num = document.getElementById('senderPreCountNum') || pc.firstChild;
      let n = 3; pc.style.display = 'grid'; num.textContent = String(n);
      if (window.__senderPreTimer) { clearInterval(window.__senderPreTimer); window.__senderPreTimer = null; }
      window.__senderPreTimer = setInterval(()=>{
        n -= 1; if (n > 0) { num.textContent = String(n); }
        else { clearInterval(window.__senderPreTimer); window.__senderPreTimer = null; pc.style.display='none'; }
      }, 1000);
    }
    // NOTE: overlayDescending is ignored for the tip. Tip is controlled only by overlayWaiting.
