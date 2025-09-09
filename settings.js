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

  function sendPrintDelay(sec){
    const v = Math.max(0, Math.min(15, Math.round(Number(sec)||0)));
    const data = { print: { delaySec: v } };
    const msg = { type: 'config', data };
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    fetch(`${httpBase(SERVER_URL)}/config?channel=${encodeURIComponent(CHANNEL)}`,
      { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data }) }).catch(()=>{});
  }

  function sendPrintRotate180(on){
    const data = { print: { rotate180: !!on } };
    const msg = { type: 'config', data };
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    fetch(`${httpBase(SERVER_URL)}/config?channel=${encodeURIComponent(CHANNEL)}`,
      { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data }) }).catch(()=>{});
  }

  function sendAnimReappearDelay(sec){
    const v = Number(sec);
    const data = { animReceiver: { reappearDelaySec: isFinite(v) ? Math.max(0, Math.min(20, Math.round(v))) : null } };
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
      // Visual selection for background cards
      if (target === 'sender' || target === 'receiver') {
        const panel = target === 'sender' ? document.getElementById('senderPanel') : document.getElementById('receiverPanel');
        panel?.querySelectorAll('.card').forEach(el => el.classList.remove('is-active'));
        card.classList.add('is-active');
      }
      if (target === 'animType') {
        // toggle active state within animType panel
        const panel = document.getElementById('animTypePanel');
        panel?.querySelectorAll('.card').forEach(el => el.classList.remove('is-active'));
        card.classList.add('is-active');
        const anim = (card.getAttribute('data-anim') || 'A').toUpperCase();
        const data = { animType: (anim === 'B') ? 'B' : 'A' };
        const msg = { type: 'config', data };
        if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
        fetch(`${httpBase(SERVER_URL)}/config?channel=${encodeURIComponent(CHANNEL)}`,
          { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data }) }).catch(()=>{});
        return;
      }
      if (target === 'rotate') {
        // toggle active state within rotate panel
        const panel = document.getElementById('rotatePanel');
        panel?.querySelectorAll('.card').forEach(el => el.classList.remove('is-active'));
        card.classList.add('is-active');
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
  const animR = document.getElementById('animDelayReappear');
  const animRV = document.getElementById('animDelayReappearVal');
  const printDelay = document.getElementById('printDelaySec');
  const printDelayVal = document.getElementById('printDelayVal');
  const preCountSec = document.getElementById('preCountSec');
  const preCountSecVal = document.getElementById('preCountSecVal');
  const stayCountSec = document.getElementById('stayCountSec');
  const stayCountSecVal = document.getElementById('stayCountSecVal');
  const warnCountSec = document.getElementById('warnCountSec');
  const warnCountSecVal = document.getElementById('warnCountSecVal');
  const printRotate180 = document.getElementById('printRotate180');
  let atimer = null;
  function pushAnim(){ clearTimeout(atimer); atimer = setTimeout(()=> sendAnimDelays(animX.value, animZ.value), 150); }
  animX?.addEventListener('input', ()=>{ animXV.textContent = animX.value; pushAnim(); });
  animZ?.addEventListener('input', ()=>{ animZV.textContent = animZ.value; pushAnim(); });
  let rtimer = null;
  animR?.addEventListener('input', ()=>{
    animRV.textContent = (animR.value === '' ? '既定' : animR.value);
    clearTimeout(rtimer);
    rtimer = setTimeout(()=> sendAnimReappearDelay(animR.value), 150);
  });

  let ptimer = null;
  printDelay?.addEventListener('input', ()=>{
    printDelayVal.textContent = printDelay.value;
    clearTimeout(ptimer);
    ptimer = setTimeout(()=> sendPrintDelay(printDelay.value), 150);
  });

  // Count settings broadcast
  function sendCountSettings(pre, stay, warn){
    const p = Math.max(0, Math.min(10, Math.round(Number(pre)||0)));
    const s = Math.max(5, Math.min(120, Math.round(Number(stay)||5)));
    const w = Math.max(0, Math.min(60, Math.round(Number(warn)||10)));
    const data = { preCountSec: p, overlayStaySec: s, overlayWarnSec: w };
    const msg = { type: 'config', data };
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    fetch(`${httpBase(SERVER_URL)}/config?channel=${encodeURIComponent(CHANNEL)}`,
      { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data }) }).catch(()=>{});
  }
  let ctimer = null;
  const pushCounts = ()=>{ clearTimeout(ctimer); ctimer=setTimeout(()=> sendCountSettings(preCountSec?.value, stayCountSec?.value, warnCountSec?.value), 150); };
  preCountSec?.addEventListener('input', ()=>{ preCountSecVal.textContent = preCountSec.value; pushCounts(); });
  stayCountSec?.addEventListener('input', ()=>{ stayCountSecVal.textContent = stayCountSec.value; pushCounts(); });
  warnCountSec?.addEventListener('input', ()=>{ warnCountSecVal.textContent = warnCountSec.value; pushCounts(); });

  printRotate180?.addEventListener('change', ()=>{
    sendPrintRotate180(printRotate180.checked);
  });

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
