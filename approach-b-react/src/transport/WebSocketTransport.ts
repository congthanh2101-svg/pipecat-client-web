import {
  Transport,
  TransportState,
  PipecatClientOptions,
  RTVIMessage,
  Tracks,
  TransportConnectionParams,
} from '@pipecat-ai/client-js';

// ---------------------------------------------------------------------------
// Protobuf frame helpers
// ---------------------------------------------------------------------------
// The bridge at /connect uses protobuf framing:
//   Frame (oneof): { 2: AudioRawFrame, 4: MessageFrame }
//   AudioRawFrame:  { 3: audio bytes (Int16 PCM), 4: sample_rate, 5: num_channels }
//   MessageFrame:   { 1: data (JSON string) }
//
// MessageFrame happens to have the same byte layout as RTVI 0x22 format:
//   0x22 [outer_len] 0x0A [inner_len] [JSON]  — field 4/field 1 wire-type-2
// So sendMessage() still uses encodeRTVI unchanged.

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  while (value > 127) {
    bytes.push((value & 127) | 128);
    value >>>= 7;
  }
  bytes.push(value & 127);
  return bytes;
}

function encodeRTVI(jsonStr: string): ArrayBuffer {
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(jsonStr);
  const jsonLen = jsonBytes.length;

  const innerLenVarint = encodeVarint(jsonLen);
  const outerLen = 1 + innerLenVarint.length + jsonLen;
  const outerLenVarint = encodeVarint(outerLen);

  const msg = new Uint8Array(
    1 + outerLenVarint.length + 1 + innerLenVarint.length + jsonLen
  );
  let offset = 0;
  msg[offset++] = 0x22;
  outerLenVarint.forEach((b) => (msg[offset++] = b));
  msg[offset++] = 0x0a;
  innerLenVarint.forEach((b) => (msg[offset++] = b));
  msg.set(jsonBytes, offset);
  return msg.buffer;
}

function decodeRTVI(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let offset = 1;
  while (bytes[offset] & 128) offset++;
  offset++;
  if (bytes[offset] !== 0x0a) throw new Error('Invalid RTVI message');
  offset++;
  let jsonLen = 0;
  let shift = 0;
  while (bytes[offset] & 128) {
    jsonLen |= (bytes[offset] & 127) << shift;
    shift += 7;
    offset++;
  }
  jsonLen |= (bytes[offset] & 127) << shift;
  offset++;
  return new TextDecoder().decode(bytes.subarray(offset, offset + jsonLen));
}

function isMessageFrame(data: ArrayBuffer): boolean {
  if (data.byteLength === 0) return false;
  return new Uint8Array(data)[0] === 0x22;
}

/** Check if data starts with 0x12 = protobuf Frame field 2 (AudioRawFrame). */
function isAudioFrame(data: ArrayBuffer): boolean {
  if (data.byteLength === 0) return false;
  return new Uint8Array(data)[0] === 0x12;
}

/**
 * Wrap Int16 PCM bytes in a protobuf AudioRawFrame.
 * Frame { 2: AudioRawFrame { 3: audio, 4: sample_rate, 5: num_channels } }
 */
function encodeAudioFrame(
  int16Bytes: Uint8Array,
  sampleRate: number,
  numChannels: number
): ArrayBuffer {
  // Inner: field-3 audio (bytes) + field-4 sample_rate (varint) + field-5 num_channels (varint)
  const srVarint = encodeVarint(sampleRate);
  const ncVarint = encodeVarint(numChannels);
  const audioLenVarint = encodeVarint(int16Bytes.length);

  const innerLen =
    1 + audioLenVarint.length + int16Bytes.length + // field-3 audio
    1 + srVarint.length + // field-4 sample_rate
    1 + ncVarint.length; // field-5 num_channels

  const inner = new Uint8Array(innerLen);
  let off = 0;
  inner[off++] = 0x1a; // field 3, wire type 2
  audioLenVarint.forEach((b) => (inner[off++] = b));
  inner.set(int16Bytes, off);
  off += int16Bytes.length;
  inner[off++] = 0x20; // field 4, wire type 0
  srVarint.forEach((b) => (inner[off++] = b));
  inner[off++] = 0x28; // field 5, wire type 0
  ncVarint.forEach((b) => (inner[off++] = b));

  // Outer: field 2 (AudioRawFrame), wire type 2
  const innerLenVarint = encodeVarint(inner.length);
  const frame = new Uint8Array(1 + innerLenVarint.length + inner.length);
  off = 0;
  frame[off++] = 0x12; // field 2, wire type 2
  innerLenVarint.forEach((b) => (frame[off++] = b));
  frame.set(inner, off);
  return frame.buffer;
}

