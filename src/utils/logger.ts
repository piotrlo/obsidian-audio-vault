/**
 * Minimal toggleable logger for AudioVault.
 * Provides log and warn methods gated by a runtime-enabled flag.
 */

let enabled = false;

/**
 * Enable or disable debug logging at runtime.
 * @param {boolean} on Whether to enable logging.
 */
export function setDebugLogging(on: boolean): void { enabled = !!on; }

/**
 * Log a debug message if enabled.
 * @param {...any[]} args Values to log.
 */
export function log(...args: any[]): void { if (enabled) console.log("[AudioVault]", ...args); }

/**
 * Log a warning message if enabled.
 * @param {...any[]} args Values to warn.
 */
export function warn(...args: any[]): void { if (enabled) console.warn("[AudioVault]", ...args); }
