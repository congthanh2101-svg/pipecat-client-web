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

Mở trình duyệt tại địa chỉ hiển thị trong terminal (mặc định `http://localhost:5173/ac/pipecat-client-web/`).

## Build

```bash
npm run build
```

Output trong thư mục `dist/`.

## Deploy

Copy thư mục `dist/` lên web server. Ứng dụng được cấu hình với `base: '/ac/pipecat-client-web/'`, do đó cần được serve tại path tương ứng trên web server.

Ví dụ với IIS:
```
C:\inetpub\AC\pipecat-client-web\dist\
```

## Cấu hình CORS

Pipecat AI Server (`wss://aeon-pipecat.securityzone.vn`) cần cho phép origin từ web server đang serve ứng dụng này.

## Giao thức RTVI

### Message binary format

```
[0x22] [outer_len: varint] [0x0A] [json_len: varint] [JSON payload]
```

### Message flow

1. WebSocket connected -> gửi `client-ready`
2. Nhận `bot-ready` -> kết nối sẵn sàng
3. Gửi/nhận audio binary data (PCM 16-bit @ 16000Hz mono)
4. Nhận `user-transcription`, `bot-output` messages
5. Ngắt kết nối: gửi `disconnect-bot`, đóng WebSocket

### Audio format

- Input: PCM Int16 @ 16000Hz, mono, captured từ microphone
- Output: PCM Int16 @ 16000Hz, mono, playback qua AudioContext

## Kiến trúc

```
src/
├── main.ts       Entry point, UI initialization
├── style.css     Dark theme styles
├── protocol.ts   RTVI message encode/decode
├── websocket.ts  WebSocket connection manager
├── audio.ts      Audio capture and playback
├── logger.ts     Debug logging to DOM
└── ui.ts         Vanilla DOM helpers
```

## So sánh với các approach khác

| Tiêu chí | Approach A (Plain HTML/JS) | Approach B (jQuery) | Approach C (Vite + TS) |
|---|---|---|---|
| Build tool | Không | Không | Vite |
| TypeScript | Không | Không | Có |
| Module system | Global scripts | Global scripts | ES Modules |
| Tree shaking | Không | Không | Có |
| Dev server (HMR) | Không | Không | Có |
| Production build | Không | Không | Có (minify, bundle) |
| Type safety | Không | Không | Có |
| Code organization | File order matters | File order matters | Imports |
| Deployment | Copy raw files | Copy raw files | Copy dist/ |
| Complexity | Thấp | Thấp | Trung bình |
