# Archive Report: document-and-refactor

**Change**: document-and-refactor  
**Project**: ha-status-bot  
**Archived**: 2026-09-11  
**Branch / HEAD at archive**: `test/telegram-seam-and-coverage` @ `f72dffd`  
**Repository**: /Users/joaquinhegi/Dev/ha-status-bot  

## Artifact Store Mode: Hybrid

Both OpenSpec filesystem operations and Engram persistence were performed.

### Artifact IDs (Engram Traceability)

- `sdd/document-and-refactor/proposal` — Engram #67
- `sdd/document-and-refactor/spec` — Engram #69 (8 delta specs)
- `sdd/document-and-refactor/design` — Engram #70 (REVISED, supersedes prior)
- `sdd/document-and-refactor/tasks` — Engram #73 (9 phases completed, phase 10 out of scope)
- `sdd/document-and-refactor/verify-report` — Engram #77 (final verification: PASS WITH WARNINGS, ready for archive)

## Final State at Closure

This archive report reflects the state of the change at the moment of close, per the Final-State Authority hierarchy. Final-state facts override intermediate snapshots.

### Source of Truth: The Persisted Verify Report (Engram #77)

The verify report is the authoritative record of compliance and completeness at close. Intermediate snapshots (`apply-progress`, earlier `verify-report` versions) documented work state at their time but are superseded by the final verification run.

**Verdict**: PASS WITH WARNINGS — READY FOR ARCHIVE

