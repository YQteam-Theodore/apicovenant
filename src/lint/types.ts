/**
 * Rule framework types shared by every lint rule.
 */

import type { ApiSpec } from '../spec/model.ts';

export type Severity = 'error' | 'warn' | 'info';

export const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

export interface Finding {
  /** Identifier of the rule that produced the finding. */
  ruleId: string;
  severity: Severity;
  /** Human readable description of the problem. */
  message: string;
  /** JSON Pointer into the OpenAPI document. */
  path: string;
  /** Operation key such as `GET /users/{id}` when the finding is operation scoped. */
  operation?: string;
  /** Optional "how to fix" guidance. */
  hint?: string;
}

export interface RuleReport {
  severity?: Severity;
  message: string;
  path: string;
  operation?: string;
  hint?: string;
}

export interface RuleContext {
  spec: ApiSpec;
  report(finding: RuleReport): void;
}

export interface RuleDefinition {
  /** Stable, kebab-case rule identifier. */
  id: string;
  /** Short title shown in `apicovenant rules` output. */
  title: string;
  /** One paragraph explaining what the rule enforces and why. */
  description: string;
  /** Default severity; individual findings may override it. */
  severity: Severity;
  /** Grouping used by the reporter, e.g. `operations`, `responses`. */
  category: string;
  /** Extra searchable keywords. */
  keywords?: string[];
  /** The check itself. */
  check(context: RuleContext): void;
}

export interface LintOptions {
  /** Only run these rule ids. */
  rules?: string[];
  /** Never run these rule ids. */
  ignore?: string[];
  /** Drop findings below this severity. */
  minSeverity?: Severity;
}

export interface LintResult {
  findings: Finding[];
  counts: Record<Severity, number>;
  total: number;
  /** Rules that actually ran. */
  executed: string[];
}
