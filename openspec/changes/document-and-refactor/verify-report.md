```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:b38ca34a053e362d12b14fb4e0f679a2a57aef6786b4337ed92a47099f1d0c16
verdict: fail
blockers: 1
critical_findings: 1
requirements: 28/28
scenarios: 32/33
test_command: node --test
test_exit_code: 0
test_output_hash: sha256:aaa818b9defbbb449295737603d25f7f6261b8dd36fc4877f74665d549dbb673
build_command: npx biome check .
build_exit_code: 0
build_output_hash: sha256:f2b022b84d56165660c82d4f48ade310bc2cd092bbf45aeb7af7df48da344058
```

## Verification Report (re-verification after corrective slice)

**Change**: document-and-refactor
**Repository**: ha-status-bot
**Branch / HEAD**: `test/telegram-seam-and-coverage` @ `799a199` (clean working tree, unchanged by this run)
**Mode**: Standard (Strict TDD not active)
**Artifact store**: hybrid (OpenSpec files + Engram)
**Supersedes**: the FAIL report at Engram #77 / `openspec/changes/document-and-refactor/verify-report.md` (HEAD `622fd04`)

This run re-checks every finding from the prior FAIL report, re-checks every capability that
previously passed, and treats the corrective slice's "behavior-neutral" claim as unproven until
independently demonstrated.

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 80 |
| Tasks complete | 80 |
| Tasks incomplete | 0 |
| Spec requirements | 28 across 8 capabilities |
| Spec scenarios | 33 across 8 capabilities |

Task `3.6` (`openspec/changes/document-and-refactor/tasks.md:139`) is now `- [x]`. `rg -c '^\s*- \[ \]'`
returns no unchecked task. The tasks artifact and apply-progress no longer contradict the file.

### Build & Tests Execution

**Tests**: PASSED — 129 passed / 0 failed / 0 skipped

```text
$ node --test
ℹ tests 129
ℹ suites 35
ℹ pass 129
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 303.963291
(exit code 0)
```

**Build / static analysis**: PASSED

```text
$ npx biome check .
Checked 12 files in 40ms. No fixes applied.
(exit code 0)

$ npm run check:lang
> node scripts/check-lang.js
check:lang passed — no Spanish characters found under src/**.
(exit code 0)
```

**Coverage** (`node --test --experimental-test-coverage`): 94.77% lines / 90.75% branches /
93.10% functions overall (was 88.35 / 89.89 / 90.91). No project threshold is configured.

| File | Line % | Branch % | Funcs % | Uncovered lines |
|---|---|---|---|---|
| `src/formatter.js` | 100.00 | 94.92 | 100.00 | — |
| `src/haClient.js` | 98.17 | 84.00 | 81.25 | 12-14, 143-144 |
| `src/index.js` | 92.00 | 92.68 | 86.96 | 8-10, 110-111, 120-123, 171-175 |
| `src/telegram.js` | 91.74 | 90.24 | 90.24 | 158-169, 173-180, 186-192, 197-198, 280-283, 526-531, 595-597, 624-633, 637 |

`src/telegram.js` rose from 77.83% to 91.74% lines. The four regions named in the prior report's
WARNING 1 and 2 (`341-368`, `392-419`, `423-448`, `461-464` at that revision) are gone from the
uncovered list.

### Per-finding resolution against the prior FAIL report (Engram #77)

