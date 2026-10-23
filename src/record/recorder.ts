/**
 * Traffic recorder.
 *
 * `apicovenant record` puts a recording proxy in front of a running API. Point
 * your client at the proxy, exercise the endpoints you care about, and the
 * exchange is captured as a golden file that can be replayed later.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createGoldenFile, type GoldenFile, type GoldenInteraction } from './golden.ts';

export interface RecorderOptions {
  /** Base URL of the API to record against. */
  target: string;
  /** Path of the OpenAPI document, stored in the golden file. */
  spec?: string;
  host?: string;
  port?: number;
  /** Stop after this many interactions. */
  maxRequests?: number;
  /** Stop after this many milliseconds. */
  durationMs?: number;
  /** Called for every recorded interaction. */
  onInteraction?: (interaction: GoldenInteraction) => void;
  /** Called when the recording limit is reached. */
  onComplete?: () => void;
  /** Request headers that must never be written to disk. */
  redactHeaders?: string[];
}

export interface RecorderHandle {
  /** URL the proxy listens on. */
  url: string;
  port: number;
  /** Number of interactions captured so far. */
  count(): number;
  /** Stop recording and return the golden file. */
  stop(): GoldenFile;
}

const DEFAULT_REDACT = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization'];

/** Start the recording proxy. */
export async function startRecorder(options: RecorderOptions): Promise<RecorderHandle> {
  const target = options.target.replace(/\/+$/, '');
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  const redact = new Set((options.redactHeaders ?? DEFAULT_REDACT).map((name) => name.toLowerCase()));

  const file = createGoldenFile(target, options.spec);
  let captured = 0;

  const redactHeaders = (headers: Record<string, string | string[] | undefined>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      const text = Array.isArray(value) ? value.join(', ') : String(value);
      out[name.toLowerCase()] = redact.has(name.toLowerCase()) ? '<redacted>' : text;
    }
    return out;
  };

  const server = http.createServer((request, response) => {
    void (async () => {
      const started = Date.now();
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const requestBody = Buffer.concat(chunks).toString('utf8');

      const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      const targetUrl = `${target}${request.url ?? '/'}`;

      let upstream: Response;
      try {
        upstream = await fetch(targetUrl, {
          method: request.method ?? 'GET',
          headers: request.headers as Record<string, string>,
          body: ['GET', 'HEAD'].includes((request.method ?? 'GET').toUpperCase()) ? undefined : requestBody,
          redirect: 'manual',
        });
      } catch (error) {
        response.writeHead(502, { 'Content-Type': 'application/json' });
        response.end(
          `${JSON.stringify({ error: 'bad_gateway', message: `could not reach ${target}: ${(error as Error).message}` }, null, 2)}\n`,
        );
        return;
      }

      const responseBody = await upstream.text();
      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((value, name) => {
        responseHeaders[name.toLowerCase()] = value;
      });

      const contentType = responseHeaders['content-type'] ?? '';
      const bodyType: GoldenInteraction['bodyType'] =
        responseBody.trim() === '' ? 'empty' : contentType.includes('json') ? 'json' : 'text';

      const interaction: GoldenInteraction = {
        method: (request.method ?? 'GET').toUpperCase(),
        path: requestUrl.pathname,
        query: Object.fromEntries(requestUrl.searchParams.entries()),
        requestHeaders: redactHeaders(request.headers),
        status: upstream.status,
        responseHeaders: redactHeaders(responseHeaders),
        body: responseBody,
        bodyType,
        durationMs: Date.now() - started,
      };

      file.interactions.push(interaction);
      captured += 1;
      options.onInteraction?.(interaction);

      const outHeaders: Record<string, string | string[]> = {};
      upstream.headers.forEach((value, name) => {
        if (name.toLowerCase() === 'content-encoding') return;
        outHeaders[name] = value;
      });

      response.writeHead(upstream.status, outHeaders);
      response.end(responseBody);

      if (options.maxRequests && captured >= options.maxRequests) {
        server.close();
        options.onComplete?.();
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address() as AddressInfo;

  let timer: NodeJS.Timeout | undefined;
  if (options.durationMs) {
    timer = setTimeout(() => {
      server.close();
      options.onComplete?.();
    }, options.durationMs);
  }

  return {
    url: `http://${host}:${address.port}`,
    port: address.port,
    count: () => captured,
    stop: () => {
      if (timer) clearTimeout(timer);
      server.close();
      return file;
    },
  };
}
