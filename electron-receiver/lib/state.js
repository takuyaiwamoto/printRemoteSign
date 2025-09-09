(function(root, factory){
  if (typeof define === 'function' && define.amd) { define(['./bus.js'], factory); }
  else if (typeof module === 'object' && module.exports) { module.exports = factory(require('./bus.js')); }
  else { (root.ReceiverShared = root.ReceiverShared || {}).state = factory((root.ReceiverShared||{}).bus); }
})(typeof self !== 'undefined' ? self : this, function(busMod){
  function createStateMachine({ preCountSecGetter, bus, overlayStartCb, countdownStartCb, playAudioCb }){
    let running = false;
    function isRunning(){ return running; }
    function start(){
      if (running) return; running = true;
      try { playAudioCb && playAudioCb(); } catch(_) {}
      try { bus && bus.publishPreCountStart && bus.publishPreCountStart(); } catch(_) {}
      const preSec = Math.max(0, Math.round(Number(preCountSecGetter && preCountSecGetter() || 3)));
      setTimeout(()=>{ try { overlayStartCb && overlayStartCb(); } catch(_) {} try { countdownStartCb && countdownStartCb(); } catch(_) {} }, preSec * 1000);
    }
    function reset(){ running = false; }
    return { start, reset, isRunning };
  }
  return { createStateMachine };
});

