# Approach A - Single HTML File (Pipecat SDK)

A self-contained HTML client for connecting to Pipecat AI Server via WebSocket using the RTVI protocol. Built with `pipecat-sdk.js` — a custom SDK wrapping `BotClient` + `WebSocketTransport`.

## Công nghệ sử dụng

- **HTML + CSS + JavaScript** thuần (single file, zero dependencies)
- **pipecat-sdk.js** — Custom SDK (BotClient + WebSocketTransport)
- **Web Audio API** — Audio capture and playback
- **WebSocket** — Real-time communication

## Yêu cầu hệ thống

- Trình duyệt hỗ trợ WebRTC (Chrome, Firefox, Edge)
- Microphone

## Cách sử dụng

1. Mở `index.html` trong trình duyệt (hoặc serve qua web server)
2. Nhập số điện thoại (mặc định: `0909835115`)
3. Click **Connect**
4. Cấp quyền microphone
5. Nói — transcript hiển thị bên trái, bot trả lời qua loa
6. Click **Disconnect** để kết thúc

## Cấu trúc file

```
approach-a-html/
  index.html     - Main application (HTML + CSS + JS + SDK)
  assets/
    pipecat-sdk.js - Pipecat Client SDK (BotClient + WebSocketTransport)
  README.md      - This file
  BUG_REPORT.md  - Bug report from initial testing
```

## Kiến trúc

| Thành phần | Mô tả |
|------------|-------|
| HTML | Header, status indicator, phone input, connect/disconnect button, transcript panel, debug log |
| CSS | Dark theme, flexbox layout, status animations |
| SDK: BotClient | Quản lý kết nối bot, initiator chain, event callbacks |
| SDK: WebSocketTransport | WebSocket transport với protobuf bridge protocol |
| SDK: Audio | WavRecorder (AudioWorklet @ 8000Hz) cho mic, MediaStream cho bot audio |
| UI Code | 3 sections: Debug Logging, Status Management, Transcript |

## Giao thức

### Bridge Protocol

1. **POST** `/connect` → nhận `{ ws_url: "wss://..." }`
2. **WebSocket** connect tới `ws_url`
3. Gửi RTVI `client-ready` → nhận `bot-ready`
4. Gửi audio dạng Int16 PCM
5. Nhận RTVI JSON messages (transcript, bot output)
6. Nhận audio dạng Int16 PCM → phát qua `<audio>` element

So với code cũ (kết nối trực tiếp `wss://aeon-pipecat.securityzone.vn/ws`), code mới sử dụng bridge server để lấy WebSocket URL.

## Các chỉnh sửa so với code gốc

### index.html — Tổng quan

| Thay đổi | Trước | Sau |
|----------|-------|-----|
| **Engine** | Raw WebSocket + manual RTVI encode/decode (~550 dòng custom code) | `BotClient` + `WebSocketTransport` từ `pipecat-sdk.js` |
| **Connection** | WebSocket trực tiếp tới `wss://aeon-pipecat.securityzone.vn/ws` với URL override logic | POST `https://rtstt-demo.securityzone.vn/connect` → nhận wsUrl → SDK connect |
| **Audio capture** | AudioWorklet (custom `audio_processor`) hoặc ScriptProcessorNode fallback | SDK tự quản lý (WavRecorder, AudioWorklet @ 8000Hz) |
| **Bot audio playback** | Protobuf frame extract → Int16→Float32 → resample → AudioBufferSourceNode với scheduling | `<audio autoplay>` element với `srcObject` từ `pcClient.tracks().bot.audio` |
| **RTVI messages** | Manual 0x22 decode + JSON parse + switch case | SDK callbacks: `onBotReady`, `onUserTranscript`, `onBotTranscript`, `onTrackStarted` |
| **client-ready version** | `1.0.0` | `1.3.0` |
| **Mic forwarding** | Gate trên `bot-tts-stopped` event (greeting completion) | SDK tự quản lý |
| **Keepalive** | RTVI ping heartbeat + silence frame generator | SDK tự quản lý |
| **Code size** | ~750 dòng JS (custom) | ~80 dòng JS + SDK |

### Chi tiết thay đổi

#### Kết nối

