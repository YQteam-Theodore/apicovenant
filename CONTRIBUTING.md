# Contributing to apicovenant

Thanks for taking the time. This document explains how the project is put
together and what a good contribution looks like.

## Getting started

```bash
git clone https://github.com/apicovenant/apicovenant.git
cd apicovenant
node --test
```

There is **no build step and no install step**. The tool is TypeScript executed
directly by Node's native type stripping, and it has no runtime dependencies.
You only need Node.js ≥ 22.18.

```bash
node --test                      # run the whole suite
node --test test/lint.test.ts    # run one file
node --test --watch              # re-run on change
node bin/apicovenant.mjs lint examples/shop.openapi.yaml   # try it out
node scripts/release-check.mjs   # the checks a release depends on
```

### The three gates

A change is ready when all three pass:

| Gate | Command | Checks |
| --- | --- | --- |
| Tests | `node --test` | Behaviour, including that every rule fires on a fixture |
| Types | `npx tsc --noEmit` | `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `erasableSyntaxOnly` |
| Release check | `node scripts/release-check.mjs` | Rule catalogue vs docs, README claims, links, published file list, dead exports, leftovers |

`erasableSyntaxOnly` matters here: it guarantees the source can be executed by
Node without a compiler, which is what makes the zero-build promise real.

## Project layout

```
src/
  yaml/      YAML subset parser
  spec/      document loading, $ref resolution, the normalized model
  lint/      the rule engine and the rule catalogue
  mock/      the spec driven mock server
  record/    the recording proxy and the golden file format
  diff/      contract diffing
  report/    terminal, JSON and HTML reports
  cli/       argument parsing and command dispatch
test/        the test suite, one file per area
examples/    a clean reference contract and a deliberately broken one
```

## Adding a rule

Rules live in `src/lint/rules/`, grouped by category. A rule is a plain
object:

```ts
import type { RuleDefinition } from '../types.ts';

export const myRule: RuleDefinition = {
  id: 'my-rule-id',                 // kebab-case, stable, never reused
  title: 'One line summary',        // shown in `apicovenant rules`
  description: 'Why this matters.',  // shown in `apicovenant rules`
  severity: 'warn',                 // error | warn | info
  category: 'operations',
  check({ spec, report }) {
    for (const operation of spec.operations) {
      if (!operation.summary) {
        report({
          message: `${operation.key} has no summary`,
          path: operation.pointer,   // JSON Pointer into the document
          operation: operation.key,
          hint: 'Add a summary.',
        });
      }
    }
  },
};
```

Then register it in `src/lint/rules/index.ts`.

Rules that hold for the whole document (rather than one operation) can use
`spec.raw`, `spec.components` or `spec.info` directly.

**A rule must be:**

- **Explainable.** The message says what is wrong, the hint says what to do.
- **Addressable.** The `path` is a JSON Pointer into the document.
- **Quiet by default.** Report a problem once, not once per symptom.
- **Documented.** Add it to `docs/rules.md` and to the README table.

## Style

- TypeScript, strict mode, no `any` unless there is no alternative.
- Comments explain *why*, not *what*. The code says what.
- Prefer small functions with names that read like sentences.
- Keep the runtime dependency count at **zero**. If you need a new capability,
  implement it in `src/` — that is the point of this project.
- Two spaces per indent, single quotes, semicolons, trailing commas.
- Files end with a newline.

## Tests

Every change needs a test. The suite uses the built-in Node test runner:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('does the thing', () => {
  assert.equal(doTheThing(), 'expected');
});
```

### The example contracts

`examples/` holds three OpenAPI documents that the test suite lints:

| File | Purpose |
| --- | --- |
| `shop.openapi.yaml` | The reference contract. It must produce **zero** findings. |
| `legacy.openapi.yaml` | A realistic but inconsistent API. It must produce errors. |
| `violations.openapi.yaml` | A fixture that breaks every convention at once. |

`test/rules.test.ts` asserts that **every rule fires on at least one of the
three**. If you add a rule, extend a fixture so it fires — otherwise the rule
can silently break without any test noticing.

If a new rule fires on `shop.openapi.yaml`, either the rule is wrong or the
reference contract needs updating. Decide deliberately and say why in the pull
request.

Two contracts are worth protecting:

- `examples/shop.openapi.yaml` must produce **zero** findings. If a new rule
  fires on it, either the rule is wrong or the example needs updating — decide
  deliberately, and say why in the pull request.
- `examples/legacy.openapi.yaml` must keep producing findings from the
  categories it was written to exercise.

## Pull requests

1. Branch from `main`.
2. Keep the change focused; unrelated refactors make review harder.
3. Make sure `node --test` passes.
4. Update the documentation: `README.md`, `README.zh-CN.md`, `docs/rules.md`.
5. Add a `CHANGELOG.md` entry under *Unreleased*.
6. Open the pull request and describe **what** changed and **why**.

## Reporting bugs

Open an issue with the OpenAPI document (or the reduced version of it), the
command you ran, what you expected and what happened. A failing rule is much
easier to fix with a minimal document attached.

## Code of conduct

By participating you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).
