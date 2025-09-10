# Electron Receiver (Structure)

This renderer is split into small modules to improve maintenance without changing behavior.

- layout.js: Canvas sizing and transform application.
- net.js: WS + SSE + HTTP fallback networking.
- stroke.js: Realtime stroke engine (author layers, buffering, compose).
- config.js: Background, animation/print/overlay settings.
- overlays/
  - twinkle.js: Window-wide twinkle stars (z-index 0, masked over the card area).
  - fireworks.js: Window-wide fireworks (z-index 9999).
  - confetti.js: Window-wide confetti burst (z-index 9999).
- renderer.js: Orchestration. Calls into overlays via thin wrappers (startTwinkleStars, startFireworks, startConfetti) to preserve existing API.

Loading order is set in `receiver.html` so overlays are available before `renderer.js`.

Z-order summary:
- Twinkle: 0
- Card (rotator): 500
- Fireworks/Confetti: 9999

No functional changes were made; only code organization.