| # | Prior finding | Status | Evidence |
|---|---|---|---|
| CRITICAL 1 | Shared fetch+keyboard+error helper does not exist | **RESOLVED** | `fetchEntityKeyboard` (`src/telegram.js:86-90`) invoked by all four call sites; `replyWithEntityKeyboard` (`:100-122`) wraps it for the three commands. Zero independent repetition remains. Judgment detailed below |
| CRITICAL 2 | Camera clip duration has no named constant | **RESOLVED** | `CAMERA_CLIP_DURATION_SECONDS` declared once at `src/haClient.js:4`. `rg '\b30\b\|vid30\|30s\|30 seconds' src/` returns that declaration and nothing else |
| CRITICAL 3 | Default base URL test is tautological; mutant M8 survived | **RESOLVED** | `tests/index.test.js:55-56` now pins the literal on both sides. Mutation re-run: **128 passed / 1 failed** (was 114/0). Mutant killed |
| WARNING 1 | `callback_query` allow-list denial branch uncovered | **RESOLVED** | `tests/telegram.test.js:639-666`. Mutants M12 (gate removed), M13 (gate inverted), M14 (denial copy changed) all killed |
| WARNING 2 | `/lights`, `/covers`, `/cameras` handlers never invoked | **RESOLVED** | `tests/telegram.test.js:235-413`, 12 tests. All 11 registered commands are now driven by tests. Mutants M15, M18 killed |
| WARNING 3 | No test asserts an old Spanish command is ignored | **STILL OPEN — now the sole blocker** | Unchanged since the prior report: no committed test drives an old command. Re-classified as CRITICAL 1 below, not because it worsened, but because it is now the only unmet item and the prior report already recorded this scenario as UNTESTED |
| WARNING 4 | Biome scope narrower than the design's repo-wide claim | **RESOLVED** | `biome.json:10` is now `["src/**", "tests/**", "scripts/**", "*.json", "*.js"]`. Probe: a `process.env` read added under `scripts/` and at the repository root both raise `lint/style/noProcessEnv`. All 10 tracked `.js` files are in scope |
| WARNING 5 | README overstates the Biome `process.env` guard | **DOWNGRADED to SUGGESTION** | `README.md:233-235` is now accurate for every JS file that exists in the repository. It remains technically overstated only for a hypothetical new top-level directory (probe: `tools/probe.js` is not checked) |
| WARNING 6 | Task `3.6` unchecked while artifacts claim completion | **RESOLVED** | 80/80 tasks checked, 0 unchecked |
| WARNING 7 | CI uses `npm install`, Dockerfile uses `npm ci` | **OPEN** | `.github/workflows/tests.yml:20` still `npm install`. Not a spec violation (the requirement names only the Dockerfile) |
| SUGGESTION 1 | `loadConfig()` evaluated outside the `.catch` | **OPEN** | `src/index.js:171` unchanged |
| SUGGESTION 2 | `retryForNonEmpty` sleeps after its final attempt | **OPEN** | `src/haClient.js:136-149` unchanged |
| SUGGESTION 3 | Untracked `debug-options.json` holds a bot token | **OPEN** | Still untracked and git-ignored; rotation still recommended |
| SUGGESTION 4 | Other uncovered `src/telegram.js` branches | **PARTIALLY OPEN** | Still uncovered: `158-169`, `173-180`, `186-192`, `197-198`, `526-531`, `595-597`, `624-633` |
| SUGGESTION 5 | `scripts/check-lang.js` outside the Biome file set | **RESOLVED** | Now checked; `npx biome check .` covers 12 files including it |

### CRITICAL 1 — judgment on the deliberate non-unification

**Verdict: the requirement is SATISFIED. This is not a deviation requiring owner approval.**

The requirement (`specs/code-quality-hygiene/spec.md:49-57`) reads: the lights, covers, cameras
handlers and the callback-refresh path "MUST call one shared helper instead of independently
repeating the pattern", with the scenario "all four call sites invoke the same shared helper
function."

The apply agent's two reported differences are real, and I confirmed both by reading the code:

1. **Delivery mechanism.** The three commands call `bot.sendMessage` (a new message); the refresh
   block calls `bot.editMessageReplyMarkup` (`src/telegram.js:612-621`), an in-place edit of an
   existing message. Different Telegram API calls with different user-visible results.
2. **Error-handling ownership.** The commands own a `try`/`catch` that replies
   `Error querying Home Assistant: ${error.message}` (`:118-121`). The refresh block has no
   `catch`; errors propagate to the enclosing `callback_query` handler's catch (`:623-633`), which
   sends a different message (`⚠️ Error in ${action}: ${error.message}`) and additionally answers
   the callback. Routing the refresh block through `replyWithEntityKeyboard` would produce double
   error handling and the wrong error copy.

