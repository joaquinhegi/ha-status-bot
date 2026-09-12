```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:ec7a7b8391fe7a575156442aa946363a0c733d3851fc41099349ff27817f3bd8
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 28/28
scenarios: 33/33
test_command: node --test
test_exit_code: 0
test_output_hash: sha256:24c9b12fb54d6a4ad1757c59549a084d314fc241441b6d730236919c513a92a8
build_command: npx biome check .
build_exit_code: 0
build_output_hash: sha256:00b1cdd2b7d9b3e811f28ac176091c26c92eb78032b949876cab1db9faf0b106
```

## Verification Report (final run — archive verdict)

**Change**: document-and-refactor
**Repository**: ha-status-bot
**Branch / HEAD**: `test/telegram-seam-and-coverage` @ `f72dffd` (clean working tree, unchanged by this run)
**Tree**: `8021531cb2c812a2c9da80c283e07437304c1aba`
**Mode**: Standard (Strict TDD not active)
**Artifact store**: hybrid (OpenSpec files + Engram)
**Supersedes**: the FAIL report at Engram #77 / `openspec/changes/document-and-refactor/verify-report.md` (HEAD `799a199`)

This run re-checks the single blocker left open by the prior report, judges the spec amendment
that accompanied its fix, and re-checks every capability and every previously resolved finding for
regression. Nothing was accepted on inspection: every claim below is backed by a command that ran.

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 80 |
| Tasks complete | 80 |
| Tasks incomplete | 0 |
| Spec requirements | 28 across 8 capabilities |
| Spec scenarios | 33 across 8 capabilities |

`rg -c '^\s*- \[ \]' openspec/changes/document-and-refactor/tasks.md` returns no unchecked task;
`rg -c '^\s*- \[x\]'` returns 80. Requirement and scenario totals were recounted from the eight
capability spec files rather than carried forward: `addon-configuration` 2/2,
`bot-authorization` 4/6, `bot-localization` 3/4, `code-quality-hygiene` 5/5,
`ha-connection-config` 2/4, `process-lifecycle` 3/3, `project-documentation` 5/5,
`test-coverage` 4/4.

### Build & Tests Execution

**Tests**: PASSED — 137 passed / 0 failed / 0 skipped (was 129; the eight new retired-command
tests account for the delta exactly).

```text
$ node --test
ℹ tests 137
ℹ suites 36
ℹ pass 137
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 294.2965
(exit code 0)
```

**Build / static analysis**: PASSED

```text
$ npx biome check .
Checked 12 files in 31ms. No fixes applied.
(exit code 0)

$ npm run check:lang
> node scripts/check-lang.js
check:lang passed — no Spanish characters found under src/**.
(exit code 0)
```

**Coverage** (`node --test --experimental-test-coverage`): 94.77% lines / 90.75% branches /
93.10% functions overall — byte-identical to the prior run. No project threshold is configured.

| File | Line % | Branch % | Funcs % | Uncovered lines |
|---|---|---|---|---|
| `src/formatter.js` | 100.00 | 94.92 | 100.00 | — |
| `src/haClient.js` | 98.17 | 84.00 | 81.25 | 12-14, 143-144 |
| `src/index.js` | 92.00 | 92.68 | 86.96 | 8-10, 110-111, 120-123, 171-175 |
| `src/telegram.js` | 91.74 | 90.24 | 90.24 | 158-169, 173-180, 186-192, 197-198, 280-283, 526-531, 595-597, 624-633, 637 |

Coverage being unchanged is the expected and correct result: the new tests assert the **absence**
of behavior, so they execute no additional line of `src/`. A coverage rise would have been the
suspicious outcome. Line coverage is therefore the wrong instrument for this scenario, which is
precisely why the mutation probe below is the load-bearing evidence.

### The prior blocker: closed, proven by mutation

**Prior CRITICAL 1** — `bot-localization` → "Old Spanish command is no longer recognized" had no
covering test in the committed suite.

