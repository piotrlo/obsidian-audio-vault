import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";

export async function requestUrlWithAbort(
  request: RequestUrlParam,
  signal?: AbortSignal,
): Promise<RequestUrlResponse> {
  const params = { ...request, throw: false };
  if (!signal) return requestUrl(params);
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason));

  let rejectAbort: ((reason: Error) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort?.(
    signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)),
  );
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();

  try {
    return await Promise.race([requestUrl(params), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function isSuccessfulResponse(status: number): boolean {
  return status >= 200 && status < 300;
}

export function getResponseHeader(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((header) => header.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

export function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

export function byteStream(buffer: ArrayBuffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}
