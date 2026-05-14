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

  // ---------------------------------------------------------------------------
  // Initiator chain (matches @pipecat-ai/client-js PipecatClient)
  // ---------------------------------------------------------------------------

  /**
   * POST /connect (empty body) → get wsUrl from the bridge server.
   * Handles both camelCase (wsUrl) and snake_case (ws_url) response keys.
   */
  async startBot(endpoint: string): Promise<string> {
    this.log(`startBot: fetching wsUrl from ${endpoint}...`);
    const response = await fetch(endpoint, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`startBot failed: ${response.status}`);
    }
    const data = await response.json() as Record<string, unknown>;
    const wsUrl = (data.wsUrl || data.ws_url) as string | undefined;
    if (!wsUrl) {
      throw new Error(`startBot: no wsUrl/ws_url in response: ${JSON.stringify(data)}`);
    }
    this.log(`startBot: got wsUrl=${wsUrl}`);
    return wsUrl;
  }

  /**
   * WebSocket connect to a wsUrl (returned by startBot).
   * Resolves when the WebSocket opens and client-ready is sent.
   */
  connect(wsUrl: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.ws) {
        this.disconnect();
      }

      this.log(`connect: connecting to ${wsUrl}`);
      this.setState('connecting');

      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        this.ws = ws;
        this.log('connect: WebSocket opened, sending client-ready');
        this.setState('connected');

        const msg = createClientReady();
        this.sendRTVI(msg);
        this.log(`connect: sent client-ready`);

        // Flush any pending audio (captured before WS opened)
        for (const audio of this.pendingAudio) {
          ws.send(audio);
        }
        this.pendingAudio = [];
        resolve();
      };

      ws.onmessage = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          this.handleBinaryMessage(event.data);
        } else if (typeof event.data === 'string') {
          this.log(`Text message: ${event.data}`);
        }
      };

      ws.onclose = (event: CloseEvent) => {
        this.ws = null;
        this.log(`WebSocket closed: code=${event.code} reason=${event.reason}`);
        this.setState('disconnected');
      };

      ws.onerror = () => {
        this.log('WebSocket error');
        this.setState('error');
        reject(new Error('WebSocket connection error'));
      };
    });
  }

  /**
   * Convenience: startBot (POST) → await → connect (WebSocket).
   */
  async startBotAndConnect(endpoint: string): Promise<void> {
    const wsUrl = await this.startBot(endpoint);
    await this.connect(wsUrl);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Send helpers
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

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