`tests/telegram.test.js:741-769` now contains `describe("createTelegramBot retired Spanish
commands")`, a table-driven block over all eight retired commands (`/estado`, `/luces`,
`/sensores`, `/puertas`, `/bateria`, `/temp`, `/persianas`, `/camaras`). Each test asserts
`bot.sentMessages.length === 0`, `ha.calls.getStates === 0`, and `ha.calls.callService.length === 0`.

#### Test construction is sound, not vacuous

Each test calls `setup({ states: lights, allowedChatIds: [] })` and then `bot.emitText(command, 42)`.
An empty allow-list is **permissive**, not restrictive: `isAllowed` (`src/telegram.js:15-21`)
returns `true` when `allowedChatIds.length` is zero, and the suite pins that separately
("allows /start for every chat_id when the allow-list is empty"). So chat 42 is fully authorized
in these tests. A zero-message, zero-HA-call result therefore proves that **no handler matched**,
not that an authorization gate denied the request. Had the fixture used a restrictive allow-list,
a revived alias would have been masked by a denial reply and the assertion would have measured the
wrong thing. It does not.

The fixture also seeds one real light entity, so a revived `/lights` alias has something to fetch
and report — the mutant has a live path to take.

#### Mutation probe (the required re-run)

Probes ran in isolated copies outside the repository (`git archive f72dffd | tar -x`), each with
`node_modules` symlinked from the repository so `src/telegram.js` can resolve
`node-telegram-bot-api`. The repository working tree was never modified and remains clean at
`f72dffd`.

**Clean baseline in the isolated copy (before any mutation): 137 pass / 0 fail, exit 0.** This
confirms the symlinked `node_modules` loads correctly and that no failure below is an import
error masquerading as a killed mutant.

| Mutant | Target | Result | Killed? |
|---|---|---|---|
| M19 | `bot.onText(/\/lights/, …)` → `bot.onText(/\/(lights\|luces)/, …)` | **136 pass / 1 fail**, exit 1 | **YES** |
| M20 | all eight aliases revived simultaneously | **129 pass / 8 fail**, exit 1 | **YES** |

**M19 — the exact probe requested.** Baseline 137/0 → mutated 136 pass / 1 fail. The single
failing test is named precisely:

```text
✖ ignores /luces entirely, calling no HA service and sending no reply (0.450666ms)
  actual: 1, expected: 0, operator: 'strictEqual'  (code: ERR_ASSERTION)
```

The other seven retired-command tests stayed green under M19, which is the correct discrimination:
reviving one alias must fail one test and only that one.

**M20 — breadth check, added by this verifier.** Reviving all eight aliases at once fails exactly
eight tests, one per retired command. This proves each of the eight assertions is individually
live rather than the block passing on the strength of `/luces` alone.

**Conclusion: the blocker is closed.** The property is now enforced by the committed suite, not
only by a verifier-side runtime probe.

### Judgment on the spec amendment

**Verdict: the amendment is legitimate. It corrects a factually wrong scenario clause; it does not
paper over a product gap. The gap it names is real, is out of this change's scope, and is now
documented rather than erased.**

Grounds, each independently checked:

1. **The normative MUST is untouched.** The requirement text is "Every bot command MUST be renamed
   per the table below, with no Spanish alias registered for any of them." The amendment changed
   only the scenario's `THEN` clause. The obligation that actually constrains the product is
   unchanged — and it is now *better* enforced than before the amendment, not worse.
2. **The original clause described behavior that has never existed in this codebase.**
   `rg 'bot\.on\(' src/telegram.js` returns exactly two registrations: `callback_query` (`:465`)
   and `polling_error` (`:636`). There is no catch-all `bot.on("message")` handler, so there is no
   "unknown-command handling" for anything to fall through to. The clause was unsatisfiable
   without new product work that no requirement asked for, no task planned, and no proposal
   scoped.
