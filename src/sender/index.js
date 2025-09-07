import { Transport } from './transport.js';
import { CanvasManager } from './canvas.js';
import { wireUI } from './ui.js';

const SENDER_VERSION = '0.8.2';
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

// minimal receiver engine on the sender to show others' strokes
const otherLayers = new Map(); // authorId -> {canvas, ctx}
const strokes = new Map(); // id -> state including authorId
const BUFFER_MS = 200;

function getLayer(author) {
  if (!otherLayers.has(author)) {
    const c = document.createElement('canvas');
    c.width = cm.canvas.width; c.height = cm.canvas.height;
    const k = c.getContext('2d'); k.imageSmoothingEnabled = true; k.imageSmoothingQuality = 'high';
    otherLayers.set(author, { canvas: c, ctx: k });
  }
  return otherLayers.get(author);
}

function resizeLayers() {
  for (const { canvas } of otherLayers.values()) {
    const off = document.createElement('canvas'); off.width = cm.canvas.width; off.height = cm.canvas.height;
    off.getContext('2d').drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, off.width, off.height);
    canvas.width = off.width; canvas.height = off.height;
    getLayer('tmp'); // touch to set smoothing
    const g = canvas.getContext('2d'); g.drawImage(off, 0, 0);
  }
}

function composeOthers() {
  const ctx = cm.ctx;
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  for (const { canvas } of otherLayers.values()) ctx.drawImage(canvas, 0, 0);
  ctx.restore();
}

function processStrokes() {
  const now = performance.now();
  const target = now - BUFFER_MS;
  let needsCompose = false;
  for (const [id, s] of strokes) {
    const ready = (() => { for (let i = s.points.length - 1; i >= 2; i--) if (s.points[i].time <= target) return i; return 0; })();
    if (s.curIndex === undefined) {
      if (ready >= 2) { s.curIndex = 2; s.t = 0; const p0 = s.points[0], p1 = s.points[1]; s.lastPt = { x:(p0.x+p1.x)/2, y:(p0.y+p1.y)/2 }; }
      else continue;
    }
    const layer = getLayer(s.author).ctx;
    layer.lineJoin = 'round'; layer.lineCap = 'round'; layer.strokeStyle = s.color; layer.lineWidth = s.sizeDev || s.sizeCss * cm.DPR;
    let drew = false; layer.beginPath(); layer.moveTo(s.lastPt.x, s.lastPt.y);
    const q = (m1,p1,m2,t)=>{const a=1-t; return {x:a*a*m1.x+2*a*t*p1.x+t*t*m2.x,y:a*a*m1.y+2*a*t*p1.y+t*t*m2.y};};
    while (s.curIndex <= ready) {
      const i = s.curIndex; const p0 = s.points[i-2], p1 = s.points[i-1], p2 = s.points[i];
      const m1 = {x:(p0.x+p1.x)/2, y:(p0.y+p1.y)/2}, m2 = {x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2};
      const segLen = Math.hypot(m2.x-m1.x, m2.y-m1.y)+1e-3; const stepPx = Math.max(0.8*cm.DPR,0.5*(s.sizeDev||s.sizeCss*cm.DPR));
      const dt = Math.min(0.35, Math.max(0.02, stepPx/segLen));
      const dur = Math.max(1,(p2.time||0)-(p1.time||0)); const timeT = Math.max(0, Math.min(1,(target-(p1.time||0))/dur));
      const desiredT = (i < ready) ? 1 : timeT;
      while (s.t < desiredT - 1e-6) { const nt = Math.min(desiredT, s.t+dt); const np = q(m1,p1,m2,nt); layer.lineTo(np.x,np.y); s.lastPt = np; s.t=nt; drew = true; if (s.t>=1-1e-6) break; }
      if (s.t >= 1-1e-6) { s.curIndex++; s.t=0; s.lastPt = {...m2}; } else break;
    }
    if (drew) { layer.stroke(); needsCompose = true; }
    if (s.ended && s.curIndex > s.points.length-1) strokes.delete(id);
  }
  if (needsCompose) composeOthers();
  requestAnimationFrame(processStrokes);
}
requestAnimationFrame(processStrokes);

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
    const author = msg.authorId;
    if (msg.phase === 'start') {
      const cssW = cm.canvas.width; // device px width
      const sizeDev = (typeof msg.sizeN === 'number' && isFinite(msg.sizeN)) ? (msg.sizeN * cssW) : (Number(msg.size||4) * cm.DPR);
      const p = { x: msg.nx * cm.canvas.width, y: msg.ny * cm.canvas.height, time: performance.now() };
      strokes.set(msg.id, { author, color: msg.color || '#000', sizeCss: Number(msg.size||4), sizeDev, points:[p], drawnUntil:0, ended:false });
    } else if (msg.phase === 'point') {
      const s = strokes.get(msg.id); if (!s) return; const p = { x: msg.nx*cm.canvas.width, y: msg.ny*cm.canvas.height, time: performance.now() };
      s.points.push(p);
    } else if (msg.phase === 'end') {
      const s = strokes.get(msg.id); if (!s) return; s.ended = true;
    }
  }
  if (msg.type === 'clear') {
    // clear all layers
    for (const {canvas,ctx} of otherLayers.values()) { ctx.clearRect(0,0,canvas.width,canvas.height); }
    composeOthers();
  }
  if (msg.type === 'clearMine') {
    const { authorId } = msg; const lay = otherLayers.get(authorId); if (lay) { lay.ctx.clearRect(0,0,lay.canvas.width, lay.canvas.height); composeOthers(); }
  }
};

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