Grounds for ruling this satisfied rather than a deviation:

- The requirement's operative prohibition is "instead of independently repeating the pattern."
  After the refactor there is **zero** independent repetition of the fetch → select → build
  sequence: it exists once, in `fetchEntityKeyboard`.
- All four call sites do invoke that one shared helper. Three reach it through the thin
  `replyWithEntityKeyboard` wrapper, which exists only to share *additional* code among the subset
  that genuinely shares it; the refresh block calls `fetchEntityKeyboard` directly.
- A DRY-hygiene requirement cannot reasonably be read to mandate a user-visible behavior change
  that no spec requests. Forcing the fourth site into the wrapper would change the error copy and
  the delivery mechanism, violating the change's own behavior-neutrality constraint.

The one nuance an owner may wish to weigh: under the strictest reading of "all four call sites
invoke the same shared helper function", three of the four invoke it *transitively* rather than as
their immediate callee. I judge the two-tier decomposition (shared core plus a wrapper for the
subset with shared surrounding behavior) to be the correct engineering answer to exactly this
shape, and therefore compliant. Flagged transparently so the owner can overrule.

### CRITICAL 1 — behavior-neutrality, independently proven

The "behavior-neutral" claim was not accepted on assertion. Four independent checks:

1. **Exhaustive reachability of the refresh block.** The refactor moved `await ha.getStates()` from
   an unconditional call before the `if`/`else if` into each branch. That is safe only if one
   branch always matches. Every branch of the action chain at `src/telegram.js:492-603` except
   `light_on`, `light_off`, `cover_open`, `cover_close` ends in `return`. Those four are exactly
   the actions satisfying `startsWith("light_")` or `startsWith("cover_")`. So control reaches
   `:610` only when precisely one branch matches: same single `getStates` call, same order, same
   `try` scope. The apply agent's claim is correct.
2. **Eager keyboard build is unobservable.** `fetchEntityKeyboard` calls `keyboardBuilder(entities)`
   before the empty-list check, whereas the originals built the keyboard only on the non-empty
   path. All three builders (`src/telegram.js:42-78`) are pure `Array.prototype.map` calls;
   `[].map()` returns `[]` and cannot throw or produce side effects.
3. **Copy preserved verbatim.** Occurrence counts of every user-facing string are identical before
   and after `40bd2ce`: `💡 No lights available.` 1→1, `💡 Lights:` 1→1, `🪟 No covers available.`
   1→1, `🪟 Covers:` 1→1, `📷 No cameras available.` 2→2, `📷 Select a camera:` 2→2.
   `Error querying Home Assistant: ${error.message}` went 4→2 because three duplicates collapsed
   into the shared helper — that is the DRY win, not a copy change. The parameterized log line
   `[Telegram] ${commandLabel}: ${entities.length} ${entityNoun} found` renders byte-identically to
   each original for all three domains.
4. **Empirical differential test.** The pre-refactor `src/telegram.js` (`40bd2ce~1`) was dropped
   into an isolated copy alongside the **current** 129-test suite — including the 15 tests written
   *after* the refactor — and the result was **129 passed / 0 failed**. The post-refactor suite
   detects no observable difference from the pre-refactor implementation.

**Conclusion: the refactor is behavior-neutral.** No user-visible string, error path, or HA call
sequence changed. No new defect was introduced by the corrective slice.

### Mutation evidence (test-suite effectiveness)

Run against isolated copies of the repository in a scratch directory outside the repository; the
working tree was never modified and remains clean at `799a199`. Each mutant was applied to a
pristine copy, one at a time. Isolated-copy baseline: 129 pass / 0 fail.

