# Audio Quality Parameters — Approach B (React)

Tài liệu ghi lại các thông số ảnh hưởng đến chất lượng nhận dạng giọng nói (STT)
của Pipecat AI trong client web. Tổng hợp từ quá trình debug và so sánh giữa
Approach A (pipecat-sdk.js) và Approach B (@pipecat-ai/client-js + custom transport).

---

## 1. getUserMedia Mic Constraints

Nơi áp dụng: `WebSocketTransport.ts` — `initDevices()` và `_lazyInitMic()`

**Quan trọng nhất.** Sai lầm phổ biến là bật đồng thời tất cả xử lý âm thanh trình duyệt:

```typescript
// ❌ KHÔNG dùng — làm giảm chất lượng STT đáng kể
{ audio: { channelCount: { exact: 1 }, sampleRate: { ideal: 16000 },
           echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
```

```typescript
// ✅ Nên dùng — giống Approach A
{ audio: true }
```

**Giải thích:** Khi bật đồng thời cả 3 tùy chọn xử lý (echo cancellation + noise suppression + auto gain control), trình duyệt áp dụng pipeline xử lý aggressive làm méo tín hiệu giọng nói, dẫn đến STT nhận dạng kém. Dùng `{ audio: true }` cho phép microphone hoạt động ở chất lượng cao nhất (thường 48kHz), AudioContext tự downsampling xuống 16kHz bằng resampler chất lượng cao.

---

## 2. AudioContext Sample Rate

Nơi áp dụng: `WebSocketTransport.ts` — constructor/initialize (dòng ~258)

```typescript
this._audioContext = new AudioContext({ sampleRate: 16000 });
```

- Bridge server kỳ vọng **16000 Hz** (xem `server/server.js` dòng 176: `new Float32Array(1600) // 100ms at 16kHz`)
- Backend Pipecat nhận raw Float32, không kèm metadata sample rate → backend assume 16kHz
- **Không nên dùng 8000 Hz** dù Approach A dùng 8000 Hz ở WavRecorder; bridge server được thiết kế cho 16kHz

---

## 3. Gain / Pre-amplification

Nơi áp dụng: `WebSocketTransport.ts` — `_setupMicCapture()`

```typescript
// ❌ KHÔNG dùng — gain boost gây clipping, không cải thiện STT
const gainNode = this._audioContext.createGain();
gainNode.gain.value = 2.0;
```

```typescript
// ✅ Không cần gain — source → processor trực tiếp
source.connect(processor);
```

**Giải thích:** Gain boost (6dB) làm tăng tín hiệu nhưng cũng làm clipping ở đỉnh âm, gây méo tiếng. STT hoạt động tốt với tín hiệu gốc (đã được mic khuếch đại phần cứng và browser tự động điều chỉnh). Approach A không dùng gain.

---

## 4. Float32 → Int16 Conversion

Nơi áp dụng: `WebSocketTransport.ts` — `_setupMicCapture()` `onaudioprocess` callback

```typescript
const int16 = new Int16Array(input.length);
for (let i = 0; i < input.length; i++) {
  const s = Math.max(-1, Math.min(1, input[i]));    // clamp
  int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;      // Float32 → Int16
}
```

- Công thức này giống hệt Approach A (pipecat-sdk.js `floatTo16BitPCM`)
- Int16Array trên x86 là little-endian (phù hợp với protobuf)
- **Quantization noise** từ Float32→Int16 là ~96dB SNR — không ảnh hưởng STT

---

## 5. Protobuf AudioRawFrame Encoding

Nơi áp dụng: `WebSocketTransport.ts` — `encodeAudioFrame()`

```typescript
// Frame { 2: AudioRawFrame { 3: audio (Int16 bytes), 4: sample_rate, 5: num_channels } }
// Inner:  0x1A [len_varint] [PCM bytes] 0x20 [sr_varint] 0x28 [nc_varint]
// Outer:  0x12 [len_varint] [inner]
```

- Field 3 (audio) = raw Int16 PCM, **không có** header hay metadata
- Field 4 (sample_rate) = AudioContext sample rate (16000)
- Field 5 (num_channels) = 1 (mono)
- **Quan trọng:** Bridge server (`server/protobuf.js`) ignore field 4 (sample_rate). Nếu AudioContext lệch khỏi 16000 Hz, backend nhận audio sai tốc độ.

---

## 6. ScriptProcessorNode Buffer Size

Nơi áp dụng: `WebSocketTransport.ts` — `_setupMicCapture()` dòng ~450

```typescript
const processor = this._audioContext.createScriptProcessor(4096, 1, 1);
```

- 4096 samples × (1 / 16000 Hz) = **256ms** mỗi chunk
- Buffer lớn hơn → ít callback hơn, CPU thấp hơn nhưng latency cao hơn
- AudioWorklet (128 samples) cho latency thấp hơn nhưng không ảnh hưởng chất lượng STT cuối cùng
- ScriptProcessorNode deprecated nhưng functional

---

## 7. Bridge Server Sample Rate Handling

Nơi áp dụng: `server/server.js` dòng ~176, `server/protobuf.js` dòng ~75

```javascript
// Bridge server gửi silence kickstart với assumption 16kHz
const silence = new Float32Array(1600); // 100ms at 16kHz

// Bridge parse AudioRawFrame nhưng KHÔNG dùng sampleRate từ protobuf
// → Nếu client capture ≠ 16000 Hz, backend nhận audio sai
```

---

## 8. Bot Audio Playback (Receive Path)

Nơi áp dụng: `WebSocketTransport.ts` — `_playBotAudio()` và `int16ToFloat32()`

```typescript
// Int16 → Float32 (bridge server dùng công thức tương tự)
function int16ToFloat32(uint8Bytes: Uint8Array): Float32Array {
  const int16 = new Int16Array(uint8Bytes.buffer, uint8Bytes.byteOffset, uint8Bytes.length >> 1);
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    out[i] = int16[i] / 32768;
  }
  return out;
}
```

- Bot audio playback dùng AudioBufferSourceNode → connect tới destination
- **Không ảnh hưởng** đến chất lượng STT (chỉ ảnh hưởng đến những gì user nghe được)

---

## Tóm tắt Cheat Sheet

| Tham số | Giá trị đúng | Hậu quả nếu sai |
|---------|-------------|------------------|
| Mic constraints | `{ audio: true }` | STT nhận dạng rất kém |
| AudioContext sampleRate | 16000 Hz | Backend nhận audio sai tốc độ |
| Gain boost | Không dùng | Clipping, méo tiếng |
| Float32→Int16 | `s<0 ? s*0x8000 : s*0x7fff` | (công thức chuẩn) |
| Protobuf AudioRawFrame field 3 | Int16 PCM raw | (dùng manual encode) |
| ScriptProcessor bufferSize | 4096 | (chỉ ảnh hưởng latency) |
