# Changelog — Approach C1

All notable changes from the base Approach C to Approach C1.

## [C1] — Initial fork + Settings panel + Audio quality fixes

Approach C1 forks from `approach-c-vite` and adds:

1. Settings panel with configurable audio parameters
2. Audio quality improvements (Chrome/Edge compatibility)
3. Separate AudioContext architecture (isolates capture from playback)
4. AudioWorkletNode support for low-latency capture

### Added

#### Settings panel (`src/settings.ts`, `src/settings-ui.ts`)

| Setting | Control | Default | Requires reconnect |
|---------|---------|---------|-------------------|
| Sample Rate | Select (8000/16000/22050/44100 Hz) | 8000 Hz | Yes |
| Mic Constraint | Select (Best STT / Aggressive processing) | Best STT | Yes |
| Audio Format | Select (Protobuf Int16 / Raw Int16 / Raw Float32) | Protobuf Int16 | Yes |
| Server URL | Text input | `https://rtstt-demo.securityzone.vn/connect` | Yes |
| Audio Processor | Select (AudioWorklet / ScriptProcessor) | AudioWorklet | Yes |
| Gain Boost | Range slider 0.0–5.0 | 0.0 | No (live) |
| Skip Initial Frames | Number input 0–200 | 50 | Yes |
| Capture Gain Ramp | Range slider 0–500ms | 150ms | Yes |
| Playback Gain Ramp | Range slider 0–500ms | 80ms | Yes |
| First Frame Fade-In | Range slider 0–100ms | 15ms | Yes |

#### Protocol helpers (`src/protocol.ts`)

- `encodeRawInt16()` — encode Float32 → raw Int16 PCM ArrayBuffer
- `encodeRawFloat32()` — pass-through Float32 as ArrayBuffer
- `encodeAudioForFormat()` — dispatch to correct encoder based on format
- `decodeAudioFrame()` — decode protobuf AudioRawFrame → { int16Bytes, sampleRate, numChannels }
- `int16ToFloat32()` — Int16 PCM → Float32 conversion

### Changed

#### Audio processing — complete rewrite (`src/audio.ts`)

| Change | Before (Approach C) | After (C1) |
|--------|--------------------|------------|
| AudioContexts | Single context for capture + playback | **Two separate contexts** (`playbackContext` + `captureContext`) — isolates capture graph changes from playback |
| ensureContext() | Not present | Creates `playbackContext` + `playbackGain` before WebSocket connects, so graph is fully built before audio arrives |
| Capture method | ScriptProcessorNode only | **AudioWorkletNode** (primary) with ScriptProcessorNode fallback |
| Capture routing | Direct to destination | `source → gainNode → workletNode → silence(0) → MediaStreamDestination` (separate from playback) |
| Capture gain | None | Gain node with configurable ramp (0→value over `captureRampMs`) |
| Frame skipping | None | Skip first N frames (`skipInitialFrames`, default 50) to avoid driver startup noise |
| Playback gain | None | Playback gain node with configurable ramp (0→1 over `playbackRampMs`) |
| Audio buffering | None | `pendingAudio[]` buffer for frames arriving before context ready |
| First-frame fade | None | Linear PCM fade-in over `fadeInMs` on first buffered frame |
| Gapless scheduling | Simple | `nextPlayTime` tracking with 500ms drift reset threshold |
| stopCapture() | Closes the single context | Closes only capture context; playback context stays alive |
| dispose() | Not present | Full cleanup — closes both contexts |

#### AudioWorklet processor (`public/audio-processor.js`)

- New `CaptureProcessor` class registered as `capture-processor`
- Zeroes output buffer before each `process()` call (prevents stale/garbage data)
- Posts Float32 PCM data to main thread via `port.postMessage`

#### Settings data model (`src/settings.ts`)

- `AppSettings` interface with 10 configurable fields
- `SettingsManager` class with getters, update, reset, requiresReconnect
- `AudioProcessorType` — now includes `'audio-worklet'` and `'script-processor'`
- Configurable server URL instead of hardcoded endpoint

#### UI and layout (`src/style.css`)

| Change | Detail |
|--------|--------|
| Settings panel | Collapsible card with expanded height measurement |
| Layout grid | 2-column grid with fixed heights for balance |
| Debug log height | Fixed 220px (matches Connection card) |
| Conversation height | Dynamic — matched to Settings panel expanded height |
| Responsive | Single column on mobile (<768px) |

#### Connection flow (`src/main.ts`)

- `ensureContext(sampleRate)` called **before** `startBotAndConnect()`
  — AudioContext startup click happens outside audio flow
