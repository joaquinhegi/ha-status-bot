# Project Documentation Specification

## Purpose

Rewrites `README.md` to describe the system's actual behavior after this change, including both breaking-change migrations (commands and options).

## Requirements

### Requirement: README Matches Actual Connection and Authorization Behavior

`README.md` MUST document: the Supervisor-token/proxy connection model (env-sourced token, `http://supervisor/core/api` base URL), the chat-id allow-list plus entity-id validation model including the `/chatid`-stays-ungated rationale, the actual `Dockerfile` install command, and that `callService` is used by every light/cover/camera action (correcting the current "not used" claim at `README.md:219`).

#### Scenario: README connection section matches code

- GIVEN `README.md` is read
- WHEN comparing its connection/authorization description to `src/index.js` and `src/telegram.js`
- THEN every claim matches the actual behavior, with no stale statement remaining

### Requirement: Command Migration Table

`README.md` MUST include the complete old-to-new command table from `bot-localization`, plus a note stating that no Spanish alias exists for any command.

#### Scenario: Table is present and complete

- GIVEN `README.md` is read
- WHEN locating the commands section
- THEN all 11 commands appear with both old and new names, and a no-alias note is present

### Requirement: Config Migration Note

`README.md` MUST include a dedicated "Breaking change: reconfigure after upgrade" section listing every renamed/retyped option from `addon-configuration`.

#### Scenario: Migration note is present

- GIVEN `README.md` is read
- WHEN locating the configuration section
- THEN it lists all three old-to-new option changes and states that existing installs must be reconfigured after upgrading

### Requirement: Testing Section Matches Reality

`README.md`'s testing section MUST state that `tests/telegram.test.js` and `tests/index.test.js` import and exercise the real `src/telegram.js` and `src/index.js` modules (correcting the current claim at `README.md:313`).

#### Scenario: Testing claim matches the test-coverage capability

- GIVEN `README.md` is read
- WHEN comparing its testing section to the `test-coverage` capability
- THEN the description matches (imports real modules, no re-implemented logic)

### Requirement: OPTIONS_PATH Documented

`README.md` MUST document the `OPTIONS_PATH` environment override used for local/dev testing.

#### Scenario: OPTIONS_PATH appears in README

- GIVEN `README.md` is read
- WHEN searching for local development instructions
- THEN `OPTIONS_PATH` is documented with its purpose
