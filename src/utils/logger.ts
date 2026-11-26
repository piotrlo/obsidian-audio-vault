let debugEnabled = false;
let infoEnabled = false;

export function setDebugLogging(enabled: boolean): void {
  debugEnabled = enabled;
}

export function setInfoLogging(enabled: boolean): void {
  infoEnabled = enabled;
}

export function debug(...args: unknown[]): void {
  if (debugEnabled) console.log("[AudioVault:DEBUG]", ...args);
}

export function info(...args: unknown[]): void {
  if (infoEnabled) console.info("[AudioVault:INFO]", ...args);
}

export function warn(...args: unknown[]): void {
  console.warn("[AudioVault:WARN]", ...args);
}

export function error(...args: unknown[]): void {
  console.error("[AudioVault:ERROR]", ...args);
}

export function log(...args: unknown[]): void {
  debug(...args);
}
