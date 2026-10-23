

import { writeTextFile } from '../../util/fs.ts';
import { lint, allRules, findRule } from '../../lint/engine.ts';
import { renderTextReport } from '../../report/text.ts';
import { renderJsonReport } from '../../report/json.ts';
import { renderHtmlReport } from '../../report/html.ts';
import { bold, dim, green, red, yellow } from '../../util/ansi.ts';
import { TOOL_NAME, VERSION } from '../../version.ts';
import { loadSpec, UsageError } from '../common.ts';
import type { Severity } from '../../lint/types.ts';

export interface LintCommandOptions {
  document: string;
  format: 'text' | 'json' | 'html';
  output?: string;
  rules?: string[];
  ignore?: string[];
  severity: Severity;
  failOn: 'error' | 'warn' | 'never';

  listRules?: boolean;
}

export async function runLint(options: LintCommandOptions): Promise<number> {
  if (options.listRules) {
    process.stdout.write(renderRuleCatalogue(undefined, options.format === 'json' ? 'json' : 'text'));
    return 0;
  }

  const spec = await loadSpec(options.document);

  const unknown = (options.rules ?? []).filter((id) => !findRule(id));
  if (unknown.length > 0) {
    throw new UsageError(
      `unknown rule${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. Run "apicovenant rules" for the catalogue.`,
    );
  }

  const result = lint(spec, {
    rules: options.rules,
    ignore: options.ignore,
    minSeverity: options.severity,
  });

  let report: string;
  if (options.format === 'json') {
    report = renderJsonReport({
      tool: TOOL_NAME,
      version: VERSION,
      document: spec.document,
      findings: result.findings,
    });
  } else if (options.format === 'html') {
    report = renderHtmlReport({
      tool: TOOL_NAME,
      version: VERSION,
      document: spec.document,
      findings: result.findings,
      title: `${spec.info.title} — contract report`,
    });
  } else {
    report = renderTextReport({
      document: spec.document,
      findings: result.findings,
      successMessage: `${spec.info.title} v${spec.info.version} follows every convention.`,
      groupByRule: true,
    });
  }

  if (options.output) {
    await writeTextFile(options.output, report);
    const summary = `${result.counts.error} errors, ${result.counts.warn} warnings, ${result.counts.info} info`;
    process.stdout.write(`${green('✓')} report written to ${bold(options.output)} ${dim(`(${summary})`)}\n`);
  } else {
    process.stdout.write(`${report}\n`);
  }

  if (options.failOn === 'never') return 0;
  if (options.failOn === 'warn') {
    if (result.counts.error > 0 || result.counts.warn > 0) return 1;
    return 0;
  }
  if (result.counts.error > 0) return 1;
  return 0;
}

export function renderRuleCatalogue(category?: string, format: 'text' | 'json' = 'text'): string {
  const rules = [...allRules()].sort((a, b) => a.id.localeCompare(b.id));
  const selected = category ? rules.filter((rule) => rule.category === category) : rules;

  if (format === 'json') {
    return `${JSON.stringify(
      selected.map((rule) => ({
        id: rule.id,
        title: rule.title,
        severity: rule.severity,
        category: rule.category,
        description: rule.description,
      })),
      null,
      2,
    )}\n`;
  }

  const lines: string[] = [];
  const byCategory = new Map<string, typeof selected>();
  for (const rule of selected) {
    const list = byCategory.get(rule.category) ?? [];
    list.push(rule);
    byCategory.set(rule.category, list);
  }

  for (const [cat, list] of byCategory) {
    lines.push(bold(cat));
    lines.push('');
    for (const rule of list) {
      const severity =
        rule.severity === 'error' ? red('error') : rule.severity === 'warn' ? yellow('warn ') : dim('info ');
      lines.push(`  ${severity}  ${rule.id}`);
      lines.push(`        ${rule.title}`);
    }
    lines.push('');
  }

  lines.push(dim(`${selected.length} rules in ${byCategory.size} categories`));
  return lines.join('\n');
}
