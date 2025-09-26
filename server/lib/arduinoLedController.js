import { SerialPort } from 'serialport';
import { existsSync } from 'node:fs';

const DEFAULT_PORT = process.env.LED_SERIAL_PORT || '';
const KNOWN_VENDOR_IDS = new Set(['2341', '2A03', '1A86', '10C4', '0403']);
const DEFAULT_BAUD = Number(process.env.LED_SERIAL_BAUD || 115200);
const DEFAULT_PULSE_MS = Number(process.env.LED_SEND_HOLD_MS || 8000);

class ArduinoLedController {
  constructor({ path = DEFAULT_PORT, baudRate = DEFAULT_BAUD, pulseMs = DEFAULT_PULSE_MS } = {}) {
    this.configuredPath = path;
    this.path = path;
    this.baudRate = baudRate;
    this.pulseMs = pulseMs;
    this.queue = [];
    this.ready = false;
    this.reconnectTimer = null;
    this.holdTimer = null;
    this.port = null;
    this.pendingOpen = false;

    this.open();
  }

  async resolvePath() {
    const preferred = this.path || this.configuredPath;
    if (preferred && existsSync(preferred)) {
      return preferred;
    }
    try {
      const ports = await SerialPort.list();
      const byPreferred = preferred ? ports.find(({ path }) => path === preferred) : null;
      if (byPreferred?.path) return byPreferred.path;

      const byVendor = ports.find(({ vendorId }) => {
        if (!vendorId) return false;
        return KNOWN_VENDOR_IDS.has(vendorId.toUpperCase());
      });
      if (byVendor?.path) return byVendor.path;

      const byPattern = ports.find(({ path }) => path && /usb(modem|serial)|ttyACM|ttyUSB/i.test(path));
      if (byPattern?.path) return byPattern.path;

      return preferred || null;
    } catch (err) {
      console.warn('[arduino-led] SerialPort.list failed', err?.message || err);
      return preferred || null;
    }
  }

  setupPort(path) {
    if (this.port) {
      try { this.port.removeAllListeners(); } catch (_) {}
      this.port = null;
    }
    this.path = path;
    this.port = new SerialPort({ path, baudRate: this.baudRate, autoOpen: false });
    this.port.on('open', () => {
      this.ready = true;
      this.flushQueue();
      this.setIdle();
      console.log(`[arduino-led] serial open ${path}`);
    });
    this.port.on('error', (err) => {
      console.warn('[arduino-led] serial error', err?.message || err);
      this.handleDisconnect();
    });
    this.port.on('close', () => {
      console.warn('[arduino-led] serial closed');
      this.handleDisconnect();
    });
  }

  async open() {
    if (this.ready || this.pendingOpen) {
      return;
    }
    this.pendingOpen = true;
    const resolved = await this.resolvePath();
    this.pendingOpen = false;
    if (!resolved) {
      console.warn('[arduino-led] no serial port detected');
      this.handleDisconnect();
      return;
    }

    if (!this.port || this.port.path !== resolved) {
      this.setupPort(resolved);
    }

    if (this.port.isOpen) {
      this.ready = true;
      this.flushQueue();
      this.setIdle();
      return;
    }

    this.port.open((err) => {
      if (err) {
        console.warn('[arduino-led] open failed', err?.message || err);
        this.handleDisconnect();
      }
    });
  }

  handleDisconnect() {
    this.ready = false;
    if (this.port) {
      try { this.port.removeAllListeners(); } catch (_) {}
      this.port = null;
    }
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, 2000);
  }

  flushQueue() {
    while (this.ready && this.queue.length) {
      const msg = this.queue.shift();
      this.port.write(msg, (err) => {
        if (err) console.warn('[arduino-led] write failed', err?.message || err);
      });
    }
  }

  writeCommand(cmd) {
    const payload = `${cmd}\n`;
    if (this.ready) {
      this.port.write(payload, (err) => {
        if (err) console.warn('[arduino-led] write failed', err?.message || err);
      });
    } else {
      this.queue.push(payload);
    }
  }

  setIdle() {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    this.writeCommand('B');
  }

  setSendActive() {
    this.writeCommand('R');
    if (this.pulseMs > 0) {
      if (this.holdTimer) clearTimeout(this.holdTimer);
      this.holdTimer = setTimeout(() => this.setIdle(), this.pulseMs);
    }
  }

  setOff() {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    this.writeCommand('O');
  }
}

let controller = null;

export function initArduinoLedController() {
  if (process.env.LED_SERIAL_DISABLED === '1') {
    console.log('[arduino-led] disabled via LED_SERIAL_DISABLED');
    controller = null;
    return controller;
  }
  try {
    controller = new ArduinoLedController();
  } catch (err) {
    console.warn('[arduino-led] init failed', err?.message || err);
    controller = null;
  }
  return controller;
}

export function notifySendTriggered() {
  controller?.setSendActive();
}

export function notifyIdle() {
  controller?.setIdle();
}

export function shutdownLed() {
  controller?.setOff();
}
