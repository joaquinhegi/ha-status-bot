# HA Connection Config Specification

## Purpose

Defines how the bot obtains its Home Assistant Supervisor credentials and REST endpoint, replacing the hardcoded token and bypassed base URL currently present in the working tree (`src/index.js:39,45,49`).

## Requirements

### Requirement: Supervisor Token From Environment Only

The system MUST read the Home Assistant API token exclusively from the `SUPERVISOR_TOKEN` environment variable, which the Supervisor already injects because `config.yaml` declares `homeassistant_api: true`. The system MUST NOT contain any literal token string in tracked source.

#### Scenario: Startup reads the injected token

- GIVEN the add-on container is started by the Supervisor with `homeassistant_api: true`
- WHEN the HA client is constructed
- THEN every HA REST request's `Authorization` header is built from `process.env.SUPERVISOR_TOKEN`

#### Scenario: Missing token fails fast

- GIVEN `SUPERVISOR_TOKEN` is unset or empty at startup
- WHEN the bot starts
- THEN startup logs an explicit English error and exits non-zero instead of sending unauthenticated or empty-token requests

### Requirement: Supervisor Proxy Base URL By Default

The system MUST default the HA REST base URL to `http://supervisor/core/api` and MUST NOT hardcode any other host (such as `http://homeassistant.local:8123/api`) as the active base URL.

#### Scenario: Default base URL is the Supervisor proxy

- GIVEN no base-URL override is configured
- WHEN the HA client issues any request (`/states`, `/services/...`, `/camera_proxy/...`)
- THEN the request target starts with `http://supervisor/core/api`

#### Scenario: No stray hostnames in source

- GIVEN a manual review of `src/**`
- WHEN searching for HTTP URL literals
- THEN no `homeassistant.local` literal remains as an active base URL
