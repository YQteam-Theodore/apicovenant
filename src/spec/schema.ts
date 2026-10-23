/**
 * A pragmatic JSON Schema (draft 2020-12 / OpenAPI 3.1 subset) implementation.
 *
 * Two features are needed by `apicovenant`:
 *
 *   1. **Validation** — does a live response still satisfy the contract?
 *   2. **Example generation** — build deterministic payloads for the mock
 *      server from a schema.
 *
 * Both work on OpenAPI 3.0 schemas too (`nullable` is understood as a
 * synonym of a `null` type member).
 */

import { isPlainObject } from '../util/text.ts';
import { pointer } from '../util/json-pointer.ts';

export interface JsonSchema {
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  enum?: unknown[];
  const?: unknown;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  not?: JsonSchema;
  nullable?: boolean;
  default?: unknown;
  example?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  [key: string]: unknown;
}

export interface SchemaViolation {
  /** JSON Pointer to the offending value. */
  path: string;
  /** JSON Pointer to the schema that rejected the value. */
  schemaPath: string;
  message: string;
}

export interface ValidateOptions {
  /** Maximum number of violations collected before bailing out. */
  maxErrors?: number;
  /** Property names that must not be reported (used for write-only fields). */
  skipProperties?: Set<string>;
}

const TYPE_CHECKS: Record<string, (value: unknown) => boolean> = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  integer: (value) => typeof value === 'number' && Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  object: (value) => isPlainObject(value),
  array: (value) => Array.isArray(value),
  null: (value) => value === null,
};

function typeNames(schema: JsonSchema): string[] {
  const names: string[] = [];
  if (typeof schema.type === 'string') names.push(schema.type);
  else if (Array.isArray(schema.type)) names.push(...schema.type.filter((t): t is string => typeof t === 'string'));
  if (schema.nullable === true && !names.includes('null')) names.push('null');
  return names;
}

function matchesType(value: unknown, names: string[]): boolean {
  if (names.length === 0) return true;
  return names.some((name) => TYPE_CHECKS[name]?.(value) ?? true);
}

