(() => {
  // Receiver overlay: twinkle stars (window-wide, subtle). Exposed via window.ReceiverOverlays.twinkle
  const clampDPR = () => Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  let twRunning = false; let twCanvas = null; let twRaf = 0; let twStars = []; let twFade = {mode:'none', t0:0, dur:0, from:0, to:1, alpha:0};

  function drawStarPoly(g, cx, cy, r, rot){
    const type = (Math.random()<0.6)?'star':(Math.random()<0.5?'diamond':'plus');
    g.save(); g.translate(cx,cy); g.rotate(rot);
    if (type==='star'){
      const spikes=5, outer=r, inner=r*0.45; g.beginPath();
      for (let i=0;i<spikes*2;i++){ const rr=(i%2===0?outer:inner); const a=i*Math.PI/spikes; const x=Math.cos(a)*rr, y=Math.sin(a)*rr; if(i===0) g.moveTo(x,y); else g.lineTo(x,y);} g.closePath(); g.fill();
    } else if (type==='diamond'){
      g.beginPath(); g.moveTo(0,-r); g.lineTo(r*0.7,0); g.lineTo(0,r); g.lineTo(-r*0.7,0); g.closePath(); g.fill();
    } else { g.fillRect(-r*0.12,-r,r*0.24,r*2); g.fillRect(-r,-r*0.12,r*2,r*0.24); }
    g.restore();
  }

  function start({ fadeInMs=2000 }={}){
    if (twRunning) return; twRunning = true;
    const DPR = clampDPR();
    const cv = document.createElement('canvas'); twCanvas = cv;
    cv.style.position='fixed'; cv.style.inset='0'; cv.style.zIndex='0'; cv.style.pointerEvents='none'; document.body.appendChild(cv);
    const g = cv.getContext('2d');
    function fit(){ cv.width=Math.floor((window.innerWidth||800)*DPR); cv.height=Math.floor((window.innerHeight||600)*DPR); cv.style.width='100%'; cv.style.height='100%'; }
    fit(); const onResize=()=>fit(); window.addEventListener('resize', onResize);
    const base = Math.round((cv.width*cv.height)/(140*140));
    const count = Math.max(120, Math.min(480, base));
    twStars = new Array(count).fill(0).map(()=>({
      x:Math.random()*cv.width, y:Math.random()*cv.height,
      r:(Math.random()*3.2+1.2)*DPR,
      a0:Math.random()*Math.PI*2,
      w:0.9+Math.random()*1.4,
      dx:(Math.random()-0.5)*0.12*DPR, dy:(Math.random()-0.5)*0.12*DPR,
      gold:Math.random()<0.55, rot: Math.random()*Math.PI*2 }));
    twFade = {mode:'in', t0:performance.now(), dur:Math.max(1,fadeInMs), from:0, to:1, alpha:0};
    function alphaNow(){ if (twFade.mode==='none') return twFade.alpha||0; const e=Math.min(1,(performance.now()-twFade.t0)/twFade.dur); const a=twFade.from+(twFade.to-twFade.from)*e; if(e>=1){ twFade.alpha=a; twFade.mode='none'; } return a; }
    function step(){
      g.clearRect(0,0,cv.width,cv.height); g.globalCompositeOperation='lighter';
      const aBase = alphaNow();
      for (const s of twStars){
        s.a0 += s.w*0.03; s.x += s.dx; s.y += s.dy; s.rot += 0.012;
        if(s.x<-24) s.x=cv.width+24; if(s.x>cv.width+24) s.x=-24; if(s.y<-24) s.y=cv.height+24; if(s.y>cv.height+24) s.y=-24;
        const tw = 0.45 + 0.95*(0.5+0.5*Math.sin(s.a0));
        const glowR = s.r*2.4;
        const grad = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, glowR);
        const baseCol = s.gold ? '255,215,0' : '192,192,192';
        grad.addColorStop(0, `rgba(${baseCol},0.95)`);
        grad.addColorStop(0.35, `rgba(${baseCol},0.55)`);
        grad.addColorStop(1, `rgba(${baseCol},0)`);
        g.globalAlpha = aBase * Math.min(1, tw*0.9);
        g.fillStyle = grad; g.beginPath(); g.arc(s.x, s.y, glowR, 0, Math.PI*2); g.fill();
        g.globalAlpha = aBase * Math.min(1, tw*1.05);
        g.fillStyle = s.gold ? '#ffd700' : '#c0c0c0';
        drawStarPoly(g, s.x, s.y, s.r, s.rot);
      }
      // cut out postcard area so stars never cover the card
      try {
        const cardEl = document.getElementById('rotator') || document.getElementById('base');
        if (cardEl){
          const r = cardEl.getBoundingClientRect();
          g.globalCompositeOperation = 'destination-out';
          g.fillStyle = 'rgba(0,0,0,1)';
          g.fillRect(Math.floor(r.left*DPR), Math.floor(r.top*DPR), Math.ceil(r.width*DPR), Math.ceil(r.height*DPR));
        }
      } catch(_){ }
      g.globalAlpha=1; g.globalCompositeOperation='source-over'; twRaf=requestAnimationFrame(step);
    }
    twRaf = requestAnimationFrame(step);
    start._cleanup = ()=>{ try{cancelAnimationFrame(twRaf);}catch(_){} try{window.removeEventListener('resize', onResize);}catch(_){} try{cv.remove();}catch(_){} twRunning=false; twCanvas=null; twStars=[]; twFade={mode:'none',t0:0,dur:0,from:0,to:1,alpha:0}; };
  }

  function stop({ fadeOutMs=1200 }={}){
    if (!twRunning) return; if (!twCanvas){ try{ start._cleanup && start._cleanup(); }catch(_){} return; }
    twFade = { mode:'out', t0:performance.now(), dur:Math.max(1,fadeOutMs), from:(twFade.alpha||1), to:0, alpha:(twFade.alpha||1) };
    const prevCleanup = start._cleanup; const wait=()=>{ const e=(performance.now()-twFade.t0)/twFade.dur; if(e>=1){ try{ prevCleanup && prevCleanup(); }catch(_){} } else { requestAnimationFrame(wait); } }; requestAnimationFrame(wait);
  }

  window.ReceiverOverlays = window.ReceiverOverlays || {};
  window.ReceiverOverlays.twinkle = { start, stop };
})();

