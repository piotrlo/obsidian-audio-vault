/**
 * Enhanced logger for AudioVault with multiple levels.
 * Provides debug/info/warn/error methods gated by runtime flags.
 * Designed for iOS lifecycle debugging and production silence.
 */

let debugEnabled = false;
let infoEnabled = false;

/**
 * Enable or disable debug logging at runtime.
 * @param on Whether to enable debug-level logging
 */
export function setDebugLogging(on: boolean): void { 
  debugEnabled = !!on; 
}

/**
 * Enable or disable info logging at runtime.
 * Info logs are shown in development but can be silenced in production.
 * @param on Whether to enable info-level logging
 */
export function setInfoLogging(on: boolean): void { 
  infoEnabled = !!on; 
}

/**
 * Log a debug message if debug logging is enabled.
 * Use for detailed debugging information.
 * @param args Values to log
 */
export function debug(...args: any[]): void { 
  if (debugEnabled) console.log("[AudioVault:DEBUG]", ...args); 
}

/**
 * Log an info message if info logging is enabled.
 * Use for important operational information.
 * @param args Values to log
 */
export function info(...args: any[]): void { 
  if (infoEnabled) console.info("[AudioVault:INFO]", ...args); 
}

/**
 * Log a warning message. Always shown unless completely disabled.
 * Use for recoverable errors or important notices.
 * @param args Values to warn
 */
export function warn(...args: any[]): void { 
  console.warn("[AudioVault:WARN]", ...args); 
}

/**
 * Log an error message. Always shown unless completely disabled.
 * Use for errors that affect functionality.
 * @param args Values to log as error
 */
export function error(...args: any[]): void { 
  console.error("[AudioVault:ERROR]", ...args); 
}

// Backward compatibility
/**
 * @deprecated Use debug() instead
 */
export function log(...args: any[]): void { debug(...args); }
