/** RTVI message structure sent/received over WebSocket */
export interface RTVIMessage {
  label: string;
  type: string;
  data: unknown;
  id: string;
}

/** RTVI client-ready data payload */
export interface ClientReadyData {
  version: string;
  about: {
    library: string;
    library_version: string;
    platform_details: {
      browser: string;
      platform_type: string;
    };
  };
}

/** RTVI bot-ready data payload */
export interface BotReadyData {
  version: string;
  about: {
    library: string;
    library_version: string;
  };
}

/** RTVI transcription data payload */
export interface TranscriptionData {
  text: string;
  is_final: boolean;
  role?: string;
}

/** RTVI bot output data payload */
export interface BotOutputData {
  text: string;
}

/** Known RTVI message types */
export const RTVI_MESSAGE_TYPES = {
  CLIENT_READY: 'client-ready',
  BOT_READY: 'bot-ready',
  BOT_DISCONNECTED: 'bot-disconnected',
  USER_TRANSCRIPTION: 'user-transcription',
  BOT_TRANSCRIPTION: 'bot-transcription',
  BOT_OUTPUT: 'bot-output',
  ERROR: 'error',
} as const;

/** Connection status enum */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'bot-ready'
  | 'error';

/** Debug log entry */
export interface LogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'send' | 'recv';
}

/** Transcript entry for the chat display */
export interface TranscriptEntry {
  id: string;
  timestamp: string;
  role: 'user' | 'bot';
  text: string;
}
