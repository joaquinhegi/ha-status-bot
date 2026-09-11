# Tasks: Document and Refactor ha-status-bot

## Prerequisite (operational, not a task)

The Supervisor JWT hardcoded at `src/index.js:39` must be **revoked by the user** in Home Assistant
(Profile → Long-lived access tokens). This is owned outside the code change and is not gated on any
unit below; unit 1a removes the literal from source regardless of revocation timing.

**ZERO NEW FILES under `src/`.** All production edits land in `src/index.js`, `src/haClient.js`,
`src/telegram.js`, `src/formatter.js`. `src/telegram.js` stays one ~582-line module — no splitting.
`tests/` files may be rewritten in place; `tests/helpers/fakeTelegramBot.js` is a new TEST file
(outside the `*.test.js` glob) and is allowed. `biome.json` and a devDependency are allowed.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2,290 aggregate across 10 units |
| 400-line budget risk | High (aggregate); every individual unit ≤400 |
| Chained PRs recommended | Yes |
| Suggested split | 10 stacked PRs, PR 1 → PR 10 |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

**Decision needed before apply: Yes** — every individually forecast unit is at or under 400, so no
single unit currently overruns the budget. Unit **2a (~356)** is the tightest and the most likely to
overrun once real numbers are measured; if `git diff --stat` on 2a lands over 400, apply the
**Option B contingency split** below (5b's technique, applied to 2a is not pre-planned — instead
stop and ask the user for a new split, since 2a has no pre-approved fallback slice). Unit **5b
(~316 estimated, ~526 without Decision 3's copy-decoupled tests)** already carries an approved
fallback split, recorded below as a contingency.

### Suggested Work Units / PR Stack

`stacked-to-main`: each PR branches from the previous PR's branch; the whole stack merges to `main`
in order 1 → 10.

| PR | Branch (base = previous PR branch, PR 1 base = `main`) | Title | Unit | Est. changed | Focused test | Runtime harness | Rollback boundary |
|----|----------------------------------------------------------|-------|------|-------------|--------------|------------------|--------------------|
| 1 | `fix/secrets-and-config` | fix: restore SUPERVISOR_TOKEN env read and Supervisor proxy URL | 1a | ~10 | `node --test` | N/A — no runtime harness exists yet; manual `node src/index.js` smoke start against real `/data/options.json` is the closest available check | Revert restores nothing dangerous; reapplying the hardcode is prevented by review, not by code |
| 2 | `refactor/load-config-bootstrap` | refactor: extract loadConfig + bootstrap export + entrypoint guard | 1b | ~220 | `node --test tests/index.test.js` | N/A — no live Telegram/HA credentials in CI; `bootstrap` is exercised only via injected fakes | Revert `src/index.js` to pre-`loadConfig` shape; no other file depends on the export yet |
| 3 | `test/telegram-seam-and-coverage` | test: inject createBot seam, add FakeTelegramBot, replace re-implemented telegram tests | 2a | ~356 | `node --test tests/telegram.test.js` | N/A — FakeTelegramBot is itself the harness; no real Telegram/HA endpoint touched | Revert `tests/telegram.test.js` and drop the `createBot` param; production behavior unchanged (behavior-neutral unit) |
| 4 | `test/telegram-coverage-completion` | test: cover callback dispatch, camera flows, media fallback | 2b | ~210 | `node --test tests/telegram.test.js` | N/A — test-only unit, no runtime scenario | Revert test file only; zero production risk |
| 5 | `feat/authz-hardening-lifecycle` | feat: entity-id membership gate, /start+/help gating, process lifecycle handlers | 3 | ~220 | `node --test` | Manual: send SIGTERM to a running bootstrap in a throwaway process and confirm exit code 0 within timeout | Revert `src/telegram.js` gate + `src/index.js` `installProcessHandlers`; independent of units 1-2 |
| 6 | `refactor/haclient-dry` | refactor: haClient constants/helpers, injected sleep/now, English haClient + shared keyboard builders | 4 | ~300 | `node --test tests/haClient.test.js tests/telegram.test.js` | N/A — DRY refactor with unchanged public surface; existing tests are the harness | Revert `src/haClient.js` and the two telegram.js keyboard builders independently; public API contract unchanged |
| 7 | `i18n/formatter-english` | docs(i18n): English formatter.js output, collation comment | 5a | ~190 | `node --test tests/formatter.test.js` | N/A — pure function module, tests are the harness | Revert `src/formatter.js` strings; Spanish fixture data in tests is untouched either way |
| 8 | `i18n/telegram-english-commands` | docs(i18n): English telegram.js copy + command renames | 5b | ~316 (see contingency) | `node --test tests/telegram.test.js` | Manual: run bot against a test HA instance, confirm `/status` responds and `/estado` does not | Revert `src/telegram.js` literals/regexes and the `describe("user-facing copy")` test block only |
| 9 | `chore/addon-config-tooling` | chore: config.yaml rename, npm ci, Biome, check:lang, version bump | 6 | ~120 | `node --test && npm run check && npm run check:lang` | Manual: validate `config.yaml` against HA Supervisor schema tooling if available | Revert `config.yaml`, `package.json`, `biome.json`, `Dockerfile` independently; each is a standalone file |
| 10 | `docs/readme-rewrite` | docs: rewrite README for actual behavior + migration notes | 7 | ~350 | N/A — documentation only | N/A — no runtime behavior | Revert `README.md` only |

### Contingency: unit 5b fallback split (apply only if measurement overruns 400)

If `git diff --stat` on unit 5b (branch `i18n/telegram-english-commands`) shows more than 400
changed lines, split into two PRs before opening review, inserted between PR 7 and PR 9:

- **5b-1** `i18n/telegram-command-renames` (~130 changed): the 8 `onText` regexes, the `/start`
  command list (`src/telegram.js:212-223`), the `/help` command list (`:232-241`), and the ~10
  `console.log` lines embedding command names. Isolates the entire user-visible breaking rename
  into one revertible commit — matches the README migration table exactly.
- **5b-2** `i18n/telegram-reply-copy` (base = 5b-1 branch, ~186 changed): remaining reply/button/log
  copy in `src/telegram.js`. If this alone still exceeds 400 after the split, take a documented
  `size:exception` on 5b-2 rather than slicing a third time (design's Option C).

Do not pre-apply this split speculatively — measure first (see 8.4 below).

## Phase 1: Secrets and Config (Unit 1a — PR 1, alone)

- [x] 1.1 In `src/index.js:39`, delete the hardcoded JWT literal and its trailing comment; restore
      `const supervisorToken = process.env.SUPERVISOR_TOKEN;`. Do not reproduce the removed literal
      anywhere (commit message, comment, or artifact). — DONE at baseline commit `50b2442`, verified.
- [x] 1.2 In `src/index.js:45,49`, delete the hardcoded `"http://homeassistant.local:8123/api"` and
      uncomment/restore `baseUrl: "http://supervisor/core/api"` at the `createHomeAssistantClient` call.
      — DONE at baseline; `HA_BASE_URL` env override added on top (`process.env.HA_BASE_URL ||
      "http://supervisor/core/api"`), verified.
- [x] 1.3 Add `.vscode/` and `.DS_Store` to `.gitignore` (currently untracked, not ignored). — DONE at
      baseline commit `50b2442`, verified present.
- [x] 1.4 Verify: `node --test` passes (no test currently asserts on config, so this is a smoke check
      only — real config tests land in unit 1b). Run `git diff --stat` and confirm ≤10 changed lines.
      — Verified: baseline `git diff 820c088 --stat` is empty (already committed), 59/59 tests passing.
- [x] 1.5 Commit as its own work unit per `work-unit-commits`; message states the outcome (secret
      removed, proxy restored), not the file list. — DONE at baseline commit `50b2442`; branch
      `fix/secrets-and-config` created pointing at this commit as the PR-1 base for the stack.

## Phase 2: loadConfig + bootstrap + entrypoint guard (Unit 1b — PR 2)

- [x] 2.1 In `src/index.js`, write `export const HA_DEFAULT_BASE_URL = "http://supervisor/core/api";`
      as a module-level named constant, replacing the inline string from 1.2.
- [x] 2.2 In `src/index.js`, write `export function loadConfig({ env = process.env, readFile } = {})`
      absorbing `loadOptions` (current `:5-12`) and `parseAllowedChatIds` (current `:14`); return a
      deep-frozen `{ telegram: {token, allowedChatIds}, homeAssistant: {baseUrl, token}, thresholds:
      {lowBattery} }`. HA token via a private `requireEnv(env, "SUPERVISOR_TOKEN")` throwing a message
      naming `homeassistant_api: true`. Walk one validation table once; every option name that fails
      validation is named in the thrown error.
- [x] 2.3 In `src/index.js`, replace `main()` with `export async function bootstrap({ config,
      createHaClient = createHomeAssistantClient, startBot = createTelegramBot, logger = console } =
      {})`, using injected collaborators instead of importing directly by name at call sites.
- [x] 2.4 In `src/index.js:63`, replace `main().catch(...)` with an entrypoint guard:
      `if (pathToFileURL(process.argv[1]).href === import.meta.url) { bootstrap({ config: loadConfig()
      }).catch((error) => { logger.error(...); process.exit(1); }); }`.
- [x] 2.5 Translate the remaining Spanish `console.log` strings inside `loadConfig`/`bootstrap`
      (current `:7,10,32,33,36,42,60,64`) to English.
- [x] 2.6 RED: rewrite `tests/index.test.js` to `import { loadConfig } from "../src/index.js"` (delete
      the inline `parseAllowedChatIds` copy at current `:4-14`); add failing cases first: env sourcing,
      Supervisor default URL, missing `SUPERVISOR_TOKEN` throws, chat-id parsing, threshold
      coercion/bounds, invalid option name in the thrown error.
- [x] 2.7 GREEN: confirm `node --test tests/index.test.js` passes against the real `loadConfig`.
- [x] 2.8 Verify: `node --test` full suite green. Run `git diff --stat`; confirm ≈220 changed lines
      before opening PR 2. — MEASURED 380 changed lines (310+/70-), over the ~220 estimate but under the
      400 budget. Committed on `refactor/load-config-bootstrap` at `9e0288b`. 69/69 tests passing.

## Phase 3: Testability Seam + Real telegram.js Coverage, Part 1 (Unit 2a — PR 3, HIGH risk)

- [x] 3.1 In `src/telegram.js:160-166`, add optional `createBot = (token) => new TelegramBot(token, {
      polling: { autoStart: false } })` and `logger = console` parameters to `createTelegramBot`;
      replace the direct `new TelegramBot(token, ...)` call with `createBot(token)`. No new exports.
- [x] 3.2 Create `tests/helpers/fakeTelegramBot.js` (new TEST file, outside `*.test.js` glob): a
      recording double implementing `onText`, `on`, `sendMessage`, `sendPhoto`, `sendVideo`,
      `sendDocument`, `editMessageText`, `editMessageReplyMarkup`, `answerCallbackQuery`, a resolved
      `deleteWebHook()`, and a no-op synchronous `startPolling()`. Registrations recorded synchronously.
- [x] 3.3 RED: rewrite `tests/telegram.test.js` — delete the re-implemented `isAllowed` (current
      `:10-15`) and `splitText` (current `:39-48`); `import { createTelegramBot } from
      "../src/telegram.js"`; drive it with `createBot: () => new FakeTelegramBot()`. Write failing
      cases for: allow-list allow/deny, `/estado` `/sensores` `/puertas` `/bateria` `/temp` simple
      commands (current Spanish command triggers — renaming is unit 5b, out of scope here), and
      chunking over 3900 chars — all via the real module.
- [x] 3.4 Structure assertions only in this unit: assert `sendMessage` was called for the right
      `chat_id` and that the correct number of chunks were sent — never assert on the Spanish copy the
      commands currently produce. Copy-exact assertions are reserved for unit 5b's
      `describe("user-facing copy")` block, added later.
- [x] 3.5 GREEN: `node --test tests/telegram.test.js` passes against real `createTelegramBot`
      (13/13 new tests green; 74/74 full suite green).
- [ ] 3.6 Verify: `git diff --stat`; if this unit measures over 400, stop and report the measured
      number back to the user before opening PR 3 (no pre-approved fallback split exists for 2a). —
      **TRIGGERED**: measured 423 changed lines (362+/61-: `src/telegram.js` 10+/7-,
      `tests/helpers/fakeTelegramBot.js` 102+/0- new file, `tests/telegram.test.js` 250+/54-). Over the
      400 budget by 23 lines. Per the design, there is no pre-approved fallback split for 2a. Work is
      implemented and green but left UNCOMMITTED on branch `test/telegram-seam-and-coverage`, pending a
      user/maintainer decision (accept `size:exception`, or define a new split for this unit).

## Phase 4: Real telegram.js Coverage, Part 2 (Unit 2b — PR 4, test-only)

- [x] 4.1 Extend `tests/telegram.test.js` with structure-first cases for `callback_query` dispatch:
      light on/off, cover open/close, `camera_pick`, `camera_list`, keyboard refresh after action —
      assert `callback_data` values and row counts, not button labels. — DONE: new
      `describe("createTelegramBot callback_query dispatch", ...)` block, 6 tests.
- [x] 4.2 Add cases for `camera_img`/`camera_vid30` media flows and the `sendPhotoWithFallback`/
      `sendVideoWithFallback` document-fallback branch, using `FakeTelegramBot`'s recorded calls. —
      DONE: new `describe("createTelegramBot camera media flows", ...)` block, 5 tests (snapshot send,
      recorded-clip send, 5xx record-unsupported fallback to snapshot, sendPhoto-fails-to-document,
      sendVideo-fails-to-document).
- [x] 4.3 Add a case for the unknown-callback-action branch (`src/telegram.js:520-524`). — DONE: new
      `describe("createTelegramBot callback_query unknown action", ...)` block, 1 test.
- [x] 4.4 Verify: `node --test tests/telegram.test.js`; confirm no production line changed in this
      unit (test-only). `git diff --stat` ≈210. — MEASURED: `git diff --stat HEAD -- src/ tests/` =
      240 changed lines (239+/1-), entirely in `tests/telegram.test.js`; `src/` has zero changes. Full
      suite: 86/86 passing (was 74/74, +12 new tests), zero regressions.

## Phase 5: Authorization Hardening + Process Lifecycle (Unit 3 — PR 5) — DONE

- [x] 5.1 RED: in `tests/telegram.test.js`, add a failing case asserting `callService` is never
      called when a `callback_query` carries `light_on:light.not_offered` or `light_on:../../etc`
      (entity not present in the most recently fetched candidate set). — DONE: new
      `describe("createTelegramBot entity authorization gate", ...)` block; also added cover and
      camera_pick forged-entity cases plus a still-accepts-offered-entity regression case.
- [x] 5.2 In `src/telegram.js`, before line 405's dispatch, add a private `resolveOfferedEntity(action,
      entityId, states)` mapping action prefix to the same formatter selector used to build the
      keyboard (`light_*` → `getAllLights`, `cover_*` → `getAllCovers`, `camera_*` → `getAllCameras`);
      require an exact `entity_id` match. Add a shape gate `/^[a-z_]+\.[a-z0-9_]+$/` before the
      membership check. No match → inline unknown-entity reply, zero service calls, `logger.warn`. —
      DONE. Implemented as `OFFERED_ENTITY_SELECTORS` map + `resolveOfferedEntity`. Gate runs once per
      `callback_query`, fetching `/states` before dispatch; `camera_pick`/`camera_img`/`camera_vid30`
      now reuse `gate.offered` instead of a second lookup (net-neutral fetch count for camera actions,
      +1 `/states` call for light/cover, matching the design's accepted tradeoff). Used `console.warn`
      (matching the file's existing un-migrated logger usage; `logger` param is still only wired to the
      constructor log lines per unit 2a's scope).
- [x] 5.3 GREEN: confirm 5.1's test passes against the real gate. — DONE, all 5 gate tests green.
- [x] 5.4 In `src/telegram.js:205-244`, add the `isAllowed(chatId, allowedChatIds)` check to the
      `/start` and `/help` handlers (currently ungated); leave `/chatid` (current `:246-249`)
      intentionally ungated. — DONE. Added an explanatory English comment above `/chatid` referencing
      the bot-authorization spec's "Stays Ungated By Design" requirement.
- [x] 5.5 RED: add a failing case asserting unauthorized `/start` is denied. — DONE: new
      `describe("createTelegramBot /start and /help gating", ...)` block (6 tests: /start denied,
      /start allowed, /start with empty allow-list, /help denied, /help allowed, /chatid still
      reachable). Structural line-count assertions (`text.split("\n").length`) distinguish the short
      denial reply from the multi-line command list without asserting exact copy.
- [x] 5.6 GREEN: confirm 5.5 passes. — DONE.
- [x] 5.7 In `src/index.js`, write `export function installProcessHandlers({ bot, processRef =
      process, exit = process.exit, logger = console, timeoutMs = 10_000 })`: SIGTERM/SIGINT handler
      with a `shuttingDown` guard calling `await bot.stopPolling({ cancel: true })` then `exit(0)`, a
      `timeoutMs` force-exit timer for a hung stop; `unhandledRejection` logs only, never exits;
      `uncaughtException` logs then `exit(1)`. Wire it into `bootstrap` (no longer discarding the bot
      return at current `:53`). — DONE, wired into `bootstrap` with new optional `processRef`/`exit`/
      `shutdownTimeoutMs` params (all defaulting to production values). Also updated the 3 pre-existing
      `bootstrap` tests to inject a fake `EventEmitter` `processRef` + no-op `exit`, since `bootstrap`
      now unconditionally registers process-level signal/error handlers — without the fake, those tests
      would have attached real listeners to the actual Node process shared across the whole test run.
- [x] 5.8 RED: in `tests/index.test.js`, add a failing case with a fake `EventEmitter` `processRef` and
      a recording `exit` spy: SIGTERM sent twice → exactly one `stopPolling` call, one `exit(0)` call. —
      DONE: new `describe("installProcessHandlers", ...)` block, 5 tests (SIGTERM, repeated SIGTERM,
      SIGINT, unhandledRejection, uncaughtException).
- [x] 5.9 RED: add cases for `unhandledRejection` (never exits) and `uncaughtException` (exits
      non-zero). — DONE.
- [x] 5.10 GREEN: confirm 5.8-5.9 pass against the real `installProcessHandlers`. — DONE, all 5 pass.
- [x] 5.11 In `src/telegram.js:576-578`, extend the `polling_error` log to include `error.code`. —
      DONE.
- [x] 5.12 Verify: `node --test`; `git diff --stat` ≈220 before opening PR 5. — MEASURED: `git diff
      --numstat HEAD -- src/ tests/` = 384 changed lines (src/index.js 58+/0-, src/telegram.js 75+/20-,
      tests/index.test.js 98+/1-, tests/telegram.test.js 132+/0-). Over the ~220 estimate (test-assertion
      volume, consistent with the pattern already seen in units 2a/2b) but under the 400 budget, no
      exception needed. Full suite: `node --test` → 103/103 passing (was 86/86, +17 new tests), zero
      regressions.

## Phase 6: haClient DRY + Shared Keyboard Builders (Unit 4 — PR 6) — DONE

- [x] 6.1 In `src/haClient.js`, replace the literals `3` (`:137`), `1200` (`:150`), `5*60*1000`
      (`:154`) with a frozen `HA_RETRY = { ATTEMPTS: 3, DELAY_MS: 1200, SNAPSHOT_COOLDOWN_MS: 5 * 60 *
      1000 }` module-level constant. — DONE.
- [x] 6.2 In `src/haClient.js`, extract a private `fetchFirstNonEmpty(candidates, label)` unifying the
      candidate-URL fallback chains currently duplicated in `getCameraSnapshot` (`:99-123`) and
      `getMediaFile` (`:176-213`). — DONE. Note: the unified loop now continues to the next candidate
      on an empty-but-ok response too (previously the camera-proxy chain only advanced on a thrown
      error, not on an empty 200). No existing test covers that edge; documented as a deviation below.
- [x] 6.3 In `src/haClient.js`, extract a private `retryForNonEmpty(fn, { attempts, delayMs })`
      replacing the inline retry loop at `:135-151`. — DONE.
- [x] 6.4 Add optional `fetchImpl = fetch`, `sleep = defaultSleep`, `now = Date.now`, `logger =
      console` parameters to `createHomeAssistantClient`; wire the single construction site at
      `src/index.js:48` (now inside `bootstrap`) to pass them through unchanged by default. Public
      return shape (`getStates, callService, getCameraSnapshot, recordCameraClip, getMediaFile`) stays
      identical. — DONE. `src/index.js`'s construction call needed no edit: all four new params default
      to production behavior, so the additive inputs are invisible at the single call site, per design.
- [x] 6.5 Translate the Spanish comment at `src/haClient.js:153` and the Spanish strings at
      `:82,93,107,109,117,119,145,155,204,205,208,212` to English. — DONE, folded into the
      `fetchFirstNonEmpty`/`retryForNonEmpty` consolidation (the per-candidate Spanish messages are now
      the shared helpers' English messages).
- [x] 6.6 In `src/telegram.js`, extract one shared keyboard-builder helper used by the light keyboard
      (current `:278-288`), the cover keyboard (current `:341-352`), and their duplicate refresh
      versions inside `callback_query` (current `:529-563`) — 4 near-identical builders collapse to 1
      call site per domain. — DONE: `buildLightKeyboard(lights)` and `buildCoverKeyboard(covers)`, each
      used at 2 call sites (initial keyboard + post-action refresh).
- [x] 6.7 RED: in `tests/haClient.test.js`, add failing cases for the untested cooldown branch
      (`:90-94`, using injected `now`) and retry-exhaustion (using injected `sleep` as a no-op). — DONE:
      new `describe("camera snapshot retry and cooldown", ...)` block, 1 test covering both branches
      (retry exhaustion via a recording `sleep` spy asserting 3 calls of 1200ms, then a second
      `getCameraSnapshot` call within the cooldown window asserting zero new HTTP calls).
- [x] 6.8 GREEN: confirm 6.7 passes against the real injected collaborators. — DONE.
- [x] 6.9 Verify: `node --test tests/haClient.test.js tests/telegram.test.js`; confirm the
      `callService`/keyboard `callback_data` assertions from units 2a/2b/3 still pass unchanged
      (public behavior net-neutral). `git diff --stat` ≈300 before opening PR 6. — MEASURED: `git diff
      --numstat HEAD -- src/ tests/` = 335 changed lines (`src/haClient.js` 114+/82-, `src/telegram.js`
      33+/48-, `tests/haClient.test.js` 57+/1-). Over the ~300 estimate but under the 400 budget, no
      exception needed. Full suite: `node --test` → 104/104 passing (was 103/103, +1 new test), zero
      regressions.

## Phase 7: English formatter.js (Unit 5a — PR 7) — DONE

- [x] 7.1 In `src/formatter.js`, translate all English-adjacent Spanish headings/labels: `"Ninguno"`
      (`:13`), `"💡 Luces encendidas"` / `"No hay luces encendidas"` (`:131,133`), `"📡 Sensores
      activos"` / `"No hay sensores activos"` (`:141,143`), `"🚪 Puertas / ventanas abiertas"` /
      `"Todo cerrado"` (`:151,153`), `"🔋 Baterías bajas <= …"` / `"No hay baterías bajas"`
      (`:161,163`), `"🌡️ Temperaturas"` / `"No hay sensores de temperatura"` (`:171,173`), and the
      `formatFullStatus` heading block (`:185-200`). — DONE.
- [x] 7.2 At `src/formatter.js:10` and `:123`, keep `localeCompare(..., "es")` unchanged; add an
      English comment explaining collation is matched to the Spanish-language entity data, not to
      interface language. — DONE. One comment block above `byFriendlyName` plus a one-line pointer
      comment on `getTemperatures`'s inline `localeCompare(..., "es")` call.
- [x] 7.3 Update `tests/formatter.test.js` `describe`/`it` titles to English and assertions to the new
      English output strings. Leave fixture `friendly_name` values (`:31-104`, e.g. `"Salón"`,
      `"Batería ventana"`) in Spanish — they are simulated HA data and the regression evidence for 7.2.
      — DONE. Also added one new regression test (`getTemperatures` accented-name sort order) and a
      dedicated `describe("user-facing copy", ...)` block (6 tests) confining every exact-English-string
      assertion; all pre-existing structural assertions were converted away from asserting on the
      now-translated Spanish headings (they assert on bullet content / fixture names / message length
      instead).
- [x] 7.4 Verify: `node --test tests/formatter.test.js`; confirm accented-name sort order assertions
      still pass. `git diff --stat` ≈190 before opening PR 7. — MEASURED: `git diff --numstat HEAD --
      src/ tests/` = 218 changed lines (`src/formatter.js` 28+/23-, `tests/formatter.test.js` 112+/55-).
      Under the 400 budget. Full suite: `node --test` → 111/111 passing (was 104/104, +7 new tests),
      zero regressions.

## Phase 8: English telegram.js Copy + Command Renames (Unit 5b — PR 8)

- [x] 8.1 Rename the 8 `onText` regexes per the mapping table: `/\/estado/`→`/\/status/`,
      `/\/luces/`→`/\/lights/`, `/\/sensores/`→`/\/sensors/`, `/\/puertas/`→`/\/doors/`,
      `/\/bateria/`→`/\/battery/`, `/\/temp/`→`/\/temperature/`, `/\/persianas/`→`/\/covers/`,
      `/\/camaras/`→`/\/cameras/`. `/start`, `/help`, `/chatid` regexes are unchanged. No Spanish
      alias is registered for any renamed command. — DONE.
- [x] 8.2 Update the `/start` command list (`:212-223`) and `/help` command list (`:232-241`) to the
      new English command names and English descriptive text. — DONE.
- [x] 8.3 Translate every remaining Spanish literal/template literal in `src/telegram.js` to English:
      module helpers (`:42-158` — camera labels, media-wait errors, callback-expired warning,
      photo/video captions), `handleCommand` + auth-denial + error copy (`:177-203`), `/luces`/
      `/persianas`/`/camaras` bodies (`:258-297,321-390`), `callback_query` action replies and
      final-refresh log (`:392-574,580`). Touch ONLY string literals, template literals, comments, and
      the regexes from 8.1 — if a hunk changes a condition, argument list, or control flow, move it to
      unit 3, 4, or its own fix-forward commit before this PR opens (compensating control from design).
      — DONE. Verified with `rg` for remaining accented/Spanish tokens in `src/telegram.js`: none found.
- [x] 8.4 MEASURE before writing test assertions: run `git diff --stat` on the production-only diff
      from 8.1-8.3 and confirm it is ≈226 changed lines. If over 400, invoke the 5b-1/5b-2 contingency
      split documented above instead of continuing this unit as one PR. — MEASURED: `src/telegram.js`
      114+/114- = 228 changed lines. Under budget, no split needed.
- [x] 8.5 In `tests/telegram.test.js`, confine every exact-copy assertion to one new
      `describe("user-facing copy", () => { ... })` block — reply text, button labels, toast text.
      Every other existing assertion in the file stays structure-based (from units 2a/2b/3) and needs
      NO edit for this unit, because it never asserted on copy. — DONE: only the pre-existing
      `describe("user-facing copy", ...)` block's Spanish-authorization assertion was translated;
      no other block gained a copy assertion.
- [x] 8.6 Update command-name assertions in the structure-based tests (e.g. `onText` regex matching,
      `handleCommand` dispatch by new command) to the renamed commands from 8.1. — DONE: all
      `bot.emitText("/estado"|"/sensores"|"/puertas"|"/bateria"|"/temp"|"/luces"|"/persianas"|"/camaras", ...)`
      call sites updated to the new English command strings.
- [x] 8.7 Verify: `node --test tests/telegram.test.js`; run `git diff --stat` on the full unit
      (production + test) and confirm it is ≈316. Confirm no hunk outside `describe("user-facing
      copy")` contains a translated string compared with `assert.strictEqual`/`assert.match` against
      literal Spanish or English sentence text. — MEASURED: `git diff --numstat HEAD -- src/ tests/` =
      264 changed lines total (`src/telegram.js` 114+/114- = 228, `tests/telegram.test.js` 18+/18- = 36).
      Under the ≈316 estimate and well under the 400 budget — no split, no size:exception needed.
      Full suite: `node --test` → 113/113 passing (unchanged from before this unit), zero regressions.
      Committed at `db7d57e` on `test/telegram-seam-and-coverage`.

## Phase 9: config.yaml Rename, Dockerfile, package.json, Biome (Unit 6 — PR 9)

- [ ] 9.1 In `config.yaml`, rename `telegram_token` → `telegram_bot_token` (type `password` unchanged)
      in both `options` (`:18`) and `schema` (`:23`); update the `src/index.js` `loadConfig` field
      read to match.
- [ ] 9.2 In `config.yaml`, retype `allowed_chat_ids` from `str` to `list(str)` in `schema` (`:24`);
      name unchanged. Update `loadConfig` to accept the array directly and drop the comma-split
      parsing branch (list input replaces `parseAllowedChatIds`'s comma path).
- [ ] 9.3 In `config.yaml`, rename `low_battery_threshold` → `low_battery_threshold_percent`,
      bounded `int(0,100)` in `schema` (`:25`) and `options` (`:20`); update `loadConfig`'s threshold
      field name and add the 0-100 bound to its validation table.
- [ ] 9.4 In `config.yaml:4`, translate `description` to English.
- [ ] 9.5 In `config.yaml:2`, bump `version` from `"1.0.1"` to `"1.1.0"` — two breaking user-visible
      changes (English replies/renamed commands, renamed options) ship in this change.
- [ ] 9.6 In `Dockerfile:6`, replace `npm install --omit=dev` with `npm ci --omit=dev`.
- [ ] 9.7 In `package.json`, add `"engines": { "node": ">=20" }` and `"license": "MIT"`; bump
      `"version"` to `"1.1.0"` to match 9.5.
- [ ] 9.8 Add `@biomejs/biome` as a devDependency; create `biome.json` with formatter + linter rules,
      including a repo-wide `process.env` restriction (Biome's `noProcessEnv` nursery rule if the
      pinned version supports it; otherwise a restricted-globals rule) that flags every read outside
      `loadConfig`. Add one `// biome-ignore` at the single legitimate read inside `loadConfig`.
- [ ] 9.9 Add `lint`, `lint:fix`, `format`, `check` npm scripts to `package.json`.
- [ ] 9.10 Add a `check:lang` npm script running a grep-equivalent Node check across `src/**` for
      `[áéíóúÁÉÍÓÚñÑüÜ¿¡]` (character-class based, not "any non-ASCII" — emoji are intentional).
- [ ] 9.11 Update `.github/workflows/tests.yml` to run `npm run check` and `npm run check:lang`.
- [ ] 9.12 Verify: `node --test && npm run check && npm run check:lang` all pass. `git diff --stat`
      ≈120 before opening PR 9.

## Phase 10: README Rewrite (Unit 7 — PR 10)

- [ ] 10.1 Rewrite `README.md` to describe the env-token/Supervisor-proxy connection model (matching
      unit 1a/1b), correcting the stale `http://homeassistant.local:8123/api` and hardcoded-token
      references.
- [ ] 10.2 Document the allow-list + entity-id membership authorization model, including why
      `/chatid` intentionally stays ungated.
- [ ] 10.3 Correct the Dockerfile command documentation to `npm ci --omit=dev` (matching unit 6) and
      the `callService`-is-unused claim (it IS used — every light/cover toggle and camera
      snapshot/record call goes through it).
- [ ] 10.4 Add the full old→new command migration table (11 commands, no Spanish aliases kept) per
      the bot-localization spec.
- [ ] 10.5 Add a dedicated "Breaking change: reconfigure after upgrade" section listing all three
      `config.yaml` option renames from unit 6, and a separate note that bot replies are now English
      only with renamed commands (no aliases).
- [ ] 10.6 Correct the Testing section to state that `tests/telegram.test.js` and `tests/index.test.js`
      import and exercise the real modules (matching units 2a/2b/1b).
- [ ] 10.7 Document the `OPTIONS_PATH` environment override for local/dev testing.
- [ ] 10.8 Verify: manual proofread against the actual current source state after PR 9 merges;
      `git diff --stat` ≈350 before opening PR 10.

## Binding Implementation Order

`1a → 1b → 2a → 2b → 3 → 4 → 5a → 5b → 6 → 7` (design's binding order; PR numbers above follow this
1:1). The secret/config fix ships first and alone. All testability/coverage work (2a, 2b) precedes
every behavioral edit (3) and every large-scale string edit (5a, 5b), so authorization hardening and
localization changes land against a real regression net, not a re-implemented one.
