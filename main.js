(() => {
  const RATIO = 210 / 297; // A4 縦: 幅 / 高さ（約 0.707）
  const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));

  const wrap = document.getElementById('canvas-wrap');
  const canvas = document.getElementById('paint');
  const ctx = canvas.getContext('2d');

  const sizeInput = document.getElementById('size');
  const colorInput = document.getElementById('color');
  const clearBtn = document.getElementById('clear');
  const saveBtn = document.getElementById('save');

  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;
  let brushSizeCssPx = Number(sizeInput?.value || 4);
  let brushColor = colorInput?.value || '#000000';

  // --- Sync (optional): send frames to a WebSocket relay server ---
  const qs = new URLSearchParams(location.search);
  const SERVER_URL = (qs.get('server') || (window.SERVER_URL || '')).trim();
  const CHANNEL = (qs.get('channel') || (window.CHANNEL || 'default')).trim();
  let ws = null;
  let wsReady = false;
  let lastSent = 0;
  const SEND_INTERVAL_MS = 150; // throttle during drawing
  let httpFallback = false;

  function connectWS() {
    if (!SERVER_URL) return;
    const url = `${SERVER_URL.replace(/^http/, 'ws').replace(/\/$/, '')}/ws?channel=${encodeURIComponent(CHANNEL)}&role=sender`;
    try { ws = new WebSocket(url); } catch (_) { httpFallback = !!SERVER_URL; return; }
    ws.onopen = () => { wsReady = true; httpFallback = false; sendFrame(true); };
    ws.onclose = () => { wsReady = false; setTimeout(connectWS, 1000); };
    ws.onerror = () => { wsReady = false; httpFallback = !!SERVER_URL; };
  }
  connectWS();

  function sendFrame(force = false) {
    const dataURL = canvas.toDataURL('image/png');
    if (wsReady) {
      try { ws.send(JSON.stringify({ type: 'frame', data: dataURL })); } catch (_) {}
      return;
    }
    if (httpFallback && SERVER_URL) {
      // HTTP fallback: POST the latest frame
      const httpBase = SERVER_URL.replace(/^wss?:\/\//i, (m) => m.toLowerCase() === 'wss://' ? 'https://' : 'http://');
      const u = `${httpBase.replace(/\/$/, '')}/frame?channel=${encodeURIComponent(CHANNEL)}`;
      fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: dataURL }) }).catch(() => {});
    }
  }
  function maybeSendFrame() {
    const now = Date.now();
    if (now - lastSent >= SEND_INTERVAL_MS) {
      sendFrame();
      lastSent = now;
    }
  }

  // 画面に収まる最大サイズで A4 縦比率を維持してラップ要素とキャンバスをリサイズ
  function fitToViewport(preserve = false) {
    const pad = 24; // 余白
    const toolbarH = (document.querySelector('.toolbar')?.offsetHeight || 60) + pad;
    const maxW = Math.max(300, window.innerWidth - pad * 2);
    const maxH = Math.max(300, window.innerHeight - toolbarH - pad);

    // ビューポートに収まる幅・高さを算出
    let width, height;
    if (maxW / maxH >= RATIO) {
      height = maxH;
      width = Math.round(height * RATIO);
    } else {
      width = maxW;
      height = Math.round(width / RATIO);
    }

    wrap.style.width = width + 'px';
    wrap.style.height = height + 'px';

    // キャンバスの表示サイズ（CSSピクセル）
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    // 既存描画を保持する場合はオフスクリーンに退避してから再設定
    let prev = null;
    if (preserve && canvas.width && canvas.height) {
      prev = document.createElement('canvas');
      prev.width = canvas.width;
      prev.height = canvas.height;
      prev.getContext('2d').drawImage(canvas, 0, 0);
    }

    // 実際の描画解像度は DPR を掛ける
    const pixelW = Math.floor(width * DPR);
    const pixelH = Math.floor(height * DPR);
    canvas.width = pixelW;
    canvas.height = pixelH;

    // 描画設定（線端丸めなど）
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSizeCssPx * DPR;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (prev) {
      // 前の内容を新しいサイズへスケール描画
      ctx.drawImage(prev, 0, 0, prev.width, prev.height, 0, 0, canvas.width, canvas.height);
    } else {
      // 初期の用紙風背景（薄いグリッド/余白などは不要なら削除）
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // サイズ変更時も現在の状態を送信
    sendFrame(true);
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const xCss = (e.clientX ?? (e.touches?.[0]?.clientX || 0)) - rect.left;
    const yCss = (e.clientY ?? (e.touches?.[0]?.clientY || 0)) - rect.top;
    const x = xCss * DPR;
    const y = yCss * DPR;
    return { x, y };
  }

  function startDraw(e) {
    e.preventDefault();
    isDrawing = true;
    const { x, y } = getPos(e);
    lastX = x; lastY = y;
  }

  function draw(e) {
    if (!isDrawing) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastX = x;
    lastY = y;
    // 描画中は間引いて送信
    maybeSendFrame();
  }

  function endDraw() {
    isDrawing = false;
    // 最終フレーム送信
    sendFrame(true);
  }

  // 入力ハンドラ登録（Pointer / Mouse / Touch いずれでも動作）
  const supportsPointer = 'onpointerdown' in window;
  if (supportsPointer) {
    canvas.addEventListener('pointerdown', startDraw);
    canvas.addEventListener('pointermove', draw);
    window.addEventListener('pointerup', endDraw);
    canvas.addEventListener('pointerleave', endDraw);
  } else {
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseleave', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    window.addEventListener('touchend', endDraw);
  }

  // UI: 線の太さ・色
  sizeInput?.addEventListener('input', (e) => {
    brushSizeCssPx = Number(e.target.value);
    ctx.lineWidth = brushSizeCssPx * DPR;
  });
  colorInput?.addEventListener('input', (e) => {
    brushColor = e.target.value;
    ctx.strokeStyle = brushColor;
  });

  // 全消去（白で塗りつぶし）
  clearBtn?.addEventListener('click', () => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    sendFrame(true);
  });

  // 保存（PNG ダウンロード）
  saveBtn?.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'drawing-a4.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });

  // 初期化 & リサイズ（内容保持）
  fitToViewport(false);
  window.addEventListener('resize', () => fitToViewport(true));
})();
