# Approach C: Vite + Vanilla TypeScript

Giao diện kết nối tới Pipecat AI Server qua WebSocket sử dụng giao thức RTVI (Real-Time Voice Interaction). Xây dựng với Vite + vanilla TypeScript, không sử dụng framework.

## Yêu cầu

- Node.js 18+

## Cài đặt

```bash
npm install
```

## Development

```bash
npm run dev
```

Mở trình duyệt tại địa chỉ hiển thị trong terminal (mặc định `http://localhost:5173/ac/pipecat-client-web/vite/`).

## Build

```bash
npm run build
```

Output trong thư mục `dist/`.

## Deploy

Copy thư mục `dist/` lên web server. Ứng dụng được cấu hình với `base: '/ac/pipecat-client-web/vite/'`, do đó cần được serve tại path tương ứng trên web server.

Ví dụ với IIS:
```
C:\inetpub\AC\pipecat-client-web\vite\
```

## Cấu hình CORS

Pipecat AI Server cần cho phép origin từ web server đang serve ứng dụng này.

## Kiến trúc

```
src/
├── main.ts       Entry point, UI initialization
├── style.css     Dark theme styles
├── protocol.ts   RTVI message encode/decode + Protobuf helpers
├── websocket.ts  WebSocket manager + initiator chain
├── audio.ts      Audio capture (protobuf) and playback
├── logger.ts     Debug logging to DOM
└── ui.ts         Vanilla DOM helpers
```

## Giao thức

### Bridge Protocol (giống Approach B)

Kết nối qua bridge server:

1. **POST** `/connect` (empty body) → nhận `{ ws_url: "wss://..." }`
2. **WebSocket** connect tới `ws_url`
3. Gửi RTVI `client-ready` → nhận `bot-ready`
4. Gửi audio dạng **protobuf AudioRawFrame** (Int16 PCM)
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

### Message flow

1. WebSocket connected → gửi `client-ready`
2. Nhận `bot-ready` → kết nối sẵn sàng
3. Gửi audio dạng protobuf AudioRawFrame (Int16 PCM @ 16000Hz mono)
4. Nhận `user-transcription`, `bot-output` messages
5. Ngắt kết nối: gửi `disconnect-bot`, đóng WebSocket

## Initiator Chain

Kế thừa từ `@pipecat-ai/client-js`:

```
startBot(endpoint)           → POST /connect (empty body) → trả về wsUrl
connect(wsUrl)               → WebSocket connect → Promise<void>
startBotAndConnect(endpoint) → await startBot → await connect
```

## Các chỉnh sửa so với code gốc

### Chất lượng âm thanh (STT)

| Tham số | Giá trị | Ghi chú |
|---------|---------|---------|
| Mic constraints | `{ audio: true }` | Không dùng explicit echoCancellation / noiseSuppression — tránh browser xử lý quá aggressive làm giảm chất lượng STT |
| AudioContext sampleRate | 16000 Hz | Bridge server kỳ vọng 16kHz |
| Gain boost | Không dùng | Gain gây clipping, không cải thiện STT |
| Float32 → Int16 | `s<0 ? s*0x8000 : s*0x7fff` | Công thức chuẩn, giống `pipecat-sdk.js` |
| ScriptProcessor bufferSize | 4096 | 256ms mỗi chunk |

Chi tiết: xem [`docs/audio-quality-parameters.md`](../approach-b-react/docs/audio-quality-parameters.md).

### Kết nối

| Thay đổi | Trước | Sau |
|----------|-------|-----|
| Endpoint | WebSocket trực tiếp `wss://aeon-pipecat.securityzone.vn/ws` | POST `https://rtstt-demo.securityzone.vn/connect` → nhận wsUrl |
| Request body | phone + conversation_id | Empty body (content-length: 0) |
| wsUrl key | — | Xử lý cả `wsUrl` và `ws_url` |
| Audio format | Raw Int16 PCM (gửi thẳng) | Protobuf AudioRawFrame (field 2 → field 3) |
| Bot audio | Raw Int16 PCM → play trực tiếp | Protobuf AudioRawFrame → decode → play |
| Message format | Raw RTVI 0x22 | Protobuf MessageFrame (0x22 byte layout tương thích) |

### Code structure

| File | Chức năng |
|------|-----------|
| `protocol.ts` | Thêm `encodeAudioFrame()`, `decodeAudioFrame()`, `isAudioFrame()`, `int16ToFloat32()` |
| `websocket.ts` | Thêm `startBot()`, `startBotAndConnect()`; đổi `connect()` nhận wsUrl; xử lý snake_case |
| `audio.ts` | Bọc Int16 PCM trong protobuf trước khi gửi; decode protobuf trước khi play; zero-gain node giữ audio graph alive |
| `main.ts` | Gọi `startBotAndConnect(endpoint)` thay vì `connect(phone, convId)` |

## So sánh với các approach khác

| Tiêu chí | Approach A (HTML/JS) | Approach B (React) | Approach C (Vite + TS) |
|---|---|---|---|
| Build tool | Không | Vite | Vite |
| Framework | Không | React 18 | Không (vanilla) |
| TypeScript | Không | Có | Có |
| Bundle size | ~15KB | ~152KB JS | ~12KB JS |
| Bridge protocol | Không | Có (protobuf) | Có (protobuf) |
| Mic constraints | `{ audio: true }` | `{ audio: true }` | `{ audio: true }` |
| Initiator chain | BotClient | PipecatClient | startBot/connect/startBotAndConnect |
| Deployment | Copy file | Build + deploy / Vite dev | Build + deploy / Vite dev |
