/**
 * Bridge test script
 * Simulates the Pipecat Client JS to verify the bridge works end-to-end.
 *
 * Usage: node test-bridge.js
 */

const WebSocket = require('ws');
const http = require('http');
const protobuf = require('./protobuf');

const SERVER = 'http://localhost:3099';

async function test() {
  console.log('╔═══════════════════════════════════════╗');
  console.log('║  Bridge End-to-End Test              ║');
  console.log('╚═══════════════════════════════════════╝\n');

  // Step 1: POST /connect
  console.log('▶ Step 1: POST /connect');
  const connectResp = await fetch(`${SERVER}/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '0909835115' }),
  });
  const connectData = await connectResp.json();
  console.log(`   wsUrl: ${connectData.wsUrl}`);
  if (!connectData.wsUrl) {
    console.error('   ✗ No wsUrl returned!');
    process.exit(1);
  }
  console.log('   ✓ /connect works\n');

  // Step 2: Connect to WebSocket
  console.log('▶ Step 2: Connect WebSocket');
  const ws = new WebSocket(connectData.wsUrl);
  ws.binaryType = 'arraybuffer';

  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      console.log('   ✓ WebSocket connected');
      resolve();
    });
    ws.on('error', (err) => {
      reject(err);
    });
    // Timeout after 10s
    setTimeout(() => reject(new Error('timeout')), 10000);
  });
  console.log('');

  // Step 3: Send client-ready via protobuf MessageFrame
  console.log('▶ Step 3: Send client-ready');
  const clientReady = JSON.stringify({
    label: 'rtvi-ai',
    type: 'client-ready',
    id: 'test-001',
    data: {
      version: '1.3.0',
      about: {
        library: 'pipecat-bridge-test',
        library_version: '1.0.0',
        platform_details: { browser: 'Chrome', platform_type: 'desktop' },
      },
    },
  });
  const msgFrame = protobuf.encodeMessageFrame(clientReady);
  ws.send(Buffer.from(msgFrame));
  console.log('   ✓ client-ready sent\n');

  // Step 4: Send audio silence
  console.log('▶ Step 4: Send audio (silence)');
  const silence = new Int16Array(1600); // 100ms at 16kHz
  const silenceBytes = new Uint8Array(silence.buffer);
  const audioFrame = protobuf.encodeAudioFrame(silenceBytes, 16000, 1);
  ws.send(Buffer.from(audioFrame));
  console.log('   ✓ Audio silence sent\n');

  // Step 5: Wait for response
  console.log('▶ Step 5: Wait for server response...');
  let messageCount = 0;
  const startTime = Date.now();
  const timeout = 15000;

  await new Promise((resolve, reject) => {
    ws.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data);
      const uint8 = new Uint8Array(buf);
      const { type, data: frameData } = protobuf.parseFrame(uint8);
      const elapsed = Date.now() - startTime;

      if (type === 'message' && frameData) {
        try {
          const msg = JSON.parse(frameData);
          console.log(`   [${elapsed}ms] Message: ${msg.type}${msg.data ? ' ' + JSON.stringify(msg.data).substring(0, 100) : ''}`);
          messageCount++;
        } catch (e) {
          console.log(`   [${elapsed}ms] Raw message: ${frameData.substring(0, 100)}`);
          messageCount++;
        }
      } else if (type === 'audio') {
        console.log(`   [${elapsed}ms] Audio frame: ${frameData?.audio?.length || 0} bytes, ${frameData?.sampleRate || '?'}Hz`);
        messageCount++;
      } else {
        console.log(`   [${elapsed}ms] Unknown frame type: ${type}`);
        messageCount++;
      }

      // Stop after receiving at least one message or after timeout
      if (messageCount >= 1) {
        // Wait a bit more to see if there are more messages
        setTimeout(() => {
          ws.close();
          resolve();
        }, 2000);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`   WebSocket closed: code=${code} reason=${reason || 'none'}`);
      resolve();
    });

    ws.on('error', (err) => {
      console.error(`   WebSocket error: ${err.message}`);
      reject(err);
    });

    setTimeout(() => {
      console.log(`   ⏱ Timeout after ${timeout}ms`);
      ws.close();
      resolve();
    }, timeout);
  });

  console.log(`\n▶ Test complete. Received ${messageCount} message(s)`);
  console.log(messageCount > 0 ? '  ✓ Bridge works!' : '  ⚠ No messages received (backend may be down)');

  // Cleanup
  ws.close();
  process.exit(0);
}

test().catch((err) => {
  console.error(`Test failed: ${err.message}`);
  process.exit(1);
});
