/**
 * Web Audio API Mixer for Timeline Audio Export
 *
 * This module provides audio mixing capabilities using the Web Audio API.
 * Designed for long-term maintainability with clear separation of concerns.
 *
 * Architecture:
 * - AudioMixer: Main class for managing audio context and mixing
 * - AudioTrackSource: Individual audio track management
 * - Non-breaking: Works alongside existing video export
 *
 * Future enhancements:
 * - Volume automation
 * - Audio effects (reverb, compression)
 * - Multi-channel support beyond stereo
 */

export interface AudioMixerOptions {
  sampleRate?: number;
  channels?: number;
  latencyHint?: "interactive" | "balanced" | "playback";
}

export interface AudioTrackOptions {
  volume?: number; // 0.0 to 1.0
  pan?: number; // -1.0 (left) to 1.0 (right)
  muted?: boolean;
  startTime?: number; // in seconds
  endTime?: number; // in seconds
}

/**
 * Individual audio track source management
 */
export class AudioTrackSource {
  private source: MediaElementAudioSourceNode | AudioBufferSourceNode | null =
    null;
  private gainNode: GainNode;
  private pannerNode: StereoPannerNode;
  private context: AudioContext;
  private options: AudioTrackOptions;

  constructor(context: AudioContext, options: AudioTrackOptions = {}) {
    this.context = context;
    this.options = options;
    this.gainNode = context.createGain();
    this.pannerNode = context.createStereoPanner();

    // Set initial values
    this.setVolume(options.volume ?? 1.0);
    this.setPan(options.pan ?? 0);

    // Connect nodes: source -> gain -> panner -> destination
    this.gainNode.connect(this.pannerNode);
  }

  /**
   * Set track volume
   */
  setVolume(volume: number): void {
    this.gainNode.gain.setValueAtTime(
      Math.max(0, Math.min(1, volume)),
      this.context.currentTime
    );
  }

  /**
   * Set track pan
   */
  setPan(pan: number): void {
    this.pannerNode.pan.setValueAtTime(
      Math.max(-1, Math.min(1, pan)),
      this.context.currentTime
    );
  }

  /**
   * Connect this track to a destination
   */
  connect(destination: AudioNode): void {
    this.pannerNode.connect(destination);
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    this.pannerNode.disconnect();
    this.gainNode.disconnect();
    if (this.source) {
      this.source.disconnect();
      if ("stop" in this.source && typeof this.source.stop === "function") {
        this.source.stop();
      }
    }
  }

  /**
   * Load audio from HTMLAudioElement
   */
  async loadFromElement(audioElement: HTMLAudioElement): Promise<void> {
    if (this.source) {
      this.source.disconnect();
    }

    this.source = this.context.createMediaElementSource(audioElement);
    this.source.connect(this.gainNode);
  }

  /**
   * Load audio from AudioBuffer
   */
  async loadFromBuffer(buffer: AudioBuffer, when = 0): Promise<void> {
    if (this.source) {
      this.source.disconnect();
    }

    const bufferSource = this.context.createBufferSource();
    bufferSource.buffer = buffer;
    this.source = bufferSource;
    this.source.connect(this.gainNode);

    // Schedule playback
    bufferSource.start(when, this.options.startTime ?? 0);
    if (this.options.endTime) {
      bufferSource.stop(
        when + (this.options.endTime - (this.options.startTime ?? 0))
      );
    }
  }
}

/**
 * Main audio mixer class
 */
export class AudioMixer {
  private audioContext: AudioContext;
  private destination: MediaStreamAudioDestinationNode;
  private masterGain: GainNode;
  private tracks: Map<string, AudioTrackSource> = new Map();
  private isInitialized = false;

  constructor(options: AudioMixerOptions = {}) {
    // Create audio context with specified options
    this.audioContext = new (
      window.AudioContext || (window as any).webkitAudioContext
    )({
      sampleRate: options.sampleRate || 44_100,
      latencyHint: options.latencyHint || "balanced",
    });

    // Create master gain for overall volume control
    this.masterGain = this.audioContext.createGain();

    // Create destination for capturing mixed audio
    this.destination = this.audioContext.createMediaStreamDestination();

    // Connect master gain to destination
    this.masterGain.connect(this.destination);

    this.isInitialized = true;
  }

