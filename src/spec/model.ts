/**
 * The normalized view of an OpenAPI document.
 *
 * The linter, the mock server and the recorder all operate on this model
 * instead of walking raw JSON, which keeps every subsystem working against the
 * same understanding of "an operation" and "a response".
 */

import { isPlainObject, toArray } from '../util/text.ts';
import { deref, isRefNode, followRef } from './ref.ts';

export type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace';

export const HTTP_METHODS: HttpMethod[] = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

export const PARAMETER_LOCATIONS = ['path', 'query', 'header', 'cookie'] as const;
export type ParameterLocation = (typeof PARAMETER_LOCATIONS)[number];

export interface SpecInfo {
  title: string;
  version: string;
  description?: string;
  summary?: string;
  termsOfService?: string;
  contact?: { name?: string; url?: string; email?: string };
  license?: { name?: string; url?: string; identifier?: string };
  raw: Record<string, unknown>;
}

export interface Server {
  url: string;
  description?: string;
  variables?: Record<string, unknown>;
}

export interface MediaType {
  contentType: string;
  schema?: unknown;
  example?: unknown;
  examples?: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface Parameter {
  name: string;
  in: ParameterLocation | string;
  required: boolean;
  description?: string;
  deprecated: boolean;
  schema?: unknown;
  example?: unknown;
  style?: string;
  explode?: boolean;
  raw: Record<string, unknown>;
  pointer: string;
}

export interface RequestBody {
  required: boolean;
  description?: string;
  content: Map<string, MediaType>;
  raw: Record<string, unknown>;
  pointer: string;
}

export interface Response {
  status: string;
  description?: string;
  content: Map<string, MediaType>;
  headers: Map<string, Record<string, unknown>>;
  raw: Record<string, unknown>;
  pointer: string;
}

export interface Operation {
  path: string;
  method: HttpMethod;
  operationId?: string;
  summary?: string;
  description?: string;
  tags: string[];
  parameters: Parameter[];
  requestBody?: RequestBody;
  responses: Map<string, Response>;
  security: Array<Record<string, string[]>>;
  deprecated: boolean;
  servers: Server[];
  raw: Record<string, unknown>;
  pointer: string;
  /** `"GET /users/{id}"` — used as a stable human readable identifier. */
  key: string;
}

export interface PathItem {
  path: string;
  summary?: string;
  description?: string;
  parameters: Parameter[];
  operations: Operation[];
  raw: Record<string, unknown>;
  pointer: string;
}

export interface ApiSpec {
  /** Where the document came from (file path or `<stdin>`). */
  document: string;
  /** Declared OpenAPI version, e.g. `3.1.0`. */
  version: string;
  info: SpecInfo;
  servers: Server[];
  paths: PathItem[];
  components: Record<string, unknown>;
  globalSecurity: Array<Record<string, string[]>>;
  tags: Array<{ name: string; description?: string }>;
  raw: Record<string, unknown>;
  /** All operations in document order. */
  operations: Operation[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function buildMediaTypes(content: unknown): Map<string, MediaType> {
  const map = new Map<string, MediaType>();
  if (!isPlainObject(content)) return map;
  for (const [contentType, raw] of Object.entries(content)) {
    const record = asRecord(raw);
    map.set(contentType, {
      contentType,
      schema: record['schema'],
      example: record['example'],
      examples: isPlainObject(record['examples']) ? record['examples'] : undefined,
      raw: record,
    });
  }
  return map;
}

function buildParameters(raw: unknown, doc: unknown, pointer: string): Parameter[] {
  const out: Parameter[] = [];
  toArray(raw).forEach((entry, index) => {
    const record = asRecord(entry);
    const resolved = asRecord(followRef(doc, record));
    const name = typeof resolved['name'] === 'string' ? resolved['name'] : '';
    if (!name) return;
    out.push({
      name,
      in: typeof resolved['in'] === 'string' ? resolved['in'] : 'query',
      required: resolved['required'] === true,
      description: typeof resolved['description'] === 'string' ? resolved['description'] : undefined,
      deprecated: resolved['deprecated'] === true,
      schema: resolved['schema'],
      example: resolved['example'],
      style: typeof resolved['style'] === 'string' ? resolved['style'] : undefined,
      explode: typeof resolved['explode'] === 'boolean' ? resolved['explode'] : undefined,
      raw: resolved,
      pointer: `${pointer}/${index}`,
    });
  });
  return out;
}

function buildResponses(raw: unknown, doc: unknown, pointer: string): Map<string, Response> {
  const map = new Map<string, Response>();
  if (!isPlainObject(raw)) return map;
  for (const [status, value] of Object.entries(raw)) {
    const resolved = asRecord(followRef(doc, value));
    const headers = new Map<string, Record<string, unknown>>();
    if (isPlainObject(resolved['headers'])) {
      for (const [name, header] of Object.entries(resolved['headers'])) {
        headers.set(name, asRecord(followRef(doc, header)));
      }
    }
    map.set(status, {
      status,
      description: typeof resolved['description'] === 'string' ? resolved['description'] : undefined,
      content: buildMediaTypes(resolved['content']),
      headers,
      raw: resolved,
      pointer: `${pointer}/${status}`,
    });
  }
  return map;
}

function buildSecurity(raw: unknown): Array<Record<string, string[]>> {
  return toArray(raw)
    .filter(isPlainObject)
    .map((entry) => {
      const out: Record<string, string[]> = {};
      for (const [name, scopes] of Object.entries(entry)) {
        out[name] = toArray(scopes).filter((s): s is string => typeof s === 'string');
      }
      return out;
    });
}

/** Build the normalized model from a raw OpenAPI document. */
export function buildSpec(raw: unknown, document = '<memory>'): ApiSpec {
  const doc = asRecord(raw);
  const infoRaw = asRecord(doc['info']);

  const info: SpecInfo = {
    title: typeof infoRaw['title'] === 'string' ? infoRaw['title'] : 'Untitled API',
    version: typeof infoRaw['version'] === 'string' ? infoRaw['version'] : '0.0.0',
    description: typeof infoRaw['description'] === 'string' ? infoRaw['description'] : undefined,
    summary: typeof infoRaw['summary'] === 'string' ? infoRaw['summary'] : undefined,
    termsOfService: typeof infoRaw['termsOfService'] === 'string' ? infoRaw['termsOfService'] : undefined,
    contact: isPlainObject(infoRaw['contact']) ? (infoRaw['contact'] as SpecInfo['contact']) : undefined,
    license: isPlainObject(infoRaw['license']) ? (infoRaw['license'] as SpecInfo['license']) : undefined,
    raw: infoRaw,
  };

  const servers: Server[] = toArray(doc['servers'])
    .filter(isPlainObject)
    .map((server) => ({
      url: typeof server['url'] === 'string' ? server['url'] : '',
      description: typeof server['description'] === 'string' ? server['description'] : undefined,
      variables: isPlainObject(server['variables']) ? server['variables'] : undefined,
    }));

  const paths: PathItem[] = [];
  const operations: Operation[] = [];

  const pathsRaw = asRecord(doc['paths']);
  for (const [pathKey, pathValue] of Object.entries(pathsRaw)) {
    const pathRaw = asRecord(followRef(doc, pathValue));
    const pathPointer = `/paths/${pathKey.replace(/~/g, '~0').replace(/\//g, '~1')}`;
    const pathParameters = buildParameters(pathRaw['parameters'], doc, `${pathPointer}/parameters`);

    const pathItem: PathItem = {
      path: pathKey,
      summary: typeof pathRaw['summary'] === 'string' ? pathRaw['summary'] : undefined,
      description: typeof pathRaw['description'] === 'string' ? pathRaw['description'] : undefined,
      parameters: pathParameters,
      operations: [],
      raw: pathRaw,
      pointer: pathPointer,
    };

    for (const method of HTTP_METHODS) {
      const operationRaw = pathRaw[method];
      if (!isPlainObject(operationRaw)) continue;

      const operationPointer = `${pathPointer}/${method}`;
      const mergedParameters = [
        ...pathParameters,
        ...buildParameters(operationRaw['parameters'], doc, `${operationPointer}/parameters`),
      ];

      let requestBody: RequestBody | undefined;
      if (isPlainObject(operationRaw['requestBody'])) {
        const bodyRaw = asRecord(followRef(doc, operationRaw['requestBody']));
        requestBody = {
          required: bodyRaw['required'] === true,
          description: typeof bodyRaw['description'] === 'string' ? bodyRaw['description'] : undefined,
          content: buildMediaTypes(bodyRaw['content']),
          raw: bodyRaw,
          pointer: `${operationPointer}/requestBody`,
        };
      }

      const operation: Operation = {
        path: pathKey,
        method,
        operationId: typeof operationRaw['operationId'] === 'string' ? operationRaw['operationId'] : undefined,
        summary: typeof operationRaw['summary'] === 'string' ? operationRaw['summary'] : undefined,
        description: typeof operationRaw['description'] === 'string' ? operationRaw['description'] : undefined,
        tags: toArray(operationRaw['tags']).filter((t): t is string => typeof t === 'string'),
        parameters: mergedParameters,
        requestBody,
        responses: buildResponses(operationRaw['responses'], doc, `${operationPointer}/responses`),
        security: operationRaw['security'] === undefined
          ? buildSecurity(doc['security'])
          : buildSecurity(operationRaw['security']),
        deprecated: operationRaw['deprecated'] === true,
        servers: toArray(operationRaw['servers'])
          .filter(isPlainObject)
          .map((server) => ({
            url: typeof server['url'] === 'string' ? server['url'] : '',
            description: typeof server['description'] === 'string' ? server['description'] : undefined,
          })),
        raw: operationRaw,
        pointer: operationPointer,
        key: `${method.toUpperCase()} ${pathKey}`,
      };

      pathItem.operations.push(operation);
      operations.push(operation);
    }

    paths.push(pathItem);
  }

  const tags = toArray(doc['tags'])
    .filter(isPlainObject)
    .map((tag) => ({
      name: typeof tag['name'] === 'string' ? tag['name'] : '',
      description: typeof tag['description'] === 'string' ? tag['description'] : undefined,
    }))
    .filter((tag) => tag.name !== '');

  return {
    document,
    version: typeof doc['openapi'] === 'string' ? doc['openapi'] : '',
    info,
    servers,
    paths,
    components: asRecord(doc['components']),
    globalSecurity: buildSecurity(doc['security']),
    tags,
    raw: doc,
    operations,
  };
}

/** Expand `$ref`s in a subtree of the spec document. */
export function expand(node: unknown): unknown {
  return deref(node, node);
}

/** True when the node is still an unresolved `$ref`. */
export function isUnresolvedRef(node: unknown): boolean {
  return isRefNode(node);
}

/** All schemas declared under `components.schemas`. */
export function componentSchemas(spec: ApiSpec): Record<string, unknown> {
  const schemas = spec.components['schemas'];
  return isPlainObject(schemas) ? schemas : {};
}

/** All security schemes declared under `components.securitySchemes`. */
export function securitySchemes(spec: ApiSpec): Record<string, Record<string, unknown>> {
  const schemes = spec.components['securitySchemes'];
  const out: Record<string, Record<string, unknown>> = {};
  if (isPlainObject(schemes)) {
    for (const [name, value] of Object.entries(schemes)) out[name] = asRecord(value);
  }
  return out;
}