3. **The amended clause agrees with documentation this same change already shipped.**
   `README.md:167-169` states: "the old commands are not recognized at all — the bot does not
   reply to them, it simply ignores the message." That README text predates the amendment. So the
   scenario's `THEN` clause was the single outlier contradicting both the code *and* the change's
   own user-facing documentation. Amending the outlier to match two independent agreeing sources
   is correction, not accommodation.
4. **The gap is recorded, not deleted.** The amendment's block quote explicitly names the
   consequence — "a user who types a retired command gets no feedback and no pointer to its new
   name" — and states the remedy (a catch-all replying with the rename mapping) as deliberate
   future work. A spec change that erases a gap deletes it; this one writes it down.
5. **The owner was informed before the decision.** Per the launch context, the repository owner was
   told that retired commands produce silence and that a catch-all is a candidate for a later
   change. A spec amendment is an owner decision, and it was made on accurate information.

**Where I decline to round up.** The silence is a genuine, user-visible regression introduced by
this change: before 2.0.0, `/luces` worked. A user who has not read the README gets a bot that
appears dead. The amendment makes the spec honest about that; it does not make the UX good. I
carry it forward as WARNING 3 below, and I would not describe this change as complete product work
on the migration experience. It is complete *specified* work, which is what this gate measures.

The one caution an owner should hold: amending a scenario to match the implementation is exactly
the shape of the failure mode where gaps quietly vanish. What disqualifies that reading here is
point 1 — the tightening ran in the same commit. If the amendment had arrived *without* the eight
tests, I would have rejected it.

### Regression check — previously resolved findings re-executed

Not re-checked by reading. Each was re-run.

| Prior finding | Re-check performed | Result |
|---|---|---|
| CRITICAL 3 — base-URL literal pin (mutant M8 previously survived) | Re-ran M8: `HA_DEFAULT_BASE_URL` → `http://homeassistant.local:8123/api` in an isolated copy | **Still killed** — 136 pass / 1 fail, exit 1. `tests/index.test.js:55-56` pins the literal on both sides (`config.homeAssistant.baseUrl` and the exported constant) |
| WARNING 4 — `noProcessEnv` scope | Re-ran the probe: added a `process.env` read at `scripts/probe.js`, at the repository root, and at `tools/probe.js` in an isolated copy | **Still resolved as scoped.** Root and `scripts/` both raise `lint/style/noProcessEnv`; file count went 12 → 14. `tools/probe.js` is still not checked, matching `biome.json:10` `["src/**","tests/**","scripts/**","*.json","*.js"]` — unchanged, carried forward as SUGGESTION 2 |
| CRITICAL 1 — shared fetch+keyboard+error helper | Re-read the call graph | **Still resolved.** `fetchEntityKeyboard` declared once (`src/telegram.js:86`); `replyWithEntityKeyboard` (`:100`) calls it at `:107`; the three commands call the wrapper at `:395`, `:435`, `:455`; the callback refresh calls the core directly at `:611` and `:617`. Four call sites, one shared core, zero independent repetition |
| CRITICAL 2 — camera clip duration constant | `rg` over `src/` | **Still resolved.** `CAMERA_CLIP_DURATION_SECONDS` declared once at `src/haClient.js:4` |
| WARNING 1 — `callback_query` allow-list denial coverage | Suite run | **Still resolved**; denial tests green |
| WARNING 2 — `/lights`, `/covers`, `/cameras` handlers driven | Suite run | **Still resolved**; all 11 registered commands driven |
| WARNING 6 — task `3.6` unchecked | `rg` over `tasks.md` | **Still resolved**; 80/80 checked, 0 unchecked |
| Prior mutants M1 (invert `isAllowed`) | Re-ran in an isolated copy | **Still killed** — 125 pass / 12 fail, exit 1 |
| Prior mutant M3 (disable entity membership gate) | Re-ran in an isolated copy | **Still killed** — 134 pass / 3 fail, exit 1 |

