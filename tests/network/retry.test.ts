/**
 * Tests for network retry logic with exponential backoff and jitter.
 */

import { test, expect, mock, beforeEach, afterEach } from "bun:test";

// First mock the platform module before any imports
const mockIsIOS = mock(() => false);
const mockIsAppInBackground = mock(() => false);

mock.module("../../src/core/platform", () => ({
  isIOS: mockIsIOS,
  isAppInBackground: mockIsAppInBackground,
  isDesktop: mock(() => true),
  isOnline: mock(() => true),
  userGestureUnlocked: mock(() => true),
  getConnectionType: mock(() => 'unknown'),
}));

// Now import after mocking
import { fetchWithRetry } from "../../src/network/retry";

// Mock fetch globally
const originalFetch = globalThis.fetch;
let mockFetch: any;

beforeEach(() => {
  mockFetch = mock();
  globalThis.fetch = mockFetch;
  mockIsIOS.mockReturnValue(false);
  mockIsAppInBackground.mockReturnValue(false);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  mockFetch.mockClear();
  mockIsIOS.mockClear();
  mockIsAppInBackground.mockClear();
});

test("fetchWithRetry succeeds on first attempt", async () => {
  const mockResponse = new Response("success", { status: 200 });
  mockFetch.mockResolvedValueOnce(mockResponse);

  const result = await fetchWithRetry("https://example.com", undefined, {
    attempts: 3,
  });

  expect(result.ok).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  if (result.ok) {
    expect(result.value).toBe(mockResponse);
  }
});

test("fetchWithRetry retries on 500 error and succeeds", async () => {
  // First attempt fails with 500, second succeeds
  mockFetch
    .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
    .mockResolvedValueOnce(new Response("success", { status: 200 }));

  const startTime = Date.now();
  const result = await fetchWithRetry("https://example.com", undefined, {
    attempts: 3,
    baseDelayMs: 100,
    jitter: false,
  });

  const elapsed = Date.now() - startTime;
  expect(result.ok).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(2);
  
  // Should have delayed at least 100ms between attempts
  expect(elapsed).toBeGreaterThanOrEqual(90);
});

test("fetchWithRetry respects Retry-After header", async () => {
  const retryAfterResponse = new Response("Too Many Requests", {
    status: 429,
    headers: { "retry-after": "2" }, // 2 seconds
  });
  
  mockFetch
    .mockResolvedValueOnce(retryAfterResponse)
    .mockResolvedValueOnce(new Response("success", { status: 200 }));

  const startTime = Date.now();
  const result = await fetchWithRetry("https://example.com", undefined, {
    attempts: 3,
  });

  const elapsed = Date.now() - startTime;
  expect(result.ok).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(2);
  
  // Should have waited approximately 2000ms
  expect(elapsed).toBeGreaterThanOrEqual(1900);
  expect(elapsed).toBeLessThanOrEqual(2500);
});

test("fetchWithRetry does not retry 404 errors", async () => {
  mockFetch.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

  const result = await fetchWithRetry("https://example.com", undefined, {
    attempts: 3,
  });

  expect(result.ok).toBe(false);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  
  if (!result.ok) {
    expect(result.error.kind).toBe("permanent");
    expect(result.error.reason).toContain("404");
  }
});

test("fetchWithRetry handles network errors with retry", async () => {
  // Network error, then success
  mockFetch
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(new Response("success", { status: 200 }));

  const result = await fetchWithRetry("https://example.com", undefined, {
    attempts: 3,
    baseDelayMs: 50,
    jitter: false,
  });

  expect(result.ok).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

test("fetchWithRetry gives up after max attempts", async () => {
  // Always fail with 500
  mockFetch.mockResolvedValue(new Response("Server Error", { status: 500 }));

  const result = await fetchWithRetry("https://example.com", undefined, {
    attempts: 2,
    baseDelayMs: 10,
    jitter: false,
  });

  expect(result.ok).toBe(false);
  expect(mockFetch).toHaveBeenCalledTimes(2);
  
  if (!result.ok) {
    expect(result.error.kind).toBe("transient");
    expect(result.error.reason).toContain("2 attempts");
  }
});

test("fetchWithRetry respects external abort signal", async () => {
  const controller = new AbortController();
  
  mockFetch.mockImplementation(() => {
    // Abort immediately when fetch is called
    controller.abort();
    return Promise.reject(new DOMException("The user aborted a request.", "AbortError"));
  });

  const result = await fetchWithRetry("https://example.com", undefined, {
    attempts: 3,
    abortSignal: controller.signal,
    timeoutMs: 100, // Short timeout
  });

  expect(result.ok).toBe(false);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  
  if (!result.ok) {
    expect(result.error.kind).toBe("permanent");
  }
});

test("fetchWithRetry handles timeout", async () => {
  // Mock fetch that returns a promise that respects abort signal
  mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise((resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      
      const onAbort = () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      
      signal?.addEventListener("abort", onAbort);
      
      // Never resolve this promise - it will be aborted by timeout
    });
  });

  const startTime = Date.now();
  const result = await fetchWithRetry("https://example.com", undefined, {
    attempts: 1, // Only one attempt to avoid long test
    timeoutMs: 50, // Short timeout
    baseDelayMs: 10,
  });

  const elapsed = Date.now() - startTime;
  
  expect(result.ok).toBe(false);
  // Should timeout quickly (around 50ms per attempt)
  expect(elapsed).toBeGreaterThanOrEqual(45);
  expect(elapsed).toBeLessThanOrEqual(100);
  
  if (!result.ok) {
    expect(result.error.kind).toBe("transient");
  }
});

// Removed iOS background-specific optimization; test not applicable anymore

test("exponential backoff calculation works correctly", async () => {
  mockFetch.mockResolvedValue(new Response("Server Error", { status: 500 }));

  const startTime = Date.now();
  const result = await fetchWithRetry("https://example.com", undefined, {
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

test("jitter adds randomization to delays", async () => {
  mockFetch.mockResolvedValue(new Response("Server Error", { status: 500 }));

  const durations: number[] = [];
  
  // Run multiple times to test jitter variability
  for (let i = 0; i < 10; i++) {
    mockFetch.mockClear();
    const startTime = Date.now();
    
    await fetchWithRetry("https://example.com", undefined, {
      attempts: 2,
      baseDelayMs: 200,
      jitter: true,
    });
    
    durations.push(Date.now() - startTime);
  }
  
  // With jitter, at least some durations should vary significantly
  // Calculate variance to check for jitter effect
  const mean = durations.reduce((sum, d) => sum + d, 0) / durations.length;
  const variance = durations.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / durations.length;
  
  // Variance should be > 0 with jitter (non-zero randomization)
  expect(variance).toBeGreaterThan(0);
  
  // Also check that not all durations are exactly the same
  const uniqueDurations = new Set(durations);
  expect(uniqueDurations.size).toBeGreaterThan(1);
});
