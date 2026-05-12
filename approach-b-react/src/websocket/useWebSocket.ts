import { useCallback, useRef, useState } from 'react';
import { encodeMessage } from '../protocol/encode';
import { decodeMessage, isEncodedMessage } from '../protocol/decode';
import type {
  RTVIMessage,
  ConnectionStatus,
  LogEntry,
} from '../protocol/types';
import { RTVI_MESSAGE_TYPES } from '../protocol/types';

const WS_URL = 'wss://aeon-pipecat.securityzone.vn/ws';

export interface UseWebSocketReturn {
  status: ConnectionStatus;
  error: string | null;
  logs: LogEntry[];
  connect: (phone: string) => void;
  disconnect: () => void;
  sendAudio: (buffer: ArrayBuffer) => void;
  onAudioData: (cb: ((data: ArrayBuffer) => void) | null) => void;
  onTranscriptMessage: (cb: ((msg: RTVIMessage & { data: { text: string } }) => void) | null) => void;
}

function formatTimestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function createClientReady(): string {
  const userAgent = navigator.userAgent;
  let browser = 'Other';
  if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) browser = 'Chrome';
  else if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) browser = 'Safari';
  else if (userAgent.includes('Edg')) browser = 'Edge';

  return JSON.stringify({
    label: 'rtvi-ai',
    type: RTVI_MESSAGE_TYPES.CLIENT_READY,
    data: {
      version: '1.0.0',
      about: {
        library: 'pipecat-client-web',
        library_version: '1.0.0',
        platform_details: {
          browser,
          platform_type: 'desktop',
        },
      },
    },
    id: crypto.randomUUID().slice(0, 8),
  });
}

export function useWebSocket(): UseWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCallbackRef = useRef<((data: ArrayBuffer) => void) | null>(null);
  const transcriptCallbackRef = useRef<((msg: RTVIMessage & { data: { text: string } }) => void) | null>(null);

  const addLog = useCallback((message: string, level: LogEntry['level'] = 'info') => {
    setLogs((prev) => [
      ...prev,
      { timestamp: formatTimestamp(), message, level },
    ]);
  }, []);

  const connect = useCallback(
    (phone: string) => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      setError(null);
      setStatus('connecting');
      addLog(`Connecting with phone: ${phone}`, 'info');

      const conversationId = crypto.randomUUID();
      const url = `${WS_URL}?phone=${encodeURIComponent(phone)}&conv&conversation_id=${conversationId}`;

      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
          addLog('WebSocket connected', 'info');
          setStatus('connected');

          // Send client-ready message
          const clientReady = createClientReady();
          addLog(`Sending: ${clientReady}`, 'send');
          ws.send(encodeMessage(clientReady));
        };

        ws.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          const data = event.data;

          if (isEncodedMessage(data)) {
            // RTVI protocol message
            try {
              const json = decodeMessage(data);
              addLog(`Received: ${json}`, 'recv');
              const msg = JSON.parse(json) as RTVIMessage;

              if (msg.type === RTVI_MESSAGE_TYPES.BOT_READY) {
                addLog('Bot is ready', 'info');
                setStatus('bot-ready');
              } else if (msg.type === RTVI_MESSAGE_TYPES.BOT_DISCONNECTED) {
                addLog('Bot disconnected', 'info');
                setStatus('disconnected');
              } else if (
                msg.type === RTVI_MESSAGE_TYPES.USER_TRANSCRIPTION ||
                msg.type === RTVI_MESSAGE_TYPES.BOT_TRANSCRIPTION ||
                msg.type === RTVI_MESSAGE_TYPES.BOT_OUTPUT
              ) {
                transcriptCallbackRef.current?.(msg as RTVIMessage & { data: { text: string } });
              } else if (msg.type === RTVI_MESSAGE_TYPES.ERROR) {
                const errMsg = (msg.data as { message?: string } | undefined)?.message ?? 'Unknown error';
                addLog(`Error: ${errMsg}`, 'error');
                setError(errMsg);
              }
            } catch (e) {
              addLog(`Failed to parse message: ${e}`, 'error');
            }
          } else {
            // Raw audio data (Float32 PCM)
            audioCallbackRef.current?.(data);
          }
        };

        ws.onerror = () => {
          addLog('WebSocket error', 'error');
          setError('WebSocket connection error');
          setStatus('error');
        };

        ws.onclose = (event) => {
          addLog(`WebSocket closed (code: ${event.code})`, 'info');
          wsRef.current = null;
          setStatus('disconnected');
        };
      } catch (e) {
        addLog(`Connection failed: ${e}`, 'error');
        setError(`Connection failed: ${e}`);
        setStatus('error');
      }
    },
    [addLog]
  );

  const disconnect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const disconnectMsg = JSON.stringify({
        label: 'rtvi-ai',
        type: 'disconnect-bot',
        data: {},
        id: crypto.randomUUID().slice(0, 8),
      });
      addLog(`Sending: ${disconnectMsg}`, 'send');
      try {
        wsRef.current.send(encodeMessage(disconnectMsg));
      } catch {
        // Ignore send errors during disconnect
      }
      wsRef.current.close(1000, 'Client disconnect');
    }
    wsRef.current = null;
    setStatus('disconnected');
  }, [addLog]);

  const sendAudio = useCallback((buffer: ArrayBuffer) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(buffer);
    }
  }, []);

  const onAudioData = useCallback(
    (cb: ((data: ArrayBuffer) => void) | null) => {
      audioCallbackRef.current = cb;
    },
    []
  );

  const onTranscriptMessage = useCallback(
    (cb: ((msg: RTVIMessage & { data: { text: string } }) => void) | null) => {
      transcriptCallbackRef.current = cb;
    },
    []
  );

  return {
    status,
    error,
    logs,
    connect,
    disconnect,
    sendAudio,
    onAudioData,
    onTranscriptMessage,
  };
}