/** Validate a value against a schema and return every violation found. */
export function validateSchema(value: unknown, schema: unknown, options: ValidateOptions = {}): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  const maxErrors = options.maxErrors ?? 100;

  const visit = (val: unknown, sch: unknown, path: string, schemaPath: string): void => {
    if (violations.length >= maxErrors) return;
    if (!isPlainObject(sch)) return;
    const s = sch as JsonSchema;

    const names = typeNames(s);
    if (names.length > 0 && !matchesType(val, names)) {
      violations.push({
        path,
        schemaPath,
        message: `expected ${names.join(' | ')} but received ${describeType(val)}`,
      });
      return;
    }

    if (s.const !== undefined && !deepEqual(val, s.const)) {
      violations.push({ path, schemaPath, message: `expected the constant ${JSON.stringify(s.const)}` });
    }

    if (Array.isArray(s.enum) && !s.enum.some((candidate) => deepEqual(val, candidate))) {
      violations.push({
        path,
        schemaPath,
        message: `value is not one of the allowed values [${s.enum.map((v) => JSON.stringify(v)).join(', ')}]`,
      });
    }

    if (typeof val === 'string') validateString(val, s, path, schemaPath, violations);
    if (typeof val === 'number') validateNumber(val, s, path, schemaPath, violations);

    if (Array.isArray(val)) {
      if (typeof s.minItems === 'number' && val.length < s.minItems) {
        violations.push({ path, schemaPath, message: `expected at least ${s.minItems} items but received ${val.length}` });
      }
      if (typeof s.maxItems === 'number' && val.length > s.maxItems) {
        violations.push({ path, schemaPath, message: `expected at most ${s.maxItems} items but received ${val.length}` });
      }
      if (s.uniqueItems === true) {
        const seen = new Set<string>();
        for (const item of val) {
          const key = JSON.stringify(item);
          if (seen.has(key)) {
            violations.push({ path, schemaPath, message: 'items must be unique' });
            break;
          }
          seen.add(key);
        }
      }
      const prefix = s.prefixItems ?? [];
      val.forEach((item, index) => {
        const itemSchema = index < prefix.length ? prefix[index] : s.items;
        if (itemSchema) visit(item, itemSchema, `${path}/${index}`, `${schemaPath}/items`);
      });
    }

    if (isPlainObject(val)) {
      const properties = isPlainObject(s.properties) ? s.properties : {};
      const required = Array.isArray(s.required) ? s.required : [];

      for (const key of required) {
        if (!(key in val)) {
          violations.push({
            path: `${path}/${key}`,
            schemaPath: `${schemaPath}/required`,
            message: `missing required property "${key}"`,
          });
        }
      }

      for (const [key, child] of Object.entries(val)) {
        if (options.skipProperties?.has(key)) continue;
        const childSchema = properties[key];
        if (childSchema) {
          visit(child, childSchema, `${path}/${key}`, `${schemaPath}/properties/${key}`);
          continue;
        }
        if (s.additionalProperties === false) {
          violations.push({
            path: `${path}/${key}`,
            schemaPath: `${schemaPath}/additionalProperties`,
            message: `unexpected property "${key}" is not allowed`,
          });
        } else if (isPlainObject(s.additionalProperties)) {
          visit(child, s.additionalProperties, `${path}/${key}`, `${schemaPath}/additionalProperties`);
        }
      }

      if (typeof s.minProperties === 'number' && Object.keys(val).length < s.minProperties) {
        violations.push({
          path,
          schemaPath,
          message: `expected at least ${s.minProperties} properties`,
        });
      }
      if (typeof s.maxProperties === 'number' && Object.keys(val).length > s.maxProperties) {
        violations.push({
          path,
          schemaPath,
          message: `expected at most ${s.maxProperties} properties`,
        });
      }
    }

    if (Array.isArray(s.allOf)) {
      s.allOf.forEach((sub, index) => visit(val, sub, path, `${schemaPath}/allOf/${index}`));
    }

    if (Array.isArray(s.anyOf) && s.anyOf.length > 0) {
      const ok = s.anyOf.some((sub) => validateSchema(val, sub, { maxErrors: 1 }).length === 0);
      if (!ok) {
        violations.push({
          path,
          schemaPath: `${schemaPath}/anyOf`,
          message: 'value does not match any of the allowed schemas',
        });
      }
    }

    if (Array.isArray(s.oneOf) && s.oneOf.length > 0) {
      const matches = s.oneOf.filter((sub) => validateSchema(val, sub, { maxErrors: 1 }).length === 0);
      if (matches.length === 0) {
        violations.push({
          path,
          schemaPath: `${schemaPath}/oneOf`,
          message: 'value does not match any of the allowed schemas',
        });
      } else if (matches.length > 1) {
        violations.push({
          path,
          schemaPath: `${schemaPath}/oneOf`,
          message: `value matches ${matches.length} schemas but must match exactly one`,
        });
      }
    }

    if (s.not && validateSchema(val, s.not, { maxErrors: 1 }).length === 0) {
      violations.push({ path, schemaPath: `${schemaPath}/not`, message: 'value must not match the forbidden schema' });
    }
  };

  visit(value, schema, '', '');
  return violations;
}

function validateString(
  value: string,
  schema: JsonSchema,
  path: string,
  schemaPath: string,
  violations: SchemaViolation[],
): void {
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    violations.push({
      path,
      schemaPath,
      message: `expected at least ${schema.minLength} characters but received ${value.length}`,
    });
  }
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    violations.push({
      path,
      schemaPath,
      message: `expected at most ${schema.maxLength} characters but received ${value.length}`,
    });
  }
  if (typeof schema.pattern === 'string') {
    let regex: RegExp | null = null;
    try {
      regex = new RegExp(schema.pattern);
    } catch {
      regex = null;
    }
    if (regex && !regex.test(value)) {
      violations.push({
        path,
        schemaPath,
        message: `value does not match the pattern ${schema.pattern}`,
      });
    }
  }
}

function validateNumber(
  value: number,
  schema: JsonSchema,
  path: string,
  schemaPath: string,
  violations: SchemaViolation[],
): void {
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    violations.push({
      path,
      schemaPath,
      message: `expected a value >= ${schema.minimum} but received ${value}`,
    });
  }
  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    violations.push({
      path,
      schemaPath,
      message: `expected a value <= ${schema.maximum} but received ${value}`,
    });
  }
  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
    violations.push({
      path,
      schemaPath,
      message: `expected a value > ${schema.exclusiveMinimum} but received ${value}`,
    });
  }
  if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
    violations.push({
      path,
      schemaPath,
      message: `expected a value < ${schema.exclusiveMaximum} but received ${value}`,
    });
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    if (!aKeys.every((key, index) => key === bKeys[index])) return false;
    return aKeys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

export function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

// ---------------------------------------------------------------- examples

