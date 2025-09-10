(() => {
  // Receiver overlay: fireworks (window-wide, FX layer). Exposed via window.ReceiverOverlays.fireworks
  const clampDPR = () => Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  let running = false;

  function start(durationMs = 7000) {
    if (running) return; running = true;
    const DPR = clampDPR();
    const cv = document.createElement('canvas');
    cv.style.position = 'fixed'; cv.style.inset = '0'; cv.style.zIndex = '9999';
    cv.style.pointerEvents = 'none';
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    function fit(){ cv.width = Math.floor((window.innerWidth||800) * DPR); cv.height = Math.floor((window.innerHeight||600) * DPR); cv.style.width='100%'; cv.style.height='100%'; g.scale(1,1); }
    fit();
    const onResize = () => { fit(); };
    window.addEventListener('resize', onResize);

    const rockets = []; // {x,y,vx,vy,color,exploded}
    const parts = [];   // {x,y,vx,vy,life,color}
    const colors = ['#ff6b6b','#ffd166','#06d6a0','#118ab2','#a78bfa','#f472b6'];
    const GR = 0.10 * DPR;
    const now = () => performance.now();
    const t0 = now();
    let lastSpawn = t0;
    const spawnInterval = 550; // slower spawn pace (~0.55s)
    function spawnRocket(){
      const W = cv.width, H = cv.height;
      const x = (Math.random()*0.8+0.1) * W; const y = H + 5*DPR;
      const vx = (Math.random()-0.5) * 0.3 * DPR;
      const vy = -(1.2 + Math.random()*0.6) * DPR * 8; // upward
      rockets.push({ x, y, vx, vy, color: colors[(Math.random()*colors.length)|0], exploded:false });
    }
    function explode(r){
      const count = 40 + (Math.random()*20|0);
      for (let i=0;i<count;i++){
        const a = (i/count) * Math.PI*2; const sp = 1.5 + Math.random()*1.5;
        const vx = Math.cos(a)*sp*DPR*2, vy = Math.sin(a)*sp*DPR*2;
        parts.push({ x:r.x, y:r.y, vx, vy, life: 600 + (Math.random()*500|0), color: r.color });
      }
    }
    function step(){
      const t = now();
      // clear with fade trail
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.globalCompositeOperation = 'destination-out';
      g.fillRect(0,0,cv.width,cv.height);
      g.globalCompositeOperation = 'lighter';

      if (t - t0 < durationMs && t - lastSpawn > spawnInterval) { lastSpawn = t; spawnRocket(); }
      // update rockets
      for (let i=rockets.length-1;i>=0;i--){
        const r = rockets[i];
        r.x += r.vx; r.y += r.vy; r.vy += GR*0.4;
        if (!r.exploded && (r.vy > -1 || r.y < cv.height*0.25)) { r.exploded = true; explode(r); rockets.splice(i,1); continue; }
        g.fillStyle = r.color; g.beginPath(); g.arc(r.x, r.y, 2*DPR, 0, Math.PI*2); g.fill();
      }
      // update particles
      for (let i=parts.length-1;i>=0;i--){
        const p = parts[i]; p.x += p.vx; p.y += p.vy; p.vy += GR*0.2; p.life -= 16;
        if (p.life <= 0) { parts.splice(i,1); continue; }
        g.fillStyle = p.color; g.globalAlpha = Math.max(0, p.life/600);
        g.beginPath(); g.arc(p.x, p.y, 2*DPR, 0, Math.PI*2); g.fill(); g.globalAlpha = 1;
      }
      if (t - t0 >= durationMs && rockets.length === 0 && parts.length === 0) finish();
      else requestAnimationFrame(step);
    }
    function finish(){
      window.removeEventListener('resize', onResize);
      try { cv.remove(); } catch(_) {}
      running = false;
    }
    requestAnimationFrame(step);
  }

  window.ReceiverOverlays = window.ReceiverOverlays || {};
  window.ReceiverOverlays.fireworks = { start };
})();

