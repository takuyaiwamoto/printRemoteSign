(function () {
  const selectionEl = document.getElementById('selection');
  const infoEl = document.getElementById('info');
  let initData = null;
  let dragStart = null;
  let active = false;

  function applyRect(rect) {
    if (!selectionEl) return;
    if (!rect) {
      selectionEl.style.display = 'none';
      return;
    }
    selectionEl.style.display = 'block';
    selectionEl.style.left = `${rect.x}px`;
    selectionEl.style.top = `${rect.y}px`;
    selectionEl.style.width = `${rect.width}px`;
    selectionEl.style.height = `${rect.height}px`;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function buildRect(current) {
    if (!dragStart) return null;
    const bounds = initData?.bounds || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    const x1 = clamp(dragStart.x, 0, bounds.width);
    const y1 = clamp(dragStart.y, 0, bounds.height);
    const x2 = clamp(current.x, 0, bounds.width);
    const y2 = clamp(current.y, 0, bounds.height);
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    return { x, y, width, height };
  }

  function finish(rect) {
    if (!initData) return;
    active = false;
    applyRect(null);
    if (!rect || rect.width < 4 || rect.height < 4) {
      if (initData.cancelChannel) window.SelectionApi?.notify?.(initData.cancelChannel);
      return;
    }
    window.SelectionApi?.notify?.(initData.completeChannel, rect);
  }

  function cancel() {
    if (!initData) return;
    active = false;
    applyRect(null);
    window.SelectionApi?.notify?.(initData.cancelChannel);
  }

  window.SelectionApi?.onInit?.((data) => {
    initData = data;
    if (infoEl && data?.scaleFactor) {
      infoEl.textContent = `ドラッグして領域を選択（Escapeでキャンセル）`;
    }
  });

  window.addEventListener('pointerdown', (event) => {
    if (!initData) return;
    event.preventDefault();
    active = true;
    dragStart = { x: event.clientX, y: event.clientY };
    applyRect({ x: dragStart.x, y: dragStart.y, width: 1, height: 1 });
  });

  window.addEventListener('pointermove', (event) => {
    if (!active || !dragStart) return;
    event.preventDefault();
    applyRect(buildRect({ x: event.clientX, y: event.clientY }));
  });

  window.addEventListener('pointerup', (event) => {
    if (!active || !dragStart) return;
    event.preventDefault();
    const rect = buildRect({ x: event.clientX, y: event.clientY });
    dragStart = null;
    finish(rect);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  });
})();
