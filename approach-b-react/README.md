# Approach B: React App (Vite + React + TypeScript)

Giao dien ket noi toi Pipecat AI Server qua WebSocket voi giao thuc RTVI.

## Mo ta Approach

Day la ung dung React su dung WebSocket truc tiep de giao tiep voi Pipecat AI Server. Khong su dung thu vien `@pipecat-ai/client-js` cho transport -- thay vao do, tu implement toan bo giao thuc RTVI bao gom:

- **Ma hoa/giai ma binary message** theo dinh dang Protobuf-like cua Pipecat
- **Quan ly WebSocket** va cac message RTVI (client-ready, bot-ready, disconnect-bot)
- **Xu ly audio** truc tiep qua WebRTC getUserMedia va AudioContext

### Diem khac biet so voi cac approach khac:

| Approach | Mo ta |
|----------|-------|
| A | Su dung `@pipecat-ai/client-js` Daily transport |
| **B (approach nay)** | WebSocket truc tiep, tu implement RTVI binary protocol |
| C | Su dung `@pipecat-ai/client-js` voi custom transport |

**Uu diem cua Approach B:**
- Kiem soat hoan toan qua trinh giao tiep
- Khong phu thuoc vao thu vien ben thu ba cho transport
- De debug va mo rong

**Nhuoc diem:**
- Can tu implement ma hoa/giai ma binary
- Nhieu code hon so voi dung SDK

## Yeu cau he thong

- **Node.js** 18+ (khuyen nghi 20 LTS)
- **npm** 9+
- Trinh duyet ho tro WebRTC (Chrome, Firefox, Edge, Safari)

## Cai dat

```bash
cd approach-b-react
npm install
```

## Phat trien (Development)

```bash
npm run dev
```

Mo trinh duyet tai `http://localhost:5173` (port co the khac neu 5173 da duoc su dung).

## Build

```bash
npm run build
```

San pham build se nam trong thu muc `dist/`.

## Deploy

1. Build project: `npm run build`
2. Copy toan bo thu muc `dist/` len web server
3. Cau hinh web server de phuc vu SPA (Single Page Application):
   - Tat ca request khong phai file tinh phai tra ve `index.html`
   - Vi du voi Nginx:
     ```nginx
     location /ac/pipecat-client-web/ {
         alias /var/www/pipecat-client-web/;
         try_files $uri $uri/ /ac/pipecat-client-web/index.html;
     }
     ```
   - Voi IIS: Su dung URL Rewrite module

### CORS Configuration

Neu backend Pipecat Server nam o domain khac, can cau hinh CORS:

**Tren Pipecat Server:**
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: *
```

**WebSocket** khong bi anh huong boi CORS -- chi can dam bao WebSocket server chap nhan ket noi tu origin cua web client.

## Cau truc du an

```
approach-b-react/
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── vite.config.ts
├── README.md
└── src/
    ├── main.tsx                   # Entry point
    ├── App.tsx                    # Main component + layout
    ├── App.css                    # Dark theme styles
    ├── vite-env.d.ts              # Vite type declarations
    ├── protocol/
    │   ├── encode.ts              # Binary message encoding (RTVI)
    │   ├── decode.ts              # Binary message decoding (RTVI)
    │   └── types.ts               # RTVI message type definitions
    ├── websocket/
    │   └── useWebSocket.ts        # React hook for WebSocket + RTVI protocol
    ├── audio/
    │   └── useAudio.ts            # React hook for mic/speaker audio
    └── components/
        ├── ConnectForm.tsx        # Phone input + Connect/Disconnect button
        ├── StatusPanel.tsx        # Connection status indicator
        ├── DebugLog.tsx           # Scrollable debug log panel
        └── Transcript.tsx         # Conversation transcript display
```

## Cong nghe su dung

- **Vite** 5 - Build tool
- **React** 18 - UI library
- **TypeScript** 5 - Type safety
- **WebSocket API** - Native browser WebSocket
- **Web Audio API** - Audio capture and playback

## Giao thuc

### WebSocket URL

```
wss://aeon-pipecat.securityzone.vn/ws?phone={phone}&conv&conversation_id={uuid}
```

### Binary Message Format

```
[0x22] [outer_len: varint] [0x0A] [json_len: varint] [JSON payload]
```

### Message Flow

1. WebSocket ket noi -> gui `client-ready`
2. Nhan `bot-ready` -> ket noi thanh cong
3. Gui/nhan audio binary data (Float32 PCM, 16kHz, mono)
4. Nhan `user-transcription`, `bot-output` messages
5. Ngat ket noi: gui `disconnect-bot` -> dong WebSocket
