/**
 * Tests for AudioSessionManager and enhanced session management.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  AudioSessionManager,
  type AudioSessionState,
  type AudioSessionEventListener,
} from "../../src/playback/session";

// Mock HTML Audio element for testing
class MockAudio {
  src = '';
  currentTime = 0;
  duration = 100;
  volume = 1.0;
  playbackRate = 1.0;
  paused = true;
  ended = false;
  readyState = 0; // HTMLMediaElement.HAVE_NOTHING
  error: MediaError | null = null;
  preload: '' | 'auto' | 'none' | 'metadata' = 'auto';
  crossOrigin: string | null = null;
  
  private eventListeners = new Map<string, Array<EventListener>>();
  
  addEventListener(type: string, listener: EventListener, options?: any) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type)!.push(listener);
  }
  
  removeEventListener(type: string, listener: EventListener) {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    }
  }
  
  load() {
    // Simulate loading
    setTimeout(() => {
      this.readyState = 4; // HTMLMediaElement.HAVE_ENOUGH_DATA
      this.dispatchEvent('canplay');
    }, 10);
  }
  
  async play(): Promise<void> {
    if (this.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
      throw new Error('Not ready to play');
    }
    this.paused = false;
    this.dispatchEvent('playing');
    return Promise.resolve();
  }
  
  pause() {
    this.paused = true;
  }
  
  dispatchEvent(event: Event | string, customEvent?: any): boolean {
    const type = typeof event === 'string' ? event : event.type;
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(customEvent || (typeof event === 'string' ? { type, target: this } : event));
        } catch (error) {
          console.error('Error in event listener:', error);
        }
      });
    }
    return true;
  }
  
  // Helper methods for testing
  simulateTimeUpdate(newTime: number) {
    this.currentTime = newTime;
    this.dispatchEvent('timeupdate');
  }
  
  simulateEnded() {
    this.ended = true;
    this.paused = true;
    this.dispatchEvent('ended');
  }
  
  simulateError(error: MediaError) {
    this.error = error;
    this.dispatchEvent('error');
  }
  
  simulateStalled() {
    this.dispatchEvent('stalled');
  }
  
  simulateWaiting() {
    this.dispatchEvent('waiting');
  }
}

// Mock HTMLMediaElement constants
(globalThis as any).HTMLMediaElement = {
  HAVE_NOTHING: 0,
  HAVE_METADATA: 1,
  HAVE_CURRENT_DATA: 2,
  HAVE_FUTURE_DATA: 3,
  HAVE_ENOUGH_DATA: 4,
};

// Mock global Audio constructor
const originalAudio = globalThis.Audio;
let mockAudioInstance: MockAudio | null = null;

beforeEach(() => {
  // @ts-ignore - Mock Audio constructor
  globalThis.Audio = class MockAudioConstructor {
    constructor() {
      mockAudioInstance = new MockAudio();
      return mockAudioInstance as any;
    }
  };
  
  // Mock URL methods
  globalThis.URL.createObjectURL = (blob: Blob) => `blob:mock-${Math.random()}`;
  globalThis.URL.revokeObjectURL = (url: string) => {};
});

afterEach(() => {
  globalThis.Audio = originalAudio;
  mockAudioInstance = null;
});

test("AudioSessionManager initializes in idle state", () => {
  const sessionManager = new AudioSessionManager();
  
  expect(sessionManager.state).toBe('idle');
  expect(sessionManager.audio).toBe(null);
  expect(sessionManager.disposed).toBe(false);
});

test("AudioSessionManager transitions to loading state on startWithPart", async () => {
  const stateChanges: Array<{ from: AudioSessionState; to: AudioSessionState }> = [];
  
  const listeners: AudioSessionEventListener = {
    onStateChange: (newState, previousState) => {
      stateChanges.push({ from: previousState, to: newState });
    }
  };
  
  const sessionManager = new AudioSessionManager({}, listeners);
  
  // Start should transition to loading immediately
  const startPromise = sessionManager.startWithPart('/mock/audio.mp3');
  
  expect(sessionManager.state).toBe('loading');
  expect(stateChanges).toHaveLength(1);
  expect(stateChanges[0]).toEqual({ from: 'idle', to: 'loading' });
  
  // Wait for mock audio to become ready
  await startPromise;
  
  expect(mockAudioInstance).not.toBe(null);
  expect(mockAudioInstance!.src).toBe('/mock/audio.mp3');
  expect(sessionManager.audio).toBe(mockAudioInstance as any as HTMLAudioElement);
});

test("AudioSessionManager handles play and transitions to playing state", async () => {
  const stateChanges: AudioSessionState[] = [];
  
  const listeners: AudioSessionEventListener = {
    onStateChange: (newState) => {
      stateChanges.push(newState);
    }
  };
  
  const sessionManager = new AudioSessionManager({}, listeners);
  
  await sessionManager.startWithPart('/mock/audio.mp3');
  await sessionManager.play();
  
  expect(sessionManager.state).toBe('playing');
  expect(stateChanges).toContain('playing');
  expect(mockAudioInstance!.paused).toBe(false);
});

test("AudioSessionManager handles audio events correctly", async () => {
  const events: string[] = [];
  let bufferingState = false;
  
  const listeners: AudioSessionEventListener = {
    onStateChange: (newState) => {
      events.push(`state:${newState}`);
    },
    onEnded: () => {
      events.push('ended');
    },
    onError: (error) => {
      events.push(`error:${error.message}`);
    },
    onBuffering: (isBuffering) => {
      bufferingState = isBuffering;
      events.push(`buffering:${isBuffering}`);
    }
  };
  
  const sessionManager = new AudioSessionManager({}, listeners);
  await sessionManager.startWithPart('/mock/audio.mp3');
  
  // Simulate various audio events
  mockAudioInstance!.simulateWaiting();
  expect(sessionManager.state).toBe('stalled');
  expect(bufferingState).toBe(true);
  expect(events).toContain('state:stalled');
  expect(events).toContain('buffering:true');
  
  // Simulate playing again
  mockAudioInstance!.dispatchEvent('playing');
  expect(sessionManager.state).toBe('playing');
  expect(bufferingState).toBe(false);
  expect(events).toContain('state:playing');
  expect(events).toContain('buffering:false');
  
  // Simulate ended
  mockAudioInstance!.simulateEnded();
  expect(sessionManager.state).toBe('ended');
  expect(events).toContain('state:ended');
  expect(events).toContain('ended');
  
  // Simulate error
  const mockError = { message: 'Test error' } as MediaError;
  mockAudioInstance!.simulateError(mockError);
  expect(sessionManager.state).toBe('error');
  expect(events).toContain('error:Test error');
});

test("AudioSessionManager respects configuration", async () => {
  const config = {
    playbackRate: 1.5,
    volume: 0.8,
    preload: 'metadata' as const,
    crossOrigin: 'anonymous' as const,
  };
  
  const sessionManager = new AudioSessionManager(config);
  await sessionManager.startWithPart('/mock/audio.mp3');
  
  expect(mockAudioInstance!.playbackRate).toBe(1.5);
  expect(mockAudioInstance!.volume).toBe(0.8);
  expect(mockAudioInstance!.preload).toBe('metadata');
  expect(mockAudioInstance!.crossOrigin).toBe('anonymous');
});

test("AudioSessionManager handles seeking and volume control", async () => {
  const sessionManager = new AudioSessionManager();
  await sessionManager.startWithPart('/mock/audio.mp3');
  
  // Test seeking
  sessionManager.seekTo(30);
  expect(mockAudioInstance!.currentTime).toBe(30);
  
  // Test seeking with negative value (should clamp to 0)
  sessionManager.seekTo(-10);
  expect(mockAudioInstance!.currentTime).toBe(0);
  
  // Test volume control
  sessionManager.setVolume(0.5);
  expect(mockAudioInstance!.volume).toBe(0.5);
  
  // Test volume clamping
  sessionManager.setVolume(1.5);
  expect(mockAudioInstance!.volume).toBe(1.0);
});

test("AudioSessionManager handles disposal correctly", async () => {
  const sessionManager = new AudioSessionManager();
  await sessionManager.startWithPart('/mock/audio.mp3');
  
  sessionManager.dispose();
  expect(sessionManager.disposed).toBe(true);
  expect(sessionManager.state).toBe('idle');
  expect(sessionManager.audio).toBe(null);
  
  // Should prevent further operations
  await expect(sessionManager.startWithPart('/mock/audio.mp3')).rejects.toThrow(
    'AudioSessionManager has been disposed'
  );
});

test("AudioSessionManager.releaseResources pauses audio, ends MediaSource and revokes object URL", () => {
  const originalRevoke = globalThis.URL.revokeObjectURL;
  let paused = false;
  let ended = false;
  let revoked: string | undefined;
  globalThis.URL.revokeObjectURL = (url: string) => { revoked = url; };
  try {
    const session = {
      abort: new AbortController(),
      audioEl: { pause: () => { paused = true; } } as any,
      mediaSource: { readyState: "open", endOfStream: () => { ended = true; } } as any,
      sourceBuffer: null,
      lastBlob: null,
      objectUrl: "blob:mock-url",
    };
    AudioSessionManager.releaseResources(session);

    expect(paused).toBe(true);
    expect(ended).toBe(true);
    expect(revoked).toBe("blob:mock-url");
  } finally {
    globalThis.URL.revokeObjectURL = originalRevoke;
  }
});

test("AudioSessionManager.releaseResources tolerates missing resources", () => {
  expect(() => AudioSessionManager.releaseResources(null)).not.toThrow();
  const session = { abort: new AbortController(), audioEl: null, mediaSource: null, sourceBuffer: null, lastBlob: null };
  expect(() => AudioSessionManager.releaseResources(session)).not.toThrow();
});