```javascript
// TRƯỚC: Kết nối trực tiếp với URL override logic
const DIRECT_WS = 'wss://aeon-pipecat.securityzone.vn/ws';
const params = new URLSearchParams(window.location.search);
const wsOverride = params.get('ws');
// ... logic phức tạp để chọn direct/proxy/default URL ...
ws = new WebSocket(WS_URL);

// SAU: Bridge server qua SDK
pcClient = new BotClient({
  transport: new WebSocketTransport(),
  enableMic: true,
  callbacks: { onConnected, onDisconnected, onBotReady, ... }
});
await pcClient.initDevices();
await pcClient.startBotAndConnect({ endpoint: CONNECT_URL });
```

#### Audio capture

```javascript
// TRƯỚC: AudioWorklet + Float32→Int16 + resampling + silence keepalive
// ~200 dòng: AudioProcessor worklet, readChannelData, formatAudioData, floatTo16BitPCM

// SAU: SDK tự xử lý capture
// enableMic: true → SDK tự tạo WavRecorder, gửi audio qua transport
```

#### Bot audio

```javascript
// TRƯỚC: protobuf frame parse + Int16→Float32 + resample + BufferSource scheduling
function extractAudioFromFrame(data) { /* scan 0x12 frame */ }
function playInt16PCM(int16Buffer) { /* convert + resample + schedule */ }

// SAU: MediaStreamTrack → <audio> element
function setupBotAudio(track) {
  botAudio.srcObject = new MediaStream([track]);
}
```

## Debug history

| # | Vấn đề | Nguyên nhân | Fix |
|---|--------|-------------|-----|
| 1 | Server đóng kết nối ngay sau bot-ready (code 1000) | Server chờ HTTP startBot hoặc audio input không có | Chuyển sang SDK flow (startBotAndConnect), update RTVI version |
| 2 | ScriptProcessorNode audio feedback loop | ScriptProcessorNode output connect trực tiếp tới destination | Route qua GainNode (gain = 0) |
| 3 | AudioContext không resume | Chrome khởi tạo AudioContext ở trạng thái suspended | Thêm `await audioCtx.resume()` |
| 4 | Thiếu bot speaking indicator | Không handler cho bot-tts-started/stopped | Thêm UI indicator (sau này chuyển sang SDK callback) |
| 5 | Audio queue không handle interruption | nextPlayTime không được flush khi bot nói mới | Clear queue khi bot-tts-started |
| 6 | RTVI version sai | Gửi version 1.0.0 thay vì 1.3.0 | Đổi thành 1.3.0 |
| 7 | Không WebSocket keepalive | Không ping/pong | RTVI ping mỗi 15s (sau này SDK tự quản lý) |

## So sánh với các approach khác

| Tiêu chí | Approach A (HTML/SDK) | Approach B (React) | Approach C (Vite + TS) |
|---|---|---|---|
| Framework | Không (SDK) | React 18 | Không (vanilla) |
| TypeScript | Không | Có | Có |
| Bundle size | ~18KB (HTML) + SDK | ~152KB JS | ~12KB JS |
| SDK | `pipecat-sdk.js` (custom BotClient) | `@pipecat-ai/client-js` | Tự implement WebSocket + Audio |
| Bridge protocol | Có (qua SDK) | Có (protobuf) | Có (protobuf) |
| Mic constraints | SDK quản lý (default) | `{ audio: true }` | `{ audio: true }` |
| Bot audio | `<audio>` element (MediaStream) | AudioBuffer + source | AudioBuffer + source |
| Initiator chain | BotClient (SDK) | PipecatClient | startBot/connect/startBotAndConnect |

## Chất lượng âm thanh (STT)

| Tham số | Giá trị | Ghi chú |
|---------|---------|---------|
| Mic constraints | SDK default | SDK WavRecorder quản lý capture |
| Audio sample rate | 8000 Hz (WavRecorder) | SDK worklet xử lý |
| Float32 → Int16 | `s<0 ? s*0x8000 : s*0x7fff` | Công thức chuẩn Int16 PCM |
| AudioWorklet buffer | 4096 samples | WavRecorder default |

Chi tiết: xem [`docs/audio-quality-parameters.md`](../approach-b-react/docs/audio-quality-parameters.md).

## Ghi chú triển khai

- **Local:** Có thể mở trực tiếp `index.html` bằng `file://` protocol
- **Production:** Serve qua web server (IIS, Nginx). File đang deploy tại `C:\inetpub\AC\pipecat-client-web\html\`
- URL public: `https://web.securityzone.vn/ac/pipecat-client-web/html/`
