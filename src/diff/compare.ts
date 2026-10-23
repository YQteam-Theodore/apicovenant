/**
 * Contract diffing: compare recorded traffic against a live implementation.
 *
 * This is the part of `apicovenant` that answers the question teams actually
 * ask before a release: *"did my change alter the way the API behaves?"*
 */

import { compilePath } from '../mock/server.ts';
import { validateSchema, type SchemaViolation } from '../spec/schema.ts';
import { deref, followRef } from '../spec/ref.ts';
import { isPlainObject } from '../util/text.ts';
import type { ApiSpec, Operation } from '../spec/model.ts';
import { diffJson, parseBody, type BodyDifference } from './json-diff.ts';
import type { GoldenFile, GoldenInteraction } from '../record/golden.ts';

export interface LiveResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Somewhere a recorded interaction can be replayed against. */
export interface LiveSource {
  /** Human readable description, shown in the report. */
  readonly description: string;
  request(interaction: GoldenInteraction): Promise<LiveResponse>;
}

/** Replays against a real HTTP server. */
export class HttpLiveSource implements LiveSource {
  readonly description: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 10_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.description = this.baseUrl;
    this.timeoutMs = timeoutMs;
  }

  async request(interaction: GoldenInteraction): Promise<LiveResponse> {
    const query = new URLSearchParams(interaction.query).toString();
    const url = `${this.baseUrl}${interaction.path}${query ? `?${query}` : ''}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: interaction.method,
        headers: interaction.requestHeaders,
        body: interaction.method === 'GET' || interaction.method === 'HEAD' ? undefined : interaction.body,
        signal: controller.signal,
        redirect: 'manual',
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });

      const body = await response.text();
      return { status: response.status, headers, body };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Replays against a mock server that is generated from a spec. */
export class MockLiveSource implements LiveSource {
  readonly description: string;
  private readonly url: string;

  constructor(url: string, description?: string) {
    this.url = url.replace(/\/+$/, '');
    this.description = description ?? `mock(${this.url})`;
  }

  async request(interaction: GoldenInteraction): Promise<LiveResponse> {
    const query = new URLSearchParams(interaction.query).toString();
    const url = `${this.url}${interaction.path}${query ? `?${query}` : ''}`;

    const response = await fetch(url, {
      method: interaction.method,
      headers: interaction.requestHeaders,
      body: interaction.method === 'GET' || interaction.method === 'HEAD' ? undefined : interaction.body,
      redirect: 'manual',
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });

    const body = await response.text();
    return { status: response.status, headers, body };
  }
}

export interface HeaderDifference {
  name: string;
  before?: string;
  after?: string;
  changed: boolean;
}

export interface InteractionDiff {
  key: string;
  method: string;
  path: string;
  status: {
    before: number;
    after: number;
    changed: boolean;
  };
  headers: HeaderDifference[];
  body: {
    changed: boolean;
    differences: BodyDifference[];
  };
  /** Violations of the OpenAPI schema, when a spec is available. */
  schemaViolations: SchemaViolation[];
  /** Set when the replay itself failed. */
  error?: string;
  /** True when the interaction was not replayed. */
  skipped?: boolean;
}

export interface DiffSummary {
  total: number;
  changed: number;
  unchanged: number;
  failed: number;
  skipped: number;
}

export interface DiffReport {
  source: string;
  golden: string;
  interactions: InteractionDiff[];
  summary: DiffSummary;
}

export interface DiffOptions {
  /** Headers that are compared. Defaults to a small, stable set. */
  compareHeaders?: string[];
  /** Replay unsafe methods too (POST, PUT, PATCH, DELETE). */
  replayAll?: boolean;
  /** Spec used to validate the new responses. */
  spec?: ApiSpec;
}

const DEFAULT_COMPARE_HEADERS = ['content-type', 'location', 'etag', 'cache-control'];

/** Methods that are safe to replay without changing server state. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function matchOperation(spec: ApiSpec, method: string, pathname: string): Operation | undefined {
  const upper = method.toUpperCase();
  for (const pathItem of spec.paths) {
    const { regex } = compilePath(pathItem.path);
    if (!regex.test(pathname)) continue;
    for (const operation of pathItem.operations) {
      if (operation.method.toUpperCase() === upper) return operation;
    }
  }
  return undefined;
}

/** Validate a live response body against the documented schema. */
export function validateAgainstSpec(spec: ApiSpec, operation: Operation | undefined, response: LiveResponse): SchemaViolation[] {
  if (!operation) return [];

  const documented = [...operation.responses.values()].find((entry) => Number(entry.status) === response.status);
  if (!documented) return [];

  const mediaType =
    documented.content.get('application/json') ??
    [...documented.content.values()].find((entry) => entry.contentType.includes('json'));
  if (!mediaType?.schema) return [];

  const body = parseBody(response.body, response.headers['content-type']?.includes('json') ? 'json' : 'text');
  if (body === undefined) return [];

  const schema = followRef(spec.raw, mediaType.schema);
  const expanded = deref(spec.raw, schema);
  return validateSchema(body, expanded);
}

/** Compare a golden file against a live source. */
export async function compareGolden(
  golden: GoldenFile,
  source: LiveSource,
  options: DiffOptions = {},
): Promise<DiffReport> {
  const compareHeaders = options.compareHeaders ?? DEFAULT_COMPARE_HEADERS;
  const interactions: InteractionDiff[] = [];

  for (const interaction of golden.interactions) {
    const key = `${interaction.method} ${interaction.path}`;

    if (!options.replayAll && !SAFE_METHODS.has(interaction.method.toUpperCase())) {
      interactions.push({
        key,
        method: interaction.method,
        path: interaction.path,
        status: { before: interaction.status, after: interaction.status, changed: false },
        headers: [],
        body: { changed: false, differences: [] },
        schemaViolations: [],
        skipped: true,
      });
      continue;
    }

    let live: LiveResponse;
    try {
      live = await source.request(interaction);
    } catch (error) {
      interactions.push({
        key,
        method: interaction.method,
        path: interaction.path,
        status: { before: interaction.status, after: 0, changed: true },
        headers: [],
        body: { changed: false, differences: [] },
        schemaViolations: [],
        error: (error as Error).message,
      });
      continue;
    }

    const headerDiffs: HeaderDifference[] = [];
    for (const name of compareHeaders) {
      const before = interaction.responseHeaders[name] ?? interaction.responseHeaders[name.toLowerCase()];
      const after = live.headers[name];
      if (before === undefined && after === undefined) continue;
      headerDiffs.push({
        name,
        before,
        after,
        changed: before !== after,
      });
    }

    const beforeBody = parseBody(interaction.body, interaction.bodyType);
    const afterBody = parseBody(live.body, live.headers['content-type']?.includes('json') ? 'json' : 'text');
    const differences = diffJson(beforeBody, afterBody);

    const operation = options.spec
      ? matchOperation(options.spec, interaction.method, interaction.path)
      : undefined;
    const schemaViolations = validateAgainstSpec(options.spec as ApiSpec, operation, live);

    interactions.push({
      key,
      method: interaction.method,
      path: interaction.path,
      status: {
        before: interaction.status,
        after: live.status,
        changed: live.status !== interaction.status,
      },
      headers: headerDiffs,
      body: { changed: differences.length > 0, differences },
      schemaViolations,
    });
  }

  const summary: DiffSummary = { total: interactions.length, changed: 0, unchanged: 0, failed: 0, skipped: 0 };
  for (const interaction of interactions) {
    if (interaction.skipped) {
      summary.skipped += 1;
      continue;
    }
    if (interaction.error) {
      summary.failed += 1;
      continue;
    }
    const changed =
      interaction.status.changed ||
      interaction.body.changed ||
      interaction.headers.some((header) => header.changed) ||
      interaction.schemaViolations.length > 0;
    if (changed) summary.changed += 1;
    else summary.unchanged += 1;
  }

  return {
    source: source.description,
    golden: golden.target,
    interactions,
    summary,
  };
}

/** True when the diff report contains anything worth failing a build on. */
export function hasBreakingChanges(report: DiffReport): boolean {
  return report.summary.changed > 0 || report.summary.failed > 0;
}

/** Group differences by the rule-like category for reporting. */
export function summariseDifferences(interaction: InteractionDiff): string[] {
  const out: string[] = [];
  if (interaction.error) out.push(`request failed: ${interaction.error}`);
  if (interaction.status.changed) {
    out.push(`status changed ${interaction.status.before} → ${interaction.status.after}`);
  }
  for (const header of interaction.headers) {
    if (!header.changed) continue;
    out.push(`header "${header.name}" changed ${header.before ?? '(absent)'} → ${header.after ?? '(absent)'}`);
  }
  if (interaction.body.changed) {
    const first = interaction.body.differences[0];
    const extra = interaction.body.differences.length - 1;
    out.push(
      `body changed in ${interaction.body.differences.length} place${interaction.body.differences.length === 1 ? '' : 's'}` +
        (first ? ` (first: ${first.kind} ${first.path})` : '') +
        (extra > 0 ? ` and ${extra} more` : ''),
    );
  }
  for (const violation of interaction.schemaViolations) {
    out.push(`schema violation at ${violation.path || '/'}: ${violation.message}`);
  }
  return out;
}

/** Build a human readable summary of a diff report. */
export function describeReport(report: DiffReport): string {
  const parts: string[] = [];
  if (report.summary.changed) parts.push(`${report.summary.changed} changed`);
  if (report.summary.unchanged) parts.push(`${report.summary.unchanged} unchanged`);
  if (report.summary.failed) parts.push(`${report.summary.failed} failed`);
  if (report.summary.skipped) parts.push(`${report.summary.skipped} skipped`);
  return parts.join(', ');
}

/** Only used by the JSON reporter to keep the shape stable. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}
