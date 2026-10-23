/**
 * The golden file: a recorded snapshot of real API traffic.
 *
 * The format is intentionally boring JSON so it can be reviewed in a pull
 * request, diffed with `git diff` and understood without any tooling.
 */

export const GOLDEN_FORMAT_VERSION = 1;

export interface GoldenInteraction {
  method: string;
  /** Path without the query string, e.g. `/users/usr_1001`. */
  path: string;
  /** Query parameters as recorded. */
  query: Record<string, string>;
  requestHeaders: Record<string, string>;
  status: number;
  responseHeaders: Record<string, string>;
  /** Raw response body. */
  body: string;
  /** How the body should be interpreted. */
  bodyType: 'json' | 'text' | 'empty';
  /** Round trip duration in milliseconds. */
  durationMs: number;
}

export interface GoldenFile {
  /** Format version, so future releases can migrate old files. */
  apicovenant: number;
  /** ISO timestamp of the recording. */
  recordedAt: string;
  /** The base URL the traffic was recorded against. */
  target: string;
  /** Optional pointer to the OpenAPI document the traffic belongs to. */
  spec?: string;
  interactions: GoldenInteraction[];
}

export function createGoldenFile(target: string, spec?: string): GoldenFile {
  return {
    apicovenant: GOLDEN_FORMAT_VERSION,
    recordedAt: new Date().toISOString(),
    target,
    spec,
    interactions: [],
  };
}

/** Parse a golden file, validating the parts that matter. */
export function parseGoldenFile(text: string): GoldenFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`golden file is not valid JSON: ${(error as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('golden file must contain a JSON object');
  }

  const file = parsed as Partial<GoldenFile>;
  if (!Array.isArray(file.interactions)) {
    throw new Error('golden file is missing an "interactions" array');
  }
  if (file.apicovenant !== GOLDEN_FORMAT_VERSION) {
    throw new Error(
      `unsupported golden file format version ${String(file.apicovenant)} (expected ${GOLDEN_FORMAT_VERSION})`,
    );
  }

  return {
    apicovenant: GOLDEN_FORMAT_VERSION,
    recordedAt: typeof file.recordedAt === 'string' ? file.recordedAt : new Date().toISOString(),
    target: typeof file.target === 'string' ? file.target : '',
    spec: typeof file.spec === 'string' ? file.spec : undefined,
    interactions: file.interactions.map((entry) => ({
      method: String(entry.method ?? 'GET').toUpperCase(),
      path: String(entry.path ?? '/'),
      query: entry.query ?? {},
      requestHeaders: entry.requestHeaders ?? {},
      status: Number(entry.status ?? 0),
      responseHeaders: entry.responseHeaders ?? {},
      body: typeof entry.body === 'string' ? entry.body : '',
      bodyType: entry.bodyType ?? 'text',
      durationMs: Number(entry.durationMs ?? 0),
    })),
  };
}

/** Serialise a golden file with stable formatting. */
export function serializeGoldenFile(file: GoldenFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** A stable identifier for an interaction inside a golden file. */
export function interactionKey(interaction: { method: string; path: string; query?: Record<string, string> }): string {
  const query = Object.keys(interaction.query ?? {})
    .sort()
    .map((key) => `${key}=${(interaction.query as Record<string, string>)[key]}`)
    .join('&');
  return query ? `${interaction.method} ${interaction.path}?${query}` : `${interaction.method} ${interaction.path}`;
}
