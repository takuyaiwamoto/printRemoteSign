(() => {
  function fitCanvas(baseCanvas, inkCanvas, DPR, ratio) {
    if (!baseCanvas || !inkCanvas) return;
    const parent = baseCanvas.parentElement;
    let width = parent.offsetWidth;
    let height = parent.offsetHeight;
    if (!height) height = Math.round(width / (ratio || (210/297)));
    for (const c of [baseCanvas, inkCanvas]) {
      c.style.width = width + 'px';
      c.style.height = height + 'px';
      c.width = Math.floor(width * DPR);
      c.height = Math.floor(height * DPR);
    }
    const bctx = baseCanvas.getContext('2d');
    const ictx = inkCanvas.getContext('2d');
    if (bctx) { bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = 'high'; }
    if (ictx) { ictx.imageSmoothingEnabled = true; ictx.imageSmoothingQuality = 'high'; }
  }

  function getElements() {
    return {
      canvasBox: document.getElementById('canvasBox'),
      scaler: document.getElementById('scaler'),
      rotator: document.getElementById('rotator'),
    };
  }

  function applyTransform({ scalePct = 100, rotationDeg = 0, elements }) {
    const { canvasBox, scaler, rotator } = elements || getElements();
    const s = Math.max(0.01, (Number(scalePct) || 100) / 100);
    if (scaler) scaler.style.transform = `scale(${s})`;
    if (rotator) rotator.style.transform = `rotate(${rotationDeg}deg)`;
    if (!scaler && canvasBox) canvasBox.style.transform = `scale(${s})`;
    if (!rotator && canvasBox) canvasBox.style.transform += ` rotate(${rotationDeg}deg)`;
  }

  window.CanvasLayout = { fitCanvas, getElements, applyTransform };
})();

