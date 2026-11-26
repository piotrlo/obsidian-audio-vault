/**
 * Robust HTTP client with exponential backoff retry logic.
 * Designed for iOS reliability where network conditions can be unstable.
 */

import type { Result, AudioVaultError } from "../types";
import { requestUrlWithAbort } from "./request";
import type { RequestUrlParam } from "obsidian";

async function toRequestUrlParam(input: RequestInfo | URL, init?: RequestInit): Promise<RequestUrlParam> {
  const request = input instanceof Request ? input : undefined;
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const headers = new Headers(request?.headers);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  let body: BodyInit | null | undefined = init?.body;
  if (body === undefined && request?.body) body = request.clone().body;

  let requestBody: string | ArrayBuffer | undefined;
  if (typeof body === "string") {
    requestBody = body;
    if (!headers.has("content-type")) headers.set("content-type", "text/plain;charset=UTF-8");
  } else if (body instanceof URLSearchParams) {
    requestBody = body.toString();
    if (!headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
  } else if (body !== null && body !== undefined) {
    requestBody = await new Response(body).arrayBuffer();
  }

  const requestHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    requestHeaders[key] = value;
  });
  return {
    url,
    method: init?.method ?? request?.method,
    headers: requestHeaders,
    body: requestBody,
  };
}

function toResponse(response: Awaited<ReturnType<typeof requestUrlWithAbort>>): Response {
  const bodylessStatus = response.status === 204 || response.status === 205 || response.status === 304;
  return new Response(bodylessStatus ? null : response.arrayBuffer, {
    status: response.status,
    headers: response.headers,
  });
}

/**
 * Options for fetchWithRetry function.
 */
export interface RetryOptions {
  /** Maximum number of attempts (including initial) */
  attempts?: number;
  /** Base delay between retries in milliseconds */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds */
  maxDelayMs?: number;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Whether to add jitter to delay calculation */
  jitter?: boolean;
  /** Custom abort signal that takes precedence over internal timeout */
  abortSignal?: AbortSignal;
}

/**
 * Default retry options optimized for mobile networks.
 */
export const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'abortSignal'>> = {
  attempts: 5,
  baseDelayMs: 300,
  maxDelayMs: 10000,
  timeoutMs: 30000,
  jitter: true,
};

/**
 * Determines if an error should be retried based on its characteristics.
 * @param error The error that occurred
 * @param attempt Current attempt number (1-based)
 * @param abortSignal The abort signal passed to fetch
 * @returns Whether the error is transient and should be retried
 */
function isTransientError(error: unknown, attempt: number, abortSignal?: AbortSignal): boolean {
  // If we were aborted by the caller, don't retry
  if (abortSignal?.aborted) {
    return false;
  }
  
  // Network errors are typically transient
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }
  
  // AbortError could be from our timeout, which is transient
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }
  
  // If we have a response, check status code
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
    const status = error.status;
    
    // 5xx server errors are transient
    if (status >= 500 && status < 600) {
      return true;
    }
    
    // 429 Too Many Requests is transient
    if (status === 429) {
      return true;
    }
    
    // 4xx client errors are generally permanent
    if (status >= 400 && status < 500) {
      return false;
    }
  }
  
  // Platform-specific background handling removed for simplicity
  
  // Unknown errors might be transient on first few attempts
  return attempt <= 2;
}

/**
 * Calculates delay for next retry attempt.
 * @param attempt Current attempt number (1-based)
 * @param baseDelayMs Base delay in milliseconds
 * @param maxDelayMs Maximum delay cap
 * @param useJitter Whether to add randomization
 * @returns Delay in milliseconds
 */
function calculateDelay(
  attempt: number, 
  baseDelayMs: number, 
  maxDelayMs: number, 
  useJitter: boolean
): number {
  // Exponential backoff: baseDelay * 2^(attempt-1)
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
  
  // Cap at maximum
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  
  if (!useJitter) {
    return cappedDelay;
  }
  
  // Full jitter: random value between 50% and 150% of calculated delay
  const minJitter = 0.5;
  const maxJitter = 1.5;
  const jitter = minJitter + Math.random() * (maxJitter - minJitter);
  
  return Math.floor(cappedDelay * jitter);
}

