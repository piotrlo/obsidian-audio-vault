export function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw toError(signal.reason);
}
