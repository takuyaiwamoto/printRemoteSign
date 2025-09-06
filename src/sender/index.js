import { Transport } from './transport.js';
import { CanvasManager } from './canvas.js';
import { wireUI } from './ui.js';

const SENDER_VERSION = '0.7.0';
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

let realtimeEverUsed = false;
cm.onStrokeStart = ({ id, nx, ny, color, size }) => {
  if (SERVER_URL) {
    transport.sendStroke({ type: 'stroke', phase: 'start', id, nx, ny, color, size });
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

wireUI({ canvasManager: cm, transport });

