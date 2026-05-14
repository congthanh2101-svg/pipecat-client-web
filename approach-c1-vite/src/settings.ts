// ---------------------------------------------------------------------------
// Settings data model for Approach C1
// ---------------------------------------------------------------------------

export type MicConstraintPreset = 'best-stt' | 'aggressive-processing';

export type AudioProcessorType = 'script-processor' | 'audio-worklet';

export type AudioFormatType = 'protobuf-int16' | 'raw-int16' | 'raw-float32';

export interface AppSettings {
  sampleRate: 8000 | 16000 | 22050 | 44100;
  micConstraint: MicConstraintPreset;
  audioProcessor: AudioProcessorType;
  gainBoost: number;
  audioFormat: AudioFormatType;
  serverUrl: string;
  /** Number of initial AudioWorklet frames to discard (avoids driver startup noise). */
  skipInitialFrames: number;
  /** Capture gain ramp duration in ms (0 = instant). */
  captureRampMs: number;
  /** Playback gain ramp duration in ms (0 = instant). */
  playbackRampMs: number;
  /** Linear fade-in on first buffered audio frame (ms). */
  fadeInMs: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  sampleRate: 8000,
  micConstraint: 'best-stt',
  audioProcessor: 'audio-worklet',
  gainBoost: 0.0,
  audioFormat: 'protobuf-int16',
  serverUrl: 'https://rtstt-demo.securityzone.vn/connect',
  skipInitialFrames: 50,
  captureRampMs: 150,
  playbackRampMs: 80,
  fadeInMs: 15,
};

export class SettingsManager {
  private settings: AppSettings;

  constructor(initial?: Partial<AppSettings>) {
    this.settings = { ...DEFAULT_SETTINGS, ...initial };
  }

  get(): Readonly<AppSettings> {
    return this.settings;
  }

  getSampleRate(): number {
    return this.settings.sampleRate;
  }

  getMicConstraint(): boolean | MediaTrackConstraints {
    if (this.settings.micConstraint === 'aggressive-processing') {
      return {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
    }
    return true;
  }

  getGainBoost(): number {
    return this.settings.gainBoost;
  }

  getAudioFormat(): AudioFormatType {
    return this.settings.audioFormat;
  }

  getAudioProcessor(): AudioProcessorType {
    return this.settings.audioProcessor;
  }

  getServerUrl(): string {
    return this.settings.serverUrl;
  }

  getSkipInitialFrames(): number {
    return this.settings.skipInitialFrames;
  }

  getCaptureRampMs(): number {
    return this.settings.captureRampMs;
  }

  getPlaybackRampMs(): number {
    return this.settings.playbackRampMs;
  }

  getFadeInMs(): number {
    return this.settings.fadeInMs;
  }

  update(partial: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...partial };
  }

  reset(): void {
    this.settings = { ...DEFAULT_SETTINGS };
  }

  requiresReconnect(partial: Partial<AppSettings>): boolean {
    return (
      partial.sampleRate !== undefined ||
      partial.micConstraint !== undefined ||
      partial.audioProcessor !== undefined ||
      partial.audioFormat !== undefined ||
      partial.serverUrl !== undefined ||
      partial.skipInitialFrames !== undefined ||
      partial.captureRampMs !== undefined ||
      partial.playbackRampMs !== undefined ||
      partial.fadeInMs !== undefined
    );
  }
}
