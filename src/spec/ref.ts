

import { isPlainObject } from '../util/text.ts';

export interface DerefOptions {

  maxDepth?: number;

  shallow?: boolean;
}

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

export function isRefNode(node: unknown): node is { $ref: string } {
  return isPlainObject(node) && typeof node['$ref'] === 'string';
}

export function resolveRefOnce(doc: unknown, node: unknown): unknown {
  if (!isRefNode(node)) return node;
  const resolved = resolveLocalRef(doc, node.$ref);
  return resolved === undefined ? node : resolved;
}

export function deref(doc: unknown, node: unknown, options: DerefOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 40;
  const seen = new Set<string>();

  const walk = (current: unknown, depth: number): unknown => {
    if (depth > maxDepth) return current;

    if (isRefNode(current)) {
      if (seen.has(current.$ref)) return current;
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

export function refName(ref: string): string {
  const parts = ref.split('/');
  return parts[parts.length - 1] ?? ref;
}
