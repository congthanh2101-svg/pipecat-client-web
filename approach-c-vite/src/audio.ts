import { encodeAudioFrame, decodeAudioFrame, int16ToFloat32 } from './protocol.js';

export class AudioManager {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private onAudioData: ((data: ArrayBuffer) => void) | null = null;
  private onDebugLog: (msg: string) => void;
  private sampleRate = 16000;

  constructor(onDebugLog: (msg: string) => void) {
    this.onDebugLog = onDebugLog;
  }

  async startCapture(onAudioData: (data: ArrayBuffer) => void): Promise<void> {
    if (this.processor) return;
    this.onAudioData = onAudioData;
    this.log('Requesting microphone access...');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.log('Microphone acquired');
    this.context = new AudioContext({ sampleRate: this.sampleRate });

    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    this.source = this.context.createMediaStreamSource(this.stream);

    // Use ScriptProcessorNode for mic capture.
    // Convert Float32 → Int16 PCM → wrap in protobuf AudioRawFrame before sending.
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (!this.onAudioData) return;
      const input = event.inputBuffer.getChannelData(0);

      // Float32 → Int16
      const int16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      // Wrap in protobuf AudioRawFrame
      const frame = encodeAudioFrame(
        new Uint8Array(int16.buffer as ArrayBuffer),
        this.sampleRate,
        1
      );
      this.onAudioData(frame);
    };

    this.source.connect(this.processor);
    // Keep the audio graph alive by routing to destination through a zero-gain node.
    const silence = this.context.createGain();
    silence.gain.value = 0;
    this.processor.connect(silence);
    silence.connect(this.context.destination);

    this.log(`Audio capture started: ${this.sampleRate}Hz mono`);
  }

  stopCapture(): void {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.context) {
      this.context.close().catch(() => { /* ignore */ });
      this.context = null;
    }
    this.onAudioData = null;
    this.log('Audio capture stopped');
  }

  /** Decode protobuf AudioRawFrame and play via AudioBufferSourceNode. */
  playAudio(data: ArrayBuffer): void {
    const { int16Bytes, sampleRate, numChannels } = decodeAudioFrame(data);
    if (!int16Bytes || int16Bytes.length < 2) return;

    const float32 = int16ToFloat32(int16Bytes);
    if (float32.length === 0) return;

    let ctx = this.context;
    if (!ctx) {
      ctx = new AudioContext();
      this.context = ctx;
    }
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    try {
      const audioBuffer = ctx.createBuffer(numChannels, float32.length, sampleRate);
      audioBuffer.copyToChannel(float32 as Float32Array<ArrayBuffer>, 0);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.start();
    } catch {
      // ignore audio playback errors
    }
  }

  isActive(): boolean {
    return this.stream !== null;
  }

  private log(msg: string): void {
    this.onDebugLog(msg);
  }
}
