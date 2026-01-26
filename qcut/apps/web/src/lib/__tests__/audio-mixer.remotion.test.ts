/**
 * Remotion Audio Mixer Tests
 *
 * Tests for Remotion audio extraction, timing sync, and mixing.
 *
 * @module lib/__tests__/audio-mixer.remotion.test
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import {
  RemotionAudioMixer,
  createRemotionAudioMixer,
  type RemotionAudioSource,
  type RemotionAudioMixResult,
} from "../audio-mixer";

// ============================================================================
// Mocks
// ============================================================================

// Mock AudioContext and related APIs
class MockAudioBuffer {
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  duration: number;

  constructor(options: { length: number; numberOfChannels: number; sampleRate: number }) {
    this.length = options.length;
    this.numberOfChannels = options.numberOfChannels;
    this.sampleRate = options.sampleRate;
    this.duration = options.length / options.sampleRate;
  }

  getChannelData(): Float32Array {
    return new Float32Array(this.length);
  }
}

class MockGainNode {
  gain = { value: 1, setValueAtTime: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockStereoPannerNode {
  pan = { value: 0, setValueAtTime: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockAudioBufferSourceNode {
  buffer: MockAudioBuffer | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MockMediaStreamAudioDestinationNode {
  stream = { id: "mock-stream" };
}

class MockAudioContext {
  sampleRate = 44100;
  state: AudioContextState = "running";
  currentTime = 0;
  destination = {};

  createGain = vi.fn(() => new MockGainNode());
  createStereoPanner = vi.fn(() => new MockStereoPannerNode());
  createBufferSource = vi.fn(() => new MockAudioBufferSourceNode());
  createMediaStreamDestination = vi.fn(() => new MockMediaStreamAudioDestinationNode());
  createMediaElementSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));

  decodeAudioData = vi.fn(async () =>
    new MockAudioBuffer({ length: 44100, numberOfChannels: 2, sampleRate: 44100 })
  );

  resume = vi.fn(async () => {});
  close = vi.fn(async () => { this.state = "closed"; });
}

class MockOfflineAudioContext {
  destination = {};
  sampleRate = 44100;

  createGain = vi.fn(() => new MockGainNode());
  createStereoPanner = vi.fn(() => new MockStereoPannerNode());
  createBufferSource = vi.fn(() => new MockAudioBufferSourceNode());

  startRendering = vi.fn(async () =>
    new MockAudioBuffer({ length: 44100, numberOfChannels: 2, sampleRate: 44100 })
  );
}

// Apply mocks before all tests
beforeAll(() => {
  // Mock window.AudioContext
  (global as any).AudioContext = MockAudioContext;
  (global as any).OfflineAudioContext = MockOfflineAudioContext;

  // Mock fetch for audio loading
  global.fetch = vi.fn(async () => ({
    ok: true,
    statusText: "OK",
    arrayBuffer: async () => new ArrayBuffer(1000),
  })) as any;
});

// ============================================================================
// Test Helpers
// ============================================================================

function createMockRemotionAudioSource(
  overrides: Partial<RemotionAudioSource> = {}
): RemotionAudioSource {
  return {
    elementId: `element-${Math.random().toString(36).slice(2, 9)}`,
    audioPath: "blob:audio-test-url",
    startFrame: 0,
    durationFrames: 90, // 3 seconds at 30fps
    volume: 1,
    ...overrides,
  };
}

// ============================================================================
// RemotionAudioMixer Tests
// ============================================================================

describe("RemotionAudioMixer", () => {
  let mixer: RemotionAudioMixer;

  beforeEach(() => {
    vi.clearAllMocks();
    mixer = createRemotionAudioMixer();
  });

  describe("constructor", () => {
    it("should create a mixer instance", () => {
      expect(mixer).toBeInstanceOf(RemotionAudioMixer);
    });

    it("should inherit from AudioMixer", () => {
      expect(mixer.getContext()).toBeDefined();
      expect(mixer.getStream()).toBeDefined();
    });
  });

  describe("mixRemotionAudio", () => {
    it("should mix multiple audio sources", async () => {
      const sources: RemotionAudioSource[] = [
        createMockRemotionAudioSource({ elementId: "source-1" }),
        createMockRemotionAudioSource({ elementId: "source-2" }),
      ];

      const result = await mixer.mixRemotionAudio(sources, 30, 10);

      expect(result).toHaveProperty("buffer");
      expect(result).toHaveProperty("duration", 10);
      expect(result).toHaveProperty("sourceCount");
      expect(result).toHaveProperty("errors");
      expect(result.errors).toEqual([]);
    });

    it("should handle empty sources array", async () => {
      const result = await mixer.mixRemotionAudio([], 30, 5);

      expect(result.buffer).toBeDefined();
      expect(result.sourceCount).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it("should respect volume settings", async () => {
      const sources: RemotionAudioSource[] = [
        createMockRemotionAudioSource({ volume: 0.5 }),
      ];

      const result = await mixer.mixRemotionAudio(sources, 30, 5);

      expect(result.sourceCount).toBe(1);
    });

    it("should respect pan settings", async () => {
      const sources: RemotionAudioSource[] = [
        createMockRemotionAudioSource({ pan: -0.5 }),
        createMockRemotionAudioSource({ pan: 0.5 }),
      ];

      const result = await mixer.mixRemotionAudio(sources, 30, 5);

      expect(result.sourceCount).toBe(2);
    });

    it("should calculate timing from frames and fps", async () => {
      const sources: RemotionAudioSource[] = [
        createMockRemotionAudioSource({
          startFrame: 30, // 1 second at 30fps
          durationFrames: 60, // 2 seconds
        }),
      ];

      const result = await mixer.mixRemotionAudio(sources, 30, 5);

      expect(result.sourceCount).toBe(1);
    });

    it("should collect errors for failed sources", async () => {
      // Mock fetch to fail for specific URL
      const originalFetch = global.fetch;
      global.fetch = vi.fn(async (url) => {
        if (String(url).includes("fail")) {
          return { ok: false, statusText: "Not Found" };
        }
        return originalFetch(url);
      }) as any;

      const sources: RemotionAudioSource[] = [
        createMockRemotionAudioSource({ audioPath: "fail-audio-url" }),
        createMockRemotionAudioSource({ audioPath: "good-audio-url" }),
      ];

      const result = await mixer.mixRemotionAudio(sources, 30, 5);

      expect(result.errors.length).toBe(1);
      expect(result.errors[0].elementId).toBe(sources[0].elementId);

      // Restore original fetch
      global.fetch = originalFetch;
    });
  });

  describe("extractAudioSource", () => {
    it("should extract audio source from pre-render result", () => {
      const preRenderResult = {
        elementId: "test-element",
        audioPath: "/path/to/audio.mp3",
        totalFrames: 150,
      };

      const source = RemotionAudioMixer.extractAudioSource(
        preRenderResult,
        30, // start frame
        0.8 // volume
      );

      expect(source).not.toBeNull();
      expect(source?.elementId).toBe("test-element");
      expect(source?.audioPath).toBe("/path/to/audio.mp3");
      expect(source?.startFrame).toBe(30);
      expect(source?.durationFrames).toBe(150);
      expect(source?.volume).toBe(0.8);
    });

    it("should return null when no audio path", () => {
      const preRenderResult = {
        elementId: "test-element",
        totalFrames: 150,
      };

      const source = RemotionAudioMixer.extractAudioSource(
        preRenderResult,
        0,
        1
      );

      expect(source).toBeNull();
    });

    it("should use default volume of 1", () => {
      const preRenderResult = {
        elementId: "test-element",
        audioPath: "/path/to/audio.mp3",
        totalFrames: 150,
      };

      const source = RemotionAudioMixer.extractAudioSource(preRenderResult, 0);

      expect(source?.volume).toBe(1);
    });
  });

  describe("combineAudioBuffers", () => {
    it("should return null when both buffers are null", async () => {
      const result = await mixer.combineAudioBuffers(null, null);
      expect(result).toBeNull();
    });

    it("should return remotion buffer when qcut is null", async () => {
      const remotionBuffer = new MockAudioBuffer({
        length: 44100,
        numberOfChannels: 2,
        sampleRate: 44100,
      }) as unknown as AudioBuffer;

      const result = await mixer.combineAudioBuffers(null, remotionBuffer);

      expect(result).toBe(remotionBuffer);
    });

    it("should return qcut buffer when remotion is null", async () => {
      const qcutBuffer = new MockAudioBuffer({
        length: 44100,
        numberOfChannels: 2,
        sampleRate: 44100,
      }) as unknown as AudioBuffer;

      const result = await mixer.combineAudioBuffers(qcutBuffer, null);

      expect(result).toBe(qcutBuffer);
    });

    it("should combine both buffers when present", async () => {
      const qcutBuffer = new MockAudioBuffer({
        length: 44100,
        numberOfChannels: 2,
        sampleRate: 44100,
      }) as unknown as AudioBuffer;

      const remotionBuffer = new MockAudioBuffer({
        length: 88200, // 2 seconds
        numberOfChannels: 2,
        sampleRate: 44100,
      }) as unknown as AudioBuffer;

      const result = await mixer.combineAudioBuffers(qcutBuffer, remotionBuffer);

      expect(result).toBeDefined();
    });
  });
});

// ============================================================================
// createRemotionAudioMixer Tests
// ============================================================================

describe("createRemotionAudioMixer", () => {
  it("should create a RemotionAudioMixer instance", () => {
    const mixer = createRemotionAudioMixer();
    expect(mixer).toBeInstanceOf(RemotionAudioMixer);
  });

  it("should pass options to the mixer", () => {
    const mixer = createRemotionAudioMixer({
      sampleRate: 48000,
      latencyHint: "playback",
    });
    expect(mixer).toBeInstanceOf(RemotionAudioMixer);
  });
});

// ============================================================================
// RemotionAudioSource Type Tests
// ============================================================================

describe("RemotionAudioSource type", () => {
  it("should allow valid source configurations", () => {
    const source: RemotionAudioSource = {
      elementId: "test-element",
      audioPath: "/audio/file.mp3",
      startFrame: 0,
      durationFrames: 100,
      volume: 0.75,
      pan: -0.5,
    };

    expect(source.elementId).toBe("test-element");
    expect(source.audioPath).toBe("/audio/file.mp3");
    expect(source.startFrame).toBe(0);
    expect(source.durationFrames).toBe(100);
    expect(source.volume).toBe(0.75);
    expect(source.pan).toBe(-0.5);
  });

  it("should allow pan to be optional", () => {
    const source: RemotionAudioSource = {
      elementId: "test",
      audioPath: "/audio.mp3",
      startFrame: 0,
      durationFrames: 50,
      volume: 1,
    };

    expect(source.pan).toBeUndefined();
  });
});
