// Shared engine for rendering other authors' strokes on the sender side (UMD)
(function(root, factory){
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.SenderShared = root.SenderShared || {}).otherStrokes = factory(); }
})(typeof self !== 'undefined' ? self : this, function(){
  function create({ canvas, dpr = (typeof devicePixelRatio!=='undefined'?devicePixelRatio:1), bufferMs = 200, eraserScale = 1.3 }) {
    const DPR = Math.max(1, Math.min(Number(dpr) || 1, 3));
    const getW = () => canvas.width; const getH = () => canvas.height;
    const DIST_THRESH_SQ = Math.pow(0.75 * DPR, 2);
    const otherLayers = new Map(); // authorId -> {canvas, ctx}
    const strokes = new Map(); // id -> state

    function getLayer(author) {
      const key = String(author || 'anon');
      if (!otherLayers.has(key)) {
        const c = document.createElement('canvas'); c.width = getW(); c.height = getH();
        const k = c.getContext('2d'); k.imageSmoothingEnabled = true; k.imageSmoothingQuality = 'high';
        otherLayers.set(key, { canvas: c, ctx: k });
      }
      return otherLayers.get(key);
    }

    function resizeToCanvas() {
      for (const { canvas: c } of otherLayers.values()) {
        const off = document.createElement('canvas'); off.width = getW(); off.height = getH();
        off.getContext('2d').drawImage(c, 0, 0, c.width, c.height, 0, 0, off.width, off.height);
        c.width = off.width; c.height = off.height;
        c.getContext('2d').drawImage(off, 0, 0);
      }
    }

    function compositeTo(ctx) { for (const { canvas: c } of otherLayers.values()) ctx.drawImage(c, 0, 0); }

    function clearAll() { for (const { canvas: c, ctx: k } of otherLayers.values()) k.clearRect(0,0,c.width,c.height); strokes.clear(); }
    function clearAuthor(authorId) {
      const key = String(authorId || ''); const lay = otherLayers.get(key); if (lay) lay.ctx.clearRect(0,0,lay.canvas.width, lay.canvas.height);
      for (const [id, s] of Array.from(strokes.entries())) if (String(s.author) === key) strokes.delete(id);
    }

    function handle(msg) {
      if (!msg || msg.type !== 'stroke') return;
      if (msg.phase === 'start') {
        const sizeDev = (typeof msg.sizeN === 'number' && isFinite(msg.sizeN)) ? (msg.sizeN * getW()) : (Number(msg.size||4) * DPR);
        const p = { x: msg.nx*getW(), y: msg.ny*getH(), time: performance.now() };
        strokes.set(msg.id, { author:String(msg.authorId||'anon'), tool:(msg.tool||'pen'), color: msg.color||'#000', sizeCss:Number(msg.size||4), sizeDev, points:[p], drawnUntil:0, ended:false });
        const lay = getLayer(String(msg.authorId||'anon')).ctx; lay.globalCompositeOperation = (msg.tool==='eraser')?'destination-out':'source-over'; lay.beginPath(); lay.fillStyle = msg.color||'#000'; lay.arc(p.x,p.y, (msg.tool==='eraser'?eraserScale:1.0)*sizeDev/2,0,Math.PI*2); lay.fill();
        return;
      }
      if (msg.phase === 'point') { const s = strokes.get(msg.id); if (!s) return; const p = { x: msg.nx*getW(), y: msg.ny*getH(), time: performance.now() }; s.points.push(p); return; }
      if (msg.phase === 'end') { const s = strokes.get(msg.id); if (!s) return; s.ended = true; return; }
    }

    function process() {
      const target = performance.now() - bufferMs;
      for (const [id, s] of strokes) {
        const ready = (() => { for (let i = s.points.length - 1; i >= 2; i--) if (s.points[i].time <= target) return i; return 0; })();
        if (s.curIndex === undefined) { if (ready >= 2) { s.curIndex = 2; s.t = 0; const p0=s.points[0], p1=s.points[1]; s.lastPt = { x:(p0.x+p1.x)/2, y:(p0.y+p1.y)/2 }; } else continue; }
        const layer = getLayer(s.author).ctx; layer.lineJoin='round'; layer.lineCap='round'; layer.strokeStyle = s.color; layer.lineWidth = (s.tool==='eraser'?eraserScale:1.0) * (s.sizeDev || s.sizeCss * DPR);
        let drew=false; layer.beginPath(); layer.moveTo(s.lastPt.x, s.lastPt.y);
        const q=(m1,p1,m2,t)=>{ const a=1-t; return { x:a*a*m1.x+2*a*t*p1.x+t*t*m2.x, y:a*a*m1.y+2*a*t*p1.y+t*t*m2.y }; };
        while (s.curIndex <= ready) {
          const i=s.curIndex; const p0=s.points[i-2], p1=s.points[i-1], p2=s.points[i]; const m1={x:(p0.x+p1.x)/2,y:(p0.y+p1.y)/2}, m2={x:(p1.x+p2.x)/2,y:(p1.y+p2.y)/2};
          const segLen=Math.hypot(m2.x-m1.x,m2.y-m1.y)+1e-3; const stepPx=Math.max(0.8*DPR,0.5*(s.sizeDev||s.sizeCss*DPR)); const dt=Math.min(0.35, Math.max(0.02, stepPx/segLen));
          const dur=Math.max(1,(p2.time||0)-(p1.time||0)); const timeT=Math.max(0, Math.min(1,(target-(p1.time||0))/dur)); const desired=(i<ready)?1:timeT;
          while(s.t<desired-1e-6){ const nt=Math.min(desired, s.t+dt); const np=q(m1,p1,m2,nt); layer.lineTo(np.x,np.y); s.lastPt=np; s.t=nt; drew=true; if(s.t>=1-1e-6) break; }
          if (s.t>=1-1e-6){ s.curIndex++; s.t=0; s.lastPt={...m2}; } else break;
        }
        if (drew) layer.stroke();
        if (s.ended && s.curIndex > s.points.length-1) strokes.delete(id);
      }
    }

    function startRAF() {
      function loop(){ process(); requestAnimationFrame(loop); }
      requestAnimationFrame(loop);
    }

    return { handle, process, startRAF, compositeTo, resizeToCanvas, clearAll, clearAuthor, _layers: otherLayers, _strokes: strokes };
  }

  return { create };
});

