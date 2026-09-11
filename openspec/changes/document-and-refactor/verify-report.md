```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:47edcb9ad00462f81ee6fd47007a7e028a5a5d16ebb1b0c1d6f46a398d40b41a
verdict: fail
blockers: 3
critical_findings: 3
requirements: 26/28
scenarios: 28/33
test_command: node --test
test_exit_code: 0
test_output_hash: sha256:00e0fc4abf1596eeba1f00e0c0e495270fbd80f81db51e6cb512b7e9202525bb
build_command: npx biome check .
build_exit_code: 0
build_output_hash: sha256:b5d99a241ca2445f6addfcb6926bd3eabf8051706ae73eba3427b61233eca97d
```

## Verification Report

**Change**: document-and-refactor
**Repository**: ha-status-bot
**Branch / HEAD**: `test/telegram-seam-and-coverage` @ `622fd04` (clean working tree)
**Mode**: Standard (Strict TDD not active at verification time)
**Artifact store**: hybrid (OpenSpec files + Engram)

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 75 |
| Tasks complete | 74 |
| Tasks incomplete | 1 (`3.6`, `openspec/changes/document-and-refactor/tasks.md:139`) |
| Spec requirements | 28 across 8 capabilities |
| Spec scenarios | 33 across 8 capabilities |