/**
 * Parse a protobuf AudioRawFrame and return the inner Int16 bytes + metadata.
 */
function decodeAudioFrame(data: ArrayBuffer): {
  int16Bytes: Uint8Array | null;
  sampleRate: number;
  numChannels: number;
} {
  const bytes = new Uint8Array(data);
  let pos = 0;
  // Outer tag — field 2 wire-type 2 = 0x12
  if (bytes[pos] !== 0x12) return { int16Bytes: null, sampleRate: 16000, numChannels: 1 };
  pos++;

  // Outer length varint
  let subLen = 0,
    shift = 0;
  while (pos < bytes.length) {
    const b = bytes[pos++];
    subLen |= (b & 0x7f) << shift;
    shift += 7;
    if (!(b & 0x80)) break;
  }
  const subEnd = pos + subLen;

  let int16Bytes: Uint8Array | null = null;
  let sampleRate = 16000;
  let numChannels = 1;

  while (pos < subEnd) {
    const tag = bytes[pos++];
    const fieldNum = tag >> 3;
    const wireType = tag & 7;

    if (fieldNum === 3 && wireType === 2) {
      // Audio bytes (bytes field)
      let len = 0;
      shift = 0;
      while (pos < subEnd) {
        const b = bytes[pos++];
        len |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
      }
      int16Bytes = bytes.slice(pos, pos + len);
      pos += len;
    } else if (fieldNum === 4 && wireType === 0) {
      // sample_rate varint
      let val = 0;
      shift = 0;
      while (pos < subEnd) {
        const b = bytes[pos++];
        val |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
      }
      sampleRate = val;
    } else if (fieldNum === 5 && wireType === 0) {
      // num_channels varint
      let val = 0;
      shift = 0;
      while (pos < subEnd) {
        const b = bytes[pos++];
        val |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
      }
      numChannels = val;
    } else {
      // Skip unknown field
      if (wireType === 0) {
        while (pos < subEnd && (bytes[pos] & 0x80)) pos++;
        pos++;
      } else if (wireType === 2) {
        let len = 0;
        shift = 0;
        while (pos < subEnd) {
          const b = bytes[pos++];
          len |= (b & 0x7f) << shift;
          shift += 7;
          if (!(b & 0x80)) break;
        }
        pos += len;
      } else {
        break;
      }
    }
  }

  return { int16Bytes, sampleRate, numChannels };
}

/** Convert Int16 PCM bytes to Float32 for Web Audio playback. */
function int16ToFloat32(uint8Bytes: Uint8Array): Float32Array {
  const buf = uint8Bytes.buffer as ArrayBuffer;
  const int16 = new Int16Array(buf, uint8Bytes.byteOffset, uint8Bytes.length >> 1);
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    out[i] = int16[i] / 32768;
  }
  return out;
}

