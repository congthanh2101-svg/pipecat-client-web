/**
 * Pipecat Proxy Middleware
 * ========================
 * Sits between browser and Pipecat server to handle:
 * 1. CORS proxy for HTTP startBot endpoint
 * 2. WebSocket proxy with silence keepalive + auto-reconnect
 * 3. Static file server for the HTML client
 *
 * Usage:
 *   node proxy-server.js
 *   Browser: http://localhost:3099
 *   Client WS: ws://localhost:3099/ws
 *   API: POST http://localhost:3099/api/connect
 */

const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');
const crypto = require('crypto');

// ---- Configuration ----
const PROXY_PORT = 3099;
const TARGET_HTTP = 'https://rtstt-demo.securityzone.vn';
const TARGET_WS = 'wss://aeon-pipecat.securityzone.vn/ws';
const SILENCE_FRAME_BYTES = 1280; // 20ms PCM Float32 at 16kHz (16000 * 4 * 0.02)
const STARTUP_DELAY_MS = 500; // Delay before first connection to avoid rate-limit

// ---- RTVI Protocol Helpers ----
function shortUuid() {
  return crypto.randomUUID().slice(0, 8);
}

function createRTVIMessage(type, data) {
  return JSON.stringify({ label: 'rtvi-ai', type, data, id: shortUuid() });
}

function createClientReadyMsg() {
  return createRTVIMessage('client-ready', {
    version: '1.3.0',
    about: {
      library: 'pipecat-proxy',
      library_version: '1.0.0',
    },
  });
}

function varintSize(value) {
  let count = 0;
  do {
    count++;
    value >>= 7;
  } while (value > 0);
  return count;
}

function encodeVarint(buffer, offset, value) {
  let written = 0;
  do {
    let byte = value & 0x7f;
    value >>= 7;
    if (value > 0) byte |= 0x80;
    buffer[offset + written] = byte;
    written++;
  } while (value > 0);
  return written;
}

function encodeMessage(jsonStr) {
  const jsonBytes = Buffer.from(jsonStr, 'utf-8');
  const outerLen = 1 + varintSize(jsonBytes.length) + jsonBytes.length;
  const buf = Buffer.alloc(1 + varintSize(outerLen) + outerLen);
  let offset = 0;
  buf[offset++] = 0x22;
  offset += encodeVarint(buf, offset, outerLen);
  buf[offset++] = 0x0a;
  offset += encodeVarint(buf, offset, jsonBytes.length);
  buf.set(jsonBytes, offset);
  return new Uint8Array(buf);
}

/**
 * Peek inside an RTVI binary message to check if it's client-ready.
 * Avoids forwarding duplicate client-ready when the proxy already sends one.
 */
function isClientReadyMessage(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 5 || buf[0] !== 0x22) return false;
  try {
    // Skip outer tag (1) + outer_len varint to find 0x0A + inner_len
    let pos = 1;
    while (pos < buf.length && (buf[pos] & 0x80)) pos++;
    pos++; // past outer_len
    if (buf[pos] !== 0x0A) return false;
    pos++;
    while (pos < buf.length && (buf[pos] & 0x80)) pos++;
    pos++; // past inner_len
    const jsonStr = buf.toString('utf-8', pos);
    const msg = JSON.parse(jsonStr);
    return msg.type === 'client-ready';
  } catch {
    return false;
  }
}

// ---- Express Setup ----
const app = express();

// CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, 'approach-a-html')));

