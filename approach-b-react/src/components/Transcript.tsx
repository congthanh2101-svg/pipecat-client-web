import React, { useEffect, useRef } from 'react';
import type { TranscriptEntry } from '../protocol/types';

interface TranscriptProps {
  entries: TranscriptEntry[];
}

export const Transcript: React.FC<TranscriptProps> = ({ entries }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="transcript card">
      <h3>Transcript</h3>
      <div className="transcript-container" ref={containerRef}>
        {entries.length === 0 ? (
          <div className="transcript-empty">
            Conversation will appear here after connecting.
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className={`transcript-entry ${entry.role}`}
            >
              <div className="transcript-bubble">
                <span className="transcript-role">
                  {entry.role === 'user' ? 'You' : 'Bot'}
                </span>
                <p className="transcript-text">{entry.text}</p>
                <span className="transcript-time">{entry.timestamp}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
