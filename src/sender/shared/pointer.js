// UMD helper for pointer normalization: convert event to canvas device px coords
(function(root, factory){
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.SenderShared = root.SenderShared || {}).pointer = factory(); }
})(typeof self !== 'undefined' ? self : this, function(){
  function eventToCanvasXY(canvas, e){
    if (!canvas || !e) return { x: 0, y: 0 };
    // Prefer offsetX/offsetY if provided (PointerEvent) — already relative to target
    if (typeof e.offsetX === 'number' && typeof e.offsetY === 'number') {
      const nx = canvas.clientWidth ? (e.offsetX / canvas.clientWidth) : 0;
      const ny = canvas.clientHeight ? (e.offsetY / canvas.clientHeight) : 0;
      return { x: nx * canvas.width, y: ny * canvas.height };
    }
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX ?? (e.touches?.[0]?.clientX || 0));
    const cy = (e.clientY ?? (e.touches?.[0]?.clientY || 0));
    const nx = rect.width ? (cx - rect.left) / rect.width : 0;
    const ny = rect.height ? (cy - rect.top) / rect.height : 0;
    return { x: nx * canvas.width, y: ny * canvas.height };
  }
  return { eventToCanvasXY };
});

