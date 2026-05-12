# Approach A - Single HTML File

A self-contained HTML client for connecting to Pipecat AI Server via WebSocket using the RTVI (Real-Time Voice Interface) protocol.

## Description

This approach bundles everything (HTML, CSS, JavaScript) into a single `index.html` file with zero external dependencies. It communicates with the Pipecat AI Server using:

- **Protocol**: RTVI over WebSocket with binary protobuf-like message encoding
- **Audio**: Raw PCM Float32, 16000 Hz, mono (both directions)
- **Connection**: `wss://aeon-pipecat.securityzone.vn/ws?phone={phone}&conv&conversation_id={uuid}`

## How to Use

1. Open `index.html` in a modern browser (Chrome 90+, Edge 90+, or Firefox 90+)
2. Enter a phone number in the input field (default: `0909835115`)
3. Click **Connect**
4. Grant microphone permission when prompted by the browser
5. Speak - you will see transcriptions in the left panel and hear bot responses
6. Click **Disconnect** to end the session

## File Structure

```
approach-a-html/
  index.html   - Main application (HTML + CSS + JS, fully self-contained)
  README.md    - This file
```

### Internal Architecture of index.html

| Section | Description |
|---------|-------------|
| HTML     | Header with gradient, status indicator, phone input, connect/disconnect button, transcript panel, debug log panel |
| CSS      | Dark theme, responsive layout (flexbox), custom scrollbars, status animations |
| JS: Varint | Protobuf-style varint encode/decode for message length framing |
| JS: RTVI Codec | `encodeMessage()` / `decodeMessage()` - binary message framing with 0x22/0x0A tags |
| JS: RTVI Messages | `createClientReadyMsg()`, `createRTVIMessage()` - RTVI protocol message helpers |
| JS: WebSocket | Connection management, message routing (RTVI vs audio), reconnection handling |
| JS: Audio Capture | AudioWorklet (preferred) or ScriptProcessorNode (fallback) for mic capture at 16kHz mono |
| JS: Audio Playback | AudioBufferSourceNode with scheduling for gapless bot audio playback |
| JS: Resampling | Linear interpolation resampler for converting between browser AudioContext rate and 16kHz |
| JS: UI | Status indicator (4 states: disconnected/connecting/connected/error), transcript panel, timestamped debug log |

## Binary Message Format

```
[0x22] [outer_len: varint] [0x0A] [json_len: varint] [JSON UTF-8 bytes]
```

Example for `{"label":"rtvi-ai","type":"client-ready",...}`:
```
22 c0 02 0a bd 02 + JSON bytes
```

- `0x22` = outer field tag (field 4, wire type 2 - length-delimited)
- `outer_len` = length of everything after the outer varint (covers 0x0A + inner_varint + JSON)
- `0x0A` = inner field tag (field 1, wire type 2 - length-delimited)
- `inner_len` = length of JSON payload in bytes
- Audio data is sent as raw Float32 PCM (without the protobuf wrapper)

## RTVI Message Flow

1. WebSocket connects
2. Client sends `client-ready` with library info and platform details
3. Server responds with `bot-ready` - connection is established
4. Client streams mic audio as raw PCM Float32 binary frames
5. Server streams bot audio as raw PCM Float32 binary frames
6. Server sends `user-transcription` and `bot-output` JSON messages for text
7. On disconnect, client sends `disconnect-bot` then closes the WebSocket

## Deploy Instructions

### Local Development
Simply open `index.html` in a browser. No web server required (works with `file://` protocol).

### Production Deployment
Serve the file from any static web server:

**Nginx:**
```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/pipecat-client;

    location / {
        try_files $uri /index.html;
    }

    # Ensure correct MIME types
    include /etc/nginx/mime.types;
}
```

**IIS (Windows):**
1. Copy `index.html` to your site's physical path (e.g., `C:\inetpub\wwwroot\pipecat-client\`)
2. Ensure the MIME type `.html` maps to `text/html` (default in IIS)

**Python (quick serve):**
```bash
python -m http.server 8080
```

### Docker
```dockerfile
FROM nginx:alpine
COPY index.html /usr/share/nginx/html/
EXPOSE 80
```

## CORS Notes

WebSocket connections are subject to the browser's same-origin policy:

- The WebSocket handshake includes an `Origin` header automatically set by the browser
- The Pipecat server at `aeon-pipecat.securityzone.vn` must accept WebSocket connections from the origin where this HTML file is served
- If serving from a different domain, the server must be configured to allow the connection
- Unlike HTTP requests, WebSocket connections do not require preflight (OPTIONS) requests
- If connection fails with a 403 or similar, verify the server allows WebSocket connections from your origin

For local development (file:// protocol), the `Origin` header is typically `null` or empty - ensure the server accepts this.

## Browser Compatibility

| Feature | Chrome | Edge | Firefox | Safari |
|---------|--------|------|---------|--------|
| WebSocket | Yes | Yes | Yes | Yes |
| Web Audio API | Yes | Yes | Yes | Yes |
| getUserMedia | Yes | Yes | Yes | Yes (requires HTTPS) |
| AudioWorklet | Yes (66+) | Yes (79+) | Yes (76+) | Yes (14.1+) |
| ScriptProcessorNode (fallback) | Yes | Yes | Yes | Yes |

## Limitations

- Single session at a time (one WebSocket connection)
- No echo cancellation beyond browser built-in (rely on `echoCancellation: true` constraint)
- Audio resampling is linear interpolation (adequate for speech, not studio quality)
- ScriptProcessorNode fallback introduces slightly higher latency than AudioWorklet
- Debug log is capped at 300 entries to prevent memory issues
