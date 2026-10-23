/**
 * Response generation for the mock server.
 *
 * The generator prefers, in order: an explicit `x-mock` override on the
 * operation, a media type `example`, a schema `example`, and finally a
 * deterministic payload derived from the schema itself.
 */

import { generateExample } from '../spec/schema.ts';
import { deref, followRef } from '../spec/ref.ts';
import { isPlainObject } from '../util/text.ts';
import type { ApiSpec, Operation, Response } from '../spec/model.ts';

export interface MockPayload {
  status: number;
  headers: Record<string, string>;
  body: string;
  contentType?: string;
}

export interface GenerateOptions {
  /** Status code requested by the caller. */
  status?: number;
  /** Simulated latency in milliseconds. */
  latency?: number;
}

/** Find the response definition that should answer a request. */
export function selectResponse(spec: ApiSpec, operation: Operation, requestedStatus?: number): Response | undefined {
  const responses = [...operation.responses.values()];

  if (requestedStatus !== undefined) {
    const exact = responses.find((response) => response.status === String(requestedStatus));
    if (exact) return exact;
    const range = responses.find((response) => {
      if (!/^\d\d\d$/.test(response.status)) return false;
      const code = Number(response.status);
      return code >= 200 && code < 300;
    });
    if (range) return range;
  }

  const success = responses
    .filter((response) => /^2\d\d$/.test(response.status))
    .sort((a, b) => Number(a.status) - Number(b.status));
  if (success.length > 0) return success[0];

  const fallback = responses.find((response) => response.status === 'default');
  return fallback ?? responses[0];
}

/** Build the payload the mock server should answer with. */
export function generatePayload(spec: ApiSpec, operation: Operation, options: GenerateOptions = {}): MockPayload {
  const raw = operation.raw;
  const override = isPlainObject(raw['x-mock']) ? raw['x-mock'] : undefined;

  const documented = selectResponse(spec, operation, options.status);

  // A caller can force a status code with "?x-mock-status=404". When that
  // status is not documented we synthesise an error response instead of
  // silently answering with the success payload.
  if (options.status !== undefined && (!documented || Number(documented.status) !== options.status)) {
    const synthetic = synthesizeErrorPayload(spec, options.status);
    if (override && override['body'] !== undefined) {
      synthetic.body = `${JSON.stringify(override['body'], null, 2)}\n`;
    }
    return synthetic;
  }

  const response = documented;
  const status = override && typeof override['status'] === 'number' ? override['status'] : Number(response?.status ?? 200);

  const headers: Record<string, string> = {};
  if (response) {
    for (const [name, header] of response.headers) {
      const schema = isPlainObject(header) ? header['schema'] : undefined;
      const example = isPlainObject(header) ? header['example'] : undefined;
      if (example !== undefined) headers[name] = String(example);
      else if (schema !== undefined) headers[name] = String(generateExample(schema, { includeOptional: true }));
    }
  }

  const contentType =
    (response ? [...response.content.keys()][0] : undefined) ?? 'application/json';

  const mediaType = response?.content.get(contentType) ?? (response ? response.content.values().next().value : undefined);

  let body: unknown;
  let finalContentType = contentType;

  if (override && override['body'] !== undefined) {
    body = override['body'];
  } else if (mediaType?.example !== undefined) {
    body = mediaType.example;
  } else if (mediaType?.examples) {
    const first = Object.values(mediaType.examples)[0];
    body = isPlainObject(first) && first['value'] !== undefined ? first['value'] : first;
  } else if (mediaType?.schema) {
    const schema = followRef(spec.raw, mediaType.schema);
    const expanded = deref(spec.raw, schema);
    body = generateExample(expanded, { includeOptional: true });
    if (isPlainObject(expanded) && typeof expanded['example'] !== 'undefined') body = expanded['example'];
  } else if (status === 204 || status === 304) {
    body = undefined;
  }

  headers['Content-Type'] = finalContentType;

  let serialised = '';
  if (body !== undefined) {
    if (finalContentType.includes('json')) {
      serialised = `${JSON.stringify(body, null, 2)}\n`;
    } else if (typeof body === 'string') {
      serialised = body;
    } else {
      serialised = `${JSON.stringify(body)}\n`;
    }
  }

  return { status, headers, body: serialised, contentType: finalContentType };
}

/**
 * Build an error payload for a status code that is not documented.
 *
 * The shared error schema of the API is used when there is one, so mocked
 * errors look exactly like the errors the real service would return.
 */
export function synthesizeErrorPayload(spec: ApiSpec, status: number): MockPayload {
  const schemas = isPlainObject(spec.components['schemas']) ? spec.components['schemas'] : {};
  const errorName = Object.keys(schemas).find((name) => /error/i.test(name));

  let body: unknown = { error: 'error', status, message: `The mock generated a ${status} response.` };

  if (errorName) {
    const schema = followRef(spec.raw, schemas[errorName]);
    const expanded = deref(spec.raw, schema);
    const example = generateExample(expanded, { includeOptional: true });
    if (isPlainObject(example)) {
      body = {
        code: example['code'] ?? 'error',
        message: example['message'] ?? `The mock generated a ${status} response.`,
        ...(example['details'] !== undefined ? { details: example['details'] } : {}),
      };
    }
  }

  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: `${JSON.stringify(body, null, 2)}\n`,
    contentType: 'application/json',
  };
}
