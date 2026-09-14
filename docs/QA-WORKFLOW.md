# QA Workflow — Switch-Router

The operating procedure for testing and quality gates. Optimized for a **fast
inner loop** (seconds) and a **strict outer gate** (CI).

---

## 1. Prerequisites

Node **24** is required and pinned in `.nvmrc` / `package.json#engines`.

This matters: `better-sqlite3` ships a native binary compiled against a specific
`NODE_MODULE_VERSION`. Running on Node 22 makes DB-backed tests fail with
`ERR_DLOPEN_FAILED` — a toolchain problem that looks exactly like a code bug and
costs an hour to diagnose. Pin the version and it cannot happen.

```bash
nvm use            # reads .nvmrc
npm install             # root deps — tests import from src/ and open-sse/
cd tests && npm install # test deps
```

---

## 2. The four lanes

| Lane | Command | Runtime | When |
|------|---------|---------|------|
| **Fast** | `npm run test:fast` | ~13s | Every save / before every commit |
| **Full** | `npm test` | ~18s | Before pushing |
| **Gate** | `npm run gate` | ~18s | What CI enforces |
| **Live** | `npm run test:live` | varies | Only when touching provider integrations |
| **Bench** | `npm run test:bench` | ~25s | Only when touching the DB layer |

All commands run from `tests/`.

The **fast lane** excludes benchmarks, concurrency, and network tests. It is the
input to the regression gate, not a standalone green-suite requirement: currently
catalogued failures remain expected until they are fixed.

---

## 3. The regression gate

The gate is the core quality mechanism. It does **not** demand a green suite —
it forbids *new* breakage:

```bash
cd tests && npm run gate
```

- A test that already fails and is listed in `__baseline__/known-fails.txt` → tolerated.
- A test that went **pass → fail** → **blocks the merge**.
- A brand-new test that fails → blocks the merge.

This lets the team ship against a suite that has known-broken corners without
either ignoring failures wholesale or being forced to fix everything at once.

### Updating the baseline

Only after a failure is **genuinely fixed** or **consciously accepted**:

```bash
cd tests && npm run test:report
# inspect tests/.vitest-reports/current-results.json, then edit __baseline__/known-fails.txt
```

Never bulk-regenerate the baseline to make the gate pass. That converts the gate
into decoration.

---

## 4. Provider drift check

```bash
node scripts/qa-provider-drift.mjs
```

Catches tests referencing providers deleted from `open-sse/config/providers.js`.
This is not hypothetical: removing six providers in v0.5.0 left 12 obsolete
snapshots and one silent pass → fail regression behind.

**When retiring a provider, do all four in the same commit:**

1. Remove it from `open-sse/config/providers.js`
2. Remove or rewrite its test cases
3. Refresh snapshots — `vitest run -u`
4. Add the id to `REMOVED_LIST` in `scripts/qa-provider-drift.mjs`

---

## 5. Diagnosing a slow suite

```bash
cd tests && npm run test:report && npm run profile
```

Prints the 12 slowest files and where failures cluster. Test time is heavily
Pareto-distributed here — the top 10 files account for ~86% of total file time —
so this is the only reliable place to start optimizing.

---

## 6. Triage rules

Before "fixing" a failing test, classify it. Skipping this step is how an
environment problem gets misdiagnosed as a code bug.

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `ERR_DLOPEN_FAILED`, `NODE_MODULE_VERSION` | Wrong Node version | `nvm use` then `npm rebuild` |
| Fails in full run, passes alone | Test pollution / shared state | Isolate the shared fixture |
| References a removed provider | Registry drift | Delete the case, run the drift check |
| `N obsolete` snapshots | Stale fixtures | `vitest run -u` |
| Fails alone **and** in full run | Real defect | Fix the code |

Always reproduce in isolation first:

```bash
cd tests && npx vitest run path/to/file.test.js --reporter=verbose
```

---

## 7. CI pipeline

`.github/workflows/qa.yml` runs four jobs, ordered cheapest-first so feedback
arrives fast:

1. **Lint** — ESLint; existing warnings are reported but do not block the job
2. **Test** — deterministic non-network lane, then the regression gate (the gate decides pass/fail, not the raw suite)
3. **Drift** — orphaned provider references
4. **Build** — `npm run build`, gated behind lint

The cross-platform gate always writes the JSON report before comparing it with
`known-fails.txt`. Concurrency is capped so superseded commits get cancelled
instead of burning runner minutes.

---

## 8. Definition of done

- [ ] `npm run test:fast` has no unexpected failures
- [ ] `npm run gate` reports no regression
- [ ] `node scripts/qa-provider-drift.mjs` is clean
- [ ] No new obsolete snapshots
- [ ] New behavior has a test; fixed bugs have a regression test
