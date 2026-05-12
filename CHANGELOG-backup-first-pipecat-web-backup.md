# Pipecat Client Web — Changelog

**So sánh:** `origin/main` (fork gốc) → `first-pipecat-web-backup` (bản deploy)

**Thống kê:** 48 files thay đổi, +8,489 dòng thêm mới, 1 dòng sửa

---

## 1. Thay đổi duy nhất từ fork gốc

### `client-js/README.md` — 1 dòng sửa

- **Trước:** `endpoint: "https://your-connect-end-point-here/connect"`
- **Sau:** `endpoint: "https://rtstt-demo.securityzone.vn/connect"`

Cập nhật endpoint mẫu trỏ tới server Pipecat thật.

---

## 2. Files mới bổ sung

### 2.1. Cấu hình & Hướng dẫn AI

| File | Mô tả |
|------|-------|
| `CLAUDE.md` | Behavioral guidelines cho AI assistant khi làm việc với codebase |
| `.claude/settings.local.json` | Local permission settings cho Claude Code |

### 2.2. Landing Page

| File | Mô tả |
|------|-------|
| `index.html` | Trang chủ cho phép chọn 1 trong 3 approaches. Gradient dark theme, card layout. Links: `/html/`, `/react/`, `/vite/` |

### 2.3. Plan Document

| File | Mô tả |
|------|-------|
| `pipecat-ai-plan.html` | Tài liệu kiến trúc đầy đủ (~604 dòng). Bao gồm: protocol RTVI, binary framing, 3 approaches, hướng dẫn deploy IIS |

### 2.4. Approach A — HTML thuần

**Thư mục:** `approach-a-html/`

| File | Dòng | Mô tả |
|------|------|-------|
| `index.html` | 907 | Self-contained HTML. Bao gồm: UI, WebSocket, binary protocol encode/decode, AudioWorklet + ScriptProcessorNode fallback, PCM Float32 16kHz |
| `README.md` | 140 | Hướng dẫn sử dụng approach A |

**Đặc điểm:** Zero dependencies, 1 file duy nhất, deploy bằng copy file.

### 2.5. Approach B — React + Vite + TypeScript

**Thư mục:** `approach-b-react/` (14 files)

| File | Dòng | Mô tả |
|------|------|-------|
| `index.html` | 13 | Entry HTML |
| `package.json` | 23 | Dependencies: React 18, Vite, TypeScript |
| `vite.config.ts` | 8 | Base path: `/ac/pipecat-client-web/react/` |
| `tsconfig.json` / `tsconfig.app.json` | 27 | TypeScript config |
| `src/main.tsx` | 9 | React entry point |
| `src/App.tsx` | 103 | Main App component, layout 2 cột |
| `src/App.css` | 471 | Styles |
| `src/components/ConnectForm.tsx` | 64 | Form nhập phone number, conversation ID, connect button |
| `src/components/StatusPanel.tsx` | 50 | Connection status indicator |
| `src/components/DebugLog.tsx` | 42 | Debug log panel |
| `src/components/Transcript.tsx` | 44 | Transcript hiển thị hội thoại |
| `src/websocket/useWebSocket.ts` | 204 | WebSocket React hook: connect, disconnect, binary message handling, auto-reconnect |
| `src/audio/useAudio.ts` | 149 | Audio React hook: getUserMedia, AudioContext, resample 16kHz, playback |
| `src/protocol/encode.ts` | 34 | Binary message encode (varint + JSON payload) |
| `src/protocol/decode.ts` | 33 | Binary message decode |
| `src/protocol/types.ts` | 75 | TypeScript types cho RTVI protocol |

**Đặc điểm:** Component architecture, dễ mở rộng, React 18.

### 2.6. Approach C — Vanilla JS + Vite + TypeScript

**Thư mục:** `approach-c-vite/` (11 files)

| File | Dòng | Mô tả |
|------|------|-------|
| `index.html` | 66 | Entry HTML với đầy đủ UI structure |
| `package.json` | 16 | Dependencies: Vite, TypeScript |
| `vite.config.ts` | 6 | Base path: `/ac/pipecat-client-web/vite/` |
| `tsconfig.json` | 20 | TypeScript config |
| `src/main.ts` | 165 | App logic chính: WebSocket events, UI binding, bot interaction |
| `src/ui.ts` | 71 | DOM manipulation helpers, status updates, transcript rendering |
| `src/style.css` | 310 | Styles |
| `src/websocket.ts` | 130 | WebSocket manager: connect/disconnect, binary message handling, heartbeat |
| `src/audio.ts` | 96 | Audio manager: getUserMedia, AudioContext, resample, playback |
| `src/protocol.ts` | 72 | Binary RTVI protocol encode/decode + types |
| `src/logger.ts` | 38 | Debug logger |

**Đặc điểm:** Nhẹ nhất (~9.7KB JS bundle), TypeScript + Vite fast refresh.

### 2.7. Build Output (deployed lên IIS)

| File | Mô tả |
|------|-------|
| `html/index.html` | Approach A đã deploy (giống `approach-a-html/index.html`) |
| `react/index.html` | Approach B built output |
| `react/assets/index-*.js` | React bundle (~152KB JS) |
| `react/assets/index-*.css` | React styles |
| `vite/index.html` | Approach C built output |
| `vite/assets/index-*.js` | Vite bundle (~9.7KB JS) |
| `vite/assets/index-*.css` | Vite styles |

---

## 3. Kiến trúc tổng thể

```
C:\inetpub\AC\pipecat-client-web\
├── index.html                  ← Landing page (mới)
├── pipecat-ai-plan.html        ← Plan document (mới)
├── CLAUDE.md                   ← AI guidelines (mới)
│
├── approach-a-html/            ← Source code Approach A (mới)
│   └── index.html
├── html/                       ← Deployed Approach A (mới)
│   └── index.html
│
├── approach-b-react/           ← Source code Approach B (mới)
│   └── src/
├── react/                      ← Deployed Approach B (mới)
│   ├── index.html
│   └── assets/
│
├── approach-c-vite/            ← Source code Approach C (mới)
│   └── src/
├── vite/                       ← Deployed Approach C (mới)
│   ├── index.html
│   └── assets/
│
├── client-js/                  ← Fork gốc (giữ nguyên, chỉ sửa README)
├── client-react/               ← Fork gốc (giữ nguyên)
└── package.json / etc.         ← Fork gốc (giữ nguyên)
```

## 4. Giao thức RTVI Binary

Cả 3 approach đều implement cùng một giao thức WebSocket binary:

```
[0x22][outer_len:varint][0x0A][json_len:varint][UTF-8 JSON payload]
```

- WebSocket URL: `wss://aeon-pipecat.securityzone.vn/ws?phone={phone}&conv&conversation_id={uuid}`
- Audio codec: PCM Float32 16000Hz mono
- RTVI Protocol v1.0
