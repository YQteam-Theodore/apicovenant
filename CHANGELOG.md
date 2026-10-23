# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-10-23

The first release. One CLI, four commands, zero runtime dependencies.

### Added

- A logo: `assets/logo.svg` (mark), `assets/logo-mono.svg` (dark mode) and
  `assets/icon.svg` (app icon), with PNG exports. The mark is a square
  spiral whose inner arm folds diagonally towards a marked endpoint — a
  contract walked from one end to the other. It is drawn in graphite
  (#18181B) and deliberately avoids the hexagon, shield and rounded-square
  containers that are already crowded in the security and developer-tools
  categories.
- **`apicovenant lint`** — 42 design-convention rules across 8 categories
  (document, operations, paths, parameters, responses, schemas, security,
  pagination). Every finding carries a JSON Pointer into the document and a
  hint on how to fix it.
  - Reports in `text`, `json` and a self-contained `html` format.
  - `--rules`, `--ignore`, `--severity`, `--fail-on` and `--output` for
    fine-grained control.
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
  against the documented schema.
- **`apicovenant rules`** — the rule catalogue, as text or JSON.
- A YAML 1.2 subset parser, a JSON Schema validator and an example generator,
  so that the tool runs on a bare Node.js installation with nothing to install.
- OpenAPI 3.0 and 3.1 support, including `$ref` resolution with cycle
  detection.
- A reference contract (`examples/shop.openapi.yaml`) that passes the linter
  with zero findings, and a deliberately inconsistent one
  (`examples/legacy.openapi.yaml`) for demonstrating the rules.
- 92 tests covering the parser, the model, the rules, the mock server, the
  recorder, the diff engine, the reports and the command line interface.

### Changed

- The project is licensed under the **Apache License 2.0** instead of MIT.
  A `NOTICE` file carries the attribution.
- The source code carries no comments. The behaviour is documented in
  `README.md`, `docs/rules.md` and `CONTRIBUTING.md` instead.

[Unreleased]: https://github.com/apicovenant/apicovenant/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/apicovenant/apicovenant/releases/tag/v0.1.0
