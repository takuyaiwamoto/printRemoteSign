// CanvasManager: A4 portrait canvas, smoothing + local rendering
export class CanvasManager {
  constructor(canvas, { ratio = 210 / 297, dpr = devicePixelRatio || 1 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.wrap = canvas.closest('.canvas-wrap') || document.getElementById('canvas-wrap') || canvas.parentElement;
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
    // background
    this.bgMode = 'white';
    this.bgImage = null;
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

    // 高さ制限から導いた幅と、幅制限の小さい方を採用
    const widthFromH = Math.round(maxH * this.RATIO);
    const targetW = Math.min(maxW, widthFromH);

    // ラップは幅のみ指定（高さは aspect-ratio で決まる）
    if (this.wrap && this.wrap.style) {
      this.wrap.style.width = targetW + 'px';
      this.wrap.style.height = '';
    }
    // 表示サイズは常にラップにフィット
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';

    let prev = null;
    if (preserve && this.canvas.width && this.canvas.height) {
      prev = document.createElement('canvas');
      prev.width = this.canvas.width; prev.height = this.canvas.height;
      prev.getContext('2d').drawImage(this.canvas, 0, 0);
    }

    const rect = (this.wrap?.getBoundingClientRect?.() || this.canvas.getBoundingClientRect());
    this.canvas.width = Math.floor(rect.width * this.DPR);
    this.canvas.height = Math.floor(rect.height * this.DPR);
    this._applyBrush();
    const ctx = this.ctx;
    if (prev) {
      // Rebuild: background then previous content
      const off = document.createElement('canvas'); off.width = this.canvas.width; off.height = this.canvas.height;
      const octx = off.getContext('2d');
      this._drawBackground(octx);
      octx.drawImage(prev, 0, 0, prev.width, prev.height, 0, 0, this.canvas.width, this.canvas.height);
      ctx.drawImage(off, 0, 0);
    } else { this._drawBackground(ctx); }
  }

  clear() {
    const ctx = this.ctx;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._drawBackground(ctx);
    ctx.restore();
  }

  _drawBackground(ctx) {
    if (this.bgMode === 'image' && this.bgImage) {
      const sw = this.bgImage.width || this.bgImage.naturalWidth; const sh = this.bgImage.height || this.bgImage.naturalHeight;
      ctx.drawImage(this.bgImage, 0, 0, sw, sh, 0, 0, this.canvas.width, this.canvas.height);
    } else {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  async setBackgroundWhite() { this.bgMode = 'white'; this.bgImage = null; this.clear(); }
  async setBackgroundImage(url) {
    try {
      if (typeof createImageBitmap === 'function') {
        const bmp = await createImageBitmap(await (await fetch(url)).blob()); this.bgImage = bmp; this.bgMode = 'image';
      } else { const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; }); this.bgImage = img; this.bgMode = 'image'; }
    } catch(_) { this.bgMode = 'white'; this.bgImage = null; }
    this.clear();
  }

  _pos(e) {
    if (typeof e.offsetX === 'number' && typeof e.offsetY === 'number') {
      const nx = this.canvas.clientWidth ? (e.offsetX / this.canvas.clientWidth) : 0;
      const ny = this.canvas.clientHeight ? (e.offsetY / this.canvas.clientHeight) : 0;
      return { x: nx * this.canvas.width, y: ny * this.canvas.height };
    }
    const rect = this.canvas.getBoundingClientRect();
    const cx = (e.clientX ?? (e.touches?.[0]?.clientX || 0));
    const cy = (e.clientY ?? (e.touches?.[0]?.clientY || 0));
    const nx = rect.width ? (cx - rect.left) / rect.width : 0;
    const ny = rect.height ? (cy - rect.top) / rect.height : 0;
    return { x: nx * this.canvas.width, y: ny * this.canvas.height };
  }

  _start(e) {
    e.preventDefault();
    this.isDrawing = true;
    const { x, y } = this._pos(e);
    this.lastX = x; this.lastY = y;
    this.points = [{ x, y }];
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const cssW = this.canvas.width / this.DPR; // CSSピクセル幅
    const sizeN = this.brushSizeCss / cssW;    // キャンバス幅に対する相対太さ
    this.onStrokeStart?.({ id, nx: x / this.canvas.width, ny: y / this.canvas.height, color: this.brushColor, size: this.brushSizeCss, sizeN });
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
