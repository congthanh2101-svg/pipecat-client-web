/**
 * Pipecat Bridge Server
 * ======================
 *
 * Integrates three responsibilities:
 *   1. POST /connect  – handshake endpoint, returns wsUrl for the test client
 *   2. WebSocket /ws   – protobuf → RTVI bridge to real Pipecat backend
 *   3. Static files    – serves the test page
 *
 * Protocol bridge:
 *   Browser (Pipecat Client JS)              Real Pipecat Backend
 *   ┌────────────────────────┐              ┌──────────────────────┐
 *   │ Protobuf AudioRawFrame │  → Int16→F32 │ Raw PCM Float32     │
 *   │ (Int16 PCM)            │              │                      │
 *   │ Protobuf MessageFrame  │  → 0x22-enc  │ RTVI 0x22 JSON      │
 *   │ (RTVI JSON)            │              │                      │
 *   │                        │  ← F32→Int16 │                      │
 *   │ ← Protobuf AudioFrame  │              │ Raw PCM Float32     │
 *   │ ← Protobuf MessageFrame│  ← 0x22-dec  │ RTVI 0x22 JSON      │
 *   └────────────────────────┘              └──────────────────────┘
 *
 * Usage:
 *   node server.js              # starts on PORT (default 3099)
 *   node server.js --port 4099  # custom port
 *   node server.js --backend wss://other/ws   # custom backend
 */

const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');
const crypto = require('crypto');

const protobuf = require('./protobuf');

// ── Configuration ────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || process.argv.find((_, i, a) => a[i-1] === '--port') || '3099', 10);
const BACKEND_WS = process.env.BACKEND_WS
  || (process.argv.includes('--backend') ? process.argv[process.argv.indexOf('--backend') + 1] : null)
  || 'wss://aeon-pipecat.securityzone.vn/ws';

const HOST = process.env.HOST || `localhost:${PORT}`;
const PROTOCOL = process.env.PROTOCOL || 'ws';

// ── Express Setup ────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Session Store ────────────────────────────────────────────────────────────

const sessions = new Map();

// Clean up stale sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt < now) {
      sessions.delete(id);
    }
  }
}, 60000);

// ── POST /connect ────────────────────────────────────────────────────────────

app.post('/connect', (req, res) => {
  const sessionId = crypto.randomUUID();

  // Determine public-facing WebSocket URL from the incoming request
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers['host'] || HOST;
  const wsProto = proto === 'https' ? 'wss' : 'ws';
  const wsUrl = `${wsProto}://${host}/ws?session=${sessionId}`;

  const phone = req.body?.phone || '0909835115';
  const conversationId = crypto.randomUUID();

  sessions.set(sessionId, {
    id: sessionId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 300000, // 5 min TTL
    clientData: req.body || {},
    phone,
    conversationId,
  });

  console.log(`[SESSION] Created ${sessionId} — phone=${phone} → ${wsUrl}`);
  res.json({ wsUrl });
});

// ── GET /api/health ──────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: 'bridge',
    backend: BACKEND_WS,
    sessions: sessions.size,
    time: new Date().toISOString(),
  });
});

// ── Serve test page (optional) ───────────────────────────────────────────────

// Serve the test directory as static files
app.use(express.static(path.join(__dirname, '..', 'test')));

// ── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer(app);

