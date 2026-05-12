import React, { useState } from 'react';
import type { ConnectionStatus } from '../protocol/types';

interface ConnectFormProps {
  status: ConnectionStatus;
  isMicActive: boolean;
  onConnect: (phone: string) => void;
  onDisconnect: () => void;
}

export const ConnectForm: React.FC<ConnectFormProps> = ({
  status,
  isMicActive,
  onConnect,
  onDisconnect,
}) => {
  const [phone, setPhone] = useState('0909835115');

  const isConnected = status === 'connected' || status === 'bot-ready';
  const isConnecting = status === 'connecting';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isConnected) {
      onDisconnect();
    } else {
      onConnect(phone);
    }
  };

  return (
    <form className="connect-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="phone-input">Phone Number</label>
        <input
          id="phone-input"
          type="text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={isConnecting || isConnected}
          placeholder="Enter phone number"
          className="phone-input"
        />
      </div>
      <button
        type="submit"
        disabled={isConnecting}
        className={`connect-btn ${isConnected ? 'disconnect' : 'connect'}`}
      >
        {isConnecting ? (
          <>
            <span className="spinner" />
            Connecting...
          </>
        ) : isConnected ? (
          'Disconnect'
        ) : (
          'Connect'
        )}
      </button>
      {isMicActive && <div className="mic-indicator">Microphone active</div>}
    </form>
  );
};
