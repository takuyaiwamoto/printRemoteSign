Overview
- Browser sender captures the canvas and sends PNG frames over WebSocket to a relay server.
- Electron receiver connects to the same channel and displays the latest frame scaled to an A4 portrait canvas.

Components
- server/: WebSocket relay (Express + ws). Keeps last frame per channel in memory and broadcasts to receivers.
- electron-receiver/: Electron app rendering the received frames.
- index.html + main.js: Browser drawing app; now includes optional sync (enabled when a server URL is provided).

Local Run
1) Start relay server
   - cd server
   - npm install
   - npm start
   - Server listens on ws://localhost:8787/ws

2) Start Electron receiver
   - cd electron-receiver
   - npm install
   - SERVER_URL=ws://localhost:8787 CHANNEL=default npm start

3) Open browser sender
   - Open index.html with a query string to point at the server:
     file:///.../index.html?server=ws://localhost:8787&channel=default
   - Draw on the canvas; frames appear in the Electron receiver.

Deploy on Render
1) Create a new Web Service on Render and connect this repo.
2) Service settings
   - Root Directory: server
   - Build Command: npm install
   - Start Command: npm start
   - Instance Type: Any (the app is lightweight)
   - Environment: Node 18+ (Render default is fine)
3) After deploy, note your URL, e.g. https://your-app.onrender.com
   - WebSocket endpoint will be wss://your-app.onrender.com/ws

Using the deployed server
- Sender (browser): open index.html with query params, e.g.
  index.html?server=wss://your-app.onrender.com&channel=team1
- Receiver (Electron): start with
  SERVER_URL=wss://your-app.onrender.com CHANNEL=team1 npm start

Notes & Limits
- This is a simple broadcast relay; no auth or ACLs. Use unique channels and keep URLs private.
- Frames are PNG data URLs. Throttled during drawing (~150ms). Final frame sent on stroke end and resize.
- Server stores only the last frame in memory per channel; new receivers immediately get it.
- Large canvases increase payload size. Current guard drops frames > ~10MB.

Troubleshooting
- Nothing shows on receiver: confirm both sides point to the same server and channel.
- Render URL must be wss://... in production; ws:// is only for local dev.
- Corporate proxies may block WebSocket; try another network.

