/**
 * RFC 6901 JSON Pointer helpers.
 *
 * Every finding produced by the linter, every schema validation error and every
 * body difference in a contract diff is addressed by a JSON Pointer, so the
 * same addressing scheme works across all three subsystems.
 */

export type Pointer = string;

export function escapeToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function pointer(...tokens: Array<string | number>): Pointer {
  if (tokens.length === 0) return '';
  return '/' + tokens.map((t) => escapeToken(String(t))).join('/');
}

export function join(base: Pointer, ...tokens: Array<string | number>): Pointer {
  return base + pointer(...tokens);
}

export function parsePointer(ptr: Pointer): string[] {
  if (ptr === '' || ptr === '#') return [];
  const body = ptr.startsWith('#/') ? ptr.slice(2) : ptr.startsWith('/') ? ptr.slice(1) : ptr;
  if (body === '') return [];
  return body.split('/').map(unescapeToken);
}

export function resolvePointer(doc: unknown, ptr: Pointer): unknown {
  const tokens = parsePointer(ptr);
  let current: unknown = doc;
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Human friendly rendering of a pointer for terminal output. */
export function humanizePointer(ptr: Pointer): string {
  const tokens = parsePointer(ptr);
  if (tokens.length === 0) return '<root>';
  return tokens.join('.');
}