**No regression found in any capability.** The change surface `799a199..f72dffd` is three files:
`tests/telegram.test.js` (+30), the `bot-localization` spec (+12/-2), and the verify report itself.
**No file under `src/` was touched by this commit**, so no production behavior could have changed —
and the unchanged coverage numbers corroborate that independently.

### Spec Compliance Matrix

| Capability | Requirement | Scenario | Evidence | Result |
|---|---|---|---|---|
| ha-connection-config | Supervisor Token From Environment Only | Startup reads the injected token | `tests/index.test.js:63-70`; `tests/haClient.test.js:87`; mutant M5 killed | ✅ COMPLIANT |
| ha-connection-config | Supervisor Token From Environment Only | Missing token fails fast | `tests/index.test.js:72-84`; `src/index.js:12-20` | ✅ COMPLIANT |
| ha-connection-config | Supervisor Proxy Base URL By Default | Default base URL is the Supervisor proxy | `tests/index.test.js:55-56` pins the literal; mutant M8 re-run this session: 136/1, killed | ✅ COMPLIANT |
| ha-connection-config | Supervisor Proxy Base URL By Default | No stray hostnames in source | `rg homeassistant.local src/` returns nothing | ✅ COMPLIANT |
| bot-authorization | Chat-ID Allow-List Gates Privileged Commands | Allowed chat proceeds | `tests/telegram.test.js:128-137`; callback positive control | ✅ COMPLIANT |
| bot-authorization | Chat-ID Allow-List Gates Privileged Commands | Disallowed chat is denied with guidance | `tests/telegram.test.js` denial blocks; mutants M1, M12, M13, M14 killed (M1 re-run: 125/12) | ✅ COMPLIANT |
| bot-authorization | /start and /help Are Gated | Unauthorized /start is denied | `createTelegramBot /start and /help gating` suite | ✅ COMPLIANT |
| bot-authorization | /chatid Stays Ungated By Design | Unknown user discovers their chat_id | `src/telegram.js:375`; `/chatid` reachability test | ✅ COMPLIANT |
| bot-authorization | Entity-ID Membership Validation Before Privileged Calls | Offered entity is accepted | `createTelegramBot entity authorization gate` positive case | ✅ COMPLIANT |
| bot-authorization | Entity-ID Membership Validation Before Privileged Calls | Forged entity rejected before any HA call | `src/telegram.js:259-272`; mutant M3 re-run: 134/3, killed | ✅ COMPLIANT |
| process-lifecycle | Graceful Shutdown on SIGTERM/SIGINT | SIGTERM stops polling and exits | `src/index.js:126-127`; mutant M6 killed | ✅ COMPLIANT |
| process-lifecycle | Unhandled Errors Are Logged, Not Silently Swallowed | Unhandled rejection is logged | `src/index.js:132-134`; mutant M7 killed | ✅ COMPLIANT |
| process-lifecycle | Startup Fails Fast on Missing Configuration | Missing bot token halts startup | `tests/index.test.js:153-161`; `src/index.js:68-70` | ✅ COMPLIANT |
| code-quality-hygiene | Reproducible Docker Install | Dockerfile uses npm ci | `Dockerfile:6` — `RUN npm ci --omit=dev` | ✅ COMPLIANT |
| code-quality-hygiene | package.json Declares Engine and License | Engine and license present | `package.json:5-7` | ✅ COMPLIANT |
| code-quality-hygiene | Lint and Format Tooling Available | Lint script runs | `npx biome check .` exits 0 over 12 files | ✅ COMPLIANT |
| code-quality-hygiene | Single Named Constant Per Shared Magic Number | One declaration per constant | `CAMERA_CLIP_DURATION_SECONDS` `src/haClient.js:4`; chunk size `src/telegram.js:24` | ✅ COMPLIANT |
| code-quality-hygiene | Shared Helper for Repeated Fetch+Keyboard+Error Pattern | Shared helper reused | `fetchEntityKeyboard` `src/telegram.js:86` reached by `:395`, `:435`, `:455`, `:611`, `:617` | ✅ COMPLIANT |
| test-coverage | telegram.js Tests Import the Real Module | Real authorization logic is exercised | `tests/telegram.test.js` imports `createTelegramBot`; M1/M2/M3 killed | ✅ COMPLIANT |
| test-coverage | index.js Tests Import the Real Module | Real option-parsing logic is exercised | `tests/index.test.js:5-10`; M5/M8 killed | ✅ COMPLIANT |
| test-coverage | New Behavior Introduced By This Change Is Covered | Forged entity_id rejected without an HA call | forged-entity block; M3 killed | ✅ COMPLIANT |
| test-coverage | Full Suite Stays Green | CI passes end to end | 137/137 green, exit 0; no re-implemented production logic in any test file | ✅ COMPLIANT |
| bot-localization | English-Only User-Facing Copy | No Spanish in outbound messages | `check:lang` exit 0; Spanish scans over `src/` return nothing | ✅ COMPLIANT |
| bot-localization | English-Only Logs and Comments | No Spanish log strings remain | Same scans clean | ✅ COMPLIANT |
| bot-localization | Commands Are Renamed to English With No Aliases | Old Spanish command is no longer recognized | `tests/telegram.test.js:741-769`, 8 tests green; **mutant M19 killed 136/1, M20 killed 129/8**; amended `THEN` clause matches implemented behavior | ✅ COMPLIANT (was ❌ UNTESTED) |
| bot-localization | Commands Are Renamed to English With No Aliases | New English command runs the flow | `tests/telegram.test.js:235-413`; mutant M15 killed | ✅ COMPLIANT |
| addon-configuration | Renamed and Retyped Options | config.yaml reflects the new schema | `config.yaml:17-25`; untouched since `799a199` | ✅ COMPLIANT |
| addon-configuration | Add-on Description Is English | Description is English | `config.yaml:4` | ✅ COMPLIANT |
| project-documentation | README Matches Actual Connection and Authorization Behavior | README connection section matches code | `README.md` cross-checked; untouched since `799a199` | ✅ COMPLIANT |
| project-documentation | Command Migration Table | Table is present and complete | `README.md:154-169`, all 8 renames plus the no-alias note | ✅ COMPLIANT |
| project-documentation | Config Migration Note | Migration note is present | `README.md:171-182` | ✅ COMPLIANT |
| project-documentation | Testing Section Matches Reality | Testing claim matches the test-coverage capability | `README.md:227-231` | ✅ COMPLIANT |
| project-documentation | OPTIONS_PATH Documented | OPTIONS_PATH appears in README | `README.md:205,238-249` | ✅ COMPLIANT |

