(function(root, factory){
  if (typeof define === 'function' && define.amd) { define(['./constants.js'], factory); }
  else if (typeof module === 'object' && module.exports) { module.exports = factory(require('./constants.js')); }
  else { (root.ReceiverShared = root.ReceiverShared || {}).bus = factory((root.ReceiverShared||{}).constants); }
})(typeof self !== 'undefined' ? self : this, function(constants){
  const CONST = constants && constants.EVENTS ? constants : { EVENTS:{ preCountStart:'preCountStart', overlayRemainSec:'overlayRemainSec', overlayDescending:'overlayDescending', overlayWaiting:'overlayWaiting' } };

  function toHttpBase(u){ return String(u||'').replace(/^wss?:\/\//i, (m)=>m.toLowerCase()==='wss://'?'https://':'http://').replace(/\/$/,''); }

  function create({ server, channel }){
    const httpBase = toHttpBase(server);
    async function publishConfig(data){
      try { await fetch(`${httpBase}/config?channel=${encodeURIComponent(channel)}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data }) }); } catch(_) {}
    }
    return {
      publishConfig,
      publishPreCountStart: ()=> publishConfig({ [CONST.EVENTS.preCountStart]: Date.now() }),
      publishRemain: (sec)=> publishConfig({ [CONST.EVENTS.overlayRemainSec]: Math.max(0, Math.floor(sec||0)) }),
      publishWaiting: (on)=> publishConfig({ [CONST.EVENTS.overlayWaiting]: !!on }),
      publishDescending: (on)=> publishConfig({ [CONST.EVENTS.overlayDescending]: !!on }),
    };
  }

  return { create, toHttpBase };
});

