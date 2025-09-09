// UMD constants used by both ESM and file sender (optional)
(function(root, factory){
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.SenderShared = root.SenderShared || {}).constants = factory(); }
})(typeof self !== 'undefined' ? self : this, function(){
  return {
    VERSION: '0.9.6',
    RATIO_A4: 210/297,
    DPR_MAX: 3,
    ERASER_SCALE: 1.3,
    OTHER_BUFFER_MS: 200
  };
});
