import { encodeMessage, decodeMessage, createClientReady, createRTVIMessage, isAudioFrame } from './protocol.js';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
export type MessageHandler = (type: string, data: unknown) => void;
export type StateHandler = (state: ConnectionState) => void;
export type AudioBinaryHandler = (data: ArrayBuffer) => void;

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private onMessage: MessageHandler;
  private onStateChange: StateHandler;
  private onDebugLog: (msg: string) => void;
  private onAudioBinary: AudioBinaryHandler | null = null;
  private pendingAudio: ArrayBuffer[] = [];

  constructor(
    onMessage: MessageHandler,
    onStateChange: StateHandler,
    onDebugLog: (msg: string) => void
  ) {
    this.onMessage = onMessage;
    this.onStateChange = onStateChange;
    this.onDebugLog = onDebugLog;
  }

  setAudioBinaryHandler(handler: AudioBinaryHandler): void {
    this.onAudioBinary = handler;
  }

  /**
   * Connect via bridge protocol: POST to endpoint → get wsUrl → WebSocket.
   * Returns a promise that resolves when the WebSocket opens.
   */
  connect(endpoint: string, phone: string, conversationId: string): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      if (this.ws) {
        this.disconnect();
      }

      this.log(`Fetching wsUrl from ${endpoint}...`);
      this.setState('connecting');

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, conversation_id: conversationId }),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(`Connect request failed: ${response.status} ${errText}`);
        }

        const { wsUrl } = await response.json();
        this.log(`Got wsUrl: ${wsUrl}`);
        this._connectWs(wsUrl, resolve, reject);
      } catch (e) {
        this.log(`Connect error: ${e}`);
        this.setState('error');
        reject(e);
      }
    });
  }

  private _connectWs(wsUrl: string, resolve: () => void, reject: (reason?: unknown) => void): void {
    this.log(`Connecting WebSocket...`);
    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.log('WebSocket connected, sending client-ready');
      this.setState('connected');
      const msg = createClientReady();
      this.log(`Sent: ${msg}`);
      this.sendRTVI(msg);

      // Flush any pending audio
      for (const audio of this.pendingAudio) {
        this.ws!.send(audio);
      }
      this.pendingAudio = [];
      resolve();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        this.handleBinaryMessage(event.data);
      } else if (typeof event.data === 'string') {
        this.log(`Text message: ${event.data}`);
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.log(`WebSocket closed: code=${event.code} reason=${event.reason}`);
      this.setState('disconnected');
      this.ws = null;
    };

    this.ws.onerror = () => {
      this.log('WebSocket error');
      this.setState('error');
      reject(new Error('WebSocket connection error'));
    };
  }

  disconnect(): void {
    if (!this.ws) return;
    try {
      const msg = createRTVIMessage('disconnect-bot', {});
      this.log(`Sent: ${msg}`);
      this.sendRTVI(msg);
    } catch {
      // ignore send errors during disconnect
    }
    setTimeout(() => {
      if (this.ws) {
        this.ws.close(1000, 'User disconnect');
        this.ws = null;
      }
    }, 200);
    this.setState('disconnected');
  }

  /**
   * Send binary data (expects protobuf AudioRawFrame from AudioManager).
   * If WebSocket is not yet open, queue for delivery after connection.
   */
  sendBinary(data: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingAudio.push(data);
      return;
    }
    this.ws.send(data);
  }

  sendRTVI(jsonStr: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('Cannot send RTVI: not connected');
      return;
    }
    const buffer = encodeMessage(jsonStr);
    this.ws.send(buffer);
  }

  getState(): ConnectionState {
    return this.state;
  }

  private handleBinaryMessage(data: ArrayBuffer): void {
    // Protobuf MessageFrame (0x22) → decode RTVI JSON
    if (data.byteLength > 0 && new Uint8Array(data)[0] === 0x22) {
      try {
        const json = decodeMessage(data);
        const parsed = JSON.parse(json);
        this.log(`Received: ${json}`);
        if (parsed.type) {
          this.onMessage(parsed.type, parsed.data ?? parsed);
        }
        return;
      } catch {
        this.log('Failed to decode RTVI message');
        return;
      }
    }

    // Protobuf AudioRawFrame (0x12) → pass to audio handler
    if (isAudioFrame(data)) {
      if (this.onAudioBinary) {
        this.onAudioBinary(data);
      }
      return;
    }

    this.log(`Unknown binary data: ${data.byteLength} bytes`);
  }

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.onStateChange(state);
    }
  }

  private log(msg: string): void {
    this.onDebugLog(msg);
  }
}
