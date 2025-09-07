import { Transport } from './transport.js';
import { CanvasManager } from './canvas.js';
import { wireUI } from './ui.js';

const SENDER_VERSION = '0.8.7';
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

transport.onmessage = (msg) => {
  if (msg.type === 'config' && msg.data) {
    if (msg.data.bgSender) {
      if (typeof msg.data.bgSender === 'string') { cm.setBackgroundWhite(); }
      else if (msg.data.bgSender.mode === 'image' && msg.data.bgSender.url) { cm.setBackgroundImage(msg.data.bgSender.url); }
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
