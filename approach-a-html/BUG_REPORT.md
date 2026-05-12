# Bug Report — Approach A (HTML thuần)

**Test thực tế ngày:** 2026-05-12
**URL:** https://web.securityzone.vn/ac/pipecat-client-web/html/

---

## Test Results Summary

| Kết quả | Trạng thái |
|---------|-----------|
| WebSocket kết nối tới server | ✅ |
| Gửi `client-ready` message | ✅ |
| Nhận `bot-output` (greeting text) | ✅ |
| Hiển thị transcript bot text | ✅ |
| Nhận `bot-tts-started` event | ✅ |
| Nhận `bot-ready` event | ✅ |
| **Kết nối bị đóng ngay sau bot-ready (~60ms)** | ❌ |
| **Nhận TTS audio từ server** | ❌ |
| **Gửi microphone audio lên server** | ⚠️ (chưa verify được) |
| **2-way audio hoạt động** | ❌ |

---

## Bug 1 — CRITICAL: Server đóng kết nối ngay sau bot-ready

**Hiện tượng:**
```
[R] bot-output {"text":"Xin chào...","spoken":false}
[R] bot-tts-started
[R] bot-ready {"version":"1.1.0",...
Bot is ready - connection established
WebSocket closed: code=1000 reason=none  ← 1ms sau bot-ready!
```

**Nguyên nhận:** Server chủ động đóng kết nối với code 1000 (Normal Closure) ngay sau khi gửi `bot-ready`. Không có audio TTS nào được gửi từ server vì kết nối đã đóng.

**Phân tích root cause:**
- Server Pipecat có thể đang chờ HTTP `startBot` endpoint để xác thực trước (theo flow `startBotAndConnect` của thư viện chính thức)
- Hoặc pipeline của bot chỉ chạy 1 turn (gửi greeting xong là shutdown)
- Hoặc server chờ audio input từ client nhưng không nhận được → timeout → close

**Fix:** 
- ✅ Đã cập nhật `client-ready` version từ `1.0.0` → `1.3.0` (đúng RTVI protocol)
- ❗ Vấn đề này có thể do server config (bot pipeline chỉ chạy 1 turn). Cần kiểm tra server-side:
  - Pipeline Pipecat có idle timeout quá ngắn
  - Server cần HTTP `startBot` endpoint để kích hoạt multi-turn session
  - Hoặc server dùng Daily transport, audio không qua WebSocket

---

## Bug 2 — CRITICAL: ScriptProcessorNode audio feedback loop

**Vị trí:** Line 676
```javascript
scriptNode.connect(audioCtx.destination);
```

**Vấn đề:** `ScriptProcessorNode` chỉ fire `onaudioprocess` khi output được kết nối tới `destination`. Nhưng route trực tiếp tới loa sẽ tạo feedback loop — người dùng nghe được mic của chính mình.

**Fix:** ✅ Route qua `GainNode` ở gain = 0 (đã áp dụng).

---

## Bug 3 — MODERATE: AudioContext không được resume

**Vị trí:** Line 633

**Vấn đề:** Trên Chrome hiện đại, `AudioContext` khởi tạo ở trạng thái `suspended`. Cần gọi `audioCtx.resume()` để bắt đầu xử lý audio. Nếu không resume, AudioWorklet/ScriptProcessor sẽ không xử lý data.

**Fix:** ✅ Thêm `await audioCtx.resume()` sau khi tạo AudioContext (đã áp dụng).

---

## Bug 4 — MODERATE: Thiếu handler cho bot-tts-started / bot-tts-stopped

**Vị trí:** Switch case trong `handleRTVIMessage`

**Vấn đề:** Server gửi `bot-tts-started` và `bot-tts-stopped` nhưng client chỉ log, không có UI feedback.

**Fix:** ✅ Thêm handler hiển thị "🔊 Bot speaking..." + ẩn khi TTS dừng (đã áp dụng).

---

## Bug 5 — MODERATE: Audio queue không handle interruption

**Vị trí:** `playAudio` function

**Vấn đề:** Khi bot nói, audio được queue với `nextPlayTime`. Nếu bot nói tiếp trong khi queue còn, audio cũ vẫn tiếp tục phát. Không có cơ chế flush queue khi bot bắt đầu nói mới.

**Fix:** ✅ Clear `nextPlayTime` khi `bot-tts-started` để flush queue cũ (đã áp dụng).

---

## Bug 6 — MINOR: RTVI protocol version sai

**Vị trí:** Line 463
```javascript
return createRTVIMessage('client-ready', { version: '1.0.0', ... });
```

**Vấn đề:** Thư viện chính thức dùng version `1.3.0`, client gửi `1.0.0`.

**Fix:** ✅ Đổi thành `1.3.0` (đã áp dụng).

---

## Bug 7 — MINOR: Không có WebSocket keepalive

**Vấn đề:** Không có ping/pong hoặc heartbeat. Kết nối có thể bị drop mà client không biết.

**Fix:** ✅ Thêm timer gửi RTVI ping message mỗi 30s (đã áp dụng).

---

## Bug 8 — MINOR: favicon.ico 404

**Vấn đề:** Trình duyệt request `/favicon.ico` không tồn tại. (Không ảnh hưởng tới functionality)