- Settings applied triggers either live update (gain) or reconnect (all others)
- `dispose()` instead of `stopCapture()` on disconnect/error (cleans both contexts)

### Fixed

| Issue | Cause | Fix |
|-------|-------|-----|
| Audio dropout at connect | AudioContext created after WebSocket connect | `ensureContext()` before connection |
| Startup noise burst | AudioWorklet output buffer uninitialized | `outputs[0][ch].fill(0)` in processor |
| Mic driver noise sent to server | First frames contain hardware transient | `skipInitialFrames` (50 frames = ~400ms) |
| Playback click at start | First audio frame starts abruptly | Playback gain ramp (0→1 over `playbackRampMs`) |
| Capture click at start | Mic hardware power-on transient | Capture gain ramp (0→value over `captureRampMs`) |
| Audio gap at start | Frames arrive before AudioContext ready | `pendingAudio[]` buffering + `flushPendingAudio()` |
| Chrome glitch when capture starts | Graph topology change during playback | **Separate AudioContexts** for capture vs playback |
| Delayed audio start | AudioWorklet graph not stabilized | `setTimeout(() => flushPendingAudio(), 0)` |
| Browser not honoring sampleRate | Chrome returns context at 48000Hz | Use `context.sampleRate` (actual) for encoding, not requested value |

### Architecture

#### Audio graph

```
PLAYBACK PATH (playbackContext):
  BufferSource → playbackGain (ramp) → destination

CAPTURE PATH (captureContext, separate AudioContext):
  getUserMedia → MediaStreamSource → gainNode (ramp) → AudioWorkletNode/→ScriptProcessorNode
    → silence(0) → MediaStreamDestination  (no connection to destination)

CAPTURE DATA FLOW:
  AudioWorkletProcessor (Float32) → main thread → encodeAudioForFormat() → WebSocket → server

PLAYBACK DATA FLOW:
  WebSocket → protobuf AudioRawFrame → decodeAudioFrame() → int16ToFloat32() → AudioBuffer
    → AudioBufferSourceNode → start(when) → playbackGain → destination
```

#### Settings panel integration

```
main.ts:
  1. new SettingsManager()                    — data model
  2. buildSettingsPanel(settings, onApply)    — build UI, wire events
  3. new AudioManager(log, settings)          — pass settings reference
  4. audioManager.ensureContext(sampleRate)   — warm up playback context
  5. wsManager.startBotAndConnect(url)        — connect to server
  6. bot-ready → startMicrophone()            — start capture
     → audioManager.startCapture(callback)
```

#### File structure

```
approach-c1-vite/
├── index.html               Entry HTML (footer: "Approach C1")
├── vite.config.ts           Vite config (base path: /ac/pipecat-client-web/vite-c1/)
├── public/
│   └── audio-processor.js   AudioWorklet processor (CaptureProcessor)
├── src/
│   ├── main.ts              Entry point, UI initialization, wiring
│   ├── style.css            Dark theme, settings panel, responsive
│   ├── audio.ts             Dual AudioContext capture/playback manager
│   ├── protocol.ts          RTVI + Protobuf encode/decode helpers
│   ├── settings.ts          Settings data model + defaults
│   ├── settings-ui.ts       Settings panel DOM construction
│   ├── websocket.ts         WebSocket manager + initiator chain
│   ├── logger.ts            Debug logging to DOM
│   └── ui.ts                Vanilla DOM helpers
└── CHANGELOG.md             This file
```

### Comparison: Approach A vs C1

| Aspect | Approach A (SDK) | Approach C1 (Custom) |
|--------|-----------------|---------------------|
| Transport | WebRTC (via Pipecat SDK) | Raw WebSocket + protobuf |
| Bot audio playback | `<audio>` element + MediaStreamTrack | Web Audio API BufferSource |
| Mic capture | SDK AudioRecorder (internal) | Custom AudioWorkletNode |
| AudioContexts | Two (BotAudio + AudioRecorder) | Two (playback + capture) |
| Audio format | Raw PCM Float32, 16000 Hz | Protobuf AudioRawFrame + Int16 PCM |
| Audio processing | Chrome's native `<audio>` pipeline | Web Audio gain, ramp, fade-in |
| Configuration | None (hardcoded via SDK config) | Full Settings panel with 10 controls |

### Deployment

Build output goes to `dist/`, deployed to IIS at `/ac/pipecat-client-web/vite-c1/`:

```bash
npm run build
# Copy dist/* to C:\inetpub\AC\pipecat-client-web\vite-c1\
```
