import { useCallback, useRef, useState } from 'react';
import { ConnectForm } from './components/ConnectForm';
import { StatusPanel } from './components/StatusPanel';
import { DebugLog } from './components/DebugLog';
import { Transcript } from './components/Transcript';
import { useWebSocket } from './websocket/useWebSocket';
import { useAudio } from './audio/useAudio';
import type { RTVIMessage, TranscriptEntry } from './protocol/types';
import './App.css';

function formatTimestamp(): string {
  return new Date().toLocaleTimeString();
}

function App() {
  const ws = useWebSocket();
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  // Stable ref for bridging mic audio data to WebSocket send
  const sendAudioRef = useRef<(buffer: ArrayBuffer) => void>(() => {});
  const onAudioData = useCallback((buffer: ArrayBuffer) => {
    sendAudioRef.current(buffer);
  }, []);

  const { isMicActive, isSpeakerActive, startMic, stopMic, playAudioChunk } =
    useAudio({ onAudioData });

  // Keep the ref wired to the current ws.sendAudio
  sendAudioRef.current = ws.sendAudio;

  // Wire received audio from WebSocket to speaker output
  ws.onAudioData(playAudioChunk);

  // Transcript message handler
  const handleTranscript = useCallback(
    (msg: RTVIMessage & { data: { text: string } }) => {
      const text = msg.data?.text;
      if (!text) return;
      const role = msg.type === 'user-transcription' ? 'user' : 'bot';
      setTranscripts((prev) => [
        ...prev,
        {
          id: msg.id,
          timestamp: formatTimestamp(),
          role,
          text,
        },
      ]);
    },
    []
  );
  ws.onTranscriptMessage(handleTranscript);

  const handleConnect = useCallback(
    async (phone: string) => {
      ws.connect(phone);
      try {
        await startMic();
      } catch (e) {
        console.error('Mic access denied:', e);
      }
    },
    [ws, startMic]
  );

  const handleDisconnect = useCallback(() => {
    stopMic();
    ws.disconnect();
  }, [ws, stopMic]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Pipecat Client</h1>
        <span className="app-subtitle">RTVI WebSocket Interface</span>
      </header>

      <main className="app-main">
        <div className="left-column">
          <ConnectForm
            status={ws.status}
            isMicActive={isMicActive}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
          <StatusPanel
            status={ws.status}
            isMicActive={isMicActive}
            isSpeakerActive={isSpeakerActive}
            error={ws.error}
          />
        </div>

        <div className="right-column">
          <DebugLog logs={ws.logs} />
          <Transcript entries={transcripts} />
        </div>
      </main>
    </div>
  );
}

export default App;