  /**
   * Get the mixed audio stream for export
   */
  getStream(): MediaStream {
    if (!this.isInitialized) {
      throw new Error("AudioMixer not initialized");
    }
    return this.destination.stream;
  }

  /**
   * Get the audio context (for advanced usage)
   */
  getContext(): AudioContext {
    return this.audioContext;
  }

  /**
   * Set master volume
   */
  setMasterVolume(volume: number): void {
    this.masterGain.gain.setValueAtTime(
      Math.max(0, Math.min(1, volume)),
      this.audioContext.currentTime
    );
  }

  /**
   * Add an audio track from an HTMLAudioElement
   */
  async addAudioTrack(
    id: string,
    audioElement: HTMLAudioElement,
    options?: AudioTrackOptions
  ): Promise<void> {
    // Remove existing track if it exists
    if (this.tracks.has(id)) {
      this.removeTrack(id);
    }

    const track = new AudioTrackSource(this.audioContext, options);
    await track.loadFromElement(audioElement);
    track.connect(this.masterGain);

    this.tracks.set(id, track);
  }

  /**
   * Add an audio track from an AudioBuffer
   */
  async addAudioBuffer(
    id: string,
    buffer: AudioBuffer,
    options?: AudioTrackOptions
  ): Promise<void> {
    // Remove existing track if it exists
    if (this.tracks.has(id)) {
      this.removeTrack(id);
    }

    const track = new AudioTrackSource(this.audioContext, options);
    await track.loadFromBuffer(buffer);
    track.connect(this.masterGain);

    this.tracks.set(id, track);
  }

  /**
   * Update track options
   */
  updateTrack(id: string, options: Partial<AudioTrackOptions>): void {
    const track = this.tracks.get(id);
    if (!track) {
      console.warn(`Track ${id} not found`);
      return;
    }

    if (options.volume !== undefined) {
      track.setVolume(options.volume);
    }
    if (options.pan !== undefined) {
      track.setPan(options.pan);
    }
  }

  /**
   * Remove a track
   */
  removeTrack(id: string): void {
    const track = this.tracks.get(id);
    if (track) {
      track.disconnect();
      this.tracks.delete(id);
    }
  }

  /**
   * Clear all tracks
   */
  clearTracks(): void {
    // Use Array.from for ES5 compatibility
    const trackIds = Array.from(this.tracks.keys());
    for (const id of trackIds) {
      this.removeTrack(id);
    }
  }

  /**
   * Get current state
   */
  getState(): {
    isInitialized: boolean;
    trackCount: number;
    sampleRate: number;
    state: AudioContextState;
  } {
    return {
      isInitialized: this.isInitialized,
      trackCount: this.tracks.size,
      sampleRate: this.audioContext.sampleRate,
      state: this.audioContext.state,
    };
  }

  /**
   * Resume audio context if suspended (required in some browsers)
   */
  async resume(): Promise<void> {
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  /**
   * Cleanup and dispose
   */
  async dispose(): Promise<void> {
    this.clearTracks();

    if (this.audioContext.state !== "closed") {
      await this.audioContext.close();
    }

    this.isInitialized = false;
  }
}

/**
 * Helper function to load audio file as AudioBuffer
 * Note: AudioBuffer is bound to the AudioContext that created it,
 * so the context parameter is required to ensure compatibility
 */
export async function loadAudioBuffer(
  file: File | Blob,
  context: AudioContext
): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await context.decodeAudioData(arrayBuffer);
  return audioBuffer;
}

/**
 * Helper to check Web Audio API availability
 */
export function isWebAudioSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window.AudioContext || (window as any).webkitAudioContext);
}

/**
 * Get supported audio formats for MediaRecorder
 */
export function getSupportedAudioCodecs(): string[] {
  const codecs = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2", // AAC
    "audio/mpeg", // MP3
  ];

  if (typeof MediaRecorder === "undefined") {
    return [];
  }

  return codecs.filter((codec) => MediaRecorder.isTypeSupported(codec));
}