| Mutant | Target | Result | Killed? |
|---|---|---|---|
| M8 | `HA_DEFAULT_BASE_URL` → `http://homeassistant.local:8123/api` | 128 pass / 1 fail | **YES** (was SURVIVED) |
| M12 | remove the `callback_query` allow-list gate entirely | 128 pass / 1 fail | YES |
| M13 | invert the `callback_query` allow-list gate | 115 pass / 14 fail | YES |
| M14 | change the callback denial answer copy | 128 pass / 1 fail | YES |
| M15 | `/lights` uses the covers selector and builder | 128 pass / 1 fail | YES |
| M16 | change the `/covers` empty-state copy | 129 pass / 0 fail | NO — survives by design (see SUGGESTION 1) |
| M17 | change the `/cameras` list-message copy | 129 pass / 0 fail | NO — survives by design (see SUGGESTION 1) |
| M18 | shared helper swallows the HA error instead of replying | 126 pass / 3 fail | YES |
| M1 | invert `isAllowed` | 117 pass / 12 fail | YES (kill count up from 7) |
| M2 | chunk limit 3900 → 100000 | 128 pass / 1 fail | YES |
| M3 | disable the entity membership gate | 126 pass / 3 fail | YES |
| M5 | replace `requireEnv(env,"SUPERVISOR_TOKEN")` with a literal | 126 pass / 3 fail | YES |
| M6 | remove the SIGTERM handler | 127 pass / 2 fail | YES |
| M7 | `unhandledRejection` exits instead of logging | 128 pass / 1 fail | YES |

M16 and M17 survive because design Decision 3 deliberately decouples tests from copy, concentrating
copy assertions in a single `user-facing copy` block per file that pins only the security-relevant
denial wording. This is a recorded design choice, not a regression introduced by the corrective
slice, and the machine contract (`callback_data` values, keyboard shape, HA call counts) is pinned.

**Runtime probe for the no-alias scenario** (isolated copy, driving the real `createTelegramBot`):
each of `/luces`, `/persianas`, `/camaras`, `/estado`, `/sensores`, `/puertas`, `/bateria`, `/temp`
produced `matchedHandlers=0`, `haGetStates=0`, `messagesSent=0`.

### Spec Compliance Matrix

