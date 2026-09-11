# Test Coverage Specification

## Purpose

Replaces the false-confidence tests in `tests/telegram.test.js` and `tests/index.test.js` — which currently re-implement production logic instead of importing it — with tests that exercise the real modules.

## Requirements

### Requirement: telegram.js Tests Import the Real Module

`tests/telegram.test.js` MUST import from `src/telegram.js` and exercise its exported behavior directly. It MUST NOT re-implement `isAllowed` or message-chunking logic inline.

#### Scenario: Real authorization logic is exercised

- GIVEN `npm test` runs
- WHEN `tests/telegram.test.js` executes
- THEN a deliberate defect introduced into `src/telegram.js`'s real authorization or chunking logic causes the corresponding test to fail

### Requirement: index.js Tests Import the Real Module

`tests/index.test.js` MUST import from `src/index.js`'s exported/testable entry points for option loading and parsing, rather than re-implementing `parseAllowedChatIds` inline.

#### Scenario: Real option-parsing logic is exercised

- GIVEN `npm test` runs
- WHEN `tests/index.test.js` executes
- THEN a deliberate defect in `src/index.js`'s real option-parsing logic causes the corresponding test to fail

### Requirement: New Behavior Introduced By This Change Is Covered

Tests MUST cover the entity-id membership rejection path (`bot-authorization`) and the `SIGTERM`/`unhandledRejection` handling (`process-lifecycle`) introduced by this change.

#### Scenario: Forged entity_id is rejected without an HA call

- GIVEN a mocked HA client
- WHEN a simulated callback_query carries an `entity_id` never offered by the bot
- THEN the test asserts the mocked HA call was never invoked

### Requirement: Full Suite Stays Green

`npm test` MUST pass after every slice of this change lands, covering `formatter.js`, `haClient.js`, `telegram.js`, and `index.js`, with no remaining re-implemented production logic in any test file.

#### Scenario: CI passes end to end

- GIVEN all slices are merged
- WHEN CI runs `npm test`
- THEN all suites pass, and zero re-implemented logic remains in `tests/telegram.test.js` or `tests/index.test.js`
