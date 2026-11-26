export function setDebugLogging(enabled: boolean): void {
  void enabled;
}

export function setInfoLogging(enabled: boolean): void {
  void enabled;
}

export function debug(...args: unknown[]): void {
  void args;
}

export function info(...args: unknown[]): void {
  void args;
}

export function warn(...args: unknown[]): void {
  void args;
}

export function error(...args: unknown[]): void {
  void args;
}

export function log(...args: unknown[]): void {
  debug(...args);
}
