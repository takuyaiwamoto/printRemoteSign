import { WebSocket } from 'ws';
import {
  initArduinoLedController,
  notifySendTriggered,
  notifyIdle,
  notifyRelayBurst,
  shutdownLed,
} from './lib/arduinoLedController.js';

const BASE_URL = process.env.BRIDGE_SERVER_URL || 'https://printremotesign.onrender.com';
const CHANNEL = process.env.BRIDGE_CHANNEL || 'default';
const ROLE = process.env.BRIDGE_ROLE || 'receiver';
const RECONNECT_MS = Number(process.env.BRIDGE_RECONNECT_MS || 5000);

function toWsBase(u) {
  return u.replace(/^https?:/i, (m) => (m.toLowerCase() === 'https:' ? 'wss:' : 'ws:')).replace(/\/$/, '');
}

let reconnectTimer = null;
let ws = null;

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_MS);
}

function connect() {
  const wsUrl = `${toWsBase(BASE_URL)}/ws?channel=${encodeURIComponent(CHANNEL)}&role=${encodeURIComponent(ROLE)}`;
  console.log(`[led-bridge] connecting to ${wsUrl}`);
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('[led-bridge] WS open');
    try { notifyIdle(); } catch (err) { console.warn('[led-bridge] notifyIdle on open failed', err?.message || err); }
  });

  ws.on('message', (raw) => {
    let msg = null;
    try { msg = JSON.parse(raw.toString()); } catch (err) {
      console.warn('[led-bridge] failed to parse message', err?.message || err);
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'sendAnimation':
        console.log('[led-bridge] sendAnimation received');
        try { notifySendTriggered(); } catch (err) { console.warn('[led-bridge] notifySendTriggered failed', err?.message || err); }
        break;
      case 'config':
        if (msg.data && typeof msg.data === 'object') {
          if (Object.prototype.hasOwnProperty.call(msg.data, 'animKick')) {
            console.log('[led-bridge] config.animKick received');
            try { notifySendTriggered(); } catch (err) { console.warn('[led-bridge] notifySendTriggered failed', err?.message || err); }
          }
          if (Object.prototype.hasOwnProperty.call(msg.data, 'relayKick')) {
            console.log('[led-bridge] config.relayKick received');
            try { notifyRelayBurst(); } catch (err) { console.warn('[led-bridge] notifyRelayBurst failed', err?.message || err); }
          }
          if (Object.prototype.hasOwnProperty.call(msg.data, 'ledTest')) {
            const v = String(msg.data.ledTest || '').toLowerCase();
            if (v === 'blue') {
              console.log('[led-bridge] config.ledTest=blue received');
              try { notifyIdle(); } catch (err) { console.warn('[led-bridge] notifyIdle failed', err?.message || err); }
            } else if (v === 'off') {
              console.log('[led-bridge] config.ledTest=off received');
              try { shutdownLed(); } catch (err) { console.warn('[led-bridge] shutdownLed failed', err?.message || err); }
            } else if (v === 'rainbow') {
              console.log('[led-bridge] config.ledTest=rainbow received');
              try { notifySendTriggered(); } catch (err) { console.warn('[led-bridge] notifySendTriggered failed', err?.message || err); }
            }
          }
        }
        break;
      case 'clear':
        try { notifyIdle(); } catch (err) { console.warn('[led-bridge] notifyIdle failed', err?.message || err); }
        break;
      default:
        break;
    }
  });

  ws.on('error', (err) => {
    console.warn('[led-bridge] WS error', err?.message || err);
  });

  ws.on('close', () => {
    console.warn('[led-bridge] WS closed');
    scheduleReconnect();
  });
}

process.on('SIGINT', () => {
  console.log('\n[led-bridge] SIGINT received, shutting down');
  try { shutdownLed(); } catch (err) { console.warn('[led-bridge] shutdownLed failed', err?.message || err); }
  try { ws?.close(); } catch (_) {}
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[led-bridge] SIGTERM received, shutting down');
  try { shutdownLed(); } catch (err) { console.warn('[led-bridge] shutdownLed failed', err?.message || err); }
  try { ws?.close(); } catch (_) {}
  process.exit(0);
});

initArduinoLedController();
connect();