| Capability | Requirement | Scenario | Evidence | Result |
|---|---|---|---|---|
| ha-connection-config | Supervisor Token From Environment Only | Startup reads the injected token | `tests/index.test.js:63-70`; `tests/haClient.test.js:87`; mutant M5 killed | ✅ COMPLIANT |
| ha-connection-config | Supervisor Token From Environment Only | Missing token fails fast | `tests/index.test.js:72-84`; `src/index.js:12-20` | ✅ COMPLIANT |
| ha-connection-config | Supervisor Proxy Base URL By Default | Default base URL is the Supervisor proxy | `tests/index.test.js:55-56` pins the literal; **mutant M8 now killed** | ✅ COMPLIANT |
| ha-connection-config | Supervisor Proxy Base URL By Default | No stray hostnames in source | `rg homeassistant.local src/` returns nothing | ✅ COMPLIANT |
| bot-authorization | Chat-ID Allow-List Gates Privileged Commands | Allowed chat proceeds | `tests/telegram.test.js:128-137`; callback positive control `:653-664` | ✅ COMPLIANT |
| bot-authorization | Chat-ID Allow-List Gates Privileged Commands | Disallowed chat is denied with guidance | `tests/telegram.test.js:139-148`, `:640-652`, `:816-826`; mutants M1, M12, M13, M14 killed | ✅ COMPLIANT |
| bot-authorization | /start and /help Are Gated | Unauthorized /start is denied | `tests/telegram.test.js` `/start` and `/help` gating block | ✅ COMPLIANT |
| bot-authorization | /chatid Stays Ungated By Design | Unknown user discovers their chat_id | `src/telegram.js:375`; `tests/telegram.test.js` `/chatid` cases | ✅ COMPLIANT |
| bot-authorization | Entity-ID Membership Validation Before Privileged Calls | Offered entity is accepted | `tests/telegram.test.js` callback positive cases | ✅ COMPLIANT |
| bot-authorization | Entity-ID Membership Validation Before Privileged Calls | Forged entity rejected before any HA call | `src/telegram.js:259-272,484-490`; mutant M3 killed | ✅ COMPLIANT |
| process-lifecycle | Graceful Shutdown on SIGTERM/SIGINT | SIGTERM stops polling and exits | `src/index.js:126-127`; mutant M6 killed | ✅ COMPLIANT |
| process-lifecycle | Unhandled Errors Are Logged, Not Silently Swallowed | Unhandled rejection is logged | `src/index.js:132-134`; mutant M7 killed | ✅ COMPLIANT |
| process-lifecycle | Startup Fails Fast on Missing Configuration | Missing bot token halts startup | `tests/index.test.js:153-161`; `src/index.js:68-70` | ✅ COMPLIANT |
| code-quality-hygiene | Reproducible Docker Install | Dockerfile uses npm ci | `Dockerfile:6` — `RUN npm ci --omit=dev` | ✅ COMPLIANT |
| code-quality-hygiene | package.json Declares Engine and License | Engine and license present | `package.json:5-7` — `"license": "MIT"`, `"node": ">=20"` | ✅ COMPLIANT |
| code-quality-hygiene | Lint and Format Tooling Available | Lint script runs | `package.json:13-16`; `npx biome check .` exits 0 | ✅ COMPLIANT |
| code-quality-hygiene | Single Named Constant Per Shared Magic Number | One declaration per constant | chunk size `src/telegram.js:24`; `CAMERA_CLIP_DURATION_SECONDS` `src/haClient.js:4`; `ATTEMPTS`/`DELAY_MS`/`SNAPSHOT_COOLDOWN_MS` `src/haClient.js:7-9`. No unnamed `30` survives anywhere in `src/` | ✅ COMPLIANT |
| code-quality-hygiene | Shared Helper for Repeated Fetch+Keyboard+Error Pattern | Shared helper reused | `fetchEntityKeyboard` `src/telegram.js:86-90` invoked by all four sites; behavior-neutrality independently proven | ✅ COMPLIANT |
| test-coverage | telegram.js Tests Import the Real Module | Real authorization logic is exercised | `tests/telegram.test.js` imports `createTelegramBot`; mutants M1, M2, M3 killed | ✅ COMPLIANT |
| test-coverage | index.js Tests Import the Real Module | Real option-parsing logic is exercised | `tests/index.test.js:5-10`; mutant M5 killed | ✅ COMPLIANT |
| test-coverage | New Behavior Introduced By This Change Is Covered | Forged entity_id rejected without an HA call | `tests/telegram.test.js` forged-entity block; mutant M3 killed | ✅ COMPLIANT |
| test-coverage | Full Suite Stays Green | CI passes end to end | 129/129 green; no re-implemented production logic in any test file | ✅ COMPLIANT |
| bot-localization | English-Only User-Facing Copy | No Spanish in outbound messages | `check:lang` clean; accented and unaccented Spanish scans over `src/` return nothing | ✅ COMPLIANT |
| bot-localization | English-Only Logs and Comments | No Spanish log strings remain | Same scans; all comments added by the corrective slice are English | ✅ COMPLIANT |
| bot-localization | Commands Are Renamed to English With No Aliases | Old Spanish command is no longer recognized | 11 `bot.onText` regexes all English; verifier runtime probe: 8 old commands → 0 handlers, 0 HA calls, 0 messages. **No covering test in the committed suite** | ❌ UNTESTED |
| bot-localization | Commands Are Renamed to English With No Aliases | New English command runs the flow | `tests/telegram.test.js:235-413`; all 11 registered commands driven by tests; mutant M15 killed | ✅ COMPLIANT |
| addon-configuration | Renamed and Retyped Options | config.yaml reflects the new schema | `config.yaml:17-25`; untouched by the corrective slice | ✅ COMPLIANT |
| addon-configuration | Add-on Description Is English | Description is English | `config.yaml:4` | ✅ COMPLIANT |
| project-documentation | README Matches Actual Connection and Authorization Behavior | README connection section matches code | `README.md` cross-checked; untouched by the corrective slice | ✅ COMPLIANT |
| project-documentation | Command Migration Table | Table is present and complete | `README.md:154-169` | ✅ COMPLIANT |
| project-documentation | Config Migration Note | Migration note is present | `README.md:171-182` | ✅ COMPLIANT |
| project-documentation | Testing Section Matches Reality | Testing claim matches the test-coverage capability | `README.md:227-231` | ✅ COMPLIANT |
| project-documentation | OPTIONS_PATH Documented | OPTIONS_PATH appears in README | `README.md:205,238-249` | ✅ COMPLIANT |

