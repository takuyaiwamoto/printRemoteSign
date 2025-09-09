// Transport: handles WS first, with HTTP fallback for frames/strokes/clear
export class Transport {
  constructor(serverUrl, channel, { sendIntervalMs = 150 } = {}) {
    this.serverUrl = (serverUrl || '').trim();
    this.channel = (channel || 'default').trim();
    this.sendIntervalMs = sendIntervalMs;
    this.ws = null;
    this.wsReady = false;
    this.httpFallback = false;
    this._lastFrameSent = 0;
  }

  toHttpBase(u) {
    return u.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://').replace(/\/$/, '');
  }
  toWsBase(u) {
    return u.replace(/^http/, 'ws').replace(/\/$/, '');
  }

  connect() {
    if (!this.serverUrl) return;
    const url = `${this.toWsBase(this.serverUrl)}/ws?channel=${encodeURIComponent(this.channel)}&role=sender`;
    try { this.ws = new WebSocket(url); } catch (e) { this.httpFallback = !!this.serverUrl; try { console.warn('[sender(transport)] WS construct error', e?.message||e); } catch(_) {} return; }
    this.ws.onopen = () => { this.wsReady = true; this.httpFallback = false; try { console.log('[sender(transport)] WS open', { url }); } catch(_) {} };
    this.ws.onclose = () => { this.wsReady = false; try { console.warn('[sender(transport)] WS close, retrying'); } catch(_) {} setTimeout(() => this.connect(), 1000); };
    this.ws.onerror = (e) => { this.wsReady = false; this.httpFallback = !!this.serverUrl; try { console.warn('[sender(transport)] WS error', e); } catch(_) {} };
    this.ws.onmessage = (ev) => {
      if (!this.onmessage) return;
      let msg = null; try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : 'null'); } catch(_) {}
      if (msg) {
        try { if (msg && msg.type) console.log('[sender(transport)] WS message', msg.type); } catch(_) {}
        this.onmessage(msg);
      }
    };
  }

  wsSend(obj) {
    if (!this.wsReady) return false;
    try { this.ws.send(JSON.stringify(obj)); return true; } catch (_) { return false; }
  }
  get wsReadyFlag() { return this.wsReady; }
  httpPost(path, body) {
    if (!this.serverUrl) return;
    const u = `${this.toHttpBase(this.serverUrl)}${path}?channel=${encodeURIComponent(this.channel)}`;
    fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
  }

  sendFrameNow(dataURL) {
    if (this.wsSend({ type: 'frame', data: dataURL })) return;
    if (this.httpFallback) this.httpPost('/frame', { data: dataURL });
  }
  maybeSendFrame(dataURL) {
    const now = Date.now();
    if (now - this._lastFrameSent >= this.sendIntervalMs) {
      this.sendFrameNow(dataURL);
      this._lastFrameSent = now;
    }
  }

  sendStroke(ev) {
    if (this.wsSend(ev)) return;
    if (this.httpFallback) this.httpPost('/stroke', ev);
  }
  sendStrokeBatch(batch) {
    if (this.wsSend({ type: 'stroke', phase: 'batch', batch })) return;
    if (this.httpFallback) this.httpPost('/stroke', { batch });
  }
  sendClear() {
    if (this.wsSend({ type: 'clear' })) return;
    if (this.httpFallback) this.httpPost('/clear', {});
  }

  sendClearMine(authorId) {
    if (this.wsSend({ type: 'clearMine', authorId: String(authorId) })) return;
    if (this.httpFallback) this.httpPost('/clearMine', { authorId: String(authorId) });
  }

  sendAnimation() {
    if (this.wsSend({ type: 'sendAnimation' })) return;
    if (this.httpFallback) this.httpPost('/anim', {});
  }
}
