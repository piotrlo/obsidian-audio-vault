/**
 * Mock Obsidian module for testing
 */
export const Platform = {
  isIosApp: false,
  isMobileApp: false,
  isDesktopApp: true,
};

export class TFile {
  basename = '';
  path = '';
}

export class App {}

export class Notice {
  constructor(readonly message: string) {}
}

export async function requestUrl(request: string | {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
}): Promise<{
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  json: unknown;
  text: string;
}> {
  const params = typeof request === "string" ? { url: request } : request;
  const response = await globalThis.fetch(params.url, {
    method: params.method,
    headers: params.headers,
    body: params.body,
  });
  const arrayBuffer = await response.clone().arrayBuffer();
  const text = new TextDecoder().decode(arrayBuffer);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return { status: response.status, headers, arrayBuffer, json, text };
}