**Compliance summary**: 32/33 scenarios compliant, 1 UNTESTED, 0 PARTIAL, 0 FAILING.
**Requirement summary**: 28/28 requirements satisfied.

### Per-capability verdict

| Capability | Prior verdict | This verdict | Regression? |
|---|---|---|---|
| ha-connection-config | FAIL (1 UNTESTED) | **PASS** | No |
| bot-authorization | PASS | **PASS** (strengthened: callback denial now covered) | No |
| process-lifecycle | PASS | **PASS** | No |
| code-quality-hygiene | FAIL (2 MUSTs unmet) | **PASS** | No |
| test-coverage | PASS | **PASS** (coverage 88.35% → 94.77%) | No |
| bot-localization | FAIL (2 UNTESTED) | **FAIL** (1 of 2 closed; 1 still UNTESTED) | No |
| addon-configuration | PASS | **PASS** (untouched) | No |
| project-documentation | PASS | **PASS** (untouched) | No |

### Regression check on the corrective slice

Change surface `622fd04..799a199`: `biome.json`, `src/haClient.js`, `src/telegram.js`,
`tests/index.test.js`, `tests/telegram.test.js`, plus two openspec files. `config.yaml`,
`Dockerfile`, `package.json`, `README.md`, `src/index.js`, and `src/formatter.js` were not touched.

Checks performed for a newly introduced defect:

- **Import cycle**: `src/telegram.js` now imports `CAMERA_CLIP_DURATION_SECONDS` from
  `src/haClient.js`. `haClient.js` imports no local module, so the graph stays acyclic
  (`index.js` → {`haClient.js`, `telegram.js`}, `telegram.js` → {`formatter.js`, `haClient.js`}).
  `haClient.js` has no top-level side effects beyond two frozen constant declarations.
- **Callback contract stability**: the computed `` `camera_vid${CAMERA_CLIP_DURATION_SECONDS}` ``
  key, the `callback_data` payload, the action comparison, and the `_30s.mp4` filename all still
  render to the same literals as before the extraction.
- **Prior mutants re-run**: M1, M2, M3, M5, M6, M7 all still killed. No capability lost coverage.
- **Differential test**: pre-refactor `telegram.js` + current 129-test suite = 129 pass / 0 fail.

**No new defect was found.**

### Coherence (Design — Engram #70)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| 1 — Testability seam (`createBot`, `logger`) | ✅ Yes | Used by all 15 new tests |
| 2 — `loadConfig()` inside `src/index.js`, no new `src/` file | ✅ Yes | Zero new files under `src/` |
| 2 — Biome `process.env` restriction as compensating control | ✅ Yes (was PARTIAL) | Now covers `src/**`, `tests/**`, `scripts/**`, and root JS — every tracked `.js` file. Proven by probe |
| 3 — Copy inline; tests decoupled from copy | ✅ Yes | Explains surviving mutants M16/M17 |
| 3 — Collation stays `"es"` | ✅ Yes | `src/formatter.js:15,123` untouched |
| 4 — haClient constants + injected collaborators, public surface unchanged | ✅ Yes | `CAMERA_CLIP_DURATION_SECONDS` added as a named export; `createHomeAssistantClient` return shape unchanged |
| 5 — Two-stage entity gate | ✅ Yes | `src/telegram.js:237-272` |
| 6 — `installProcessHandlers` with injected `processRef`/`exit` | ✅ Yes | Untouched |
| 7 — Biome devDependency + `biome.json` + scripts | ✅ Yes | Scope widened |
| Accepted deviation: `size:exception` on `ae4b14b` | ✅ Confirmed | Documented in task `3.6`, now checked |
| Accepted deviation: `src/telegram.js` stays one module | ✅ Confirmed | 643 lines, single module, no ports/adapters |
| Design's DRY target: one shared fetch+keyboard+error helper | ✅ Yes (was NO) | `fetchEntityKeyboard` + `replyWithEntityKeyboard` |

