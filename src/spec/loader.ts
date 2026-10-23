/**
 * Loading and validating OpenAPI documents.
 */

import path from 'node:path';

import { parseYaml, YamlError } from '../yaml/parser.ts';
import { isPlainObject } from '../util/text.ts';
import { readTextFile } from '../util/fs.ts';
import { buildSpec, type ApiSpec } from './model.ts';

export class SpecError extends Error {
  readonly file: string;

  constructor(message: string, file = '') {
    super(file ? `${file}: ${message}` : message);
    this.name = 'SpecError';
    this.file = file;
  }
}

export interface LoadOptions {
  /** Path used in error messages. */
  document?: string;
  /** Force a parser instead of detecting it from the file extension. */
  format?: 'yaml' | 'json';
}

/** Parse raw document text into a plain object. */
export function parseDocument(text: string, options: LoadOptions = {}): unknown {
  const file = options.document ?? '';
  const format = options.format ?? detectFormat(file);
  // Windows editors love to add a byte order mark; it is not part of the
  // document and would otherwise break the very first key.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  try {
    if (format === 'json') {
      try {
        return JSON.parse(source);
      } catch (error) {
        throw new SpecError(`invalid JSON: ${(error as Error).message}`, file);
      }
    }
    return parseYaml(source);
  } catch (error) {
    if (error instanceof YamlError) {
      throw new SpecError(`invalid YAML: ${error.message}`, file);
    }
    throw error;
  }
}

export function detectFormat(file: string): 'yaml' | 'json' {
  const ext = path.extname(file).toLowerCase();
  return ext === '.json' ? 'json' : 'yaml';
}

/**
 * Structural checks that a document must pass before any rule runs.
 *
 * These are intentionally shallow: `apicovenant` is a design linter, not a
 * replacement for a full JSON Schema validator for the OpenAPI meta-schema.
 */
export function validateDocument(doc: unknown, file = ''): void {
  if (!isPlainObject(doc)) {
    throw new SpecError('document root must be a mapping', file);
  }
  if (typeof doc['openapi'] !== 'string') {
    throw new SpecError('missing "openapi" version field', file);
  }
  const version = doc['openapi'];
  if (!/^3\.\d+(\.\d+)?/.test(version)) {
    throw new SpecError(`unsupported OpenAPI version "${version}" (expected 3.x)`, file);
  }
  if (!isPlainObject(doc['info'])) {
    throw new SpecError('missing "info" object', file);
  }
  if (typeof doc['info']['title'] !== 'string' || doc['info']['title'].trim() === '') {
    throw new SpecError('missing "info.title"', file);
  }
  if (doc['paths'] !== undefined && !isPlainObject(doc['paths'])) {
    throw new SpecError('"paths" must be a mapping', file);
  }
}

/** Parse, validate and normalize an OpenAPI document. */
export function loadSpecFromText(text: string, options: LoadOptions = {}): ApiSpec {
  const doc = parseDocument(text, options);
  validateDocument(doc, options.document ?? '');
  return buildSpec(doc, options.document ?? '<memory>');
}

/** Load an OpenAPI document from disk. */
export async function loadSpecFile(filePath: string): Promise<ApiSpec> {
  const text = await readTextFile(filePath);
  return loadSpecFromText(text, { document: filePath });
}

/** Load an OpenAPI document from standard input. */
export async function loadSpecFromStdin(): Promise<ApiSpec> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return loadSpecFromText(text, { document: '<stdin>' });
}
