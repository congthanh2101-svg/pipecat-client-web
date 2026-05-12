import { encodeMessage, decodeMessage, createClientReady, createRTVIMessage } from './protocol.js';

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

  connect(phone: string, conversationId: string): void {
    if (this.ws) {
      this.disconnect();
    }
    const url = `wss://aeon-pipecat.securityzone.vn/ws?phone=${encodeURIComponent(phone)}&conv&conversation_id=${conversationId}`;
    this.log(`Connecting to ${url}`);
    this.setState('connecting');
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => {
      this.log('WebSocket connected, sending client-ready');
      this.setState('connected');
      const msg = createClientReady();
      this.log(`Sent: ${msg}`);
      this.sendRTVI(msg);
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

  sendBinary(data: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('Cannot send binary: not connected');
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
    try {
      const json = decodeMessage(data);
      const parsed = JSON.parse(json);
      this.log(`Received: ${json}`);
      if (parsed.type) {
        this.onMessage(parsed.type, parsed.data ?? parsed);
      }
    } catch {
      // Not a JSON RTVI message, treat as audio binary data
      this.log(`Received audio binary data: ${data.byteLength} bytes`);
      if (this.onAudioBinary) {
        this.onAudioBinary(data);
      }
    }
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
