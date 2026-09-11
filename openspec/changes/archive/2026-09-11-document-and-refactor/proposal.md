# Proposal: Document and Refactor ha-status-bot

## Intent

A live Home Assistant Supervisor JWT is hardcoded in the working tree (`src/index.js:39`), and the Supervisor proxy base URL is bypassed (`src/index.js:45,49`). Around that critical defect sit an unvalidated `entity_id` path into privileged HA service calls, no shutdown/error safety net, duplicated logic with magic numbers, tests that re-implement production logic instead of importing it (false confidence), a mixed Spanish/English surface, and a `README.md` that documents behavior the code no longer has.

Success: no secret in source, HA traffic back on the Supervisor proxy, privileged calls validated, real tests covering `src/telegram.js` and `src/index.js`, one language (English) everywhere, and a README that matches reality.

## Scope

### In Scope

| # | Deliverable | Key files |
|---|---|---|
| 1 | Secrets/config fix: restore `process.env.SUPERVISOR_TOKEN` and `http://supervisor/core/api` | `src/index.js` |
| 2 | Authorization hardening: validate `entity_id` membership before privileged calls, normalize chat-id gating, add `SIGTERM`/`SIGINT` + `unhandledRejection` handling | `src/telegram.js`, `src/index.js` |
| 3 | DRY/hygiene: shared keyboard + fallback helpers, named constants, `npm ci` in `Dockerfile`, `engines`/`license`/lint+format in `package.json` | `src/telegram.js`, `src/haClient.js`, `Dockerfile`, `package.json` |
| 4 | Real tests importing `src/telegram.js` and `src/index.js` | `tests/telegram.test.js`, `tests/index.test.js` |
| 5 | English normalization of ALL copy, logs, comments — including user-facing Telegram replies (user-visible breaking change) | `src/**`, `tests/**`, `config.yaml` |
| 6 | Add-on options schema rename/restructure (breaking; reconfiguration required) | `config.yaml` |
| 7 | README rewrite matching actual behavior + migration note for 5 and 6 | `README.md` |

### Out of Scope

- **Ports-and-adapters / architecture refactor (hard non-goal).** `src/telegram.js` keeps its current single-module structure at 582 lines. No layer split, no ports/adapters seam, no module-boundary restructuring.
- Upgrading `node-telegram-bot-api` off the `0.x` line.
- Revoking the exposed token (user-owned operational action, tracked as a risk).

## Capabilities

### New Capabilities

- `ha-connection-config`: HA credentials come from the environment; base URL defaults to the Supervisor proxy.
- `bot-authorization`: chat-id allow-list plus `entity_id` membership validation before any privileged HA call.
- `addon-configuration`: add-on option names, types, and defaults after the breaking rename.
- `bot-localization`: all user-facing Telegram copy is English.
- `process-lifecycle`: startup, graceful shutdown, and unhandled-error behavior.

### Modified Capabilities

- None (`openspec/specs/` is empty).

## Approach

Fix by slice, smallest blast radius first. Slice 1 ships alone as a live-secret fix. Slice 4 (real tests) must land before slices 3, 5, and 6 touch `telegram.js` at scale — that module has no regression safety net today. Slices 5 and 6 are behavior/contract changes and each need their own README section.

**Dependency order (binding for `sdd-tasks`):**

```
1 (secrets, alone)  ->  2 (authz + lifecycle)  ->  4 (real tests)  ->  3 (DRY) -> 5 (English) -> 6 (options) -> 7 (README)
```

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/index.js` | Modified | Env token, Supervisor URL, lifecycle handlers, English logs |
| `src/telegram.js` | Modified | Entity validation, shared helpers, constants, English copy — no restructuring |
| `src/haClient.js` | Modified | Unified fallback/retry helpers, named constants, English comment |
| `src/formatter.js` | Modified | English output strings |
| `tests/telegram.test.js`, `tests/index.test.js` | Rewritten | Import and exercise the real modules |
| `config.yaml` | Modified (breaking) | Renamed/restructured options, English description |
| `README.md`, `Dockerfile`, `package.json` | Modified | Accurate docs, `npm ci`, `engines`/`license`/tooling |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Exposed Supervisor token already used elsewhere | Med | Slice 1 ships first; user revokes the token in HA (never committed per `git log -S`) |
| Regression in untested `telegram.js` | High | Slice 4 lands before large edits to that module |
| English switch surprises existing bot users | High | Documented as a breaking behavior change in README |
| Options rename breaks existing installs | High | Migration table in README; add-on version bump |
| 400-line review budget exceeded | High | `sdd-tasks` must forecast and chain PRs per slice |

## Rollback Plan

Each slice is an independent revert. Slice 1: `git revert` restores env-based config without touching behavior. Slices 5 and 6 are the only user-visible reverts — reverting 6 also requires restoring the previous `config.yaml` option names and re-bumping the add-on version.

## Dependencies

- User must revoke the exposed Supervisor long-lived token (out-of-band, cannot be done in code).
- Node 20 runtime and `node:test` remain the verification baseline (`npm test`).

## Success Criteria

- [ ] No secret literal in any tracked source file; `SUPERVISOR_TOKEN` and `http://supervisor/core/api` restored.
- [ ] Privileged HA calls reject an `entity_id` the bot did not offer.
- [ ] Process exits cleanly on `SIGTERM` and logs unhandled rejections.
- [ ] `tests/telegram.test.js` and `tests/index.test.js` import the real modules; `npm test` green.
- [ ] No Spanish string remains in `src/`, `tests/`, `config.yaml`, or `README.md`.
- [ ] `README.md` matches actual behavior and carries the options-migration and English-copy breaking-change notes.
