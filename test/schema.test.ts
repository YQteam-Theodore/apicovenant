import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateSchema, generateExample, deepEqual } from '../src/spec/schema.ts';

test('validates primitive types', () => {
  assert.deepEqual(validateSchema('x', { type: 'string' }), []);
  assert.equal(validateSchema(1, { type: 'string' }).length, 1);
  assert.equal(validateSchema(1.5, { type: 'integer' }).length, 1);
  assert.equal(validateSchema(1, { type: 'number' }).length, 0);
  assert.equal(validateSchema(null, { type: 'null' }).length, 0);
});

test('validates objects and required properties', () => {
  const schema = {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' }, age: { type: 'integer' } },
    additionalProperties: false,
  };
  assert.deepEqual(validateSchema({ id: 'a' }, schema), []);
  assert.equal(validateSchema({}, schema)[0]?.message.includes('missing required property'), true);
  assert.equal(validateSchema({ id: 'a', extra: 1 }, schema)[0]?.message.includes('not allowed'), true);
});

test('validates arrays', () => {
  const schema = { type: 'array', items: { type: 'string' }, minItems: 1 };
  assert.deepEqual(validateSchema(['a'], schema), []);
  assert.equal(validateSchema([], schema).length, 1);
  assert.equal(validateSchema([1], schema).length, 1);
});

test('validates enums and const', () => {
  assert.deepEqual(validateSchema('a', { enum: ['a', 'b'] }), []);
  assert.equal(validateSchema('c', { enum: ['a', 'b'] }).length, 1);
  assert.deepEqual(validateSchema(5, { const: 5 }), []);
  assert.equal(validateSchema(6, { const: 5 }).length, 1);
});

test('validates string constraints', () => {
  assert.equal(validateSchema('ab', { type: 'string', minLength: 3 }).length, 1);
  assert.equal(validateSchema('abcd', { type: 'string', maxLength: 3 }).length, 1);
  assert.equal(validateSchema('abc', { type: 'string', pattern: '^a' }).length, 0);
  assert.equal(validateSchema('bbc', { type: 'string', pattern: '^a' }).length, 1);
});

test('validates numeric constraints', () => {
  assert.equal(validateSchema(1, { type: 'number', minimum: 2 }).length, 1);
  assert.equal(validateSchema(3, { type: 'number', maximum: 2 }).length, 1);
  assert.equal(validateSchema(2, { type: 'number', minimum: 1, maximum: 3 }).length, 0);
});

test('supports OpenAPI 3.0 nullable', () => {
  assert.deepEqual(validateSchema(null, { type: 'string', nullable: true }), []);
  assert.equal(validateSchema(1, { type: 'string', nullable: true }).length, 1);
});

test('supports anyOf, oneOf and not', () => {
  assert.deepEqual(validateSchema('a', { anyOf: [{ type: 'string' }, { type: 'number' }] }), []);
  assert.equal(validateSchema(true, { anyOf: [{ type: 'string' }, { type: 'number' }] }).length, 1);
  assert.equal(validateSchema('a', { oneOf: [{ type: 'string' }, { type: 'string' }] }).length, 1);
  assert.equal(validateSchema('a', { not: { type: 'string' } }).length, 1);
});

test('reports the path of the offending value', () => {
  const schema = {
    type: 'object',
    properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } } },
  };
  const violations = validateSchema({ items: [{ id: 5 }] }, schema);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.path, '/items/0/id');
});

test('generates deterministic examples', () => {
  const schema = {
    type: 'object',
    properties: { id: { type: 'string' }, email: { type: 'string', format: 'email' }, age: { type: 'integer' } },
  };
  const first = generateExample(schema, { includeOptional: true });
  const second = generateExample(schema, { includeOptional: true });
  assert.deepEqual(first, second);
  assert.equal(typeof first, 'object');
  assert.match(String((first as Record<string, unknown>)['email']), /@/);
});

test('generated examples respect the schema', () => {
  const schema = {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' },
      count: { type: 'integer', minimum: 5 },
      flag: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  };
  const example = generateExample(schema, { includeOptional: true }) as Record<string, unknown>;
  assert.equal(typeof example['id'], 'string');
  assert.equal(typeof example['count'], 'number');
  assert.equal(typeof example['flag'], 'boolean');
  assert.ok(Array.isArray(example['tags']));
  assert.equal(validateSchema(example, schema).length, 0);
});

test('uses explicit examples when present', () => {
  const schema = { type: 'object', properties: { id: { type: 'string', example: 'fixed' } } };
  const example = generateExample(schema, { includeOptional: true }) as Record<string, unknown>;
  assert.equal(example['id'], 'fixed');
});

test('only includes required properties when asked', () => {
  const schema = {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' }, extra: { type: 'string' } },
  };
  const example = generateExample(schema, { includeOptional: false }) as Record<string, unknown>;
  assert.deepEqual(Object.keys(example), ['id']);
});

test('deepEqual compares structurally', () => {
  assert.equal(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
  assert.equal(deepEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(deepEqual([1, 2], [1, 2, 3]), false);
});