### Issues Found

**CRITICAL**

1. **`bot-localization` → "Old Spanish command is no longer recognized" has no covering test in the
   committed suite.** No test in `tests/` drives `/luces` or any other retired Spanish command, so
   nothing prevents a future edit from re-registering one. This is unchanged since the prior FAIL
   report, which already recorded this scenario as ❌ UNTESTED; the corrective slice did not scope
   it.

   I am reporting it as CRITICAL rather than WARNING for consistency, not because it worsened. The
   verification contract is explicit that a spec scenario is compliant only when a covering test
   passed at runtime, and my own prior report classified this exact scenario as UNTESTED at
   `622fd04`. Nothing in the code or the suite changed for it between the two runs. Softening it to
   a warning now, purely because everything else was fixed, would be rounding a known gap up to
   passing.

   **This blocker is qualitatively different from the prior three**, and the owner should weigh
   that when deciding:
   - The underlying property is *true* and deterministically decidable — the complete set of
     registered patterns is 11 literal regexes, none of which can match a Spanish command.
   - This verifier obtained direct runtime evidence: `/luces`, `/persianas`, `/camaras`, `/estado`,
     `/sensores`, `/puertas`, `/bateria`, `/temp` each produced 0 matched handlers, 0 HA calls and
     0 messages against the real `createTelegramBot`.
   - The scenario's `THEN` clause ("falls through to unknown-command handling") describes behavior
     that does not exist: there is no catch-all `bot.on("message")` handler, so an unrecognized
     command produces no reply at all. `README.md:167-169` documents the real behavior correctly.

   **Remedy**: one test in `tests/telegram.test.js` asserting that `emitText("/luces", 1)` produces
   `ha.calls.getStates === 0` and `bot.sentMessages.length === 0`. Alternatively, the owner may
   amend the scenario's `THEN` clause to match the implemented no-reply behavior and accept the
   static plus runtime proof, which is a spec-amendment decision this verifier cannot make
   unilaterally.

**WARNING**

1. **CI installs with `npm install` while the Dockerfile uses `npm ci`.**
   `.github/workflows/tests.yml:20` does not validate against the committed lockfile that
   `Dockerfile:6` depends on. Carried forward unchanged; not a spec violation, since the
   `code-quality-hygiene` requirement names only the Dockerfile.

2. **The outer `callback_query` error handler is untested** (`src/telegram.js:624-633`,
   uncovered). This matters slightly more than before: the CRITICAL 1 refactor deliberately leaves
   the keyboard-refresh path depending on this handler for its error behavior. Behavior-neutrality
   is proven by other means above, but the error path itself has no covering test.

**SUGGESTION**

1. **Per-command copy is not pinned.** Mutants M16 (`/covers` empty-state text) and M17
   (`/cameras` list text) survive. This follows design Decision 3 and is not a defect, but the
   `user-facing copy` block pins only three strings. Note also that its callback assertion uses
   `/[Nn]ot authorized/`, which matches both `"Not authorized."` and `"Entity not authorized."`, so
   it does not discriminate the allow-list denial from the entity-membership denial; the behavioral
   test at `tests/telegram.test.js:640-652` carries that weight instead.

2. **`README.md:233-235` remains marginally overstated.** It says Biome forbids `process.env`
   "anywhere except the single authorized entry point". True for every JS file that exists today; a
   future top-level directory (e.g. `tools/`) would not be covered — confirmed by probe. Adding
   `**/*.js` or an explicit `!` exclusion list would close it.

