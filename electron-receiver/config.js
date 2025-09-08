(() => {
  let baseCanvas = null;
  let bgMode = 'white';
  let bgImage = null; // ImageBitmap or HTMLImageElement
  let onScale = null;
  let onRotate = null;
  let log = () => {};
  let onKick = null;
  let animRotateDelaySec = 0;
  let animMoveDelaySec = 0;
  let animType = 'B';
  let animAudioVol = 30; // percent
  let animReappearDelaySec = null; // null=use built-in defaults per animation
  let printDelaySec = 0; // seconds (0-15)
  let rotateDegState = 180; // track latest applied rotation (0 or 180)
  let printRotate180 = null; // explicit print rotation override (null=follow screen rotation)
  let overlayStaySec = 5; // seconds the image stays up before coming back
  let lastAnimKick = 0;
  let bootAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function init({ base, onScaleCb, onRotateCb, onKickCb, logCb }) {
    baseCanvas = base;
    onScale = onScaleCb || (() => {});
    onRotate = onRotateCb || (() => {});
    onKick = onKickCb || (() => {});
    log = logCb || (() => {});
    // default animType if not set
    if (!animType) animType = 'B';
    bootAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function drawBackground(ctx) {
    if (!ctx || !baseCanvas) return;
    log('drawBackground', { mode: bgMode, hasImg: !!bgImage, cw: baseCanvas.width, ch: baseCanvas.height });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (bgMode === 'image' && bgImage) {
      const sw = bgImage.width || bgImage.naturalWidth; const sh = bgImage.height || bgImage.naturalHeight;
      const cw = baseCanvas.width, ch = baseCanvas.height;
      const sRatio = sw / sh, cRatio = cw / ch;
      let sx = 0, sy = 0, sWidth = sw, sHeight = sh;
      if (sRatio > cRatio) { sWidth = sh * cRatio; sx = (sw - sWidth) / 2; }
      else if (sRatio < cRatio) { sHeight = sw / cRatio; sy = (sh - sHeight) / 2; }
      ctx.drawImage(bgImage, sx, sy, sWidth, sHeight, 0, 0, cw, ch);
    } else {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, baseCanvas.width, baseCanvas.height);
    }
    ctx.restore();
  }

  function resolveCandidates(inUrl) {
    const list = [];
    if (/^https?:/i.test(inUrl)) { list.push(inUrl); }
    else {
      try { list.push(new URL(inUrl, location.href).href); } catch(_) {}
      try { list.push(new URL('../' + inUrl, location.href).href); } catch(_) {}
    }
    return list;
  }

  function applyConfig(data) {
    if (!data || typeof data !== 'object') return;
    log('applyConfig', data);
    if (data.bgReceiver) {
      if (typeof data.bgReceiver === 'string') { bgMode = data.bgReceiver; bgImage = null; drawBackground(baseCanvas?.getContext('2d')); }
      else if (data.bgReceiver.mode === 'image' && data.bgReceiver.url) {
        const candidates = resolveCandidates(data.bgReceiver.url);
        (async () => {
          for (const url of candidates) {
            try {
              const isHttp = /^https?:/i.test(url);
              if (isHttp && typeof createImageBitmap === 'function') {
                const bmp = await createImageBitmap(await (await fetch(url)).blob());
                bgImage = bmp; bgMode = 'image'; log('bg loaded via bitmap', url, { w: bmp.width, h: bmp.height }); drawBackground(baseCanvas?.getContext('2d')); return;
              } else {
                await new Promise((res, rej) => { const img = new Image(); img.onload = () => { bgImage = img; bgMode = 'image'; log('bg loaded via Image', url, { w: img.naturalWidth, h: img.naturalHeight }); drawBackground(baseCanvas?.getContext('2d')); res(); }; img.onerror = rej; img.src = url; });
                return;
              }
            } catch(err) { log('bg load failed', url, err?.message || err); }
          }
          log('bg load all candidates failed; fallback white');
          bgMode = 'white'; bgImage = null; drawBackground(baseCanvas?.getContext('2d'));
        })();
      }
    }
    if (typeof data.scaleReceiver === 'number') { const v = Math.max(1, Math.min(100, Math.round(Number(data.scaleReceiver) || 100))); onScale && onScale(v); }
    if (typeof data.rotateReceiver !== 'undefined') { const val = Number(data.rotateReceiver); const deg = (val === 180) ? 180 : 0; rotateDegState = deg; onRotate && onRotate(deg); }
    if (data.animReceiver && typeof data.animReceiver === 'object') {
      const x = Number(data.animReceiver.rotateDelaySec); const z = Number(data.animReceiver.moveDelaySec);
      if (isFinite(x)) animRotateDelaySec = Math.max(0, Math.min(10, Math.round(x)));
      if (isFinite(z)) animMoveDelaySec = Math.max(0, Math.min(10, Math.round(z)));
      if (Object.prototype.hasOwnProperty.call(data.animReceiver, 'reappearDelaySec')) {
        const r = (data.animReceiver.reappearDelaySec == null) ? null : Number(data.animReceiver.reappearDelaySec);
        if (r === null || isFinite(r)) {
          animReappearDelaySec = (r === null) ? null : Math.max(0, Math.min(20, Math.round(r)));
        }
      }
      log('anim config', { animRotateDelaySec, animMoveDelaySec, animReappearDelaySec });
    }
    if (data.print && typeof data.print === 'object') {
      const p = Number(data.print.delaySec);
      if (isFinite(p)) printDelaySec = Math.max(0, Math.min(15, Math.round(p)));
      if (Object.prototype.hasOwnProperty.call(data.print, 'rotate180')) printRotate180 = !!data.print.rotate180;
      log('print config', { printDelaySec, printRotate180 });
    }
    if (typeof data.overlayStaySec !== 'undefined') {
      const s = Number(data.overlayStaySec);
      if (isFinite(s)) overlayStaySec = Math.max(1, Math.min(60, Math.round(s)));
      log('overlay stay sec', overlayStaySec);
    }
    if (typeof data.animType === 'string') {
      animType = (String(data.animType).toUpperCase() === 'B') ? 'B' : 'A';
      log('anim type', animType);
    }
    if (typeof data.animAudioVol !== 'undefined') {
      const v = Math.max(0, Math.min(100, Math.round(Number(data.animAudioVol)||70)));
      animAudioVol = v;
      log('anim audio vol', animAudioVol);
    }
    if (typeof data.animKick !== 'undefined') {
      const ts = Number(data.animKick) || 0;
      const nowT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const canFire = (nowT - bootAt > 2000);
      if (ts > lastAnimKick && canFire) {
        lastAnimKick = ts;
        try { console.log('[receiver] animKick accepted ts=', ts); } catch(_) {}
        try { onKick && onKick(); } catch(_) {}
      } else {
        if (ts > lastAnimKick) lastAnimKick = ts;
        try { console.log('[receiver] animKick ignored (early or old)', { ts, lastAnimKick, bootDelta: Math.round(nowT - bootAt) }); } catch(_) {}
      }
    }
  }

  function getAnimDelays() { return { rotateDelaySec: animRotateDelaySec, moveDelaySec: animMoveDelaySec }; }
  function getAnimType() { return animType; }
  function getAnimAudioVol() { return animAudioVol; }
  function getAnimReappearDelaySec() { return animReappearDelaySec; }
  function getPrintDelaySec() { return printDelaySec; }
  function getRotateDeg() { return rotateDegState; }
  function getPrintRotate180() { return printRotate180; }
  function getOverlayStaySec() { return overlayStaySec; }

  window.ReceiverConfig = { init, drawBackground, applyConfig, getAnimDelays, getAnimType, getAnimAudioVol, getAnimReappearDelaySec, getPrintDelaySec, getRotateDeg, getPrintRotate180, getOverlayStaySec };
})();
