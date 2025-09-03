/**
 * Single Audio element manager with finite state machine for robust playback.
 * Provides reliable audio session management with comprehensive event handling.
 */

import type { PlaybackSession } from "../types";
import { debug, warn, error as logError } from "../utils/logger";

/**
 * Audio session states for finite state machine.
 */
export type AudioSessionState = 
  | 'idle'     // No audio loaded
  | 'loading'  // Audio is being loaded
  | 'playing'  // Audio is playing
  | 'stalled'  // Audio is stalled (buffering)
  | 'ended'    // Audio playback ended
  | 'error';   // Error occurred

/**
 * Audio session events that trigger state transitions.
 */
export type AudioSessionEvent = 
  | 'load'        // Start loading audio
  | 'canplay'     // Audio can start playing
  | 'playing'     // Audio started playing
  | 'waiting'     // Audio is waiting for data
  | 'stalled'     // Audio is stalled
  | 'ended'       // Audio playback ended
  | 'error'       // Audio error occurred
  | 'suspend'     // Audio loading suspended
  | 'timeupdate'  // Time position updated
  | 'dispose';    // Dispose session

/**
 * Event listener callback for session events.
 */
export interface AudioSessionEventListener {
  onStateChange?: (state: AudioSessionState, previousState: AudioSessionState) => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onError?: (error: Error) => void;
  onBuffering?: (isBuffering: boolean) => void;
  onEnded?: () => void;
}

/**
 * Configuration for creating an audio session.
 */
export interface AudioSessionConfig {
  /** Playback rate (0.25 to 4.0) */
  playbackRate?: number;
  /** Volume (0.0 to 1.0) */
  volume?: number;
  /** Whether to preload audio */
  preload?: 'auto' | 'metadata' | 'none';
  /** Cross-origin setting */
  crossOrigin?: 'anonymous' | 'use-credentials';
}

/**
 * Single Audio element manager with finite state machine.
 * Provides reliable session management with comprehensive event handling.
 */
export class AudioSessionManager {
  private audioElement: HTMLAudioElement | null = null;
  private currentState: AudioSessionState = 'idle';
  private listeners: AudioSessionEventListener = {};
  private isDisposed = false;
  private currentUrl: string | null = null;
  
  /**
   * Create a new audio session manager.
   * @param config Optional configuration for the session
   * @param eventListeners Optional event listeners
   */
  constructor(
    private config: AudioSessionConfig = {},
    eventListeners: AudioSessionEventListener = {}
  ) {
    this.listeners = { ...eventListeners };
    debug(`AudioSessionManager created with state: ${this.currentState}`);
  }
  
  /**
   * Get the current session state.
   */
  get state(): AudioSessionState {
    return this.currentState;
  }
  
  /**
   * Get the current audio element.
   */
  get audio(): HTMLAudioElement | null {
    return this.audioElement;
  }
  
  /**
   * Check if session is disposed.
   */
  get disposed(): boolean {
    return this.isDisposed;
  }
  
  /**
   * Start playback with a new audio part.
   * @param audioPath Path or URL to the audio file
   * @returns Promise that resolves when audio can start playing
   */
  async startWithPart(audioPath: string): Promise<void> {
    if (this.isDisposed) {
      throw new Error('AudioSessionManager has been disposed');
    }
    
    debug(`Starting playback with part: ${audioPath}`);
    
    // Clean up existing audio
    this.cleanup();
    
    // Create new audio element
    this.audioElement = new Audio();
    this.currentUrl = audioPath;
    
    // Configure audio element
    this.audioElement.playbackRate = this.config.playbackRate || 1.0;
    this.audioElement.volume = this.config.volume || 1.0;
    this.audioElement.preload = this.config.preload || 'auto';
    if (this.config.crossOrigin) {
      this.audioElement.crossOrigin = this.config.crossOrigin;
    }
    
    // Attach event listeners
    this.attachEventListeners();
    
    // Transition to loading state
    this.transitionState('loading');
    
    // Load the audio
    this.audioElement.src = audioPath;
    this.audioElement.load();
    
    // Wait for canplay event or timeout
    return this.awaitCanPlay(10000); // 10 second timeout
  }
  
