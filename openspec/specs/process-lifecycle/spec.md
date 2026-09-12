# Process Lifecycle Specification

## Purpose

Defines startup validation, graceful shutdown, and unhandled-error behavior needed for a process managed by Docker/HA Supervisor, which sends `SIGTERM` on add-on stop, restart, and update. Currently absent per `src/index.js:53` (the `bot` instance is discarded) and the missing `process.on(...)` handlers.

## Requirements

### Requirement: Graceful Shutdown on SIGTERM/SIGINT

The system MUST register handlers for `SIGTERM` and `SIGINT` that stop Telegram long-polling and exit the process cleanly.

#### Scenario: SIGTERM stops polling and exits

- GIVEN the bot is running and polling Telegram
- WHEN the process receives `SIGTERM`
- THEN the bot stops polling and the process exits with code 0

### Requirement: Unhandled Errors Are Logged, Not Silently Swallowed

The system MUST register `process.on('unhandledRejection')` and `process.on('uncaughtException')` handlers that log the error in English before the process exits or continues per a documented policy.

#### Scenario: Unhandled rejection is logged

- GIVEN the bot is running
- WHEN a promise rejects without a `.catch`
- THEN the handler logs an English error message identifying the failure

### Requirement: Startup Fails Fast on Missing Configuration

Startup MUST validate required configuration (`SUPERVISOR_TOKEN`, `telegram_bot_token`) before starting the bot and MUST exit non-zero with an explicit English message if any is missing.
(Cross-reference: `ha-connection-config` requirement "Supervisor Token From Environment Only".)

#### Scenario: Missing bot token halts startup

- GIVEN the `telegram_bot_token` option is empty
- WHEN `main()` runs
- THEN the process logs an explicit error and exits non-zero without starting polling
