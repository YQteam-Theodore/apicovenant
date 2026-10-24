# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

From 1.0.0 onwards the public API, the CLI flags and the file formats are
stable. Anything that changes them will be announced here under a heading that
says so.

## [Unreleased]

## [1.0.0] — 2026-10-23

The first stable release. One CLI, four commands, zero runtime dependencies.

Released by **YQteam** (<https://yq-tuandui.xyz>), Apache-2.0.

### Added

- **`apicovenant lint`** — 42 design-convention rules across 8 categories
  (document, operations, paths, parameters, responses, schemas, security,
  pagination). Every finding carries a JSON Pointer into the document and a
  hint on how to fix it.
  - Reports in `text`, `json` and a self-contained `html` format.
  - `--rules`, `--ignore`, `--severity`, `--fail-on` and `--output` for
  - fine-grained control.
- **`apicovenant mock`** — a mock server generated from the OpenAPI document.
  Payloads come from the documented example when there is one and are derived
  deterministically from the schema otherwise, so repeated runs are identical.
  `?x-mock-status=` forces a status code and `/_apicovenant/routes` returns the
  route table.
- **`apicovenant record`** — a recording proxy that captures real traffic into
  a golden file. Credentials are redacted before anything is written to disk.
- **`apicovenant diff`** — replays a golden file against a live API or a mock
  and reports behaviour drift: status codes, headers and body differences
  addressed by JSON Pointer. Only safe methods are replayed unless
  `--replay-all` is given. With `--spec`, responses are additionally validated
  against the documented schema. The report can be written as `html`. A mock
  built from that spec can only confirm itself, so its own schema problems are
  listed separately and never counted as drift.
- **`apicovenant rules`** — the rule catalogue, as text or JSON.
- **`apicovenant init`** — writes a starter configuration file.
- **`apicovenant mcp`** — serves the contract tools over the Model Context
  Protocol, so an AI agent can lint a document, read the rule catalogue, list
  the operations of an API, ask for an example payload and check for contract
  drift. The protocol is implemented directly against the specification, so no
  MCP SDK is pulled in and the runtime dependency count stays at zero. See
  [docs/mcp.md](docs/mcp.md).
- **Configuration files** — `apicovenant.config.json`, the YAML equivalents,
  `.apicovenantrc.*`, or an `apicovenant` key in `package.json`. Unknown
  settings are an error, so a typo can never silently disable a check. See
  [docs/configuration.md](docs/configuration.md).
- **Baselines** — record the findings that already exist so the command only
  fails on new ones. This is what makes the linter adoptable on an existing
  codebase. See [docs/baseline.md](docs/baseline.md).
- A YAML 1.2 subset parser, a JSON Schema validator and an example generator,
  so that the tool runs on a bare Node.js installation with nothing to install.
- OpenAPI 3.0 and 3.1 support, including `$ref` resolution with cycle
  detection.
- A reference contract (`examples/shop.openapi.yaml`) that passes the linter
  with zero findings, a deliberately inconsistent one
  (`examples/legacy.openapi.yaml`) and a fixture that breaks every convention
  at once (`examples/violations.openapi.yaml`).
- `src/index.ts` exports the whole tool, so it can be used as a library.
- `npm run release-check` runs the checks a release depends on: the rule
  catalogue against `docs/rules.md`, the README claims against reality, every
  relative link, the published file list, unused exports and leftover debug
  markers.

### Fixed

- The mock payload could violate the schema it was generated from. A schema
  nested deeper than the generator descends into was truncated to an empty
  object or an empty string, which broke `required` properties and enum
  members. The truncated value now keeps the required properties, an allowed
  enum value and the numeric bounds, so a mock always satisfies its own spec.
- The example generator matched keywords as substrings, so `country` and
  `discount` were answered with `"3"`. Keywords are matched on whole words
  now, and camel case is understood.
- The mock server closed idle keep-alive connections while the diff was
  validating the previous response, and the next request reused the dead
  socket and failed with `ECONNRESET`. Safe requests are retried once and the
  mock keeps its connections open.
- The global `Response` type resolved to an empty interface under
  `@types/node` without the DOM lib, so `fetch` responses had no `status`,
  `headers` or `text`. `lib` now includes `DOM`.
- The YAML parser registered an anchor under an `undefined` name when the
  capture group was missing.
- The HTML report read the severity out of the class list, so a row hidden by
  one filter could not be shown again by another. Every row now carries
  `data-severity`.
- `typescript` is declared as `^5.8.0`: the `erasableSyntaxOnly` compiler
  option used by the project does not exist in 5.6.

[Unreleased]: https://github.com/yqteam/apicovenant/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/yqteam/apicovenant/releases/tag/v1.0.0
