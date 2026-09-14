# Switch-Router Tests

Vitest suite covering the translator layer, provider config, DB layer, and API handlers.

**~1250 tests across 143 files. Full run ~18s, fast lane ~13s.**

The full QA process — lanes, the regression gate, triage rules — is documented in
[`docs/QA-WORKFLOW.md`](../docs/QA-WORKFLOW.md). This file is just the quick reference.

## Setup

Node **24** required (see `.nvmrc` — Node 22 breaks `better-sqlite3` native bindings).

```bash
npm install     # from repo root — tests import src/ and open-sse/
cd tests && npm install
```

## Commands

Run from `tests/`:

| Command | What it does |
|---------|--------------|
| `npm run test:fast` | Skips benchmarks + network tests. Expected known failures remain; use the gate for pass/fail. |
| `npm test` | Everything, including benchmarks and known failures. |
| `npm run gate` | Runs the deterministic lane, then fails only on pass→fail regressions. **What CI enforces.** |
| `npm run test:watch` | Watch mode. |
| `npm run test:live` | Real provider API calls. Needs credentials. |
| `npm run test:bench` | DB benchmarks. Measures performance, not correctness. |
| `npm run profile` | Slowest files + failure clusters from the last report. |

Single file:

```bash
npx vitest run unit/embeddingsCore.test.js --reporter=verbose
```

## Layout

| Path | Contents |
|------|----------|
| `unit/` | 123 files — handlers, DB, providers, OAuth, translators |
| `translator/` | Format conversion; `__snapshots__/` holds golden URL/header fixtures |
| `translator/real/` | Live provider calls — excluded from the fast lane |
| `__baseline__/` | Regression gate: `known-fails.txt`, verifier scripts, snapshots |

## The gate, in one line

A pre-existing failure listed in `__baseline__/known-fails.txt` is tolerated; a test
that goes **pass → fail** blocks the merge. Don't bulk-regenerate the baseline to get
green — that turns the gate into decoration.