**Compliance summary**: 33/33 scenarios compliant, 0 UNTESTED, 0 PARTIAL, 0 FAILING.
**Requirement summary**: 28/28 requirements satisfied.

### Per-capability verdict

| Capability | Prior verdict | This verdict | Regression? |
|---|---|---|---|
| ha-connection-config | PASS | **PASS** (M8 re-run, still killed) | No |
| bot-authorization | PASS | **PASS** (M1, M3 re-run, still killed) | No |
| process-lifecycle | PASS | **PASS** (untouched) | No |
| code-quality-hygiene | PASS | **PASS** (helper graph re-read; `noProcessEnv` scope re-probed) | No |
| test-coverage | PASS | **PASS** (129 → 137 tests, all green) | No |
| bot-localization | **FAIL** (1 UNTESTED) | **PASS** (blocker closed, proven by M19/M20) | No |
| addon-configuration | PASS | **PASS** (untouched) | No |
| project-documentation | PASS | **PASS** (untouched; README already matched the amended scenario) | No |

8 of 8 capabilities PASS. No capability regressed.

### Coherence (Design — Engram #70)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| 1 — Testability seam (`createBot`, `logger`) | ✅ Yes | The eight new tests use it; no real Telegram client is constructed |
| 2 — `loadConfig()` inside `src/index.js`, no new `src/` file | ✅ Yes | Zero new files under `src/` |
| 2 — Biome `process.env` restriction as compensating control | ✅ Yes | Re-probed this session; covers `src/**`, `tests/**`, `scripts/**`, root JS |
| 3 — Copy inline; tests decoupled from copy | ✅ Yes | The new tests assert counts, not strings — consistent with the decision |
| 3 — Collation stays `"es"` | ✅ Yes | `src/formatter.js` untouched |
| 4 — haClient constants + injected collaborators | ✅ Yes | Untouched by this commit |
| 5 — Two-stage entity gate | ✅ Yes | `src/telegram.js:237-272`; M3 killed |
| 6 — `installProcessHandlers` with injected `processRef`/`exit` | ✅ Yes | Untouched |
| 7 — Biome devDependency + `biome.json` + scripts | ✅ Yes | Untouched |
| Accepted deviation: `size:exception` on `ae4b14b` | ✅ Confirmed | Documented in task `3.6`, checked |
| Accepted deviation: `src/telegram.js` stays one module | ✅ Confirmed | Single module; no ports/adapters |
| Design's DRY target: one shared fetch+keyboard+error helper | ✅ Yes | Re-verified this session |

