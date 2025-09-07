// UMD helper for fitting A4 portrait canvas to viewport and wrapper
(function(root, factory){
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.SenderShared = root.SenderShared || {}).layout = factory(); }
})(typeof self !== 'undefined' ? self : this, function(){
  const RATIO = 210/297;
  function fitToViewport({ canvas, wrap, DPR = (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1), ratio = RATIO, preserve = false }){
    if (!canvas) return;
    const pad = 24;
    const toolbar = (typeof document !== 'undefined') ? document.querySelector('.toolbar') : null;
    const toolbarH = ((toolbar?.offsetHeight || 60) + pad);
    const maxW = Math.max(300, (typeof window !== 'undefined' ? window.innerWidth : (wrap?.clientWidth||canvas.clientWidth||800)) - pad * 2);
    let maxH = Math.max(300, (typeof window !== 'undefined' ? window.innerHeight : (wrap?.clientHeight||600)) - toolbarH - pad);

    // narrow layout: account for side tools + hint heights
    const isNarrow = (typeof window !== 'undefined') ? window.matchMedia('(max-width: 900px)').matches : false;
    if (isNarrow) {
      const tools = (typeof document !== 'undefined') ? document.querySelector('.side-tools') : null;
      const hint = (typeof document !== 'undefined') ? document.querySelector('.hint') : null;
      const toolsH = (tools?.offsetHeight || 0);
      const hintH = (hint?.offsetHeight || 0);
      maxH = Math.max(200, maxH - toolsH - hintH - 8);
    }

    const widthFromH = Math.round(maxH * ratio);
    const targetW = Math.min(maxW, widthFromH);

    if (wrap && wrap.style) { wrap.style.width = targetW + 'px'; wrap.style.height = ''; }
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    let prev = null;
    if (preserve && canvas.width && canvas.height) {
      prev = document.createElement('canvas'); prev.width = canvas.width; prev.height = canvas.height;
      prev.getContext('2d').drawImage(canvas, 0, 0);
    }

    const rect = (wrap && wrap.getBoundingClientRect) ? wrap.getBoundingClientRect() : canvas.getBoundingClientRect();
    const pixelW = Math.floor(rect.width * DPR);
    const pixelH = Math.floor(rect.height * DPR);
    canvas.width = pixelW; canvas.height = pixelH;

    // caller is responsible for ctx state; but preserve content if requested
    if (prev) {
      const ctx = canvas.getContext('2d');
      ctx.drawImage(prev, 0, 0, prev.width, prev.height, 0, 0, canvas.width, canvas.height);
    }
  }

  return { fitToViewport };
});