  /**
   * Queue the next audio part for seamless playback.
   * @param audioPath Path or URL to the next audio file
   * @returns Promise that resolves when the part is queued
   */
  async queueNextPart(audioPath: string): Promise<void> {
    if (this.isDisposed) {
      throw new Error('AudioSessionManager has been disposed');
    }
    
    debug(`Queuing next part: ${audioPath}`);
    
    // For now, we'll implement a simple approach where we prepare
    // the next audio but don't switch until current ends
    // In a more advanced implementation, we could use multiple audio elements
    // or implement gapless playback with Web Audio API
    
    // Store the next part for when current audio ends
    this.audioElement?.addEventListener('ended', () => {
      this.startWithPart(audioPath).catch(error => {
        logError('Failed to start queued part:', error);
        this.handleError(error);
      });
    }, { once: true });
  }
  
  /**
   * Wait for the next part to be ready within a timeout.
   * @param timeoutMs Maximum time to wait in milliseconds
   * @returns Promise that resolves when next part is ready
   */
  async awaitNextReady(timeoutMs: number): Promise<boolean> {
    if (this.isDisposed || !this.audioElement) {
      return false;
    }
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, timeoutMs);
      
      const checkReady = () => {
        if (this.currentState === 'playing' || this.currentState === 'ended') {
          clearTimeout(timeout);
          resolve(true);
        }
      };
      
      // Check immediately
      checkReady();
      