### Issues Found

**CRITICAL**

None. The single blocker from the prior report is closed and independently proven by mutation.

**WARNING**

1. **CI installs with `npm install` while the Dockerfile uses `npm ci`.**
   `.github/workflows/tests.yml:20` is `- run: npm install`; `Dockerfile:6` is
   `RUN npm ci --omit=dev`. CI therefore does not validate against the committed lockfile that the
   image build depends on. Carried forward unchanged as a non-blocking note per the accepted
   classification: the `code-quality-hygiene` requirement names only the Dockerfile, so this is
   not a spec violation. Worth a one-word follow-up commit regardless.

2. **The outer `callback_query` error handler is untested** (`src/telegram.js:624-633`, still
   uncovered). The keyboard-refresh path deliberately depends on this handler for its error
   behavior, so the one error route the DRY refactor left un-wrapped is also the one with no
   covering test. Not a spec scenario; carried forward.

3. **Retired commands produce total silence, with no migration feedback.** This is now correctly
   specified and correctly tested rather than misdescribed, but it remains a real user-visible
   regression: a user who types `/luces` after upgrading to 2.0.0 sees nothing at all and gets no
   pointer to `/lights`. The amended spec records it as deliberate future work and `README.md:167-169`
   documents it. Raised as a WARNING rather than dropped, so that "the scenario passes" is never
   mistaken for "the migration experience is good." A catch-all `bot.on("message")` replying with
   the rename table would close it in one small change.

**SUGGESTION**

1. **Per-command copy is not pinned.** Mutants M16 (`/covers` empty-state text) and M17
   (`/cameras` list text) survived in the prior run and nothing in this commit changes that. This
   follows design Decision 3 and is not a defect. Note the `user-facing copy` block's callback
   assertion uses `/[Nn]ot authorized/`, which matches both `"Not authorized."` and
   `"Entity not authorized."`, so it does not discriminate the two denial kinds; the behavioral
   tests carry that weight instead.

2. **`README.md:233-235` remains marginally overstated.** Re-probed this session: a `process.env`
   read at `tools/probe.js` is still not flagged, because `biome.json:10` enumerates directories
   rather than using `**/*.js`. True for every JS file that exists today; false for a hypothetical
   new top-level directory.

3. **Configuration failures still bypass the top-level error handler.** `src/index.js:171`
   evaluates `loadConfig()` as an argument to `bootstrap(...)`, so a synchronous throw escapes
   before `.catch` is attached. Unchanged.

4. **`retryForNonEmpty` still sleeps after its final attempt** (`src/haClient.js:136-149`),
   costing `HA_RETRY.DELAY_MS` of pure latency on every exhausted snapshot retry. Unchanged.

5. **The untracked `debug-options.json` still holds a Telegram bot token in plaintext.** Correctly
   git-ignored with no history, so no requirement is violated. Rotating that token through
   BotFather and deleting or updating the file to the 2.0.0 option names remains recommended.

