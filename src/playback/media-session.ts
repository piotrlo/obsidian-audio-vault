const artwork = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<rect width="256" height="256" rx="40" fill="#5b32a7"/>
<path d="M64 152v-24a64 64 0 0 1 128 0v24" fill="none" stroke="white" stroke-width="16"/>
<rect x="56" y="128" width="38" height="56" rx="12" fill="white"/>
<rect x="162" y="128" width="38" height="56" rx="12" fill="white"/>
</svg>`;

function optional(operation: () => void): boolean {
  try {
    operation();
    return true;
  } catch {
    return false; // System controls must not interfere with local playback.
  }
}

export function attachMediaSession(
  audio: Pick<HTMLAudioElement, "paused" | "ended" | "play" | "pause" | "addEventListener" | "removeEventListener">,
  title: string,
  onResumeError: () => void,
  session: Pick<MediaSession, "metadata" | "playbackState" | "setActionHandler"> | null | undefined = globalThis.navigator?.mediaSession,
  createMetadata = (init: MediaMetadataInit) => new MediaMetadata(init),
): () => void {
  if (!session) return () => {};

  let active = true;
  const hasMetadata = optional(() => {
    session.metadata = createMetadata({
      title,
      artist: "AudioVault",
      artwork: [{ src: `data:image/svg+xml,${encodeURIComponent(artwork)}`, sizes: "256x256", type: "image/svg+xml" }],
    });
  });
  const hasPlay = optional(() => session.setActionHandler("play", () => {
    if (!active || audio.ended || !audio.paused) return;
    void audio.play().catch(() => { if (active) onResumeError(); });
  }));
  const hasPause = optional(() => session.setActionHandler("pause", () => {
    if (active && !audio.paused) audio.pause();
  }));

  const updateState = () => {
    optional(() => { session.playbackState = audio.paused ? "paused" : "playing"; });
  };
  audio.addEventListener("play", updateState);
  audio.addEventListener("pause", updateState);
  updateState();
  return () => {
    if (!active) return;
    active = false;
    audio.removeEventListener("play", updateState);
    audio.removeEventListener("pause", updateState);
    if (hasPlay) optional(() => session.setActionHandler("play", null));
    if (hasPause) optional(() => session.setActionHandler("pause", null));
    if (hasMetadata) optional(() => { session.metadata = null; });
    optional(() => { session.playbackState = "none"; });
  };
}
