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
    this.onAudioData = onAudioData;
    this.log('Requesting microphone access...');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.log('Microphone acquired');
    this.context = new AudioContext({ sampleRate: this.sampleRate });
    this.source = this.context.createMediaStreamSource(this.stream);

    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (!this.onAudioData) return;
      const inputBuffer = event.inputBuffer;
      const channelData = inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(channelData.length);
      for (let i = 0; i < channelData.length; i++) {
        let sample = Math.max(-1, Math.min(1, channelData[i]));
        pcm16[i] = sample < 0 ? sample * 32768 : sample * 32767;
      }
      this.onAudioData(pcm16.buffer.slice(0));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
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

  playAudio(data: ArrayBuffer): void {
    if (!this.context) {
      this.context = new AudioContext();
    }
    const ctx = this.context;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    const pcm16 = new Int16Array(data);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768;
    }
    const buffer = ctx.createBuffer(1, float32.length, this.sampleRate);
    buffer.getChannelData(0).set(float32);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    this.log(`Playing audio: ${data.byteLength} bytes`);
  }

  isActive(): boolean {
    return this.stream !== null;
  }

  private log(msg: string): void {
    this.onDebugLog(msg);
  }
}
