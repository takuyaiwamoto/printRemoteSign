(function(){
  const qs = new URLSearchParams(location.search);
  const SERVER_URL = (qs.get('server') || (window.SERVER_URL || '')).trim();
  const CHANNEL = (qs.get('channel') || (window.CHANNEL || 'default')).trim();
  const ASSET_BASE = (qs.get('assets') || window.ASSET_BASE || '').trim(); // e.g. https://takuyaiwamoto.github.io/printRemoteSign/
  if (!SERVER_URL) { console.warn('SERVER_URL is empty; settings will not broadcast.'); }

  function toWs(u){ return u.replace(/^http/, 'ws').replace(/\/$/, ''); }
  const url = `${toWs(SERVER_URL)}/ws?channel=${encodeURIComponent(CHANNEL)}&role=config`;
  let ws = null;
  try { ws = new WebSocket(url); } catch(_) {}

  function absoluteIfPossible(u){
    if (!u) return u;
    if (/^https?:/i.test(u)) return u;
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      try { return new URL(u, location.href).href; } catch(_) { return u; }
    }
    return u; // file:// の場合はそのまま
  }
  function httpBase(u){ return u.replace(/^wss?:\/\//i, (m)=>m.toLowerCase()==='wss://'?'https://':'http://').replace(/\/$/, ''); }

  function sendConfig(part, mode, url){
    const data = {};
    if (mode === 'white') {
      data[part === 'receiver' ? 'bgReceiver' : 'bgSender'] = 'white';
    } else {
      let finalUrl = url;
      if (!/^https?:/i.test(finalUrl)) {
        // Prefer explicit assets base for sender so Pages配下を指す
        if (part === 'sender' && ASSET_BASE) finalUrl = ASSET_BASE.replace(/\/$/, '/') + finalUrl.replace(/^\/+/, '');
        else finalUrl = absoluteIfPossible(finalUrl);
      }
      data[part === 'receiver' ? 'bgReceiver' : 'bgSender'] = { mode: 'image', url: finalUrl };
    }
    const msg = { type: 'config', data };
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    fetch(`${httpBase(SERVER_URL)}/config?channel=${encodeURIComponent(CHANNEL)}`,
      { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data }) })
      .catch(()=>{});
  }

  function sendScaleReceiver(val){
    const v = Math.max(1, Math.min(100, Math.round(val)));
    const data = { scaleReceiver: v };
    const msg = { type: 'config', data };
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    fetch(`${httpBase(SERVER_URL)}/config?channel=${encodeURIComponent(CHANNEL)}`,
      { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data }) }).catch(()=>{});
  }

  function sendAnimDelays(x, z){
    const data = { animReceiver: { rotateDelaySec: Number(x)||0, moveDelaySec: Number(z)||0 } };
    const msg = { type: 'config', data };
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    fetch(`${httpBase(SERVER_URL)}/config?channel=${encodeURIComponent(CHANNEL)}`,
      { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data }) }).catch(()=>{});
  }

  // 画像URLの正規化
  function normalizeLocalUrl(u){
    if (!u) return u;
    if (/^https?:/i.test(u)) return u;
    if (location.protocol === 'file:') {
      if (ASSET_BASE) return (ASSET_BASE.replace(/\/$/, '/') + u.replace(/^\/+/, ''));
      return '../' + u.replace(/^\/+/, '');
    }
    return u;
  }

  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => {
      const target = card.getAttribute('data-target');
      if (target === 'animType') {
        const anim = (card.getAttribute('data-anim') || 'A').toUpperCase();
        const data = { animType: (anim === 'B') ? 'B' : 'A' };
        const msg = { type: 'config', data };
        if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
        fetch(`${httpBase(SERVER_URL)}/config?channel=${encodeURIComponent(CHANNEL)}`,
          { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data }) }).catch(()=>{});
        return;
      }
      if (target === 'rotate') {
        const rot = Number(card.getAttribute('data-rot') || '0');
        const data = { rotateReceiver: (rot === 180) ? 180 : 0 };
        const msg = { type: 'config', data };
        if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
        fetch(`${httpBase(SERVER_URL)}/config?channel=${encodeURIComponent(CHANNEL)}`,
          { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data }) }).catch(()=>{});
        return;
      }
      const mode = card.getAttribute('data-mode');
      const url = normalizeLocalUrl(card.getAttribute('data-url'));
      sendConfig(target, mode, url);
    });
  });

  const scaleEl = document.getElementById('scaleReceiver');
  const scaleVal = document.getElementById('scaleVal');
  let timer = null;
  scaleEl.addEventListener('input', () => {
    scaleVal.textContent = scaleEl.value;
    clearTimeout(timer); timer = setTimeout(() => sendScaleReceiver(scaleEl.value), 100);
  });

  // Animation delay sliders
  const animX = document.getElementById('animDelayRotate');
  const animXV = document.getElementById('animDelayRotateVal');
  const animZ = document.getElementById('animDelayMove');
  const animZV = document.getElementById('animDelayMoveVal');
  let atimer = null;
  function pushAnim(){ clearTimeout(atimer); atimer = setTimeout(()=> sendAnimDelays(animX.value, animZ.value), 150); }
  animX?.addEventListener('input', ()=>{ animXV.textContent = animX.value; pushAnim(); });
  animZ?.addEventListener('input', ()=>{ animZV.textContent = animZ.value; pushAnim(); });

  // Audio volume for animation B
  const volEl = document.getElementById('animAudioVol');
  const volVal = document.getElementById('animAudioVolVal');
  let vtimer = null;
  function sendAudioVol(v){
    const vol = Math.max(0, Math.min(100, Math.round(Number(v)||0)));
    const data = { animAudioVol: vol };
    const msg = { type: 'config', data };
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    fetch(`${httpBase(SERVER_URL)}/config?channel=${encodeURIComponent(CHANNEL)}`,
      { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data }) }).catch(()=>{});
  }
  volEl?.addEventListener('input', ()=>{ volVal.textContent = volEl.value; clearTimeout(vtimer); vtimer = setTimeout(()=> sendAudioVol(volEl.value), 120); });
})();
