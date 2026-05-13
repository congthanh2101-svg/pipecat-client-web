# Approach B: React App (Vite + React + TypeScript)

Giao diện kết nối tới Pipecat AI Server qua WebSocket sử dụng giao thức RTVI, xây dựng với React + Vite + TypeScript.

## Công nghệ sử dụng

- **Vite** 5 — Build tool
- **React** 18 — UI library
- **TypeScript** 5 — Type safety
- **@pipecat-ai/client-js** ^1.8.0 — Pipecat Client SDK
- **Web Audio API** — Audio capture and playback

## Yêu cầu hệ thống

- **Node.js** 18+ (khuyến nghị 20 LTS)
- **npm** 9+
- Trình duyệt hỗ trợ WebRTC (Chrome, Firefox, Edge)

## Cài đặt

```bash
cd approach-b-react
npm install
```

## Phát triển (Development)

```bash
npm run dev
```

Mở trình duyệt tại `http://localhost:5173/ac/pipecat-client-web/react/`.

## Build

```bash
npm run build
```

Output trong thư mục `dist/`.

## Cấu trúc dự án

```
approach-b-react/
├── index.html
├── package.json
├── vite.config.ts
├── README.md
├── docs/
│   └── audio-quality-parameters.md    # Audio quality parameter docs
└── src/
    ├── main.tsx                   # Entry point
    ├── App.tsx                    # Main component + layout
    ├── App.css                    # Dark theme styles
    ├── hooks/
    │   └── usePipecatClient.ts    # PipecatClient hook (connect/disconnect/state)
    └── transport/
        └── WebSocketTransport.ts  # Custom transport: protobuf bridge protocol
```

## Giao thức

### Bridge Protocol

Kết nối qua bridge server:

1. **POST** `/connect` (empty body) → nhận `{ ws_url: "wss://..." }`
2. **WebSocket** connect tới `ws_url`
3. Gửi RTVI `client-ready` → nhận `bot-ready`
4. Gửi audio dạng **protobuf AudioRawFrame** (Int16 PCM @ 16000Hz mono)
5. Nhận message dạng **protobuf MessageFrame** (RTVI JSON)
6. Nhận audio dạng **protobuf AudioRawFrame** (Int16 PCM) → playback

### Protobuf Frame Format

```
Frame (oneof):
  2: AudioRawFrame { 3: audio (Int16 PCM bytes), 4: sample_rate, 5: num_channels }
  4: MessageFrame   { 1: data (JSON string) }
```

Byte layout:
- Audio: `0x12 [len_varint] 0x1A [len_varint] [PCM] 0x20 [sr_varint] 0x28 [nc_varint]`
- Message: `0x22 [len_varint] 0x0A [len_varint] [JSON]`

MessageFrame (field 4) trùng byte layout với RTVI 0x22 format gốc.

### Initiator Chain (PipecatClient)

```
PipecatClient.startBotAndConnect({ endpoint })
  ├── startBot({ endpoint })        → POST /connect → nhận connection params
  └── transport.connect(params)     → WebSocket connect
       └── transport._connect()     → ws.onopen → bắt đầu gửi audio
```

## Chất lượng âm thanh (STT)

| Tham số | Giá trị | Ghi chú |
|---------|---------|---------|
| Mic constraints | `{ audio: true }` | Không dùng explicit echoCancellation / noiseSuppression — tránh browser xử lý aggressive làm giảm chất lượng STT |
| AudioContext sampleRate | 16000 Hz | Bridge server kỳ vọng 16kHz |
| Gain boost | Không dùng | Gain gây clipping, không cải thiện STT |
| Float32 → Int16 | `s<0 ? s*0x8000 : s*0x7fff` | Công thức chuẩn, giống `pipecat-sdk.js` |
| ScriptProcessor bufferSize | 4096 | 256ms mỗi chunk |

Chi tiết: xem [`docs/audio-quality-parameters.md`](docs/audio-quality-parameters.md).

## Các chỉnh sửa so với code gốc

### WebSocketTransport.ts

| Thay đổi | Trước | Sau |
|----------|-------|-----|
| **Mic constraints** | `{ channelCount: exact(1), sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true }` | `{ audio: true }` |
| **Gain boost** | GainNode ×2.0 (6dB) | Không gain |
| **Audio graph** | source → gain → processor → MediaStreamDestination | source → processor → zero-gain → destination |
| **Bot audio playback** | AudioBuffer + source → dest | Giữ nguyên (cơ chế tương tự) |
| **Protobuf encode** | Thêm `encodeAudioFrame()`, `decodeAudioFrame()` | Manual varint encoding (không thư viện) |

### usePipecatClient.ts

| Thay đổi | Trước | Sau |
|----------|-------|-----|
| **enableMic** | `false` + gọi `initDevices()` trước | Giữ nguyên (cần thiết cho initiator chain) |
| **endpoint** | `https://rtstt-demo.securityzone.vn/connect` | Giữ nguyên |
| **requestData** | Không gửi (empty body) | Giữ nguyên |

### Quá trình debug

1. **Lỗi:** Bot không nghe được gì (connection drop sau ~1.4s)
   - **Nguyên nhân:** Gửi raw Float32 PCM thay vì protobuf AudioRawFrame với Int16 PCM
   - **Fix:** Implement `encodeAudioFrame()` — bọc Int16 PCM trong protobuf frame

2. **Lỗi:** STT nhận dạng rất kém, phải nói rất to nhiều lần
   - **Nguyên nhân:** Explicit mic constraints (`echoCancellation` + `noiseSuppression` + `autoGainControl`) làm browser xử lý âm thanh aggressive
   - **Fix:** Đổi thành `{ audio: true }` (giống Approach A), bỏ GainNode ×2.0

3. **Lỗi:** ScriptProcessorNode không firing
   - **Nguyên nhân:** Audio graph không được giữ alive
   - **Fix:** Connect processor → zero-gain node → audioContext.destination

## So sánh với các approach khác

| Tiêu chí | Approach A (HTML/JS) | Approach B (React) | Approach C (Vite + TS) |
|---|---|---|---|
| Framework | Không | React 18 | Không (vanilla) |
| TypeScript | Không | Có | Có |
| Bundle size | ~15KB | ~152KB JS | ~12KB JS |
| SDK | `pipecat-sdk.js` (custom) | `@pipecat-ai/client-js` | Tự implement |
| Bridge protocol | Không | Có (protobuf) | Có (protobuf) |
| Mic constraints | `{ audio: true }` | `{ audio: true }` | `{ audio: true }` |
| Initiator chain | BotClient | PipecatClient | startBot/connect/startBotAndConnect |
