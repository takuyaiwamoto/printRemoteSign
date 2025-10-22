(function(root, factory){
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.ReceiverShared = root.ReceiverShared || {}).constants = factory(); }
})(typeof self !== 'undefined' ? self : this, function(){
  const EVENTS = {
    preCountStart: 'preCountStart',
    overlayRemainSec: 'overlayRemainSec',
    overlayDescending: 'overlayDescending',
    overlayWaiting: 'overlayWaiting',
    relayKick: 'relayKick',
  };
  const PERSISTENT_KEYS = [
    'animType', 'animAudioVol',
    'overlayStaySec', 'preCountSec', 'overlayWarnSec',
    'rotateReceiver', 'scaleReceiver', 'bgReceiver',
    'bgSender', 'print', 'animReceiver', 'twinkleStars'
  ];
  const EPHEMERAL_KEYS = [
    EVENTS.preCountStart,
    EVENTS.overlayRemainSec,
    EVENTS.overlayDescending,
    EVENTS.overlayWaiting,
    EVENTS.relayKick,
    'overlayKick',
    'ledTest',
    'ledTestTs'
  ];
  return { EVENTS, PERSISTENT_KEYS, EPHEMERAL_KEYS };
});
