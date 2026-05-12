import React, { useEffect, useRef } from 'react';
import type { LogEntry } from '../protocol/types';

interface DebugLogProps {
  logs: LogEntry[];
}

const LEVEL_CLASS: Record<LogEntry['level'], string> = {
  info: 'log-info',
  warn: 'log-warn',
  error: 'log-error',
  send: 'log-send',
  recv: 'log-recv',
};

export const DebugLog: React.FC<DebugLogProps> = ({ logs }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="debug-log card">
      <h3>Debug Log</h3>
      <div className="log-container" ref={containerRef}>
        {logs.length === 0 ? (
          <div className="log-empty">No messages yet. Connect to begin.</div>
        ) : (
          logs.map((entry, i) => (
            <div key={i} className={`log-entry ${LEVEL_CLASS[entry.level]}`}>
              <span className="log-time">{entry.timestamp}</span>
              <span className="log-msg">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