export interface GenerateOptions {
  /** Include properties that are not required (mock payloads are richer). */
  includeOptional?: boolean;
  /** Skip `readOnly` properties (request bodies). */
  skipReadOnly?: boolean;
  /** Skip `writeOnly` properties (response bodies). */
  skipWriteOnly?: boolean;
  /** Depth guard for recursive schemas. */
  maxDepth?: number;
  /** Deterministic seed so repeated runs produce identical payloads. */
  seed?: string;
}

/**
 * Build a deterministic example payload for a schema.
 *
 * The same schema always produces the same payload, which makes mock
 * responses stable and diffable.
 */
export function generateExample(schema: unknown, options: GenerateOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 6;

  const build = (sch: unknown, key: string, depth: number): unknown => {
    if (depth > maxDepth) return null;
    if (!isPlainObject(sch)) return null;
    const s = sch as JsonSchema;

    if (s.example !== undefined) return s.example;
    if (s.default !== undefined) return s.default;

    if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
    if (s.const !== undefined) return s.const;

    if (Array.isArray(s.oneOf) && s.oneOf.length > 0) return build(s.oneOf[0], key, depth + 1);
    if (Array.isArray(s.anyOf) && s.anyOf.length > 0) return build(s.anyOf[0], key, depth + 1);
    if (Array.isArray(s.allOf) && s.allOf.length > 0) {
      let merged: Record<string, unknown> = {};
      for (const sub of s.allOf) {
        const built = build(sub, key, depth + 1);
        if (isPlainObject(built)) merged = { ...merged, ...built };
      }
      return merged;
    }

    const names = typeNames(s);
    const type = names.find((name) => name !== 'null') ?? 'string';

    switch (type) {
      case 'object': {
        const out: Record<string, unknown> = {};
        const properties = isPlainObject(s.properties) ? s.properties : {};
        const required = Array.isArray(s.required) ? s.required : [];
        for (const [name, childSchema] of Object.entries(properties)) {
          const child = childSchema as JsonSchema;
          if (child.readOnly && options.skipReadOnly) continue;
          if (child.writeOnly && options.skipWriteOnly) continue;
          if (!options.includeOptional && !required.includes(name)) continue;
          out[name] = build(child, name, depth + 1);
        }
        return out;
      }
      case 'array': {
        const itemSchema = s.items;
        if (!itemSchema) return [];
        return [build(itemSchema, key, depth + 1)];
      }
      case 'integer':
        return stableInt(key);
      case 'number':
        return stableNumber(key);
      case 'boolean':
        return true;
      case 'null':
        return null;
      default:
        return stableString(s, key);
    }
  };

  return build(schema, '', 0);
}

function stableInt(key: string): number {
  const hash = hashString(key || 'value');
  return (hash % 900) + 100;
}

function stableNumber(key: string): number {
  const hash = hashString(key || 'value');
  return Math.round(((hash % 9000) + 100) / 100) / 10;
}

function stableString(schema: JsonSchema, key: string): string {
  const format = (schema.format ?? '').toLowerCase();
  const name = key.toLowerCase();

  switch (format) {
    case 'email':
      return 'ada@example.com';
    case 'uuid':
      return '8f14e45f-ea8c-4a1c-9b7c-4a2f8a1c9e01';
    case 'date-time':
      return '2024-01-15T09:30:00Z';
    case 'date':
      return '2024-01-15';
    case 'time':
      return '09:30:00';
    case 'uri':
    case 'url':
      return 'https://example.com/resource';
    case 'ipv4':
      return '198.51.100.24';
    case 'ipv6':
      return '2001:db8::1';
    case 'hostname':
      return 'example.com';
    case 'byte':
      return 'YWRtaW4=';
    case 'password':
      return 's3cret';
    default:
      break;
  }

  if (/(^|_)id$/.test(name)) return 'id_1001';
  if (name === 'email') return 'ada@example.com';
  if (name.includes('phone')) return '+1-555-0100';
  if (name.includes('url') || name.includes('link')) return 'https://example.com/page';
  if (name.includes('slug')) return 'sample-slug';
  if (name.includes('name')) return 'Sample Name';
  if (name.includes('title')) return 'Sample Title';
  if (name.includes('description') || name.includes('summary')) return 'Sample description text.';
  if (name.includes('status') || name.includes('state')) return 'active';
  if (name.includes('code')) return 'SMP-1001';
  if (name.includes('price') || name.includes('amount')) return '19.99';
  if (name.includes('count') || name.endsWith('total')) return '3';
  if (name.includes('token')) return 'tok_9f2b7c41';
  if (name.includes('date')) return '2024-01-15';

  return `sample-${name || 'value'}`;
}

export function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/** Convenience: JSON Pointer for a property path. */
export function propertyPointer(...keys: string[]): string {
  return pointer(...keys);
}
