(() => {
  // Receiver overlay: confetti burst from bottom corners (pre-move). Exposed via window.ReceiverOverlays.confetti
  const clampDPR = () => Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  let running = false;

  function start(spawnWindowMs = 1700) {
    if (running) return; running = true;
    const DPR = clampDPR();
    const cv = document.createElement('canvas');
    cv.style.position = 'fixed'; cv.style.inset = '0'; cv.style.zIndex = '9999';
    cv.style.pointerEvents = 'none';
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    function fit(){ cv.width = Math.floor((window.innerWidth||800) * DPR); cv.height = Math.floor((window.innerHeight||600) * DPR); cv.style.width='100%'; cv.style.height='100%'; }
    fit();
    const onResize = () => fit(); window.addEventListener('resize', onResize);

    const parts = []; // {x,y,vx,vy,life,w,h,ang,angV,color,gl,seed,shape}
    const colors = ['#f87171','#fbbf24','#34d399','#60a5fa','#a78bfa','#f472b6','#f59e0b','#22d3ee','#ffd700','#c0c0c0'];
    const now = () => performance.now();
    const t0 = now();
    const GR = 0.10 * DPR;
    const spawnEvery = 100; // ms
    let lastSpawn = t0;
    function spawnSide(side){
      const W=cv.width, H=cv.height; const y = H - 4*DPR; const x = side==='left' ? 6*DPR : W - 6*DPR;
      const count = 8;
      for (let i=0;i<count;i++){
        const targetX = W*0.5 + (Math.random()-0.5)*0.24*W;
        const targetY = H*0.35 + (Math.random()-0.5)*0.10*H;
        const dx = targetX - x, dy = targetY - y;
        const len = Math.max(1, Math.hypot(dx,dy));
        const ux = dx/len, uy = dy/len;
        const base = (1.9 + Math.random()*0.8) * DPR * 2.0;
        const jx = (Math.random()-0.5)*0.36, jy = (Math.random()-0.5)*0.14;
        const vx0 = (ux + jx) * base; let vy0 = (uy + jy) * base;
        const needVy = -Math.sqrt(Math.max(0.1, 2 * GR * Math.max(5*DPR, (y - targetY))));
        if (vy0 > needVy) vy0 = needVy * (1 + Math.random()*0.05);
        const vx = vx0, vy = vy0;
        const isGlitter = Math.random() < 0.30;
        const shape = isGlitter ? 'star' : (Math.random()<0.5 ? 'tri' : 'rect');
        parts.push({ x, y, vx, vy, life: 800 + (Math.random()*400|0), w: 6*DPR, h: 9*DPR, ang: Math.random()*Math.PI, angV:(Math.random()*2-1)*0.14, color: colors[(Math.random()*colors.length)|0], gl: isGlitter, seed: Math.random()*1000, shape });
      }
    }
    function step(){
      const t = now();
      if (t - t0 < spawnWindowMs && t - lastSpawn > spawnEvery) { lastSpawn = t; spawnSide('left'); spawnSide('right'); }
      g.clearRect(0,0,cv.width,cv.height);
      for (let i=parts.length-1;i>=0;i--){
        const p = parts[i]; p.x += p.vx; p.y += p.vy; p.vy += GR; p.ang += p.angV; p.life -= 16;
        if (p.life <= 0 || p.y > cv.height + 20*DPR) { parts.splice(i,1); continue; }
        g.save(); g.translate(p.x, p.y); g.rotate(p.ang);
        if (p.gl || p.shape==='star') {
          const flick = 0.6 + 0.4*Math.abs(Math.sin((t + p.seed)/120));
          g.globalAlpha = flick; g.fillStyle = (p.color === '#ffd700' || p.color === '#c0c0c0') ? p.color : '#ffd700';
          g.rotate(0.785);
          g.fillRect(-p.w/2, -p.h*0.08, p.w, p.h*0.16);
          g.rotate(Math.PI/2);
          g.fillRect(-p.w/2, -p.h*0.08, p.w, p.h*0.16);
          g.globalAlpha = 1;
        } else if (p.shape === 'tri') {
          g.fillStyle = p.color; g.beginPath(); g.moveTo(0, -p.h/2); g.lineTo(p.w/2, p.h/2); g.lineTo(-p.w/2, p.h/2); g.closePath(); g.fill();
        } else {
          g.fillStyle = p.color; g.fillRect(-p.w/2, -p.h/2, p.w, p.h);
        }
        g.restore();
      }
      if (t - t0 >= spawnWindowMs && parts.length === 0) finish(); else requestAnimationFrame(step);
    }
    function finish(){ window.removeEventListener('resize', onResize); try { cv.remove(); } catch(_){} running = false; }
    requestAnimationFrame(step);
  }

  window.ReceiverOverlays = window.ReceiverOverlays || {};
  window.ReceiverOverlays.confetti = { start };
})();

