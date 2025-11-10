(() => {
  const StrokeEngine = (function() {
    let DPR = 1;
    let baseCanvas = null;
    let inkCanvas = null;
    let STROKE_BUFFER_MS = 200;

    const strokes = new Map(); // id -> state
    const authorLayers = new Map(); // authorId -> {canvas, ctx}
    const getAuthorLayer = (author) => {
      const key = String(author || 'anon');
      if (!authorLayers.has(key)) {
        const c = document.createElement('canvas');
        c.width = baseCanvas.width; c.height = baseCanvas.height;
        const k = c.getContext('2d'); k.imageSmoothingEnabled = true; k.imageSmoothingQuality = 'high';
        authorLayers.set(key, { canvas: c, ctx: k });
      }
      return authorLayers.get(key);
    };

    function init({ dpr, base, ink, bufferMs }) {
      DPR = Math.max(1, Math.min(Number(dpr) || 1, 3));
      baseCanvas = base; inkCanvas = ink;
      STROKE_BUFFER_MS = Math.min(1000, Math.max(0, Number(bufferMs) || 200));
    }

    function resizeLayers() {
      for (const [key, layer] of authorLayers) {
        const off = document.createElement('canvas'); off.width = baseCanvas.width; off.height = baseCanvas.height;
        off.getContext('2d').drawImage(layer.canvas, 0, 0, layer.canvas.width, layer.canvas.height, 0, 0, off.width, off.height);
        layer.canvas.width = off.width; layer.canvas.height = off.height;
        layer.ctx = layer.canvas.getContext('2d'); layer.ctx.imageSmoothingEnabled = true; layer.ctx.imageSmoothingQuality = 'high';
        layer.ctx.drawImage(off, 0, 0);
      }
    }

    function clearAll() {
      for (const { canvas, ctx } of authorLayers.values()) ctx.clearRect(0,0,canvas.width,canvas.height);
      strokes.clear();
    }

    function clearAuthor(authorId) {
      const key = String(authorId || '');
      const layer = authorLayers.get(key);
      if (layer) layer.ctx.clearRect(0,0,layer.canvas.width, layer.canvas.height);
      for (const [id, s] of Array.from(strokes.entries())) { if (String(s.author) === key) strokes.delete(id); }
    }

    function compositeTo(ctx) {
      for (const { canvas } of authorLayers.values()) ctx.drawImage(canvas, 0, 0);
    }

    function handleStroke(msg) {
      const phase = msg?.phase; if (!phase) return false;
      if (phase === 'start') {
        const id = String(msg.id || Date.now());
        const p = { x: msg.nx * baseCanvas.width, y: msg.ny * baseCanvas.height, time: performance.now() };
        const sizeDev = (typeof msg.sizeN === 'number' && isFinite(msg.sizeN)) ? (msg.sizeN * baseCanvas.width) : (Number(msg.size || 4) * DPR);
        const s = { author: String(msg.authorId || 'anon'), tool:(msg.tool||'pen'), color: msg.color || '#000', sizeCss: Number(msg.size||4), sizeDev, points: [p], drawnUntil: 0, ended: false, leadDrawn: false };
        strokes.set(id, s);
        const lay = getAuthorLayer(s.author).ctx;
        lay.globalCompositeOperation = (s.tool === 'eraser') ? 'destination-out' : 'source-over';
        lay.beginPath(); lay.fillStyle = s.color; lay.arc(p.x, p.y, s.sizeDev/2, 0, Math.PI*2); lay.fill();
        return true; // indicates start
      }
      const id = String(msg.id || '');
      const s = strokes.get(id); if (!s) return false;
      if (phase === 'point') {
        const p = { x: msg.nx * baseCanvas.width, y: msg.ny * baseCanvas.height, time: performance.now() };
        const last = s.points[s.points.length - 1];
        const dx = p.x - last.x, dy = p.y - last.y;
        if (dx * dx + dy * dy < Math.pow(0.75 * DPR, 2)) return false;
        s.points.push(p); return false;
      }
      if (phase === 'end') { s.ended = true; return false; }
      return false;
    }

    function process() {
      const now = performance.now();
      const target = now - STROKE_BUFFER_MS;
      for (const [id, s] of strokes) {
        if (!s.leadDrawn && s.points.length >= 2) {
          const second = s.points[1];
          if (second.time <= target || s.ended) {
            const ctxLead = getAuthorLayer(String(s.author)).ctx;
            ctxLead.globalCompositeOperation = (s.tool === 'eraser') ? 'destination-out' : 'source-over';
            ctxLead.lineJoin = 'round'; ctxLead.lineCap = 'round'; ctxLead.strokeStyle = s.color;
            ctxLead.lineWidth = (s.tool==='eraser'?1.3:1.0) * (s.sizeDev || (s.sizeCss * DPR));
            ctxLead.beginPath();
            ctxLead.moveTo(s.points[0].x, s.points[0].y);
            ctxLead.lineTo(second.x, second.y);
            ctxLead.stroke();
            s.leadDrawn = true;
          }
        }
        let readySegment = (() => { for (let i = s.points.length - 1; i >= 2; i--) if (s.points[i].time <= target) return i; return 0; })();
        if (s.ended) readySegment = Math.max(readySegment, s.points.length - 1);
        if (s.curIndex === undefined) {
          if (readySegment >= 2) {
            s.curIndex = 2;
            s.t = 0;
            const p0 = s.points[0], p1 = s.points[1];
            s.lastPt = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
          } else if (s.ended && s.points.length === 1) {
            const p = s.points[0];
            const ctx = getAuthorLayer(String(s.author)).ctx;
            ctx.beginPath(); ctx.fillStyle = s.color; const r=(s.sizeDev || (s.sizeCss * DPR))/2; ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fill();
            strokes.delete(id); continue;
          } else if (s.ended && s.points.length === 2) {
            const ctx = getAuthorLayer(String(s.author)).ctx;
            ctx.globalCompositeOperation = (s.tool === 'eraser') ? 'destination-out' : 'source-over';
            ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = s.color;
            ctx.lineWidth = (s.tool==='eraser'?1.3:1.0) * (s.sizeDev || (s.sizeCss * DPR));
            ctx.beginPath(); ctx.moveTo(s.points[0].x, s.points[0].y); ctx.lineTo(s.points[1].x, s.points[1].y); ctx.stroke();
            strokes.delete(id); continue;
          } else { continue; }
        }
        const ctx = getAuthorLayer(String(s.author)).ctx;
        ctx.globalCompositeOperation = (s.tool === 'eraser') ? 'destination-out' : 'source-over';
        ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = s.color; ctx.lineWidth = (s.tool==='eraser'?1.3:1.0) * (s.sizeDev || (s.sizeCss * DPR));
        let drew = false; ctx.beginPath(); ctx.moveTo(s.lastPt.x, s.lastPt.y);
        const qPoint = (m1,p1,m2,t)=>{const a=1-t; return {x:a*a*m1.x+2*a*t*p1.x+t*t*m2.x,y:a*a*m1.y+2*a*t*p1.y+t*t*m2.y};};
        while (s.curIndex <= readySegment) {
          const i = s.curIndex; const p0=s.points[i-2], p1=s.points[i-1], p2=s.points[i];
          const m1={x:(p0.x+p1.x)/2,y:(p0.y+p1.y)/2};
          const isFinalSegment = s.ended && (i >= s.points.length - 1);
          const m2={x:(p1.x+p2.x)/2,y:(p1.y+p2.y)/2};
          const endPoint = isFinalSegment ? { x: p2.x, y: p2.y } : m2;
          const segLen=Math.hypot(endPoint.x-m1.x,endPoint.y-m1.y)+1e-3; const stepPx=Math.max(0.8*DPR,0.5*s.sizeCss*DPR);
          const dt=Math.min(0.35, Math.max(0.02, stepPx/segLen));
          const dur=Math.max(1,(p2.time||0)-(p1.time||0)); const timeT=Math.max(0, Math.min(1,(target-(p1.time||0))/dur));
          const desiredT=(i<readySegment || isFinalSegment)?1:timeT;
          while(s.t<desiredT-1e-6){ const nt=Math.min(desiredT, s.t+dt); const np=qPoint(m1,p1,endPoint,nt); ctx.lineTo(np.x,np.y); s.lastPt=np; s.t=nt; drew=true; if(s.t>=1-1e-6) break; }
          if (s.t>=1-1e-6){ s.curIndex++; s.t=0; s.lastPt={...endPoint}; } else break;
        }
        if (drew) ctx.stroke();
        const lastSegment=s.points.length-1; if (s.ended && s.curIndex>lastSegment) strokes.delete(id);
      }
    }

    return { init, resizeLayers, clearAll, clearAuthor, compositeTo, handleStroke, process };
  })();

  window.StrokeEngine = StrokeEngine;
})();
