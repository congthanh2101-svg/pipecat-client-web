import {
  decodeAudioFrame,
  int16ToFloat32,
  encodeAudioForFormat,
} from './protocol.js';
import type { SettingsManager, AudioFormatType } from './settings.js';

export class AudioManager {
  /** AudioContext for bot audio playback only — isolated from capture. */
  private playbackContext: AudioContext | null = null;
  /** AudioContext for mic capture only — isolated from playback. */
  private captureContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  /** Active capture node — either AudioWorkletNode or ScriptProcessorNode. */
  private captureNode: AudioNode | null = null;
  private onAudioData: ((data: ArrayBuffer) => void) | null = null;
  private onDebugLog: (msg: string) => void;
  private settings: SettingsManager;

  /** For gapless playback: scheduled time of the next audio chunk. */
  private nextPlayTime: number = 0;
  /** Buffer audio frames that arrive before AudioContext is ready. */
  private pendingAudio: ArrayBuffer[] = [];
  /** Playback gain node — ramped from 0 to 1 to avoid click on first play. */
  private playbackGain: GainNode | null = null;
  /** Skip initial capture frames to avoid sending driver startup noise. */
  private captureFrameCount: number = 0;

  constructor(onDebugLog: (msg: string) => void, settings: SettingsManager) {
    this.onDebugLog = onDebugLog;
    this.settings = settings;
  }

  async startCapture(onAudioData: (data: ArrayBuffer) => void): Promise<void> {
    if (this.captureNode) return;
    this.onAudioData = onAudioData;
    this.captureFrameCount = 0;

    const opts = this.settings.getMicConstraint();
    const sampleRate = this.settings.getSampleRate();
    const gainBoost = this.settings.getGainBoost();
    const format = this.settings.getAudioFormat();

    // Create a SEPARATE AudioContext for capture only
    this.captureContext = new AudioContext({ sampleRate });
    if (this.captureContext.state === 'suspended') {
      await this.captureContext.resume();
    }
    this.log(
      `Capture context created: requested ${sampleRate}Hz, actual ${this.captureContext.sampleRate}Hz`
    );

    this.log(`Requesting microphone access...`);
    this.stream = await navigator.mediaDevices.getUserMedia(
      typeof opts === 'boolean' ? { audio: opts } : { audio: opts }
    );
    this.log('Microphone acquired');

    this.source = this.captureContext.createMediaStreamSource(this.stream);

    // Capture gain node (ramp from 0 to avoid hardware transient)
    const captureRampSec = this.settings.getCaptureRampMs() / 1000;
    this.gainNode = this.captureContext.createGain();
    this.gainNode.gain.setValueAtTime(0, this.captureContext.currentTime);
    if (captureRampSec > 0) {
      this.gainNode.gain.linearRampToValueAtTime(
        1.0 + gainBoost,
        this.captureContext.currentTime + captureRampSec
      );
    } else {
      this.gainNode.gain.setValueAtTime(1.0 + gainBoost, this.captureContext.currentTime);
    }

    // Always use the AudioContext's actual sample rate for capture encoding,
    // since the browser may not honor the requested rate (Chrome != Edge).
    const actualRate = this.captureContext.sampleRate;

    // Try AudioWorkletNode (dedicated audio thread, no dropouts).
    // Fall back to ScriptProcessorNode if not available.
    try {
      await this.initAudioWorkletCapture(actualRate, format);
    } catch {
      this.log('AudioWorklet not available, using ScriptProcessorNode');
      this.initScriptProcessorCapture(actualRate, format);
    }

    this.log(
      `Audio capture started: ${actualRate}Hz mono, gain=+${gainBoost}, format=${format}, ` +
      `skipFrames=${this.settings.getSkipInitialFrames()}, captureRamp=${this.settings.getCaptureRampMs()}ms`
    );

    // Defer flush so the audio graph has a render quantum to stabilize
    setTimeout(() => this.flushPendingAudio(), 0);
  }