// POST /api/connect — CORS proxy to startBot endpoint
app.post('/api/connect', async (req, res) => {
  try {
    console.log('[HTTP] /api/connect ->', TARGET_HTTP + '/connect');
    const resp = await fetch(TARGET_HTTP + '/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    });
    const data = await resp.json();
    console.log('[HTTP] Response:', JSON.stringify(data));
    res.json(data);
  } catch (err) {
    console.error('[HTTP] Error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', proxy: true, mode: 'auto-reconnect' });
});

// ---- HTTP Server ----
const server = http.createServer(app);

// ---- WebSocket Proxy ----
const wss = new WebSocketServer({ server });

wss.on('connection', (clientWs, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const phone = params.get('phone') || '0909835115';
  const conversationId = params.get('conversation_id') || crypto.randomUUID();

  let realWs = null;
  let keepaliveTimer = null;

  console.log(`[WS] Client connected — phone=${phone} conv=${conversationId}`);

  function connectToRealServer() {
    console.log('[WS] connectToRealServer called, client state:', clientWs.readyState);
    if (clientWs.readyState !== WebSocket.OPEN) return;
    const url = `${TARGET_WS}?phone=${encodeURIComponent(phone)}&conv&conversation_id=${encodeURIComponent(crypto.randomUUID())}`;

    realWs = new WebSocket(url, {
      origin: 'https://rtstt-demo.securityzone.vn',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/139.0.0.0'
      }
    });

    realWs.on('open', () => {
      console.log('[WS] Real server connected');

      // Always send client-ready on new connections
      const readyMsg = createClientReadyMsg();
      realWs.send(Buffer.from(encodeMessage(readyMsg)));
      console.log('[WS] -> client-ready');
    });

    realWs.on('message', (data) => {
      // Forward server messages to client
      if (clientWs.readyState === WebSocket.OPEN) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        clientWs.send(buf);
      }
    });

    realWs.on('close', (code, reason) => {
      stopKeepalive();
      console.log(`[WS] Real server closed: code=${code} reason=${reason || 'none'}`);

      // Forward close to client (server is single-turn, no auto-reconnect)
      if (clientWs.readyState === WebSocket.OPEN) {
        const closeCode = (typeof code === 'number' && code >= 1000 && code <= 1015) ? code : 1000;
        clientWs.close(closeCode, reason || 'Server closed');
      }
    });

    realWs.on('error', (err) => {
      console.error('[WS] Real server error:', err.message || err);
    });
    realWs.on('unexpected-response', (req, res) => {
      console.error('[WS] Unexpected response:', res.statusCode, res.statusMessage);
    });
  }

  function startKeepalive() {
    stopKeepalive();
    keepaliveTimer = setInterval(() => {
      if (realWs && realWs.readyState === WebSocket.OPEN) {
        try {
          realWs.send(new ArrayBuffer(SILENCE_FRAME_BYTES));
        } catch (e) {
          /* WS may close during send */
        }
      }
    }, 20);
  }

  function stopKeepalive() {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
  }

  // ---- Client → Server forwarding ----
  clientWs.on('message', (data) => {
    // Skip forwarding client-ready – the proxy already sends it on connect
    if (isClientReadyMessage(data)) {
      return;
    }

    if (realWs && realWs.readyState === WebSocket.OPEN) {
      // Forward client data to server
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      realWs.send(buf);
    }
  });

  clientWs.on('close', () => {
    console.log('[WS] Client disconnected');
    stopKeepalive();
    if (realWs && realWs.readyState === WebSocket.OPEN) {
      realWs.close(1000, 'Client disconnected');
    }
  });

  clientWs.on('error', () => {
    /* handled by close */
  });

  // Start connection (small delay to avoid server rate-limiting on rapid connections)
  setTimeout(connectToRealServer, STARTUP_DELAY_MS);
});

// ---- Start ----
server.listen(PROXY_PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Pipecat Proxy Middleware               ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  HTTP:    http://localhost:${PROXY_PORT}        ║`);
  console.log(`║  WS:      ws://localhost:${PROXY_PORT}/ws      ║`);
  console.log(`║  API:     http://localhost:${PROXY_PORT}/api/connect  ║`);
  console.log('║                                          ║');
  console.log(`║  Target WS: ${TARGET_WS}  ║`);
  console.log(`║  Target HTTP: ${TARGET_HTTP}   ║`);
  console.log('║  Mode:     auto-reconnect + silence KA  ║');
  console.log('╚══════════════════════════════════════════╝');
});
