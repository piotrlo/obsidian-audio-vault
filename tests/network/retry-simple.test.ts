/**
 * Simplified tests for network retry logic.
 * Tests core retry functionality without platform dependencies.
 */

import { test, expect, mock, beforeEach, afterEach } from "bun:test";

// Create a simplified version of fetchWithRetry for testing
interface SimpleRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  jitter?: boolean;
  abortSignal?: AbortSignal;
}

async function testFetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: SimpleRetryOptions = {}
): Promise<{ ok: boolean; value?: Response; error?: any }> {
  const { attempts = 5, baseDelayMs = 300, maxDelayMs = 10000, timeoutMs = 30000, jitter = true, abortSignal } = options;
  
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    if (abortSignal?.aborted) {
      controller.abort();
    }
    
    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return { ok: true, value: response };
      }
      
      // Check if we should retry server errors
      if (response.status >= 500 || response.status === 429) {
        if (attempt < attempts) {
          const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
          await new Promise(resolve => setTimeout(resolve, jitter ? delay * (0.5 + Math.random()) : delay));
          continue;
        } else {
          // Exhausted attempts on retryable error - this is transient
          return { 
            ok: false, 
            error: { kind: 'transient', reason: `Failed after ${attempts} attempts with HTTP ${response.status}` }
          };
        }
      }
      
      // Client error - don't retry
      return { 
        ok: false, 
        error: { kind: 'permanent', reason: `HTTP ${response.status}`, status: response.status }
      };
      
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      
      // Retry on network errors
      if (error instanceof TypeError || (error instanceof Error && error.name === 'AbortError')) {
        if (attempt < attempts) {
          const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
          await new Promise(resolve => setTimeout(resolve, jitter ? delay * (0.5 + Math.random()) : delay));
          continue;
        }
      }
      
      break;
    }
  }
  
  return { 
    ok: false, 
    error: { kind: 'transient', reason: `Failed after ${attempts} attempts` }
  };
}

// Mock fetch globally
const originalFetch = globalThis.fetch;
let mockFetch: any;

beforeEach(() => {
  mockFetch = mock();
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  mockFetch.mockClear();
});

test("retry succeeds on first attempt", async () => {
  const mockResponse = new Response("success", { status: 200 });
  mockFetch.mockResolvedValueOnce(mockResponse);

  const result = await testFetchWithRetry("https://example.com", undefined, {
    attempts: 3,
  });

  expect(result.ok).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(result.value).toBe(mockResponse);
});

test("retry retries on 500 error and succeeds", async () => {
  mockFetch
    .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
    .mockResolvedValueOnce(new Response("success", { status: 200 }));

  const startTime = Date.now();
  const result = await testFetchWithRetry("https://example.com", undefined, {
    attempts: 3,
    baseDelayMs: 100,
    jitter: false,
  });

  const elapsed = Date.now() - startTime;
  expect(result.ok).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(elapsed).toBeGreaterThanOrEqual(90);
});

test("retry does not retry 404 errors", async () => {
  mockFetch.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

  const result = await testFetchWithRetry("https://example.com", undefined, {
    attempts: 3,
  });

  expect(result.ok).toBe(false);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(result.error?.kind).toBe("permanent");
  expect(result.error?.reason).toContain("404");
});

test("retry handles network errors with retry", async () => {
  mockFetch
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(new Response("success", { status: 200 }));

  const result = await testFetchWithRetry("https://example.com", undefined, {
    attempts: 3,
    baseDelayMs: 50,
    jitter: false,
  });

  expect(result.ok).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

test("retry gives up after max attempts", async () => {
  mockFetch.mockResolvedValue(new Response("Server Error", { status: 500 }));

  const result = await testFetchWithRetry("https://example.com", undefined, {
    attempts: 2,
    baseDelayMs: 10,
    jitter: false,
  });

  expect(result.ok).toBe(false);
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(result.error?.kind).toBe("transient");
});

test("exponential backoff calculation works", async () => {
  mockFetch.mockResolvedValue(new Response("Server Error", { status: 500 }));

  const startTime = Date.now();
  const result = await testFetchWithRetry("https://example.com", undefined, {
    attempts: 4,
    baseDelayMs: 100,
    jitter: false,
  });

  const elapsed = Date.now() - startTime;
  expect(result.ok).toBe(false);
  expect(mockFetch).toHaveBeenCalledTimes(4);
  
  // Expected delays: 100ms, 200ms, 400ms = 700ms total minimum
  expect(elapsed).toBeGreaterThanOrEqual(650);
});