// ── WebSocket Bridge ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (clientWs, req) => {
  const params = new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams;
  const sessionId = params.get('session') || crypto.randomUUID();
  const startTime = Date.now();
  let realWs = null;
  let messageQueue = [];  // buffer messages until backend is connected

  console.log(`[WS] Client connected — session=${sessionId}`);

  // ── Connect to real Pipecat backend ────────────────────────────────────

  // Get session data or use defaults
  const session = sessions.get(sessionId);
  const phone = session?.phone || '0909835115';
  const conversationId = session?.conversationId || crypto.randomUUID();

  // Build backend URL with required query parameters
  const backendUrl = `${BACKEND_WS}?phone=${encodeURIComponent(phone)}&conv&conversation_id=${encodeURIComponent(conversationId)}`;
  console.log(`[WS] Connecting to backend: ${BACKEND_WS} phone=${phone} conv=${conversationId}`);

  try {
    realWs = new WebSocket(backendUrl, {
      origin: 'https://rtstt-demo.securityzone.vn',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/139.0.0.0',
      },
      handshakeTimeout: 15000,
    });
  } catch (err) {
    console.error(`[WS] Failed to create backend WebSocket: ${err.message}`);
    clientWs.close(1011, 'Backend connection failed');
    return;
  }

  // ── Backend WebSocket event handlers ───────────────────────────────────

  realWs.on('open', () => {
    console.log(`[WS] Backend connected — session=${sessionId}`);

    // Flush any queued messages
    const queue = messageQueue;
    messageQueue = [];
    for (const msg of queue) {
      sendToBackend(msg);
    }

    // If no messages in queue after 200ms, send initial silence to kickstart
    if (queue.length === 0) {
      setTimeout(() => {
        if (realWs && realWs.readyState === WebSocket.OPEN) {
          const silence = new Float32Array(1600); // 100ms at 16kHz
          realWs.send(Buffer.from(silence.buffer));
        }
      }, 200);
    }
  });

  realWs.on('message', (data) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

    if (protobuf.isRTVIMessage(buf)) {
      // Backend sent an RTVI message (0x22-encoded JSON)
      try {
        const jsonStr = protobuf.decodeRTVIMessage(buf);
        // Wrap in protobuf MessageFrame and send to client
        const protoMsg = protobuf.encodeMessageFrame(jsonStr);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(Buffer.from(protoMsg));
        }
        // Log for debugging
        try {
          const msg = JSON.parse(jsonStr);
          console.log(`[WS→CLIENT] RTVI: ${msg.type} — session=${sessionId}`);
        } catch { /* ignore parse errors */ }
      } catch (err) {
        console.error(`[WS] Failed to decode RTVI message: ${err.message}`);
      }
    } else {
      // Backend sent raw audio (Float32 PCM)
      // Copy to ensure 4-byte alignment (Buffer byteOffset may not be aligned)
      const alignedBuf = Buffer.from(buf);
      const audioFloat32 = new Float32Array(alignedBuf.buffer, alignedBuf.byteOffset, alignedBuf.byteLength / 4);
      if (audioFloat32.length > 0) {
        const int16Bytes = protobuf.float32ToInt16(audioFloat32);
        // Wrap in protobuf AudioRawFrame and send to client
        const protoAudio = protobuf.encodeAudioFrame(
          new Uint8Array(int16Bytes.buffer || int16Bytes),
          16000, 1
        );
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(Buffer.from(protoAudio));
        }
      }
    }
  });

  realWs.on('close', (code, reason) => {
    console.log(`[WS] Backend closed — session=${sessionId} code=${code}`);
    const elapsed = Date.now() - startTime;
    console.log(`[WS] Session ${sessionId} lasted ${elapsed}ms`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code || 1000, reason || 'Backend closed');
    }
  });

  realWs.on('error', (err) => {
    console.error(`[WS] Backend error — session=${sessionId}: ${err.message || err}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'Backend error');
    }
  });

  // ── Send a message to the backend ──────────────────────────────────────

  function sendToBackend(data) {
    if (realWs && realWs.readyState === WebSocket.OPEN) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      realWs.send(buf);
      return true;
    }
    return false;
  }

  // ── Client WebSocket event handlers ────────────────────────────────────

  clientWs.on('message', (data) => {
    if (!Buffer.isBuffer(data)) {
      // Text message — log but ignore (protobuf is binary only)
      return;
    }

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const uint8 = new Uint8Array(buf);

    // Parse the protobuf Frame
    const { type, data: frameContent } = protobuf.parseFrame(uint8);

    if (type === 'audio' && frameContent && frameContent.audio) {
      // Client sent audio: Int16 PCM in protobuf → convert to Float32
      const float32Data = protobuf.int16ToFloat32(frameContent.audio);
      if (float32Data.length > 0) {
        const rawAudio = Buffer.from(float32Data.buffer);
        if (!sendToBackend(rawAudio) && realWs && realWs.readyState === WebSocket.CONNECTING) {
          messageQueue.push(rawAudio);
        }
      }
    } else if (type === 'message' && frameContent) {
      // Client sent RTVI message wrapped in protobuf → extract JSON
      try {
        const rtviBinary = protobuf.encodeRTVIMessage(frameContent);
        if (!sendToBackend(rtviBinary) && realWs && realWs.readyState === WebSocket.CONNECTING) {
          messageQueue.push(rtviBinary);
        }

        // Log
        try {
          const msg = JSON.parse(frameContent);
          if (msg.type !== 'ping') {
            console.log(`[CLIENT→WS] RTVI: ${msg.type} — session=${sessionId}`);
          }
        } catch { /* ignore */ }
      } catch (err) {
        console.error(`[WS] Failed to encode RTVI message: ${err.message}`);
      }
    }
  });

  clientWs.on('close', () => {
    console.log(`[WS] Client disconnected — session=${sessionId}`);
    messageQueue = [];
    if (realWs && realWs.readyState === WebSocket.OPEN) {
      realWs.close(1000, 'Client disconnected');
    }
  });

  clientWs.on('error', () => {
    /* handled by close */
  });
});

// ── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   Pipecat Bridge Server                      ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  HTTP:    http://localhost:${PORT}               ║`);
  console.log(`║  WS:      ws://localhost:${PORT}/ws             ║`);
  console.log(`║  Connect: http://localhost:${PORT}/connect      ║`);
  console.log('║                                          ║');
  console.log(`║  Backend: ${BACKEND_WS}`);
  console.log(`║  Mode:    bridge (protobuf ↔ RTVI)        ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log(`Serving test page at http://localhost:${PORT}/`);
  console.log(`POST /connect to get a WebSocket URL`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
});