const TARGET_SAMPLE_RATE = 16000;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class WebSocketTransport extends Transport {
  private _ws: WebSocket | null = null;

  // Mic capture
  private _micStream: MediaStream | null = null;
  private _micTrack: MediaStreamTrack | null = null;
  private _audioContext: AudioContext | null = null;
  private _processor: AudioNode | null = null;

  // Bot audio
  private _dest: MediaStreamAudioDestinationNode | null = null;
  private _botTrack: MediaStreamTrack | null = null;

  // ---------------------------------------------------------------------------
  // Transport lifecycle
  // ---------------------------------------------------------------------------

  initialize(
    options: PipecatClientOptions,
    messageHandler: (ev: RTVIMessage) => void
  ): void {
    this._options = options;
    this._callbacks = options.callbacks ?? ({} as any);
    this._onMessage = messageHandler;
    this.state = 'disconnected';

    if (!this._audioContext) {
      this._audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      this._dest = this._audioContext.createMediaStreamDestination();
    }
  }

  async initDevices(): Promise<void> {
    if (this._micStream) return;
    this.state = 'initializing';
    try {
      // Minimal constraints — match Approach A's pipecat-sdk.js behavior.
      // Avoid explicit echoCancellation/noiseSuppression/autoGainControl because
      // forcing all three simultaneously can degrade audio quality (browser applies
      // aggressive processing). Letting the browser pick defaults typically produces
      // higher-quality input for STT.
      this._micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this._micTrack = this._micStream.getAudioTracks()[0];

      this.state = 'initialized';
    } catch (e) {
      this.state = 'error';
      throw e;
    }
  }

  _validateConnectionParams(connectParams?: unknown): unknown {
    if (connectParams == null) {
      throw new Error('No connection params provided');
    }
    const bundle = connectParams as Record<string, unknown>;
    const wsUrl =
      typeof bundle.wsUrl === 'string'
        ? bundle.wsUrl
        : typeof bundle.ws_url === 'string'
          ? bundle.ws_url
          : null;
    if (!wsUrl) {
      throw new Error(
        'No wsUrl in connection params. Expected { wsUrl: "wss://..." }'
      );
    }
    return { wsUrl };
  }

  async _connect(
    connectParams?: TransportConnectionParams
  ): Promise<void> {
    const { wsUrl } = connectParams as { wsUrl: string };

    return new Promise<void>((resolve, reject) => {
      try {
        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
          this._ws = ws;
          this.state = 'connected';
          this._callbacks.onConnected?.();
          this._startMicCapture();
          resolve();
        };

        ws.onmessage = (event: MessageEvent) => {
          const data = event.data as ArrayBuffer;
          if (!data || data.byteLength === 0) return;

          if (isMessageFrame(data)) {
            // Protobuf MessageFrame (same bytes as RTVI 0x22) → RTVI JSON
            try {
              const json = decodeRTVI(data);
              const msg = JSON.parse(json) as RTVIMessage;
              this._onMessage?.(msg);
            } catch {
              // skip malformed
            }
          } else if (isAudioFrame(data)) {
            // Protobuf AudioRawFrame → decode Int16 PCM → play
            this._playBotAudio(data);
          }
        };

        ws.onerror = () => {
          this.state = 'error';
          reject(new Error('WebSocket connection error'));
        };

        ws.onclose = (event: CloseEvent) => {
          this._ws = null;
          this._stopMicCapture();
          const msg = `WebSocket closed: code=${event.code} reason="${event.reason}" wasClean=${event.wasClean}`;
          console.warn(`[WebSocketTransport] ${msg}`);
          const errMsg = {
            type: 'error',
            data: { message: msg, logOnly: true },
          } as any;
          this._callbacks?.onError?.(errMsg);
          if (this.state !== 'error') {
            this.state = 'disconnected';
            this._callbacks.onDisconnected?.();
          }
        };
      } catch (e) {
        this.state = 'error';
        reject(e);
      }
    });
  }

  async _disconnect(): Promise<void> {
    if (this._ws) {
      try {
        this._ws.close();
      } catch {
        /* ignore */
      }
      this._ws = null;
    }
    this._stopMicCapture();
    if (this._micStream) {
      this._micStream.getTracks().forEach((t) => t.stop());
      this._micStream = null;
      this._micTrack = null;
    }
    if (this._audioContext) {
      await this._audioContext.close();
      this._audioContext = null;
    }
    this._dest = null;
    this._botTrack = null;
    if (this.state !== 'error') {
      this.state = 'disconnected';
      this._callbacks.onDisconnected?.();
    }
  }

  sendReadyMessage(): void {
    this.state = 'ready';
    this.sendMessage(RTVIMessage.clientReady());
  }

  sendMessage(message: RTVIMessage): void {
    const json = JSON.stringify(message);
    const encoded = encodeRTVI(json);
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(encoded);
    }
  }

  tracks(): Tracks {
    return {
      local: { audio: this._micTrack ?? undefined },
      bot: { audio: this._botTrack ?? undefined },
    };
  }

  // ---------------------------------------------------------------------------
  // Mic capture — sends protobuf AudioRawFrame (Int16 PCM)
  // ---------------------------------------------------------------------------

  private _startMicCapture(): void {
    if (this._processor) return;

    if (!this._micStream) {
      this._lazyInitMic();
      return;
    }

    this._setupMicCapture();
  }

  private async _lazyInitMic(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this._micStream = stream;
      this._micTrack = stream.getAudioTracks()[0];
      this._setupMicCapture();
    } catch {
      // Mic unavailable — connection still works, user just can't speak
    }
  }

  private async _setupMicCapture(): Promise<void> {
    if (!this._audioContext || !this._micStream || this._processor) return;

    if (this._audioContext.state === 'suspended') {
      await this._audioContext.resume();
    }

    const source = this._audioContext.createMediaStreamSource(this._micStream);

    // Use ScriptProcessorNode (deprecated but functional) for mic capture.
    // Convert Float32 → Int16 PCM → wrap in protobuf AudioRawFrame before sending.
    const processor = this._audioContext.createScriptProcessor(4096, 1, 1);
    this._processor = processor;

    let audioPktCount = 0;
    processor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (this.state !== 'ready') return;
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;

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
        this._audioContext!.sampleRate,
        1
      );
      this._ws.send(frame);
      audioPktCount++;
      if (audioPktCount <= 5 || audioPktCount % 20 === 0) {
        console.log(`[Mic] sent audio packet #${audioPktCount} (${frame.byteLength} bytes)`);
      }
    };

    source.connect(processor);
    // Keep the audio graph alive by routing to destination through a zero-gain node.
    const silence = this._audioContext.createGain();
    silence.gain.value = 0;
    processor.connect(silence);
    silence.connect(this._audioContext.destination);
  }

  private _stopMicCapture(): void {
    if (this._processor) {
      this._processor.disconnect();
      this._processor = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Bot audio playback — accepts protobuf AudioRawFrame (Int16 PCM)
  // ---------------------------------------------------------------------------

  private _playBotAudio(data: ArrayBuffer): void {
    if (!this._audioContext || !this._dest || data.byteLength === 0) return;

    const { int16Bytes, sampleRate, numChannels } = decodeAudioFrame(data);
    if (!int16Bytes || int16Bytes.length < 2) return;

    const float32 = int16ToFloat32(int16Bytes);
    if (float32.length === 0) return;

    try {
      const audioBuffer = this._audioContext.createBuffer(
        numChannels,
        float32.length,
        sampleRate
      );
      audioBuffer.copyToChannel(float32 as Float32Array<ArrayBuffer>, 0);

      const source = this._audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this._dest);
      source.connect(this._audioContext.destination);
      source.start();

      if (!this._botTrack) {
        this._botTrack = this._dest.stream.getAudioTracks()[0];
      }
    } catch {
      // ignore audio playback errors
    }
  }

  // ---------------------------------------------------------------------------
  // Device methods
  // ---------------------------------------------------------------------------

  async getAllMics(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }

  async getAllCams(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }

  async getAllSpeakers(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audiooutput');
  }

  updateMic(_micId: string): void {}
  updateCam(_camId: string): void {}
  updateSpeaker(_speakerId: string): void {}

  get selectedMic(): MediaDeviceInfo | Record<string, never> {
    return {} as Record<string, never>;
  }
  get selectedCam(): MediaDeviceInfo | Record<string, never> {
    return {} as Record<string, never>;
  }
  get selectedSpeaker(): MediaDeviceInfo | Record<string, never> {
    return {} as Record<string, never>;
  }

  enableMic(enable: boolean): void {
    if (this._micTrack) {
      this._micTrack.enabled = enable;
    }
  }
  enableCam(_enable: boolean): void {}
  enableScreenShare(_enable: boolean): void {}

  get isCamEnabled(): boolean {
    return false;
  }
  get isMicEnabled(): boolean {
    return this._micTrack?.enabled ?? false;
  }
  get isSharingScreen(): boolean {
    return false;
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  get state(): TransportState {
    return this._state;
  }

  set state(state: TransportState) {
    if (this._state !== state) {
      this._state = state;
      this._callbacks?.onTransportStateChanged?.(state);
    }
  }
}