3. **Configuration failures still bypass the top-level error handler.** `src/index.js:171`
   evaluates `loadConfig()` as an argument to `bootstrap(...)`, so a synchronous throw escapes
   before `.catch` is attached. Carried forward unchanged.

4. **`retryForNonEmpty` still sleeps after its final attempt** (`src/haClient.js:136-149`),
   costing `HA_RETRY.DELAY_MS` of pure latency on every exhausted snapshot retry.

5. **The untracked `debug-options.json` still holds a Telegram bot token in plaintext.** Correctly
   git-ignored with no history, so no requirement is violated. Rotating that token through BotFather
   and deleting or updating the file to the 2.0.0 option names remains recommended.

6. **Remaining uncovered branches in `src/telegram.js`** for a follow-up slice: `158-169`
   (`waitForMediaFile` retry/timeout), `173-180`/`186-192` (expired-callback detection and
   `safeAnswerCallback` error path), `197-198` (`ensureNonEmptyBuffer` throw), `526-531`
   (`camera_list` with zero cameras), `595-597` (re-throw of a non-5xx `camera.record` error).

### Known accepted deviations (verified, not re-reported as defects)

| Deviation | State |
|---|---|
| Owner-approved documented `size:exception` on `ae4b14b` (423 lines vs 400 budget) | Confirmed; task `3.6` records the measurement and escalation and is now checked |
| Credential boundary is a `loadConfig()` function in `src/index.js`, not a separate module | Confirmed; zero new files under `src/`. The `noProcessEnv` compensating control is now genuinely repository-wide across all tracked JS, strengthening the acknowledged-weaker control |
| `src/telegram.js` remains a single module; ports-and-adapters was an explicit non-goal | Confirmed; the corrective slice added two internal functions, no layering |
| Spanish `friendly_name` fixtures and `localeCompare(..., "es")` are intentional | Confirmed; `src/formatter.js` and `tests/formatter.test.js` untouched by the corrective slice |

### Unverifiable Without a Live Home Assistant Instance

Unchanged from the prior report. Satisfied by code inspection and unit tests, but not provable here:
Supervisor token injection via `homeassistant_api: true`; real `SIGTERM` against real long polling;
Supervisor UI acceptance of the `list(str)` and `int(0,100)` schema; end-to-end English replies and
inline buttons over real Telegram; camera snapshot/record behavior against real camera entities.

### Verdict

**FAIL** — one blocker, narrow, pre-existing, and trivially remediable.

All three CRITICAL blockers from the prior report are genuinely closed, each confirmed by execution
rather than inspection: the default base URL mutant that previously survived is now killed
(128/1), the camera clip duration has exactly one named declaration with no unnamed `30` anywhere
in `src/`, and the shared fetch+keyboard+error helper exists and is invoked by all four call sites.
The deliberate non-unification of the callback-refresh path is a correct engineering judgment that
satisfies the requirement, not a deviation needing approval. The refactor is behavior-neutral —
proven four ways, including running the current 129-test suite against the pre-refactor module. No
new defect was introduced by the corrective slice, and no previously passing capability regressed:
all six prior mutants are still killed and coverage rose from 88.35% to 94.77%. Two WARNINGs do
not block: a CI/Dockerfile install mismatch outside the spec and an untested callback error
handler.

The single blocker is a pre-existing, out-of-scope gap the corrective slice never claimed to
address: the `bot-localization` "Old Spanish command is no longer recognized" scenario still has no
covering test in the committed suite. My prior report recorded that same scenario as UNTESTED at
`622fd04`, and nothing about it changed. Reclassifying it as passing now, purely because
everything else was fixed, would be rounding up.

**Not ready for `sdd-archive`.** One test closes it — `emitText("/luces", 1)` asserting zero HA
calls and zero messages sent — after which this change is archive-ready with warnings only. The
owner may instead amend the scenario's unimplementable `THEN` clause and accept the static plus
runtime proof recorded above; that is a spec decision, not a verification one.
