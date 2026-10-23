/**
 * A spec driven mock server.
 *
 * It answers requests from the OpenAPI document: routes are matched against
 * the path templates, the response is selected from the documented status
 * codes and the body is produced from the documented schema.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import type { ApiSpec, Operation } from '../spec/model.ts';
import { generatePayload } from './generator.ts';

export interface RouteMatch {
  operation: Operation;
  pathParams: Record<string, string>;
}

export interface MockServerOptions {
  host?: string;
  port?: number;
  /** Simulated latency for every response, in milliseconds. */
  latency?: number;
  /** Extra delay applied to error responses, in milliseconds. */
  errorLatency?: number;
}

export interface MockServerHandle {
  server: http.Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

interface CompiledRoute {
  operation: Operation;
  regex: RegExp;
  paramNames: string[];
}

/** Translate a path template into a regular expression. */
export function compilePath(template: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const pattern = template
    .split('/')
    .map((segment) => {
      const match = /^\{(.+)\}$/.exec(segment);
      if (!match) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      paramNames.push(match[1] as string);
      return '([^/]+)';
    })
    .join('/');

  return { regex: new RegExp(`^${pattern}/?$`), paramNames };
}

/** Find the operation that answers a request. */
export function matchRoute(routes: CompiledRoute[], method: string, pathname: string): RouteMatch | undefined {
  const upper = method.toUpperCase();
  let pathMatched = false;

  for (const route of routes) {
    const match = route.regex.exec(pathname);
    if (!match) continue;
    pathMatched = true;
    if (route.operation.method.toUpperCase() !== upper) continue;

    const pathParams: Record<string, string> = {};
    route.paramNames.forEach((name, index) => {
      pathParams[name] = decodeURIComponent(match[index + 1] ?? '');
    });
    return { operation: route.operation, pathParams };
  }

  if (pathMatched) {
    // The path exists but not with this method.
    for (const route of routes) {
      if (!route.regex.test(pathname)) continue;
      return {
        operation: {
          ...route.operation,
          method: route.operation.method,
          raw: { ...route.operation.raw, 'x-method-not-allowed': true },
        },
        pathParams: {},
      };
    }
  }

  return undefined;
}

/** Start the mock server. */
export async function startMockServer(spec: ApiSpec, options: MockServerOptions = {}): Promise<MockServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;

  const routes: CompiledRoute[] = [];
  for (const pathItem of spec.paths) {
    const compiled = compilePath(pathItem.path);
    for (const operation of pathItem.operations) {
      routes.push({ operation, regex: compiled.regex, paramNames: compiled.paramNames });
    }
  }

  const server = http.createServer((request, response) => {
    void handleRequest(spec, routes, request, response, options);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address() as AddressInfo;
  const actualPort = address.port;

  return {
    server,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handleRequest(
  spec: ApiSpec,
  routes: CompiledRoute[],
  request: http.IncomingMessage,
  response: http.ServerResponse,
  options: MockServerOptions,
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  // Introspection endpoint: shows which routes the mock understands.
  if (pathname === '/_apicovenant/routes') {
    const body = JSON.stringify(
      {
        routes: routes.map((route) => ({
          method: route.operation.method.toUpperCase(),
          path: route.operation.path,
          operationId: route.operation.operationId,
          statusCodes: [...route.operation.responses.keys()],
        })),
      },
      null,
      2,
    );
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(`${body}\n`);
    return;
  }

  const match = matchRoute(routes, request.method ?? 'GET', pathname);

  if (!match) {
    const body = JSON.stringify(
      {
        error: 'not_found',
        message: `No operation matches ${request.method} ${pathname}`,
        hint: 'Call GET /_apicovenant/routes to list the available routes.',
      },
      null,
      2,
    );
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(`${body}\n`);
    return;
  }

  if (match.operation.raw['x-method-not-allowed'] === true) {
    response.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET' });
    response.end(`${JSON.stringify({ error: 'method_not_allowed', message: `${request.method} is not allowed on ${pathname}` }, null, 2)}\n`);
    return;
  }

  const requestedStatus = Number(url.searchParams.get('x-mock-status') ?? '') || undefined;
  const payload = generatePayload(spec, match.operation, { status: requestedStatus });

  const latency = payload.status >= 400 ? (options.errorLatency ?? options.latency ?? 0) : (options.latency ?? 0);
  if (latency > 0) {
    await new Promise((resolve) => setTimeout(resolve, latency));
  }

  response.writeHead(payload.status, payload.headers);
  response.end(payload.body);
}