6. **Remaining uncovered branches in `src/telegram.js`** for a follow-up slice: `158-169`
   (`waitForMediaFile` retry/timeout), `173-180`/`186-192` (expired-callback detection and
   `safeAnswerCallback` error path), `197-198` (`ensureNonEmptyBuffer` throw), `526-531`
   (`camera_list` with zero cameras), `595-597` (re-throw of a non-5xx `camera.record` error).

### Known accepted deviations (verified as described, not re-reported as defects)

| Deviation | State |
|---|---|
| Owner-approved documented `size:exception` on `ae4b14b` | Confirmed; task `3.6` records the measurement and escalation and is checked |
| Credential boundary is a `loadConfig()` function in `src/index.js`, not a separate module | Confirmed; zero new files under `src/`. The `noProcessEnv` compensating control was re-probed this session and still covers every tracked JS file |
| `src/telegram.js` remains a single module; ports-and-adapters was an explicit non-goal | Confirmed; 643 lines, single module |
| Spanish `friendly_name` fixtures and `localeCompare(..., "es")` are intentional | Confirmed; `src/formatter.js` and `tests/formatter.test.js` untouched |
| CI `npm install` vs Dockerfile `npm ci` | Confirmed and carried forward as non-blocking WARNING 1 |

### Unverifiable Without a Live Home Assistant Instance

Unchanged. Satisfied by code inspection and unit tests, but not provable here: Supervisor token
injection via `homeassistant_api: true`; a real `SIGTERM` against real long polling; Supervisor UI
acceptance of the `list(str)` and `int(0,100)` schema; end-to-end English replies and inline
buttons over real Telegram; camera snapshot and record behavior against real camera entities.

### Verdict

**PASS WITH WARNINGS — READY FOR ARCHIVE.**

The sole blocker from the prior report is genuinely closed, and closed with the strong form of
evidence rather than the cheap one. Eight table-driven tests now pin that every retired Spanish
command runs no flow, calls no Home Assistant service, and sends no reply. The required mutation
probe confirms they bite: against a clean isolated baseline of 137 pass / 0 fail, reviving `/luces`
as an alias produces 136 pass / 1 fail, failing exactly `ignores /luces entirely, calling no HA
service and sending no reply` with `actual: 1, expected: 0`. Reviving all eight aliases fails
exactly eight tests, proving each assertion is individually live. The fixture's empty allow-list is
permissive, so the zero-reply assertion measures handler absence and not an authorization denial —
the test is not vacuous.

The accompanying spec amendment is legitimate. It replaced a `THEN` clause describing
"unknown-command handling" that this add-on has never had — there is no catch-all `bot.on("message")`
handler — with the behavior the code actually implements and that `README.md:167-169` already
documented. The normative MUST ("no Spanish alias registered") was never touched and is now better
enforced than before. Decisively, the tightening and the amendment arrived in the same commit; had
the amendment come without the tests, I would have rejected it as accommodation.

No regression anywhere. This commit touched no file under `src/`, coverage is byte-identical at
94.77 / 90.75 / 93.10, and the previously resolved findings were re-executed rather than assumed:
M8 still killed (136/1), M1 still killed (125/12), M3 still killed (134/3), the `noProcessEnv`
scope re-probed, and the `fetchEntityKeyboard` call graph re-read. All 8 capabilities PASS, 33/33
scenarios compliant, 28/28 requirements satisfied, 80/80 tasks complete, `node --test` exit 0,
`npx biome check .` exit 0, `npm run check:lang` exit 0.

Three WARNINGs remain and none of them blocks archive: the CI/Dockerfile install mismatch outside
the spec, the untested outer `callback_query` error handler, and the migration-silence UX that the
spec now honestly records as future work. That last one is a real product gap and should not be
read as closed — it is correctly specified, not solved.

**Proceed to `sdd-archive`.**
