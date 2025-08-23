/**
 * Playback session helpers extracted for reuse across playback modes.
 */

import type { PlaybackSession } from "../types";

/**
 * Clean up current session resources: pause, end MSE, revoke object URLs.
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


