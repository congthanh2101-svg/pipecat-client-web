# Approach C1: Vite + Vanilla TypeScript (with Settings Panel)

Giao diện kết nối tới Pipecat AI Server qua WebSocket sử dụng giao thức RTVI (Real-Time Voice Interaction). Xây dựng với Vite + vanilla TypeScript.

Kế thừa từ Approach C, bổ sung **Settings panel** cho phép tùy chỉnh thông số âm thanh và xử lý audio quality.

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

Mở trình duyệt tại địa chỉ hiển thị trong terminal (mặc định `http://localhost:5173/ac/pipecat-client-web/vite-c1/`).

## Build

```bash
npm run build
```

Output trong thư mục `dist/`.

## Deploy

Copy thư mục `dist/` lên web server. Ứng dụng được cấu hình với `base: '/ac/pipecat-client-web/vite-c1/'`, do đó cần được serve tại path tương ứng.

Ví dụ với IIS:
```
C:\inetpub\AC\pipecat-client-web\vite-c1\
```

## Cấu hình CORS

Pipecat AI Server cần cho phép origin từ web server đang serve ứng dụng này.

## Kiến trúc

```
src/
├── main.ts           Entry point, UI initialization, settings wiring
├── style.css         Dark theme styles + settings panel
├── audio.ts          Audio capture + playback (dual AudioContext)
├── protocol.ts       RTVI message encode/decode + Protobuf helpers
├── settings.ts       AppSettings interface + SettingsManager
├── settings-ui.ts    Settings panel DOM construction + events
├── websocket.ts      WebSocket manager + initiator chain
├── logger.ts         Debug logging to DOM
└── ui.ts             Vanilla DOM helpers
```

## Settings Panel

Approach C1 có Settings panel với 10 thông số có thể tùy chỉnh:

| Thông số | Mặc định | Mô tả |
|----------|----------|-------|
| Sample Rate | 8000 Hz | Tần số lấy mẫu microphone |
| Mic Constraint | Best STT | `{ audio: true }` — trình duyệt tự chọn xử lý tối ưu cho STT |
| Audio Format | Protobuf Int16 | Định dạng đóng gói audio gửi lên server |
| Server URL | `https://rtstt-demo.securityzone.vn/connect` | Endpoint kết nối Pipecat AI Server |
| Audio Processor | AudioWorklet | Phương thức xử lý audio (AudioWorklet ít dropout hơn) |
| Gain Boost | 0.0 | Tăng gain microphone (0.0–5.0), có thể chỉnh live |
| Skip Initial Frames | 50 | Số frame đầu bỏ qua để tránh noise từ driver |
| Capture Gain Ramp | 150ms | Thời gian tăng dần gain khi bật mic |
| Playback Gain Ramp | 80ms | Thời gian tăng dần gain khi bot phát audio |
| First Frame Fade-In | 15ms | Fade-in cho frame audio đầu tiên |

## Giao thức

### Bridge Protocol (giống Approach B)

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

## So sánh với các approach khác

| Tiêu chí | Approach A (HTML/JS) | Approach B (React) | Approach C1 (Vite + TS) |
|---|---|---|---|
| Build tool | Không | Vite | Vite |
| Framework | Không | React 18 | Không (vanilla) |
| TypeScript | Không | Có | Có |
| Settings panel | Không | Không | **Có** (10 params) |
| Transport | WebRTC (SDK) | Bridge + WebSocket | Bridge + WebSocket |
| Audio quality | Tốt (native `<audio>`) | Trung bình | Tốt (dual AudioContext) |
| Bundle size | ~15KB + 704KB SDK | ~152KB JS | ~25KB JS |

## Chi tiết thay đổi

Xem [CHANGELOG.md](./CHANGELOG.md) cho danh sách đầy đủ các thay đổi, fix lỗi, và cấu hình.

## Settings
  Mục Audio Processing (mới):
  - Audio Processor — chọn AudioWorklet (Chrome) hoặc ScriptProcessor (fallback). Mặc định là AudioWorklet.
  - Gain Boost (giữ nguyên)
  - Skip Initial Frames (số frame, 0-200) — số frame đầu tiên bị bỏ qua khi mic bật, tránh tiếng ồn driver. Mặc định 50.
  - Capture Gain Ramp (0-500ms) — thời gian tăng dần gain khi mic bắt đầu. Mặc định 150ms.                                                                                                                                                                
  - Playback Gain Ramp (0-500ms) — thời gian tăng dần gain khi bot bắt đầu nói. Mặc định 80ms.
  - First Frame Fade-In (0-100ms) — thời gian fade-in cho frame âm thanh đầu tiên để tránh tiếng "pop". Mặc định 15ms.

  Các thông số này đều yêu cầu reconnect để áp dụng. Bạn có thể thử chỉnh các giá trị để tìm ra Option tối ưu nhất cho Chrome:

  - Nếu tiếng ồn ở câu đầu: tăng Skip Initial Frames (100-150) và Capture Gain Ramp (200-300ms)
  - Nếu tiếng ồn nhẹ ngay khi kết nối: tăng Playback Gain Ramp (100-200ms) hoặc First Frame Fade-In (20-30ms)
  - Audio Processor: thử chuyển giữa AudioWorklet và ScriptProcessor để so sánh