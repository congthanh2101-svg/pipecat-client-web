import React from 'react';
import type { ConnectionStatus } from '../protocol/types';

interface StatusPanelProps {
  status: ConnectionStatus;
  isMicActive: boolean;
  isSpeakerActive: boolean;
  error: string | null;
}

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; color: string }> = {
  disconnected: { label: 'Disconnected', color: '#666' },
  connecting: { label: 'Connecting...', color: '#f0a500' },
  connected: { label: 'Connected', color: '#4caf50' },
  'bot-ready': { label: 'Bot Ready', color: '#00e676' },
  error: { label: 'Error', color: '#ff4444' },
};

export const StatusPanel: React.FC<StatusPanelProps> = ({
  status,
  isMicActive,
  isSpeakerActive,
  error,
}) => {
  const config = STATUS_CONFIG[status];

  return (
    <div className="status-panel card">
      <h3>Connection Status</h3>
      <div className="status-row">
        <span
          className="status-dot"
          style={{ backgroundColor: config.color }}
        />
        <span className="status-label">{config.label}</span>
      </div>
      {error && <div className="status-error">{error}</div>}
      <div className="status-info">
        <div className={`info-item ${isMicActive ? 'active' : ''}`}>
          <span className="info-dot" />
          Microphone {isMicActive ? 'Active' : 'Inactive'}
        </div>
        <div className={`info-item ${isSpeakerActive ? 'active' : ''}`}>
          <span className="info-dot" />
          Speaker {isSpeakerActive ? 'Active' : 'Inactive'}
        </div>
      </div>
    </div>
  );
};
