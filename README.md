# apicovenant

> **An OpenAPI contract guardian.** Lint the design conventions of your spec, mock it, record real traffic against it, and find out whether your next release changed the contract — with **zero runtime dependencies**.

[![npm](https://img.shields.io/npm/v/apicovenant.svg)](https://www.npmjs.com/package/apicovenant)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.18-5FA04E.svg)](https://nodejs.org)
[![dependencies](https://img.shields.io/badge/runtime%20dependencies-0-success.svg)](package.json)

[English](README.md) · [简体中文](README.zh-CN.md)

---

## The problem

Most teams own an OpenAPI document. Far fewer teams keep it honest.

The document drifts away from the implementation in three directions at once:

| Drift | What it costs you |
| --- | --- |
| **Design drift** — the spec is valid but inconsistent: four different error shapes, two pagination styles, paths that disagree on casing | Every consumer writes a per-endpoint workaround |
| **Spec drift** — the implementation moved on, the document did not | Clients generate against a contract nobody implements |
| **Behaviour drift** — the API returns something subtly different after a refactor | Production incidents that no test caught |

Existing tools cover one of these each: schema linters check that the document is *valid*, mock servers answer *from* the document, spec differs compare two versions of the document. None of them closes the loop from **spec → mock → recorded real traffic → regression diff**.

`apicovenant` does all four in one CLI.

## What it does

| Command | Purpose |
| --- | --- |
| `apicovenant lint` | Check **42 design-convention rules** that pure schema validators never look at |
| `apicovenant mock` | Serve a mock API generated from the spec, with realistic deterministic payloads |
| `apicovenant record` | Put a recording proxy in front of your API and capture traffic as a **golden file** |
| `apicovenant diff` | Replay the golden file against a live API and report **behaviour drift**, field by field |
| `apicovenant rules` | Browse the full rule catalogue |

## Why zero dependencies

`apicovenant` runs on a bare Node.js installation. There is no `npm install`, no build step, no `node_modules`, and nothing to audit before you let it touch your CI.

That means writing a few things ourselves — a YAML subset parser, a JSON Schema validator, a JSON Pointer diff — but it also means:

- **No supply chain risk.** The whole tool is the code in this repository.
- **No install step.** `node bin/apicovenant.mjs` is the entire setup.
- **Instant startup.** Nothing to compile, nothing to cache.
- **Readable source.** Every line of behaviour is in `src/`, not spread across a dependency tree.

The source is TypeScript and is executed directly by Node's native type stripping, so there is still no build step.

## Install

```bash
# run without installing
npx apicovenant lint openapi.yaml

# or install globally
npm install -g apicovenant
apicovenant lint openapi.yaml
```

Requires **Node.js ≥ 22.18** (for native TypeScript execution). The source is plain JavaScript-compatible TypeScript; `npm run typecheck` runs `tsc --noEmit` if you want static analysis.

## Quick start

```bash
# 1. check your contract
apicovenant lint openapi.yaml

# 2. get a mock to develop against
apicovenant mock openapi.yaml --port 4010

# 3. capture how your real API actually behaves
apicovenant record --target http://localhost:3000 --out traffic.golden.json

# 4. before you ship, replay it and see what moved
apicovenant diff --golden traffic.golden.json --target http://localhost:3000
```

## Linting

```console
$ apicovenant lint examples/legacy.openapi.yaml
4 errors · 15 warnings · 17 info

GET /create_stock_item

  error   operation-id-required
          GET /create_stock_item has no operationId
          paths./create_stock_item.get
          → Add a camelCase operationId such as "listUsers" or "createUser".

GET /stock_items

  error   response-status-valid
          "20O" is not a valid HTTP status code in GET /stock_items
          paths./stock_items.get.responses.20O
          → Use a three digit status code or "default".
```

Every finding carries a **JSON Pointer** into the document, so it is directly
actionable — and the same addressing scheme is used by the diff engine.

### The rules

42 rules across 8 categories. The full reference lives in [`docs/rules.md`](docs/rules.md).

| Category | Rules | What it protects |
| --- | --- | --- |
| `document` | 5 | Version, contact, license, HTTPS servers, declared tags |
| `operations` | 8 | `operationId` identity, summaries, tags, HTTP semantics |
| `paths` | 5 | kebab-case, no verbs, no trailing slash, path parameters |
| `parameters` | 4 | Required path parameters, duplicates, documentation |
| `responses` | 8 | Success responses, valid status codes, one error envelope |
| `schemas` | 7 | Naming consistency, unused components, array items |
| `security` | 3 | Declared schemes, scopes, no credentials in query strings |
| `pagination` | 2 | One pagination model, one collection envelope |

Highlights of what a schema validator will *not* tell you:

- `response-error-envelope` — every failure uses the same error schema
- `operation-id-naming` — `operationId` is camelCase and starts with a verb
- `pagination-consistency` — one endpoint pages with `limit/offset`, another with `cursor`
- `schema-property-naming-consistency` — the API does not mix `camelCase` and `snake_case`
- `path-no-verbs` — `/createUser` says the same thing twice
- `security-in-query` — an API key in the query string leaks into your access logs

### Reports

```bash
apicovenant lint openapi.yaml --format json --output report.json
apicovenant lint openapi.yaml --format html --output report.html
```

The HTML report is a **single self-contained file** — no CDN, no external fonts, no scripts from a third party. Attach it to a CI job or commit it to the repository.

### Selecting rules

```bash
# only the rules you care about
apicovenant lint openapi.yaml --rules operation-id-required,response-error-envelope

# silence noisy ones
apicovenant lint openapi.yaml --ignore schema-example-recommended,info-license-required

# only show problems
apicovenant lint openapi.yaml --severity error
```

## Mocking

```console
$ apicovenant mock examples/shop.openapi.yaml --port 4010
▶ Shop API v1.4.0 mocking examples/shop.openapi.yaml

  listening on  http://127.0.0.1:4010
  routes        11 operations
  route table   http://127.0.0.1:4010/_apicovenant/routes

  GET     /users
  GET     /users/{userId}
  POST    /users
  ...
```

Responses come from the documented example when there is one, and from a
**deterministic payload generated from the schema** when there is not — so two
runs of your mock produce byte-identical bodies.

```bash
# force a status code
curl 'http://127.0.0.1:4010/users?x-mock-status=404'

# see the route table
curl http://127.0.0.1:4010/_apicovenant/routes
```

## Recording and diffing

This is the part that answers *"did my change break the API?"*.

```console
$ apicovenant record --target http://localhost:3000 --out traffic.golden.json
▶ recording http://localhost:3000

  proxy   http://127.0.0.1:4011
  output  traffic.golden.json

  point your client at the proxy, then press Ctrl+C to stop
```

The golden file is deliberately boring JSON, so it reviews well in a pull request:

```json
{
  "apicovenant": 1,
  "recordedAt": "2026-10-23T18:04:11.204Z",
  "target": "http://localhost:3000",
  "spec": "examples/shop.openapi.yaml",
  "interactions": [
    {
      "method": "GET",
      "path": "/users",
      "query": { "page": "1" },
      "status": 200,
      "bodyType": "json",
      "body": "{\"items\":[...],\"total\":1}"
    }
  ]
}
```

Credentials are **redacted before anything is written to disk**.

Then replay it:

```console
$ apicovenant diff --golden traffic.golden.json --target http://localhost:3000
contract diff
  golden  traffic.golden.json
  source  http://localhost:3000

1 changed · 4 unchanged

✖ GET /users
  • status changed 200 → 500
  • body changed in 2 places (first: changed /items/0/total)
      total changed 42 → 0
      items changed 1 → 0

✓ GET /users/usr_1001

✖ the contract drifted — 1 changed, 4 unchanged
```

Safety is the default: **only safe methods are replayed**, so running a diff
never creates data on the target system. Pass `--replay-all` if you really
want `POST`, `PUT`, `PATCH` and `DELETE` replayed too.

You can also diff against the mock instead of a live server:

```bash
apicovenant diff --golden traffic.golden.json --spec examples/shop.openapi.yaml
```

When a spec is supplied, the new responses are additionally **validated against
the documented schema**, so a response that still parses but no longer matches
the contract is reported as a schema violation.

## CI integration

```yaml
- name: Check the API contract
  run: |
    npx apicovenant lint openapi.yaml --fail-on error
    npx apicovenant diff --golden traffic.golden.json --target "$API_URL"
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Findings above the threshold, or the contract drifted |
| `2` | Usage error (unknown flag, unknown rule, missing argument) |
| `3` | The document could not be read or parsed |

## How it is put together

```
src/
  yaml/        YAML 1.2 subset parser (no dependency)
  spec/        loader, $ref resolver, normalized operation model
  lint/        rule engine + the rule catalogue
  mock/        spec driven mock server
  record/      recording proxy + golden file format
  diff/        contract diffing with JSON Pointer paths
  report/      terminal, JSON and standalone HTML reports
  cli/         argument parsing and command dispatch
```

The linter, the mock server and the recorder all work against the **same**
normalized model of an OpenAPI document, so they can never disagree about what
an operation is.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the
workflow, the code style and how to add a rule.

```bash
git clone https://github.com/apicovenant/apicovenant.git
cd apicovenant
node --test
```

## License

[MIT](LICENSE) © apicovenant contributors