/**
 * Extracts retry delay hint from HTTP response headers.
 * @param response HTTP response
 * @returns Delay in milliseconds, or undefined if no hint
 */
function getRetryAfterDelay(response: Response): number | undefined {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) {
    return undefined;
  }
  
  // Retry-After can be in seconds (number) or HTTP date
  const seconds = parseInt(retryAfter, 10);
  if (Number.isFinite(seconds)) {
    return seconds * 1000; // Convert to milliseconds
  }
  
  // Try parsing as date
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }
  
  return undefined;
}

/**
 * Creates a timeout-aware AbortController.
 * @param timeoutMs Timeout in milliseconds
 * @param parentSignal Optional parent signal to inherit from
 * @returns Object with controller and cleanup function
 */
function createTimeoutController(timeoutMs: number, parentSignal?: AbortSignal): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  
  // If parent is already aborted, abort immediately
  if (parentSignal?.aborted) {
    controller.abort();
    return { controller, cleanup: () => {} };
  }
  
  // Set up timeout
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  
  // Set up parent signal forwarding
  const onParentAbort = () => {
    controller.abort();
  };
  
  if (parentSignal) {
    parentSignal.addEventListener('abort', onParentAbort);
  }
  
  const cleanup = () => {
    window.clearTimeout(timeoutId);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  };
  
  return { controller, cleanup };
}

/**
 * Perform HTTP request with automatic retry and exponential backoff.
 * Handles network failures, timeouts, and server errors gracefully.
 * 
 * @param input Request URL or Request object
 * @param init Optional request configuration
 * @param options Retry behavior configuration
 * @returns Result with Response or detailed error
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: RetryOptions = {}
): Promise<Result<Response, AudioVaultError>> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const { attempts, baseDelayMs, maxDelayMs, timeoutMs, jitter, abortSignal } = opts;
  
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Create timeout controller for this attempt
    const { controller, cleanup } = createTimeoutController(timeoutMs, abortSignal);
    
    try {
      // Make the request
      const request = await toRequestUrlParam(input, init);
      const result = await requestUrlWithAbort(request, controller.signal);
      const response = toResponse(result);
      
      cleanup();
      
      // Success - return the response
      if (response.ok) {
        return { ok: true, value: response };
      }
      
      // Server error - check if we should retry
      const errorWithStatus = { 
        status: response.status, 
        statusText: response.statusText,
        response 
      };
      
      if (!isTransientError(errorWithStatus, attempt, abortSignal)) {
        return {
          ok: false,
          error: {
            kind: 'permanent',
            reason: `HTTP ${response.status}: ${response.statusText}`,
            status: response.status,
          }
        };
      }
      
      lastError = errorWithStatus;
      
      // If this is the last attempt, don't delay
      if (attempt === attempts) {
        break;
      }
      
      // Check for Retry-After header
      const retryAfterDelay = getRetryAfterDelay(response);
      const delay = retryAfterDelay ?? calculateDelay(attempt, baseDelayMs, maxDelayMs, jitter);
      
      await new Promise(resolve => window.setTimeout(resolve, delay));
      
    } catch (error) {
      cleanup();
      
      // Check if error is transient
      if (!isTransientError(error, attempt, abortSignal)) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: {
            kind: 'permanent',
            reason: `Network request failed: ${message}`,
            cause: error instanceof Error ? error : undefined,
          }
        };
      }
      
      lastError = error;
      
      // If this is the last attempt, don't delay
      if (attempt === attempts) {
        break;
      }
      
      const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs, jitter);
      await new Promise(resolve => window.setTimeout(resolve, delay));
    }
  }
  
  // All attempts failed
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  const isTimeout = lastError instanceof Error && lastError.name === 'AbortError';
  
  return {
    ok: false,
    error: {
      kind: 'transient',
      reason: isTimeout 
        ? `Request timed out after ${attempts} attempts (${timeoutMs}ms each)`
        : `Request failed after ${attempts} attempts: ${message}`,
      cause: lastError instanceof Error ? lastError : undefined,
    }
  };
}