      // Check on state changes
      const originalOnStateChange = this.listeners.onStateChange;
      this.listeners.onStateChange = (state, previousState) => {
        if (originalOnStateChange) {
          originalOnStateChange(state, previousState);
        }
        checkReady();
      };
    });
  }
  
  /**
   * Start playback of currently loaded audio.
   * @returns Promise that resolves when playback starts
   */
  async play(): Promise<void> {
    if (this.isDisposed || !this.audioElement) {
      throw new Error('No audio element available');
    }
    
    debug('Starting audio playback');
    
    try {
      await this.audioElement.play();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError('Audio play failed:', message);
      this.handleError(new Error(`Play failed: ${message}`));
      throw error;
    }
  }
  
  /**
   * Pause current playback.
   */
  pause(): void {
    if (this.audioElement) {
      debug('Pausing audio playback');
      this.audioElement.pause();
    }
  }
  
  /**
   * Stop current playback and reset.
   */
  stop(): void {
    if (this.audioElement) {
      debug('Stopping audio playback');
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
    }
    this.transitionState('idle');
  }
  
  /**
   * Dispose of the session and clean up all resources.
   */
  dispose(): void {
    if (this.isDisposed) return;
    
    debug('Disposing AudioSessionManager');
    this.isDisposed = true;
    
    this.cleanup();
    this.transitionState('idle');
    this.listeners = {};
  }
  
  /**
   * Set event listeners for the session.
   * @param eventListeners Event listeners to set
   */
  setEventListeners(eventListeners: AudioSessionEventListener): void {
    this.listeners = { ...eventListeners };
  }
  
  /**
   * Get current playback time and duration.
   * @returns Object with currentTime and duration
   */
  getTimeInfo(): { currentTime: number; duration: number } {
    if (!this.audioElement) {
      return { currentTime: 0, duration: 0 };
    }
    
    return {
      currentTime: this.audioElement.currentTime || 0,
      duration: this.audioElement.duration || 0,
    };
  }
  
  /**
   * Seek to a specific time position.
   * @param time Time in seconds to seek to
   */
  seekTo(time: number): void {
    if (this.audioElement && !this.isDisposed) {
      debug(`Seeking to time: ${time}s`);
      this.audioElement.currentTime = Math.max(0, time);
    }
  }
  
  /**
   * Set playback rate.
   * @param rate Playback rate (0.25 to 4.0)
   */
  setPlaybackRate(rate: number): void {
    if (this.audioElement && !this.isDisposed) {
      const clampedRate = Math.max(0.25, Math.min(4.0, rate));
      debug(`Setting playback rate: ${clampedRate}`);
      this.audioElement.playbackRate = clampedRate;
      this.config.playbackRate = clampedRate;
    }
  }
  
  /**
   * Set volume.
   * @param volume Volume level (0.0 to 1.0)
   */
  setVolume(volume: number): void {
    if (this.audioElement && !this.isDisposed) {
      const clampedVolume = Math.max(0.0, Math.min(1.0, volume));
      debug(`Setting volume: ${clampedVolume}`);
      this.audioElement.volume = clampedVolume;
      this.config.volume = clampedVolume;
    }
  }
  
  // Private methods
  
  private transitionState(newState: AudioSessionState): void {
    if (this.currentState === newState) return;
    
    const previousState = this.currentState;
    this.currentState = newState;
    
    debug(`State transition: ${previousState} -> ${newState}`);
    
    if (this.listeners.onStateChange) {
      try {
        this.listeners.onStateChange(newState, previousState);
      } catch (error) {
        warn('Error in state change listener:', error);
      }
    }
  }
  
  private attachEventListeners(): void {
    if (!this.audioElement) return;
    
    const audio = this.audioElement;
    
    audio.addEventListener('canplay', () => {
      debug('Audio canplay event');
      if (this.currentState === 'loading') {
        // Don't auto-transition to playing - wait for explicit play() call
      }
    });
    
    audio.addEventListener('playing', () => {
      debug('Audio playing event');
      this.transitionState('playing');
      if (this.listeners.onBuffering) {
        this.listeners.onBuffering(false);
      }
    });
    
    audio.addEventListener('waiting', () => {
      debug('Audio waiting event');
      this.transitionState('stalled');
      if (this.listeners.onBuffering) {
        this.listeners.onBuffering(true);
      }
    });
    
    audio.addEventListener('stalled', () => {
      debug('Audio stalled event');
      this.transitionState('stalled');
      if (this.listeners.onBuffering) {
        this.listeners.onBuffering(true);
      }
    });
    
    audio.addEventListener('ended', () => {
      debug('Audio ended event');
      this.transitionState('ended');
      if (this.listeners.onEnded) {
        try {
          this.listeners.onEnded();
        } catch (error) {
          warn('Error in ended listener:', error);
        }
      }
    });
    
    audio.addEventListener('error', (event) => {
      const mediaError = audio.error || { code: 0, message: 'Unknown audio error' } as MediaError;
      const error = new Error(mediaError.message || `Media error (code: ${mediaError.code})`);
      logError('Audio error event:', mediaError);
      this.handleError(error);
    });
    
    audio.addEventListener('suspend', () => {
      debug('Audio suspend event');
    });
    
    audio.addEventListener('timeupdate', () => {
      if (this.listeners.onTimeUpdate) {
        try {
          const { currentTime, duration } = this.getTimeInfo();
          this.listeners.onTimeUpdate(currentTime, duration);
        } catch (error) {
          warn('Error in time update listener:', error);
        }
      }
    });
  }
  
  private handleError(error: Error): void {
    this.transitionState('error');
    
    if (this.listeners.onError) {
      try {
        this.listeners.onError(error);
      } catch (listenerError) {
        warn('Error in error listener:', listenerError);
      }
    }
  }
  
  private async awaitCanPlay(timeoutMs: number): Promise<void> {
    if (!this.audioElement) {
      throw new Error('No audio element available');
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Audio load timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      
      const onCanPlay = () => {
        clearTimeout(timeout);
        resolve();
      };
      
      const onError = () => {
        clearTimeout(timeout);
        const error = this.audioElement?.error || new Error('Audio load failed');
        reject(error);
      };
      
      if (this.audioElement && this.audioElement.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
        // Already ready
        clearTimeout(timeout);
        resolve();
        return;
      }
      
      this.audioElement?.addEventListener('canplay', onCanPlay, { once: true });
      this.audioElement?.addEventListener('canplaythrough', onCanPlay, { once: true });
      this.audioElement?.addEventListener('error', onError, { once: true });
    });
  }
  
  private cleanup(): void {
    if (this.audioElement) {
      debug('Cleaning up audio element');
      
      // Pause and reset
      try {
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
      } catch {}
      
      // Remove all event listeners by replacing the element
      this.audioElement.src = '';
      this.audioElement.load();
      
      this.audioElement = null;
    }
    
    // Clean up object URL if we have one
    if (this.currentUrl && this.currentUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(this.currentUrl);
      } catch {}
    }
    this.currentUrl = null;
  }
}

/**
 * Legacy helper function for backward compatibility.
 * @deprecated Use AudioSessionManager instead
 */
export async function cleanupSessionResources(session: PlaybackSession | null, setNull: boolean = false): Promise<PlaybackSession | null> {
  if (!session) return null;
  try { session.audioEl?.pause(); } catch {}
  try {
    if (session.mediaSource && session.mediaSource.readyState === "open") {
      session.mediaSource.endOfStream();
    }
  } catch {}
  try {
    if (session.objectUrl) {
      URL.revokeObjectURL(session.objectUrl);
    }
  } catch {}
  return setNull ? null : session;
}