  private async initAudioWorkletCapture(
    sampleRate: number,
    format: AudioFormatType
  ): Promise<void> {
    if (!this.captureContext || !this.gainNode || !this.source) return;

    // Resolve audio-processor.js relative to the current page
    const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
    const moduleUrl = `${baseUrl}audio-processor.js`;

    await this.captureContext.audioWorklet.addModule(moduleUrl);

    const workletNode = new AudioWorkletNode(this.captureContext, 'capture-processor');
    const skipInitial = this.settings.getSkipInitialFrames();
    workletNode.port.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'audio' && this.onAudioData) {
        // Skip initial frames to avoid sending driver startup noise to server
        if (this.captureFrameCount < skipInitial) {
          this.captureFrameCount++;
          return;
        }
        const float32 = new Float32Array(event.data.data);
        const frame = encodeAudioForFormat(float32, format, sampleRate, 1);
        this.onAudioData(frame);
      }
    };

    this.source.connect(this.gainNode);
    this.gainNode.connect(workletNode);

    // Route capture through zero-gain to a MediaStream destination —
    // completely separate from the playback path (separate AudioContext).
    const silence = this.captureContext.createGain();
    silence.gain.value = 0;
    workletNode.connect(silence);
    silence.connect(this.captureContext.createMediaStreamDestination());

    this.captureNode = workletNode;

    this.log('AudioWorkletNode initialized');
  }

  private initScriptProcessorCapture(
    sampleRate: number,
    format: AudioFormatType
  ): void {
    if (!this.captureContext || !this.gainNode || !this.source) return;

    const sp = this.captureContext.createScriptProcessor(4096, 1, 1);
    sp.onaudioprocess = (event: AudioProcessingEvent) => {
      if (!this.onAudioData) return;
      // Skip first callback (4096 frames ~512ms) to avoid driver startup noise
      if (this.captureFrameCount < 1) {
        this.captureFrameCount++;
        return;
      }
      const input = event.inputBuffer.getChannelData(0);
      const frame = encodeAudioForFormat(input, format, sampleRate, 1);
      this.onAudioData(frame);
    };

    this.source.connect(this.gainNode);
    this.gainNode.connect(sp);

    // Route capture through zero-gain to a MediaStream destination,
    // separate from the playback path.
    const silence = this.captureContext.createGain();
    silence.gain.value = 0;
    sp.connect(silence);
    silence.connect(this.captureContext.createMediaStreamDestination());
    this.captureNode = sp;
  }

  stopCapture(): void {
    if (this.captureNode) {
      // If AudioWorkletNode, tell it to close
      if ((this.captureNode as any).port) {
        try {
          (this.captureNode as any).port.postMessage({ type: 'close' });
        } catch { /* ignore */ }
      }
      this.captureNode.disconnect();
      this.captureNode = null;
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.captureContext) {
      this.captureContext.close().catch(() => {});
      this.captureContext = null;
    }
    this.onAudioData = null;
    this.captureFrameCount = 0;
    this.log('Audio capture stopped');
  }

  /**
   * Create AudioContext early (before connection) so Chrome's startup click
   * happens outside the audio flow and the playback graph is fully built
   * before any audio arrives. Safe to call multiple times.
   */
  async ensureContext(sampleRate: number): Promise<void> {
    if (this.playbackContext) {
      if (this.playbackContext.sampleRate !== sampleRate) {
        await this.playbackContext.close();
        this.playbackContext = null;
      } else {
        return;
      }
    }
    this.playbackContext = new AudioContext({ sampleRate });
    if (this.playbackContext.state === 'suspended') {
      await this.playbackContext.resume();
    }
    // Create playback gain and connect to destination early so the audio
    // graph is always active — no sudden "empty → connected" transition.
    this.playbackGain = this.playbackContext.createGain();
    this.playbackGain.connect(this.playbackContext.destination);
    // Ramp from 0→1 so even the earliest playback gets a smooth fade-in.
    const playbackRampSec = this.settings.getPlaybackRampMs() / 1000;
    this.playbackGain.gain.setValueAtTime(0, this.playbackContext.currentTime);
    if (playbackRampSec > 0) {
      this.playbackGain.gain.linearRampToValueAtTime(1, this.playbackContext.currentTime + playbackRampSec);
    } else {
      this.playbackGain.gain.setValueAtTime(1, this.playbackContext.currentTime);
    }
    this.log(
      `Playback context created: requested ${sampleRate}Hz, actual ${this.playbackContext.sampleRate}Hz, ` +
      `playbackRamp=${this.settings.getPlaybackRampMs()}ms, fadeIn=${this.settings.getFadeInMs()}ms`
    );
  }

  /** Update gain boost live (no reconnect needed). */
  updateGain(gainBoost: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = 1.0 + gainBoost;
      this.log(`Gain updated to +${gainBoost}`);
    }
  }

  /** Decode protobuf AudioRawFrame and play with gapless scheduling. */
  playAudio(data: ArrayBuffer): void {
    const ctx = this.playbackContext;
    if (!ctx) {
      // Buffer audio until AudioContext is ready
      this.pendingAudio.push(data.slice(0));
      return;
    }

    const { int16Bytes, sampleRate, numChannels } = decodeAudioFrame(data);
    if (!int16Bytes || int16Bytes.length < 2) return;

    const float32 = int16ToFloat32(int16Bytes);
    if (float32.length === 0) return;

    const duration = float32.length / sampleRate;
    const now = ctx.currentTime;

    // If we've drifted more than 500ms behind, reset scheduling
    let when = Math.max(now, this.nextPlayTime);
    if (when > now + 0.5) {
      when = now;
    }

    try {
      const audioBuffer = ctx.createBuffer(numChannels, float32.length, sampleRate);
      audioBuffer.copyToChannel(float32 as unknown as Float32Array<ArrayBuffer>, 0);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.playbackGain ?? ctx.destination);
      source.start(when);
      this.nextPlayTime = when + duration;
    } catch {
      // ignore audio playback errors
    }
  }

  /** Play buffered audio frames that arrived before AudioContext was ready. */
  private flushPendingAudio(): void {
    const buf = this.pendingAudio;
    this.pendingAudio = [];
    this.nextPlayTime = this.playbackContext?.currentTime ?? 0;
    for (let i = 0; i < buf.length; i++) {
      if (i === 0) {
        // Fade-in to mask any startup glitch
        this.applyFadeIn(buf[i], this.settings.getFadeInMs() / 1000);
      }
      this.playAudio(buf[i]);
    }
    if (buf.length > 0) {
      this.log(`Flushed ${buf.length} buffered audio frame(s)`);
    }
  }

  /** Apply a linear fade-in to the first `durationSec` of an Int16 PCM protobuf frame. */
  private applyFadeIn(data: ArrayBuffer, durationSec: number): void {
    try {
      const { int16Bytes, sampleRate } = decodeAudioFrame(data);
      if (!int16Bytes || int16Bytes.length < 4) return;
      const fadeSamples = Math.min(
        Math.floor(sampleRate * durationSec),
        int16Bytes.length >> 1
      );
      if (fadeSamples < 2) return;
      const int16 = new Int16Array(
        int16Bytes.buffer, int16Bytes.byteOffset, int16Bytes.length >> 1
      );
      for (let i = 0; i < fadeSamples; i++) {
        int16[i] = (int16[i] * i) / fadeSamples;
      }
    } catch { /* ignore fade errors */ }
  }

  isActive(): boolean {
    return this.stream !== null;
  }

  /** Full cleanup on disconnect — closes both contexts. */
  dispose(): void {
    this.stopCapture();
    if (this.playbackContext) {
      this.playbackContext.close().catch(() => {});
      this.playbackContext = null;
    }
    this.playbackGain = null;
    this.nextPlayTime = 0;
    this.pendingAudio = [];
  }

  private log(msg: string): void {
    this.onDebugLog(msg);
  }
}
