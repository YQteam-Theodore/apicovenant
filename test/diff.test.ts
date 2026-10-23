import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffJson, parseBody } from '../src/diff/json-diff.ts';
import {
  parseGoldenFile,
  serializeGoldenFile,
  createGoldenFile,
  interactionKey,
  GOLDEN_FORMAT_VERSION,
} from '../src/record/golden.ts';

test('detects changed primitives', () => {
  const differences = diffJson({ total: 1 }, { total: 2 });
  assert.equal(differences.length, 1);
  assert.equal(differences[0]?.path, '/total');
  assert.equal(differences[0]?.kind, 'changed');
  assert.equal(differences[0]?.before, 1);
  assert.equal(differences[0]?.after, 2);
});

test('detects added and removed properties', () => {
  const differences = diffJson({ a: 1, b: 2 }, { a: 1, c: 3 });
  const added = differences.find((difference) => difference.kind === 'added');
  const removed = differences.find((difference) => difference.kind === 'removed');
  assert.equal(added?.path, '/c');
  assert.equal(removed?.path, '/b');
});

test('reports the path of nested differences', () => {
  const differences = diffJson({ items: [{ id: 'a', price: 10 }] }, { items: [{ id: 'a', price: 12 }] });
  assert.equal(differences.length, 1);
  assert.equal(differences[0]?.path, '/items/0/price');
});

test('detects array growth', () => {
  const differences = diffJson([1, 2], [1, 2, 3]);
  assert.equal(differences.length, 1);
  assert.equal(differences[0]?.kind, 'added');
  assert.equal(differences[0]?.path, '/2');
});

test('detects array shrinkage', () => {
  const differences = diffJson([1, 2, 3], [1, 2]);
  assert.equal(differences.length, 1);
  assert.equal(differences[0]?.kind, 'removed');
});

test('reports no differences for equal documents', () => {
  assert.deepEqual(diffJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), []);
});

test('parseBody understands json, text and empty bodies', () => {
  assert.deepEqual(parseBody('{"a":1}', 'json'), { a: 1 });
  assert.equal(parseBody('hello', 'text'), 'hello');
  assert.equal(parseBody('', 'empty'), undefined);
  assert.equal(parseBody('not json', 'json'), 'not json');
});

test('golden files round trip', () => {
  const file = createGoldenFile('http://example.com', 'openapi.yaml');
  file.interactions.push({
    method: 'GET',
    path: '/users',
    query: { page: '2' },
    requestHeaders: {},
    status: 200,
    responseHeaders: { 'content-type': 'application/json' },
    body: '{"ok":true}',
    bodyType: 'json',
    durationMs: 12,
  });

  const parsed = parseGoldenFile(serializeGoldenFile(file));
  assert.equal(parsed.apicovenant, GOLDEN_FORMAT_VERSION);
  assert.equal(parsed.target, 'http://example.com');
  assert.equal(parsed.spec, 'openapi.yaml');
  assert.equal(parsed.interactions.length, 1);
  assert.equal(parsed.interactions[0]?.path, '/users');
  assert.equal(parsed.interactions[0]?.status, 200);
});

test('parseGoldenFile rejects malformed input', () => {
  assert.throws(() => parseGoldenFile('not json'), /not valid JSON/);
  assert.throws(() => parseGoldenFile('{}'), /interactions/);
  assert.throws(() => parseGoldenFile('{"apicovenant":99,"interactions":[]}'), /format version/);
});

test('interactionKey is stable and includes the query', () => {
  assert.equal(interactionKey({ method: 'GET', path: '/a', query: { b: '2', a: '1' } }), 'GET /a?a=1&b=2');
  assert.equal(interactionKey({ method: 'GET', path: '/a' }), 'GET /a');
});