The tasks artifact (Engram #73) and apply-progress (Engram #74) both assert every task is
complete. That is not accurate: task `3.6` is still `- [ ]`. Its body records that the check
*was* performed (423 measured lines) and the owner-approved `size:exception` resolved it, so
this is a bookkeeping omission, not unfinished work.

### Build & Tests Execution

**Tests**: PASSED — 114 passed / 0 failed / 0 skipped

```text
$ node --test
ℹ tests 114
ℹ suites 31
ℹ pass 114
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 292.09175
(exit code 0)
```

**Build / static analysis**: PASSED

```text
$ npx biome check .
Checked 11 files in 13ms. No fixes applied.
(exit code 0)

$ npm run lint
Checked 11 files in 31ms. No fixes applied.
(exit code 0)

$ npm run check:lang
check:lang passed — no Spanish characters found under src/**.
(exit code 0)
```

**Coverage** (`node --test --experimental-test-coverage`): 88.35% lines / 89.89% branches /
90.91% functions overall. No project threshold is configured.

| File | Line % | Branch % | Funcs % | Uncovered lines |
|---|---|---|---|---|
| `src/formatter.js` | 100.00 | 94.92 | 100.00 | — |
| `src/haClient.js` | 98.13 | 84.00 | 81.25 | 7-9, 138-139 |
| `src/index.js` | 92.00 | 92.68 | 86.96 | 8-10, 110-111, 120-123, 171-175 |
| `src/telegram.js` | 77.83 | 87.96 | 82.05 | 113-124, 128-135, 141-147, 152-153, 235-238, 341-368, 392-419, 423-448, 461-464, 512-517, 581-583, 609-618, 622 |

### Mutation evidence (test-suite effectiveness)

Run against an isolated copy of `src/` + `tests/` in a scratch directory; the repository was
never modified. Each mutant was applied to a pristine copy, one at a time.

| Mutant | Result | Killed? |
|---|---|---|
| baseline (pristine) | 114 pass / 0 fail | — |
| M1 invert `isAllowed` (`src/telegram.js:19`) | 107 pass / 7 fail | YES |
| M2 chunk limit 3900 → 100000 (`src/telegram.js:23`) | 113 pass / 1 fail | YES |
| M3 disable entity membership gate (`src/telegram.js:470`) | 111 pass / 3 fail | YES |
| M4 drop `allowed_chat_ids` parsing (`src/index.js:41`) | 112 pass / 2 fail | YES |
| M5 replace `requireEnv(env,"SUPERVISOR_TOKEN")` with a literal (`src/index.js:73`) | 111 pass / 3 fail | YES |
| M6 remove SIGTERM handler (`src/index.js:126`) | 112 pass / 2 fail | YES |
| M7 `unhandledRejection` exits instead of logging (`src/index.js:133`) | 113 pass / 1 fail | YES |
| M8 `HA_DEFAULT_BASE_URL` → `http://homeassistant.local:8123/api` (`src/index.js:6`) | **114 pass / 0 fail** | **NO — SURVIVED** |
| M9 gate `/chatid` (`src/telegram.js:330`) | 113 pass / 1 fail | YES |
| M10 revert the `605726e` camera-proxy fix (`src/haClient.js:121`) | 113 pass / 1 fail | YES |
| M11 remove `/start` allow-list gate (`src/telegram.js:275`) | 112 pass / 2 fail | YES |

### Spec Compliance Matrix

| Capability | Requirement | Scenario | Evidence | Result |
|---|---|---|---|---|
| ha-connection-config | Supervisor Token From Environment Only | Startup reads the injected token | `tests/index.test.js:63-70`; `tests/haClient.test.js:87`; mutant M5 killed | COMPLIANT |
| ha-connection-config | Supervisor Token From Environment Only | Missing token fails fast | `tests/index.test.js:72-84`; live run exits 1 with `Missing SUPERVISOR_TOKEN. Check homeassistant_api: true in config.yaml.` | COMPLIANT |
| ha-connection-config | Supervisor Proxy Base URL By Default | Default base URL is the Supervisor proxy | `src/index.js:6` correct; `tests/index.test.js:45-52` asserts against the exported constant itself — tautological; mutant M8 survived | **UNTESTED** |
| ha-connection-config | Supervisor Proxy Base URL By Default | No stray hostnames in source | `git grep homeassistant.local -- src` returns nothing | COMPLIANT |
| bot-authorization | Chat-ID Allow-List Gates Privileged Commands | Allowed chat proceeds | `tests/telegram.test.js:128-137` | COMPLIANT |
| bot-authorization | Chat-ID Allow-List Gates Privileged Commands | Disallowed chat is denied with guidance | `tests/telegram.test.js:139-148`, `:591-597`; mutant M1 killed | COMPLIANT |
| bot-authorization | /start and /help Are Gated | Unauthorized /start is denied | `tests/telegram.test.js:533-541`; mutant M11 killed | COMPLIANT |
| bot-authorization | /chatid Stays Ungated By Design | Unknown user discovers their chat_id | `src/telegram.js:326-333` (comment present); `tests/telegram.test.js:580-587`, `:599-605`; mutant M9 killed | COMPLIANT |
| bot-authorization | Entity-ID Membership Validation Before Privileged Calls | Offered entity is accepted | `tests/telegram.test.js:522-529` | COMPLIANT |
| bot-authorization | Entity-ID Membership Validation Before Privileged Calls | Forged entity is rejected before any HA call | `src/telegram.js:214-227,468-476`; `tests/telegram.test.js:473-520`; mutant M3 killed | COMPLIANT |
| process-lifecycle | Graceful Shutdown on SIGTERM/SIGINT | SIGTERM stops polling and exits | `src/index.js:126-127`; `tests/index.test.js:284-322`; mutant M6 killed | COMPLIANT |
| process-lifecycle | Unhandled Errors Are Logged, Not Silently Swallowed | Unhandled rejection is logged | `src/index.js:132-139`; `tests/index.test.js:324-349`; mutant M7 killed | COMPLIANT |
| process-lifecycle | Startup Fails Fast on Missing Configuration | Missing bot token halts startup | `tests/index.test.js:153-161`; live run exits 1 with `Invalid add-on configuration — telegram_bot_token: must be a non-empty string` | COMPLIANT |
| code-quality-hygiene | Reproducible Docker Install | Dockerfile uses npm ci | `Dockerfile:6` — `RUN npm ci --omit=dev` | COMPLIANT |
| code-quality-hygiene | package.json Declares Engine and License | Engine and license present | `package.json:5-8` — `"license": "MIT"`, `"engines": {"node": ">=20"}` | COMPLIANT |
| code-quality-hygiene | Lint and Format Tooling Available | Lint script runs | `package.json:13-17`; `npm run lint` exits 0 | COMPLIANT |
| code-quality-hygiene | Single Named Constant Per Shared Magic Number | One declaration per constant | chunk size `src/telegram.js:23` OK; retry count and cooldown `src/haClient.js:1-5` OK; **camera clip duration has no named constant** | **NOT SATISFIED** |
| code-quality-hygiene | Shared Helper for Repeated Fetch+Keyboard+Error Pattern | Shared helper reused | No such helper exists; four call sites still repeat the pattern independently | **NOT SATISFIED** |
| test-coverage | telegram.js Tests Import the Real Module | Real authorization logic is exercised | `tests/telegram.test.js:4`; mutants M1/M2 killed | COMPLIANT |
| test-coverage | index.js Tests Import the Real Module | Real option-parsing logic is exercised | `tests/index.test.js:5-10`; mutant M4 killed | COMPLIANT |
| test-coverage | New Behavior Introduced By This Change Is Covered | Forged entity_id is rejected without an HA call | `tests/telegram.test.js:473-494`; `tests/index.test.js:284-349` | COMPLIANT |
| test-coverage | Full Suite Stays Green | CI passes end to end | 114/114 green; no re-implemented production logic in any test file | COMPLIANT |
| bot-localization | English-Only User-Facing Copy | No Spanish in outbound messages | Full read of `src/telegram.js` + `src/formatter.js`; `check:lang` clean; unaccented-Spanish word scan clean | COMPLIANT |
| bot-localization | English-Only Logs and Comments | No Spanish log strings remain | Full read of all four `src/` modules; the former `haClient.js:153` comment is now English at `src/haClient.js:212-213` | COMPLIANT |
| bot-localization | Commands Are Renamed to English With No Aliases | Old Spanish command is no longer recognized | Statically verified: the 11 `bot.onText` registrations contain no Spanish name. No test drives an old command | **UNTESTED** |
| bot-localization | Commands Are Renamed to English With No Aliases | New English command runs the flow (`/lights`) | `/lights`, `/covers`, `/cameras` handlers are never invoked by any test (coverage: `src/telegram.js` 341-368, 392-419, 423-448 uncovered) | **UNTESTED** |
| addon-configuration | Renamed and Retyped Options | config.yaml reflects the new schema | `config.yaml:17-25` matches the table exactly | COMPLIANT |
| addon-configuration | Add-on Description Is English | Description is English | `config.yaml:4` | COMPLIANT |
| project-documentation | README Matches Actual Connection and Authorization Behavior | README connection section matches code | `README.md:36-64,126-144,191-209,253-262` cross-checked against `src/index.js`, `src/telegram.js`, `Dockerfile` | COMPLIANT |
| project-documentation | Command Migration Table | Table is present and complete | `README.md:154-169` (8 renames) + `README.md:108-123` (11 commands) + no-alias note at `:151-152,167-169` | COMPLIANT |
| project-documentation | Config Migration Note | Migration note is present | `README.md:171-182` | COMPLIANT |
| project-documentation | Testing Section Matches Reality | Testing claim matches the test-coverage capability | `README.md:227-231`; verified true by reading the four test files | COMPLIANT |
| project-documentation | OPTIONS_PATH Documented | OPTIONS_PATH appears in README | `README.md:205,238-249` | COMPLIANT |

**Compliance summary**: 28/33 scenarios compliant, 5 non-compliant (2 NOT SATISFIED, 3 UNTESTED).
**Requirement summary**: 26/28 requirements satisfied.

### Correctness (Static Evidence — highest-risk claims)

| Claim under verification | Status | Evidence |
|---|---|---|
| No hardcoded credential anywhere in `src/`, `tests/`, `config.yaml`, `Dockerfile`, `README.md`, or any fixture | CONFIRMED | JWT-shaped, long-base64, and Telegram-token-shaped pattern scans over all tracked files return nothing; `git log --all -S 'eyJhbGciOi'` returns nothing, so the incident literal was never committed. README examples use `<your-long-lived-access-token>` placeholders only |
| `loadConfig()` is the single reader of `process.env` in `src/` | CONFIRMED | `git grep process.env -- src` returns exactly one hit, `src/index.js:57` |
| Exactly one `// biome-ignore` in the whole repository | CONFIRMED | `git grep biome-ignore` returns exactly one code hit, `src/index.js:56` |
| The `noProcessEnv` rule genuinely fires (not a silent no-op) | CONFIRMED | Isolated probe with this repo's own `biome.json` rule block: an unsuppressed `process.env` read emits `lint/style/noProcessEnv`; the suppressed form emits nothing |
| Tests import and drive the real modules | CONFIRMED | `tests/telegram.test.js:4` imports `createTelegramBot`; `tests/index.test.js:5-10` imports `bootstrap`/`loadConfig`/`installProcessHandlers`/`HA_DEFAULT_BASE_URL`; mutants M1–M7, M9–M11 all killed, so real handler bodies are driven |
| `entity_id` validation is real authorization, not a shape-only regex | CONFIRMED | `src/telegram.js:198-206` maps each action to the same formatter selector that built the keyboard (`getAllLights`/`getAllCovers`/`getAllCameras`); `:225` requires exact `entity_id` membership in the selector output; the regex at `:193` is explicitly labelled shape-only |
| `/chatid` is still ungated with a deliberate-design comment | CONFIRMED | `src/telegram.js:326-333`; comment names the spec requirement and instructs not to add `isAllowed` |
| `localeCompare(..., "es")` retained | CONFIRMED | `src/formatter.js:15` and `:123`, with an English rationale comment at `:9-13` |
| Spanish `friendly_name` fixtures retained as data | CONFIRMED | `tests/formatter.test.js:34-107` keeps `Salón`, `Batería ventana`, etc., with an explanatory comment at `:19-22` |
| `README.md` matches reality | CONFIRMED (one imprecision) | All 3 option names/types match `config.yaml:17-25`; all 11 commands match the `bot.onText` registrations; all 7 documented scripts exist in `package.json:10-18`. See WARNING 5 for the one overstated sentence |
| `605726e` regression fix is correct and covered | CONFIRMED | `src/haClient.js:96,107,118-122` distinguishes empty-but-reachable from every-candidate-failed; `:190` only disables the proxy on the latter; `tests/haClient.test.js:291-343` covers both directions; mutant M10 killed |

### Coherence (Design — Engram #70)

| Decision | Followed? | Notes |
|---|---|---|
| 1 — Testability seam (`createBot`, `logger`) | YES | `src/telegram.js:234-241`; `tests/helpers/fakeTelegramBot.js` |
| 2 — `loadConfig()` inside `src/index.js`, no new `src/` file | YES | `src/index.js:57-87`; zero new files under `src/` |
| 2 — Biome `process.env` restriction as compensating control | PARTIAL | Rule active and proven to fire, but scoped to `biome.json:10` includes, not repo-wide (WARNING 4) |
| 3 — Copy inline; tests decoupled from copy | YES | One `describe("user-facing copy")` block per file (`tests/telegram.test.js:590`) |
| 3 — Collation stays `"es"` | YES | `src/formatter.js:15,123` |
| 4 — haClient constants + injected collaborators, public surface unchanged | YES | `src/haClient.js:1-18,261-267` |
| 5 — Two-stage entity gate | YES | `src/telegram.js:192-227` |
| 6 — `installProcessHandlers` with injected `processRef`/`exit` | YES | `src/index.js:92-140` |
| 7 — Biome devDependency + `biome.json` + scripts | YES | `package.json:13-17,22-24`; `biome.json` |
| Accepted deviation: `size:exception` on `ae4b14b` | CONFIRMED | Commit exists; task `3.6` documents the 423-line measurement and the escalation |
| Accepted deviation: `src/telegram.js` stays one module | CONFIRMED | 627 lines, single module, no ports/adapters |
| Design's DRY target: one shared fetch+keyboard+error helper | **NO** | Only keyboard *builders* were shared; see CRITICAL 1 |

### Issues Found

**CRITICAL**

1. **`code-quality-hygiene` → "Shared Helper for Repeated Fetch+Keyboard+Error Pattern" is UNMET.**
   The requirement states that the lights, covers, cameras handlers and the callback-refresh
   path "MUST call one shared helper instead of independently repeating the pattern," and its
   scenario requires "all four call sites invoke the same shared helper function." No such
   helper exists. `src/telegram.js:340-369` (`/lights`), `:391-420` (`/covers`), and
   `:422-449` (`/cameras`) each independently repeat the identical sequence — allow-list
   check, `try`, `await ha.getStates()`, selector call, `console.log` count, empty-list early
   return, `sendMessage` with an inline keyboard, `catch` with the same error copy — and the
   refresh block at `:593-607` repeats the fetch-plus-rebuild half. Phase 6 extracted
   `buildLightKeyboard`/`buildCoverKeyboard` (`src/telegram.js:50-77`), which shares the
   keyboard *construction* only; the apply-progress artifact describes that work as satisfying
   this requirement, which it does not.

2. **`code-quality-hygiene` → "Single Named Constant Per Shared Magic Number" is UNMET for the
   camera clip duration.** Three of the four named values are correct (chunk size
   `src/telegram.js:23`; `HA_RETRY.ATTEMPTS` and `HA_RETRY.SNAPSHOT_COOLDOWN_MS`
   `src/haClient.js:1-5`). The camera clip duration has no named constant anywhere: the raw
   literal `30` appears as a default parameter at `src/haClient.js:219` and as a call argument
   at `src/telegram.js:552`, and is additionally hard-coded into five user-facing strings and
   identifiers at `src/telegram.js:89,90,542,548,559,560`. Changing the clip length today
   requires editing at least seven places across two modules.

3. **`ha-connection-config` → "Default base URL is the Supervisor proxy" has no non-tautological
   covering test; the original incident's second defect can be reintroduced silently.** The
   production value at `src/index.js:6` is correct. The only test of the default,
   `tests/index.test.js:45-52`, asserts
   `config.homeAssistant.baseUrl === HA_DEFAULT_BASE_URL` — both sides are read from the same
   module, so the assertion holds for *any* value of the constant. Proven by mutation M8:
   rewriting `HA_DEFAULT_BASE_URL` to the exact pre-change defect value
   `http://homeassistant.local:8123/api` leaves the suite at **114 passed / 0 failed**. Every
   other `http://supervisor/core/api` literal in the suite is an *input* passed into
   `createHomeAssistantClient` (`tests/haClient.test.js:77,110,146,168,195,219,237,269,298,328`)
   or an assertion against a hand-written fake config (`tests/index.test.js:194,219`), so none
   of them pin the default either. This change exists because that constant was once wrong;
   the suite currently cannot detect it going wrong again.

**WARNING**

1. **The `callback_query` allow-list denial branch has zero test coverage.** The
   `bot-authorization` requirement covers "any command **or callback**." The command direction
   is well covered, but coverage reports `src/telegram.js:461-464` — the body of the
   `if (!isAllowed(chatId, allowedChatIds))` guard inside the `callback_query` handler
   (`:460-464`) — as never executed. No test sends an inline-button callback from a chat
   absent from the allow-list. Mutant M1 was killed only through command paths.

2. **Three command handlers are never invoked by any test.** Coverage shows
   `src/telegram.js:341-368` (`/lights`), `:392-419` (`/covers`), and `:423-448` (`/cameras`)
   entirely uncovered — roughly 90 lines including their allow-list gates, empty-list replies,
   keyboard construction, and error handling. This is the direct cause of the `bot-localization`
   "New English command runs the flow" scenario being UNTESTED, and it leaves the design's
   stated testing strategy ("telegram behavioral: every command") unfulfilled.

3. **No test asserts that an old Spanish command is ignored.** The no-alias property was
   verified statically (all 11 `bot.onText` regexes are English), but nothing prevents a future
   edit from re-registering `/luces`. Note also that the spec scenario's wording ("falls
   through to unknown-command handling") does not match reality: there is no catch-all
   `bot.on("message")` handler, so an unrecognized command produces no reply at all.
   `README.md:167-169` documents the real behavior correctly.

4. **The Biome `process.env` restriction is narrower than the design and README claim.**
   `biome.json:10` limits the checked file set to `src/**`, `tests/**`, and `*.json`. Biome
   confirms this by reporting "Checked 11 files". The design (Engram #70, Decision 2) specifies
   a *repo-wide* restriction as the compensating control for the function-scoped credential
   boundary. In practice a new `process.env` read added under `scripts/**` or at the repository
   root would not be flagged, weakening the "any second suppression is a review red flag"
   signal the design relies on.

5. **`README.md:233-235` overstates that Biome forbids `process.env` "anywhere except the
   single authorized entry point."** Accurate for `src/` and `tests/`; not accurate for the
   rest of the repository, per WARNING 4.

6. **Task `3.6` is unchecked while both the tasks artifact and apply-progress claim completion.**
   `openspec/changes/document-and-refactor/tasks.md:139` is `- [ ]`. Its own body records the
   measurement and escalation, and the `size:exception` was approved, so this is bookkeeping
   drift rather than unfinished work — but the artifacts' "all complete" claim is currently
   false, and any automated completeness check will flag it.

7. **CI installs with `npm install` while the Dockerfile uses `npm ci`.**
   `.github/workflows/tests.yml:20` runs `npm install`, so CI does not validate against the
   committed lockfile that `Dockerfile:6` depends on. The `code-quality-hygiene` requirement
   names only the Dockerfile, so this is not a spec violation, but it defeats part of the
   reproducibility intent.

**SUGGESTION**

1. **Configuration failures bypass the intended top-level error handler.** At
   `src/index.js:171`, `loadConfig()` is evaluated as an *argument* to `bootstrap(...)`, so a
   synchronous throw escapes before the `.catch` at `:171-174` is attached. Verified by
   execution: with an empty `telegram_bot_token` and with a missing `SUPERVISOR_TOKEN`, the
   process prints a raw ESM stack trace (`at file://.../src/index.js:171:23`) rather than
   `Error starting HA Status Bot: ...`. The spec requirement still holds — the message is
   explicit English and the exit code is `1` in all three failure cases tested (empty token,
   missing `SUPERVISOR_TOKEN`, unreadable options file) — but the handler is dead code for the
   most likely startup failure. Hoisting `const config = loadConfig();` into the `try`/promise
   chain would fix it.

2. **`retryForNonEmpty` sleeps after its final attempt.** `src/haClient.js:131-145` calls
   `await sleep(delayMs)` inside the loop unconditionally, so the last iteration waits
   `HA_RETRY.DELAY_MS` before throwing. In production that is 1200 ms of pure latency on every
   exhausted snapshot retry. The existing test asserts `sleep.calls` is `[1200, 1200, 1200]`,
   i.e. it currently pins the extra sleep as expected behavior.

3. **A local, untracked `debug-options.json` still holds a Telegram bot token in plaintext.**
   The file is correctly ignored (`.gitignore:3`), is not tracked, and has no history, so it
   does not violate any requirement. Its contents were not inspected beyond key names, types,
   and lengths: it carries a 46-character `telegram_bot_token` string plus the pre-2.0.0 option
   names `allowed_chat_ids` (string) and `low_battery_threshold`. Two operational
   recommendations: rotate that bot token through BotFather, and either delete the file or
   rewrite it with the 2.0.0 option names, since pointing `OPTIONS_PATH` at it now fails
   validation.

4. **Other uncovered branches in `src/telegram.js`** worth a follow-up slice:
   `113-124` (`waitForMediaFile` retry/timeout), `128-147` (expired-callback detection and
   `safeAnswerCallback` error path), `512-517` (`camera_list` with zero cameras),
   `581-583` (re-throw of a non-5xx `camera.record` error), `609-618` (the callback error
   handler that sends the `⚠️ Error in ...` message).

5. **`scripts/check-lang.js` is outside the Biome file set** (`biome.json:10`), so the only
   JavaScript file in the repository that is neither linted nor format-checked is the one that
   enforces a code-style policy.

### Unverifiable Without a Live Home Assistant Instance

These requirements are satisfied by code inspection and unit tests but cannot be proven here.
Classified as unverifiable rather than passed.

| Item | What a human must do to confirm |
|---|---|
| Supervisor actually injects `SUPERVISOR_TOKEN` because of `homeassistant_api: true` | Install the 2.0.0 add-on on a Supervisor instance and confirm it reaches `HA Status Bot started successfully.` without setting any environment variable manually |
| Real `SIGTERM` stops real long polling and exits 0 | Stop the add-on from the Home Assistant UI and confirm the log shows `Received SIGTERM, shutting down gracefully...` with no force-exit line and no restart loop |
| Supervisor UI accepts the `list(str)` and `int(0,100)` schema and forces reconfiguration | Upgrade an existing 1.x install and confirm the Configuration tab shows the three new options and refuses to start until `telegram_bot_token` is set |
| End-to-end English replies and inline buttons over real Telegram | Run all 11 commands and exercise light/cover toggles and both camera actions from an allowed chat |
| Camera snapshot/record behavior against real camera entities | Trigger `camera_img` and `camera_vid30` on a camera that returns blank frames and confirm the proxy path is still used on the next attempt |

### Verdict

**FAIL**

Two `code-quality-hygiene` MUST requirements are unimplemented, and the regression guard for one
of the two defects that motivated this entire change is absent — proven by a surviving mutant,
not inferred. Everything else is in good shape: 114/114 tests green, Biome and the language guard
clean, no credential anywhere in tracked source or history, `loadConfig` genuinely the single
`process.env` reader with exactly one working suppression, real modules genuinely exercised by
the tests, entity authorization genuinely a membership check, `/chatid` deliberately ungated, the
`"es"` collation and Spanish fixtures correctly preserved, and a README that matches the code.
