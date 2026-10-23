/**
 * `$ref` handling for OpenAPI documents.
 *
 * References are resolved lazily against the owning document. Recursive
 * schemas are common in real specs (`Category.parent -> Category`), so the
 * resolver is cycle aware: a reference that would loop is left in place as a
 * `{ $ref }` node instead of expanding forever.
 */

import { isPlainObject } from '../util/text.ts';

export interface DerefOptions {
  /** Maximum depth to expand before giving up and leaving the `$ref` in place. */
  maxDepth?: number;
  /** Leave `{ $ref }` nodes untouched. */
  shallow?: boolean;
}

/** Resolve a local JSON Pointer reference such as `#/components/schemas/User`. */
export function resolveLocalRef(doc: unknown, ref: string): unknown {
  if (ref === '#' || ref === '#/') return doc;
  if (!ref.startsWith('#/')) {
    throw new Error(`Only local references are supported, got "${ref}"`);
  }

  const tokens = ref
    .slice(2)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));

  let current: unknown = doc;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      current = current[Number(token)];
    } else if (isPlainObject(current)) {
      current = current[token];
    } else {
      return undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}

/** True when the node is a `{ $ref: string }` object. */
export function isRefNode(node: unknown): node is { $ref: string } {
  return isPlainObject(node) && typeof node['$ref'] === 'string';
}

/**
 * Resolve a single level of `$ref`.
 *
 * Sibling keys next to `$ref` are ignored, matching the OpenAPI 3.0 rules.
 */
export function resolveRefOnce(doc: unknown, node: unknown): unknown {
  if (!isRefNode(node)) return node;
  const resolved = resolveLocalRef(doc, node.$ref);
  return resolved === undefined ? node : resolved;
}

/**
 * Expand every `$ref` inside `node`.
 *
 * @param doc the document that owns the references
 * @param node the subtree to expand
 * @param options expansion limits
 */
export function deref(doc: unknown, node: unknown, options: DerefOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 40;
  const seen = new Set<string>();

  const walk = (current: unknown, depth: number): unknown => {
    if (depth > maxDepth) return current;

    if (isRefNode(current)) {
      if (seen.has(current.$ref)) return current; // recursive reference: keep the pointer
      const resolved = resolveLocalRef(doc, current.$ref);
      if (resolved === undefined) return current;
      seen.add(current.$ref);
      const expanded = walk(resolved, depth + 1);
      seen.delete(current.$ref);
      return expanded;
    }

    if (Array.isArray(current)) return current.map((item) => walk(item, depth + 1));

    if (isPlainObject(current)) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(current)) {
        out[key] = walk(value, depth + 1);
      }
      return out;
    }

    return current;
  };

  if (options.shallow) {
    if (isRefNode(node)) return resolveRefOnce(doc, node);
    if (Array.isArray(node)) return node.map((item) => walk(item, 1));
    if (isPlainObject(node)) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        out[key] = walk(value, 1);
      }
      return out;
    }
    return node;
  }

  return walk(node, 0);
}

/**
 * Follow a chain of `$ref`s until a concrete node is reached.
 *
 * Used by rules that only need the final target (for example "does this
 * response use the shared error schema?").
 */
export function followRef(doc: unknown, node: unknown, maxHops = 20): unknown {
  let current = node;
  for (let i = 0; i < maxHops; i += 1) {
    if (!isRefNode(current)) return current;
    const resolved = resolveLocalRef(doc, current.$ref);
    if (resolved === undefined) return current;
    current = resolved;
  }
  return current;
}

/** Collect every `$ref` string used inside a subtree. */
export function collectRefs(node: unknown, out: Set<string> = new Set<string>()): Set<string> {
  if (isRefNode(node)) {
    out.add(node.$ref);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, out);
    return out;
  }
  if (isPlainObject(node)) {
    for (const value of Object.values(node)) collectRefs(value, out);
  }
  return out;
}

/** The name of the component a `$ref` points at, e.g. `User` for `#/components/schemas/User`. */
export function refName(ref: string): string {
  const parts = ref.split('/');
  return parts[parts.length - 1] ?? ref;
}

/** The component group a `$ref` points at, e.g. `schemas` for `#/components/schemas/User`. */
export function refGroup(ref: string): string {
  const parts = ref.split('/');
  if (parts.length < 2) return '';
  return parts[parts.length - 2] ?? '';
}
