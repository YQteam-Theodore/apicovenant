

import { parseArgs } from 'node:util';

import { bold, dim, red } from '../util/ansi.ts';
import { TOOL_NAME, VERSION } from '../version.ts';
import {
  DIFF_HELP,
  LINT_HELP,
  MAIN_HELP,
  MOCK_HELP,
  RECORD_HELP,
  RULES_HELP,
} from './help.ts';
import { UsageError, describeError, parseInteger, parseSeverity, splitList } from './common.ts';
import { renderRuleCatalogue, runLint } from './commands/lint.ts';
import { runMock } from './commands/mock.ts';
import { runRecord } from './commands/record.ts';
import { runDiff } from './commands/diff.ts';

const OPTIONS = {
  format: { type: 'string' },
  output: { type: 'string' },
  rules: { type: 'string' },
  ignore: { type: 'string' },
  severity: { type: 'string' },
  'fail-on': { type: 'string' },
  'list-rules': { type: 'boolean' },
  port: { type: 'string' },
  host: { type: 'string' },
  latency: { type: 'string' },
  target: { type: 'string' },
  out: { type: 'string' },
  spec: { type: 'string' },
  golden: { type: 'string' },
  'max-requests': { type: 'string' },
  duration: { type: 'string' },
  'replay-all': { type: 'boolean' },
  category: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

type ParsedValues = Partial<Record<keyof typeof OPTIONS, string | boolean | undefined>>;

function parse(argv: string[]): { values: ParsedValues; positionals: string[] } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: OPTIONS,
    strict: true,
  });
  return { values: values as ParsedValues, positionals };
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asBoolean(value: string | boolean | undefined): boolean {
  return value === true;
}

function requireFormat(value: string | undefined, allowed: string[], fallback: string): string {
  if (!value) return fallback;
  if (!allowed.includes(value)) {
    throw new UsageError(`invalid format "${value}" (expected ${allowed.join(' or ')})`);
  }
  return value;
}

export async function run(argv: string[]): Promise<number> {
  let parsed: { values: ParsedValues; positionals: string[] };

  try {
    parsed = parse(argv);
  } catch (error) {
    process.stderr.write(`${red('error')} ${describeError(error)}\n\n${MAIN_HELP}`);
    return 2;
  }

  const { values, positionals } = parsed;
  const command = positionals[0];

  if (asBoolean(values.version)) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (!command || asBoolean(values.help)) {
    const help = command === 'lint'
      ? LINT_HELP
      : command === 'mock'
        ? MOCK_HELP
        : command === 'record'
          ? RECORD_HELP
          : command === 'diff'
            ? DIFF_HELP
            : command === 'rules'
              ? RULES_HELP
              : MAIN_HELP;
    process.stdout.write(help);
    return 0;
  }

  try {
    switch (command) {
      case 'lint':
        return await runLint({
          document: positionals[1] ?? '',
          format: requireFormat(asString(values.format), ['text', 'json', 'html'], 'text') as 'text' | 'json' | 'html',
          output: asString(values.output),
          rules: splitList(asString(values.rules)),
          ignore: splitList(asString(values.ignore)),
          severity: parseSeverity(asString(values.severity), 'info'),
          failOn: (asString(values['fail-on']) ?? 'error') as 'error' | 'warn' | 'never',
          listRules: asBoolean(values['list-rules']),
        });

      case 'mock':
        return await runMock({
          document: positionals[1] ?? '',
          host: asString(values.host) ?? '127.0.0.1',
          port: parseInteger(asString(values.port), 0, 'port'),
          latency: parseInteger(asString(values.latency), 0, 'latency'),
        });

      case 'record':
        return await runRecord({
          target: asString(values.target) ?? '',
          out: asString(values.out) ?? '',
          spec: asString(values.spec),
          host: asString(values.host) ?? '127.0.0.1',
          port: parseInteger(asString(values.port), 0, 'port'),
          maxRequests: asString(values['max-requests'])
            ? parseInteger(asString(values['max-requests']), 0, 'max-requests')
            : undefined,
          durationSeconds: asString(values.duration)
            ? parseInteger(asString(values.duration), 0, 'duration')
            : undefined,
        });

      case 'diff':
        return await runDiff({
          golden: asString(values.golden) ?? '',
          target: asString(values.target),
          spec: asString(values.spec),
          format: requireFormat(asString(values.format), ['text', 'json'], 'text') as 'text' | 'json',
          replayAll: asBoolean(values['replay-all']),
          failOn: (asString(values['fail-on']) ?? 'changed') as 'changed' | 'never',
        });

      case 'rules': {
        const format = requireFormat(asString(values.format), ['text', 'json'], 'text');
        process.stdout.write(
          renderRuleCatalogue(asString(values.category), format as 'text' | 'json'),
        );
        return 0;
      }

      default:
        process.stderr.write(`${red('error')} unknown command "${command}"\n\n${MAIN_HELP}`);
        return 2;
    }
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${red('error')} ${error.message}\n`);
      return 2;
    }
    process.stderr.write(`${red('error')} ${describeError(error)}\n`);
    return 3;
  }
}

export async function main(): Promise<void> {
  const code = await run(process.argv.slice(2));
  process.exitCode = code;
}
