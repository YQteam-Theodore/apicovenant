import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSpecFile } from '../src/spec/loader.ts';
import { startMockServer } from '../src/mock/server.ts';
import { startRecorder } from '../src/record/recorder.ts';
import { compareGolden, HttpLiveSource } from '../src/diff/compare.ts';
import { serializeGoldenFile, parseGoldenFile } from '../src/record/golden.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const shopSpecPath = path.resolve(here, '..', 'examples', 'shop.openapi.yaml');

async function withMock<T>(fn: (url: string) => Promise<T>): Promise<T> {
  const spec = await loadSpecFile(shopSpecPath);
  const handle = await startMockServer(spec);
  try {
    return await fn(handle.url);
  } finally {
    await handle.close();
  }
}

test('the mock server answers documented routes', async () => {
  await withMock(async (url) => {
    const response = await fetch(`${url}/users`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);

    const body = (await response.json()) as { items: unknown[]; total: number };
    assert.ok(Array.isArray(body.items));
    assert.equal(typeof body.total, 'number');
  });
});

test('the mock server substitutes path parameters', async () => {
  await withMock(async (url) => {
    const response = await fetch(`${url}/users/usr_1001`);
    assert.equal(response.status, 200);
  });
});

test('the mock server returns 404 for unknown routes', async () => {
  await withMock(async (url) => {
    const response = await fetch(`${url}/nope`);
    assert.equal(response.status, 404);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, 'not_found');
  });
});

test('the mock server exposes a route table', async () => {
  await withMock(async (url) => {
    const response = await fetch(`${url}/_apicovenant/routes`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { routes: Array<{ method: string; path: string }> };
    assert.ok(body.routes.length > 0);
    assert.ok(body.routes.some((route) => route.path === '/users'));
  });
});

test('the mock server honours the x-mock-status query parameter', async () => {
  await withMock(async (url) => {
    const response = await fetch(`${url}/users?x-mock-status=404`);
    assert.equal(response.status, 404);
  });
});

test('recording captures traffic and the diff finds no drift', async () => {
  const spec = await loadSpecFile(shopSpecPath);
  const mock = await startMockServer(spec);
  const recorder = await startRecorder({ target: mock.url, maxRequests: 2 });

  await fetch(`${recorder.url}/users`);
  await fetch(`${recorder.url}/users/usr_1001`);

  const golden = recorder.stop();
  await mock.close();

  assert.equal(golden.interactions.length, 2);
  assert.equal(golden.interactions[0]?.method, 'GET');
  assert.equal(golden.interactions[0]?.path, '/users');
  assert.equal(golden.interactions[0]?.status, 200);

  // Replay against a fresh mock of the same spec: nothing should have drifted.
  const second = await startMockServer(spec);
  const report = await compareGolden(golden, new HttpLiveSource(second.url), { spec });
  await second.close();

  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.changed, 0, JSON.stringify(report.interactions, null, 2));
  assert.equal(report.summary.unchanged, 2);
});

test('the diff detects a drifted response', async () => {
  const golden = parseGoldenFile(
    serializeGoldenFile({
      apicovenant: 1,
      recordedAt: new Date().toISOString(),
      target: 'http://legacy.example.com',
      interactions: [
        {
          method: 'GET',
          path: '/items',
          query: {},
          requestHeaders: {},
          status: 200,
          responseHeaders: { 'content-type': 'application/json' },
          body: JSON.stringify({ items: [{ id: 'a', price: 10 }], total: 1 }),
          bodyType: 'json',
          durationMs: 5,
        },
      ],
    }),
  );

  const drifted = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ items: [{ id: 'a', price: 12 }], total: 2 }));
  });

  await new Promise<void>((resolve) => drifted.listen(0, '127.0.0.1', resolve));
  const address = drifted.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const report = await compareGolden(golden, new HttpLiveSource(`http://127.0.0.1:${port}`));

  await new Promise<void>((resolve) => drifted.close(() => resolve()));

  assert.equal(report.summary.changed, 1);
  const interaction = report.interactions[0];
  assert.ok(interaction);
  const paths = interaction.body.differences.map((difference) => difference.path);
  assert.ok(paths.includes('/items/0/price'), JSON.stringify(paths));
  assert.ok(paths.includes('/total'), JSON.stringify(paths));
});

test('the recorder redacts credentials', async () => {
  const upstream = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=abc' });
    response.end('{"ok":true}');
  });

  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const recorder = await startRecorder({ target: `http://127.0.0.1:${port}` });
  await fetch(`${recorder.url}/secure`, { headers: { Authorization: 'Bearer super-secret' } });
  const golden = recorder.stop();

  await new Promise<void>((resolve) => upstream.close(() => resolve()));

  const interaction = golden.interactions[0];
  assert.ok(interaction);
  assert.equal(interaction.requestHeaders['authorization'], '<redacted>');
  assert.equal(interaction.responseHeaders['set-cookie'], '<redacted>');
});
