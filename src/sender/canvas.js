// CanvasManager: A4 portrait canvas, smoothing + local rendering
export class CanvasManager {
  constructor(canvas, { ratio = 210 / 297, dpr = devicePixelRatio || 1 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.RATIO = ratio;
    this.DPR = Math.max(1, Math.min(dpr, 3));

    // brush
    this.brushSizeCss = 4;
    this.brushColor = '#000000';

    // draw state
    this.isDrawing = false;
    this.points = [];
    this.lastX = 0; this.lastY = 0;
    this.DIST_THRESH_SQ = Math.pow(0.75 * this.DPR, 2);

    // callbacks
    this.onStrokeStart = () => {};
    this.onStrokePoint = () => {};
    this.onStrokeEnd = () => {};

    this._bindInputs();
  }

  setBrushSize(px) { this.brushSizeCss = Number(px) || this.brushSizeCss; this._applyBrush(); }
  setBrushColor(color) { this.brushColor = color || this.brushColor; this._applyBrush(); }

  _applyBrush() {
    const ctx = this.ctx;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = this.brushColor;
    ctx.lineWidth = this.brushSizeCss * this.DPR;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  }

  fitToViewport(preserve = false) {
    const pad = 24;
    const toolbarH = (document.querySelector('.toolbar')?.offsetHeight || 60) + pad;
    const maxW = Math.max(300, window.innerWidth - pad * 2);
    const maxH = Math.max(300, window.innerHeight - toolbarH - pad);
    let width, height;
    if (maxW / maxH >= this.RATIO) { height = maxH; width = Math.round(height * this.RATIO); }
    else { width = maxW; height = Math.round(width / this.RATIO); }

    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';

    let prev = null;
    if (preserve && this.canvas.width && this.canvas.height) {
      prev = document.createElement('canvas');
      prev.width = this.canvas.width; prev.height = this.canvas.height;
      prev.getContext('2d').drawImage(this.canvas, 0, 0);
    }

    this.canvas.width = Math.floor(width * this.DPR);
    this.canvas.height = Math.floor(height * this.DPR);
    this._applyBrush();
    const ctx = this.ctx;
    if (prev) ctx.drawImage(prev, 0, 0, prev.width, prev.height, 0, 0, this.canvas.width, this.canvas.height);
    else { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); }
  }

  clear() {
    const ctx = this.ctx;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const xCss = (e.clientX ?? (e.touches?.[0]?.clientX || 0)) - rect.left;
    const yCss = (e.clientY ?? (e.touches?.[0]?.clientY || 0)) - rect.top;
    return { x: xCss * this.DPR, y: yCss * this.DPR };
  }

  _start(e) {
    e.preventDefault();
    this.isDrawing = true;
    const { x, y } = this._pos(e);
    this.lastX = x; this.lastY = y;
    this.points = [{ x, y }];
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    this.onStrokeStart?.({ id, nx: x / this.canvas.width, ny: y / this.canvas.height, color: this.brushColor, size: this.brushSizeCss });
    this._currentId = id;
  }

  _move(e) {
    if (!this.isDrawing) return;
    const { x, y } = this._pos(e);
    const lx = this.lastX, ly = this.lastY;
    const dx = x - lx, dy = y - ly;
    if (dx * dx + dy * dy < this.DIST_THRESH_SQ) return;

    this.points.push({ x, y });
    const n = this.points.length;
    const ctx = this.ctx;
    if (n === 2) {
      ctx.beginPath(); ctx.moveTo(this.points[0].x, this.points[0].y); ctx.lineTo(this.points[1].x, this.points[1].y); ctx.stroke();
    } else if (n >= 3) {
      const p0 = this.points[n - 3]; const p1 = this.points[n - 2]; const p2 = this.points[n - 1];
      const m1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const m2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.quadraticCurveTo(p1.x, p1.y, m2.x, m2.y); ctx.stroke();
    }
    this.lastX = x; this.lastY = y;

    if (this._currentId) this.onStrokePoint?.({ id: this._currentId, nx: x / this.canvas.width, ny: y / this.canvas.height });
  }

  _end() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    const n = this.points.length; const ctx = this.ctx;
    if (n === 1) { ctx.beginPath(); ctx.fillStyle = this.brushColor; ctx.arc(this.points[0].x, this.points[0].y, (this.brushSizeCss * this.DPR) / 2, 0, Math.PI * 2); ctx.fill(); }
    else if (n >= 3) { const p0 = this.points[n - 3], p1 = this.points[n - 2], p2 = this.points[n - 1]; const mPrev = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }; ctx.beginPath(); ctx.moveTo(mPrev.x, mPrev.y); ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y); ctx.stroke(); }
    this.points = [];
    if (this._currentId) this.onStrokeEnd?.({ id: this._currentId });
    this._currentId = null;
  }

  _bindInputs() {
    const canvas = this.canvas;
    const supportsPointer = 'onpointerdown' in window;
    if (supportsPointer) {
      canvas.addEventListener('pointerdown', (e) => this._start(e));
      canvas.addEventListener('pointermove', (e) => this._move(e));
      window.addEventListener('pointerup', () => this._end());
      canvas.addEventListener('pointerleave', () => this._end());
    } else {
      canvas.addEventListener('mousedown', (e) => this._start(e));
      canvas.addEventListener('mousemove', (e) => this._move(e));
      window.addEventListener('mouseup', () => this._end());
      canvas.addEventListener('mouseleave', () => this._end());
      canvas.addEventListener('touchstart', (e) => this._start(e), { passive: false });
      canvas.addEventListener('touchmove', (e) => this._move(e), { passive: false });
      window.addEventListener('touchend', () => this._end());
    }
  }
}

