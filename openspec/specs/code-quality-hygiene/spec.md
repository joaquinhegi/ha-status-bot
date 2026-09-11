# Code Quality Hygiene Specification

## Purpose

Defines the DRY, tooling, and packaging hygiene requirements for `haClient.js`, `telegram.js`, `Dockerfile`, and `package.json`, without restructuring module boundaries (the ports-and-adapters refactor is out of scope for this change).

## Requirements

### Requirement: Reproducible Docker Install

`Dockerfile` MUST install dependencies with `npm ci` (not `npm install`), matching what `README.md:149,155` already documents.

#### Scenario: Dockerfile uses npm ci

- GIVEN `Dockerfile` is read
- WHEN locating the dependency-install line
- THEN it runs `npm ci --omit=dev` (or an equivalent `npm ci` variant), not `npm install`

### Requirement: package.json Declares Engine and License

`package.json` MUST declare `engines.node` compatible with Node 20.x (matching `Dockerfile`'s `node:20-alpine` and CI's `node-version: 20`) and a non-empty `license` field.

#### Scenario: Engine and license present

- GIVEN `package.json` is read
- WHEN inspecting its top-level fields
- THEN `engines.node` and `license` are both present and non-empty

### Requirement: Lint and Format Tooling Available

`package.json` MUST declare `lint` and `format` scripts backed by installed devDependencies, runnable without additional setup.

#### Scenario: Lint script runs

- GIVEN dependencies are installed
- WHEN running `npm run lint`
- THEN the command executes (exits 0 on a clean tree) instead of failing with "missing script"

### Requirement: Single Named Constant Per Shared Magic Number

The Telegram message chunk size, camera clip duration, HA retry count, and camera-cooldown window MUST each be declared exactly once as a named constant and referenced by name at every call site.

#### Scenario: One declaration per constant (documented manual review)

- GIVEN a review of `src/telegram.js` and `src/haClient.js`
- WHEN searching for the chunk-size, clip-duration, retry-count, and cooldown literal values
- THEN each value appears in exactly one named constant declaration, with all other usages referencing that name

### Requirement: Shared Helper for Repeated Fetch+Keyboard+Error Pattern

Command handlers that fetch entity states, build an inline keyboard, and handle HA errors (lights, covers, cameras, and the callback-refresh path) MUST call one shared helper instead of independently repeating the pattern.

#### Scenario: Shared helper reused (documented manual review)

- GIVEN a review of the lights/covers/cameras command handlers and the callback refresh block
- WHEN identifying the fetch-keyboard-error sequence
- THEN all four call sites invoke the same shared helper function