**Metrics**:
- 137 tests passing (node --test exit code 0)
- `npx biome check .` clean over 12 files
- `npm run check:lang` clean (no Spanish characters in src/**)
- Coverage: 94.77% lines / 90.75% branches / 93.10% functions
- 28/28 requirements compliant
- 33/33 scenarios compliant
- 8/8 capabilities PASS
- 0 CRITICAL findings
- 0 blockers

**Evidence base**: 
- Evidence tree hash: `sha256:ec7a7b8391fe7a575156442aa946363a0c733d3851fc41099349ff27817f3bd8`
- Tests exit code: 0
- Build/lint exit code: 0

### Task Completion Gate: PASS

All 80 implementation tasks are marked complete (`[x]`) in the persisted tasks artifact (`openspec/changes/archive/2026-09-11-document-and-refactor/tasks.md`). Zero unchecked tasks remain.

**Verification**:
```
rg -c '^\s*- \[ \]' tasks.md → 0 (no unchecked tasks)
rg -c '^\s*- \[x\]' tasks.md → 80 (all tasks complete)
```

### Capabilities Delivered

All 8 new capabilities are complete and passing final verification:

1. **ha-connection-config** — Supervisor token from environment; proxy URL by default; mutant M8 re-run: still killed (136/1)
2. **bot-authorization** — Chat-ID allow-list; entity-id membership validation; `/start`/`/help` gating; `/chatid` ungated; mutants M1, M3 re-run: still killed
3. **process-lifecycle** — SIGTERM/SIGINT graceful shutdown; unhandled error logging; startup validation
4. **code-quality-hygiene** — `npm ci` in Dockerfile; `engines`/`license` in package.json; Biome linting; single named constant per magic number; shared fetch+keyboard+error helper
5. **test-coverage** — Tests import real modules; no re-implemented production logic; new entity-id rejection path covered; SIGTERM/unhandledRejection handlers covered; 137/137 green
6. **bot-localization** — English-only user-facing copy; English logs and comments; 8 Spanish commands renamed to English with no aliases; **blocker CLOSED**: retired commands produce silence (8 table-driven tests, mutant M19 killed 136/1, mutant M20 killed 129/8)
7. **addon-configuration** — Options renamed and retyped; English description; version bumped to 2.0.0 (owner decision, overriding tasks artifact's 1.1.0)
8. **project-documentation** — README rewrite; command migration table; config migration note; testing section corrected; OPTIONS_PATH documented

### Key Final-State Facts (Outrank Intermediate Snapshots)

Per the launch context, the following facts override any stale claim in `apply-progress` or earlier `verify-report`:

#### Test Coverage and Build Status (FINAL)

**Baseline at closure**: 137 tests passing across 36 test suites.

```
$ node --test
ℹ tests 137
ℹ pass 137
ℹ fail 0
ℹ duration_ms 294.2965
(exit code 0)
```

**Build verification**:
```
$ npx biome check .
Checked 12 files in 31ms. No fixes applied.
(exit code 0)

$ npm run check:lang
check:lang passed — no Spanish characters found under src/**.
(exit code 0)
```

**Coverage unchanged** (byte-identical to prior run): 94.77 % lines / 90.75 % branches / 93.10 % functions. This is correct: the final verification commit added regression tests that assert the ABSENCE of behavior (retired commands produce silence), so no new lines of `src/` were exercised. A coverage rise would have been suspicious.

#### Two Real Defects Were Found and Fixed During This Change

Neither was in the original proposal scope:

1. **Commit `605726e` — Camera snapshot fallback silently broken by DRY consolidation (phase-6 / unit 4)**  
   The "behavior-neutral" consolidation of fetch retry+fallback logic at `src/haClient.js:99-123` moved a redundant path check into a private helper. The camera snapshot codepath returned early on a 200-but-empty response (Supervisor returning `200 OK` with zero bytes), disabling the fast proxy fallback. Fixed in same phase. Covered by regression tests in both directions: assert snapshot returns data when available, assert fallback is used when snapshot returns empty.

2. **Commit `6e7a9e0` — Tautological test masking defect in unit 2a**  
   The test at `tests/index.test.js:55-56` was written to compare `config.homeAssistant.baseUrl` against `HA_DEFAULT_BASE_URL`, which held for ANY value. Mutation probe M8 (replacing the constant with `homeassistant.local`) should have failed; it didn't. Test was rewritten to pin the literal on both sides. Mutation M8 re-run in final verification: still killed (136/1), proving fix holds.

#### Supervisor JWT Exposure and Revocation Requirement

**Status**: Removed from source in commit `50b2442` (phase 1, unit 1a). Never entered git history per `git log -S` on the exact token value.

**Operational action required**: The owner MUST revoke the exposed long-lived Supervisor token in Home Assistant (Profile → Long-lived access tokens) outside this code change. This is the highest-priority open item. The code change does not and cannot perform this action.

#### Version Bump

**Final version**: 2.0.0 (owner decision, overriding tasks artifact's forecasted 1.1.0). Justified by two user-visible breaking changes shipping together: English command names and option schema restructure.

#### Spec Amendment: bot-localization Scenario

**Amendment committed**: Commit `f72dffd` (final verification run trigger).

**Reason**: The scenario's original `THEN` clause described "unknown-command handling" for retired commands. This codebase has never had a catch-all `bot.on("message")` handler, making the clause unsatisfiable within the scope of this change. The amended clause states the actual behavior: retired commands produce no reply at all (silence).

**Legitimacy ruling** (per verify report Engram #77): The amendment is legitimate and carries forward correctly. Grounds:
- The normative MUST ("no Spanish alias registered") is untouched and is now better enforced by the committed test suite (8 table-driven tests; mutants M19/M20 prove they bite).
- The original clause described behavior that has never existed in this codebase (`rg 'bot.on(' src/telegram.js` returns only `callback_query` and `polling_error` — no generic message handler).
- The amended clause agrees with documentation already shipped in this change (`README.md:167-169` states the same silence behavior).
- The gap is recorded, not deleted. The amendment's block quote explicitly names the consequence and states the remedy (catch-all handler with rename mapping) as deliberate future work.
- The owner was informed before the decision per launch context.

**WARNING**: The silence is a genuine user-visible regression for users who have not read the README. The spec amendment makes the contract honest; it does not make the UX good. The first-run experience after upgrade from 1.x will be a bot that appears dead to users typing old Spanish commands. This is now correctly specified and correctly tested but remains a real gap to close in future work.

#### Biome `noProcessEnv` Compensating Control

**Configuration**: Enabled repo-wide at `biome.json:11` as a compensating control for the credential-hardening boundary being a function inside `src/index.js` rather than a separate file.

**Availability**: Confirmed present in Biome 2.5.13 (pinned in package.json).

**Coverage**: Fires exactly once on the legitimate `process.env` read inside `loadConfig`. One `// biome-ignore` suppression at the read site. Any second suppression appearing in a diff is a review red flag.

**Limitation**: `noProcessEnv` is a Biome nursery rule (experimental). Fallback compensating controls if the rule is unavailable in a future Biome version: `check:lang` grep + review convention. This is noted but not a blocker.

#### Spec Compliance

All 28 requirements across 8 capabilities are compliant. All 33 scenarios verified. No partial, untested, or failing capabilities.

| Capability | Requirements | Scenarios | Status |
|---|---|---|---|
| ha-connection-config | 2 | 4 | PASS |
| bot-authorization | 4 | 6 | PASS |
| process-lifecycle | 3 | 3 | PASS |
| code-quality-hygiene | 5 | 5 | PASS |
| test-coverage | 4 | 4 | PASS |
| bot-localization | 3 | 4 | PASS (blocker closed) |
| addon-configuration | 2 | 2 | PASS |
| project-documentation | 5 | 5 | PASS |
| **TOTAL** | **28** | **33** | **ALL PASS** |

### Accepted Deviations Recorded

1. **Owner-approved documented `size:exception` on commit `ae4b14b` (unit 2a)**  
   Measured 423 changed lines vs 400 budget. Approved and documented in tasks artifact task `3.6`. Contingency split Option B was available but not needed; the exception was taken on the original unit.

2. **ZERO NEW FILES under `src/`**  
   Owner-approved non-goal per design Engram #70. The credential boundary is a `loadConfig()` FUNCTION inside `src/index.js`, not a separate module. Compensated by `noProcessEnv` Biome rule (one suppression) and `check:lang` script.

3. **`src/telegram.js` Remains a Single ~643-Line Module**  
   Ports-and-adapters architecture refactor was an explicit non-goal. Unchanged from proposal scope.

4. **Spanish `friendly_name` Fixtures and `localeCompare(..., "es")` Are Intentional**  
   Entity data comes from a Spanish Home Assistant instance. Collation choice is a property of the data, not of interface language. Both `src/formatter.js` and `tests/formatter.test.js` remain unchanged in this regard.

### Known Open Items (Not Resolved, Carried Forward)

These are gaps documented as future work, not bugs or failures:

1. **Owner must revoke the exposed Supervisor token** (operational, documented above) — Highest priority.

2. **Migration silence UX** — Retired commands produce no reply. Users who don't read the README will see a bot that appears dead. Solution: add a catch-all handler replying with the command rename mapping. Specified in amended bot-localization scenario; not implemented in this change. Recommend as first follow-up.

3. **CI uses `npm install` while Dockerfile uses `npm ci`** — Workflow at `.github/workflows/tests.yml:20` doesn't validate against the committed lockfile. Does not violate spec (requirement names only Dockerfile), but worth a one-line follow-up in a chore commit.

4. **Outer `callback_query` error handler is untested** (`src/telegram.js:624-633`) — Uncovered, but not in a spec scenario. Carry forward.

5. **`debug-options.json` holds a plaintext Telegram bot token** — Untracked and gitignored (never entered history). Token should be rotated via BotFather and file should be updated to 2.0.0 option names or deleted.

6. **Remaining uncovered branches in `src/telegram.js`** — `158-169`, `173-180`, `186-192`, `197-198`, `526-531`, `595-597` (all edge cases, tested by structure of handler logic but not by dedicated branches). Coverage is 91.74% for the file; full branch coverage would benefit future safety but does not block this change.

### Delivery State

**Status**: NO DELIVERY YET. All work is local commits on `test/telegram-seam-and-coverage`. The stacked PR chain is planned but not opened. No push to remote, no pull requests exist.

**Next step**: Owner decision on delivery. Delivery strategy is `ask-on-risk`, chain strategy is `stacked-to-main`, with 10 stacked PRs planned per the design document. The first PR (`fix/secrets-and-config`) is standalone and ships alone as a live-secret fix. PRs 2–10 form a dependent chain.

## Archival Checklist

- [x] Task Completion Gate verified: 80/80 tasks complete, 0 unchecked
- [x] Native Review Receipt Gate: `reviewGate` is absent (no review was discovered for this candidate); archive proceeds under ordinary repository policy
- [x] Spec sync: All 8 delta specs copied to `openspec/specs/{domain}/spec.md` with diff -r verification (empty diff, all pass)
- [x] Change folder moved to archive: `openspec/changes/archive/2026-09-11-document-and-refactor` with diff -r snapshot verification (empty diff, pass)
- [x] Active changes directory no longer contains this change
- [x] Archived folder contains all artifacts: proposal.md, design.md, tasks.md, specs/ subdirectories (8 domains)
- [x] Archive report written and persisted to both Engram and OpenSpec
- [x] SDD cycle complete: proposal → spec → design → tasks → apply (9/10 phases done on branch) → verify (PASS WITH WARNINGS) → archive (NOW)

## Source of Truth Updates

The following spec files in `openspec/specs/` are now authoritative and reflect the new behavior:

- `openspec/specs/addon-configuration/spec.md`
- `openspec/specs/bot-authorization/spec.md`
- `openspec/specs/bot-localization/spec.md` (includes amended scenario on retired commands)
- `openspec/specs/code-quality-hygiene/spec.md`
- `openspec/specs/ha-connection-config/spec.md`
- `openspec/specs/process-lifecycle/spec.md`
- `openspec/specs/project-documentation/spec.md`
- `openspec/specs/test-coverage/spec.md`

## SDD Cycle Complete

The change has been fully planned (proposal), specified (8 capability specs), designed (binding architecture decisions, testability seam, DRY boundaries, lifecycle integration), implemented across 9 phases (units 1a–6, totaling 10 stacked PRs on branch), verified against all requirements and scenarios, and archived.

**Next phase**: None. The change is complete and closed.

---

**Archive Report Created**: 2026-09-11  
**Prepared by**: sdd-archive executor  
**Artifact Store**: hybrid (Engram + OpenSpec)
