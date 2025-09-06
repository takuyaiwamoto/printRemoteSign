// UI wiring for size/color/clear buttons
export function wireUI({ canvasManager, transport }) {
  const sizeBtns = Array.from(document.querySelectorAll('.size-btn'));
  const colorBtns = Array.from(document.querySelectorAll('.color-btn'));
  const clearSideBtn = document.getElementById('btn-clear');
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

  sizeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-size');
      const val = Math.floor(SIZE_PRESETS[key] || canvasManager.brushSizeCss);
      canvasManager.setBrushSize(val);
      if (sizeInput) sizeInput.value = String(canvasManager.brushSizeCss);
      setActive(sizeBtns, btn);
    });
  });

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
    canvasManager.clear();
    transport?.sendClear?.();
  }
  clearSideBtn?.addEventListener('click', performClear);

  return { performClear };
}

