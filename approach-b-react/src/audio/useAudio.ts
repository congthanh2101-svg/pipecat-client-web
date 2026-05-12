import { useCallback, useRef, useState } from 'react';

const TARGET_SAMPLE_RATE = 16000;

export interface UseAudioReturn {
  isMicActive: boolean;
  isSpeakerActive: boolean;
  startMic: () => Promise<void>;
  stopMic: () => void;
  playAudioChunk: (buffer: ArrayBuffer) => void;
}

interface UseAudioOptions {
  onAudioData: (buffer: ArrayBuffer) => void;
}

/**
 * Simple nearest-neighbor downsampling to 16kHz.
 * For production use, consider a proper SRC lib with low-pass filtering.
 */
function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const outLen = Math.floor(input.length / ratio);
  const output = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    output[i] = input[Math.floor(i * ratio)];
  }
  return output;
}

/**
 * Hook to manage microphone capture and speaker playback.
 *
 * Captures mono Float32 PCM audio at 16kHz from the microphone
 * and plays back received Float32 PCM audio through the speakers.
 */
export function useAudio({ onAudioData }: UseAudioOptions): UseAudioReturn {
  const [isMicActive, setIsMicActive] = useState(false);
  const [isSpeakerActive, setIsSpeakerActive] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const actualSampleRateRef = useRef<number>(TARGET_SAMPLE_RATE);

  const getAudioContext = useCallback((): AudioContext => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      actualSampleRateRef.current = audioContextRef.current.sampleRate;
    }
    return audioContextRef.current;
  }, []);

  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: TARGET_SAMPLE_RATE },
          channelCount: { ideal: 1 },
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const audioCtx = getAudioContext();
      actualSampleRateRef.current = audioCtx.sampleRate;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // ScriptProcessorNode for capturing PCM data
      // Buffer size 4096 = ~256ms at 16kHz — good balance of latency vs. throughput
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event: AudioProcessingEvent) => {
        const inputData = event.inputBuffer.getChannelData(0);

        // Resample if browser did not honour the requested sample rate
        const resampled = (actualSampleRateRef.current !== TARGET_SAMPLE_RATE)
          ? resampleTo16k(inputData, actualSampleRateRef.current)
          : inputData;

        // Float32Array -> ArrayBuffer for WebSocket transfer
        const buffer = new Float32Array(resampled);
        onAudioData(buffer.buffer.slice(0));
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      setIsMicActive(true);
    } catch (e) {
      console.error('Failed to start microphone:', e);
      throw e;
    }
  }, [getAudioContext, onAudioData]);

  const stopMic = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());

    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;

    setIsMicActive(false);
  }, []);

  const playAudioChunk = useCallback(
    (buffer: ArrayBuffer) => {
      if (buffer.byteLength === 0) return;

      try {
        const audioCtx = getAudioContext();
        const float32Data = new Float32Array(buffer);

        // createBuffer takes the buffer's sample rate, AudioContext handles resampling on playback
        const audioBuffer = audioCtx.createBuffer(1, float32Data.length, TARGET_SAMPLE_RATE);
        audioBuffer.copyToChannel(float32Data, 0);

        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);

        setIsSpeakerActive(true);
        source.onended = () => {
          setIsSpeakerActive(false);
        };

        source.start();
      } catch (e) {
        console.error('Failed to play audio chunk:', e);
      }
    },
    [getAudioContext]
  );

  return {
    isMicActive,
    isSpeakerActive,
    startMic,
    stopMic,
    playAudioChunk,
  };
}
