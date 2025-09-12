(() => {
  function fitCanvas(baseCanvas, inkCanvas, DPR, ratio) {
    if (!baseCanvas || !inkCanvas) return;
    const r = (ratio || (210/297));
    // Prefer the canvasBox as the sizing source to avoid transient 0 heights on absolute parents
    const box = baseCanvas.closest('#canvasBox') || baseCanvas.parentElement;
    const rect = box.getBoundingClientRect();
    let width = Math.max(1, Math.round(rect.width));
    // When height is zero during early layout, fall back to aspect ratio
    let height = Math.round(rect.height || (width / r));
    for (const c of [baseCanvas, inkCanvas]) {
      c.style.width = width + 'px';
      c.style.height = height + 'px';
      c.width = Math.max(1, Math.floor(width * DPR));
      c.height = Math.max(1, Math.floor(height * DPR));
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
