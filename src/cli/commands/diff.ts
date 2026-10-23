

import { readTextFile } from '../../util/fs.ts';
import { parseGoldenFile } from '../../record/golden.ts';
import { startMockServer } from '../../mock/server.ts';
import {
  compareGolden,
  HttpLiveSource,
  MockLiveSource,
  type DiffReport,
  type LiveSource,
} from '../../diff/compare.ts';
import { renderDiffReport } from '../../report/diff.ts';
import { TOOL_NAME, VERSION } from '../../version.ts';
import { UsageError, loadSpec } from '../common.ts';

export interface DiffCommandOptions {
  golden: string;
  target?: string;
  spec?: string;
  format: 'text' | 'json';
  replayAll: boolean;
  failOn: 'changed' | 'never';
}

export async function runDiff(options: DiffCommandOptions): Promise<number> {
  if (!options.golden) throw new UsageError('--golden is required');
  if (!options.target && !options.spec) {
    throw new UsageError('either --target or --spec is required');
  }

  const golden = parseGoldenFile(await readTextFile(options.golden));

  let source: LiveSource;
  let mockHandle: { url: string; close(): Promise<void> } | undefined;
  let spec = undefined;

  if (options.spec) {
    spec = await loadSpec(options.spec);
    mockHandle = await startMockServer(spec);
    source = new MockLiveSource(mockHandle.url, `mock(${options.spec})`);
  } else {
    source = new HttpLiveSource(options.target as string);
  }

  const report: DiffReport = await compareGolden(golden, source, {
    replayAll: options.replayAll,
    spec,
  });

  if (mockHandle) await mockHandle.close();

  if (options.format === 'json') {
    process.stdout.write(
      `${JSON.stringify(
        {
          tool: TOOL_NAME,
          version: VERSION,
          generatedAt: new Date().toISOString(),
          ...report,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(`${renderDiffReport({ report, goldenFile: options.golden })}\n`);
  }

  if (options.failOn === 'never') return 0;
  if (report.summary.changed > 0 || report.summary.failed > 0) return 1;
  return 0;
}
