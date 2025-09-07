// UMD: expose as ESM default and window.SenderShared.clear
(function(root, factory){
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.SenderShared = root.SenderShared || {}).clear = factory(); }
})(typeof self !== 'undefined' ? self : this, function(){
  function clearAll({ ctx, canvas, otherLayers, selfLayer, otherStrokes, compose }) {
    try {
      if (ctx && canvas) { ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.restore(); }
    } catch(_) {}
    try { if (otherLayers) for (const {canvas:c,ctx:k} of otherLayers.values()) k.clearRect(0,0,c.width,c.height); } catch(_) {}
    try { if (selfLayer && selfLayer.ctx) selfLayer.ctx.clearRect(0,0,selfLayer.canvas.width,selfLayer.canvas.height); } catch(_) {}
    try { if (otherStrokes && otherStrokes.clear) otherStrokes.clear(); } catch(_) {}
    try { if (typeof compose === 'function') compose(); } catch(_) {}
  }
  return { clearAll };
});

