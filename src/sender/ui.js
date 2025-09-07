// UI wiring for size/color/clear buttons
export function wireUI({ canvasManager, transport, authorId, onResize }) {
  const sizeBtns = Array.from(document.querySelectorAll('.size-btn'));
  const colorBtns = Array.from(document.querySelectorAll('.color-btn'));
  const clearAllBtn = document.getElementById('btn-clear-all');
  const clearMineBtn = document.getElementById('btn-clear-mine');
  const sizeInput = document.getElementById('size');
  const colorInput = document.getElementById('color');

  const SIZE_PRESETS = {
    thin: canvasManager.brushSizeCss,
    normal: Math.max(canvasManager.brushSizeCss * 2, 8),
    thick: Math.max(canvasManager.brushSizeCss * 3.5, 14),
  };

  function setActive(list, el) {
    list.forEach((b) => { const on = b === el; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  }

  if (sizeBtns.length === 1) {
    const order = ['thin','normal','thick'];
    let idx = 1;
    const btn = sizeBtns[0];
    const stroke = btn.querySelector('.stroke');
    function applyByKey(key){
      const val = Math.floor(SIZE_PRESETS[key] || canvasManager.brushSizeCss);
      canvasManager.setBrushSize(val);
      if (sizeInput) sizeInput.value = String(canvasManager.brushSizeCss);
      if (stroke){ stroke.classList.remove('stroke-thin','stroke-normal','stroke-thick'); stroke.classList.add('stroke-' + key); }
    }
    btn.addEventListener('click', () => { idx = (idx + 1) % order.length; applyByKey(order[idx]); });
    applyByKey(order[idx]);
  } else {
    sizeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-size');
        const val = Math.floor(SIZE_PRESETS[key] || canvasManager.brushSizeCss);
        canvasManager.setBrushSize(val);
        if (sizeInput) sizeInput.value = String(canvasManager.brushSizeCss);
        setActive(sizeBtns, btn);
      });
    });
  }

  colorBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const col = btn.getAttribute('data-color');
      if (!col) return;
      canvasManager.setBrushColor(col);
      if (colorInput) colorInput.value = col;
      setActive(colorBtns, btn);
    });
  });

  function performClear() {
    // 要件: 押した人の描画だけ全端末でクリア
    canvasManager.clear();
    if (transport?.sendClearMine) transport.sendClearMine(authorId);
    else if (transport?.wsSend) transport.wsSend({ type: 'clearMine', authorId });
  }
  clearAllBtn?.addEventListener('click', performClear);
  clearMineBtn?.addEventListener('click', () => {
    // local clear self layer only: since we mix local + others on the same canvas,
    // we just clear the whole canvas here (local content), then ask others to clear our layer.
    canvasManager.clear();
    if (transport) transport.wsSend ? transport.wsSend({ type:'clearMine', authorId }) : transport.sendClear?.();
    // HTTP fallback
    try { transport.httpPost?.('/config', { noop: true }); } catch(_) {}
  });

  // Hook resize to external listener to resize layers for others
  window.addEventListener('resize', () => onResize && onResize());

  return { performClear };
}
