import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { HA_DEFAULT_BASE_URL, bootstrap, installProcessHandlers, loadConfig } from "../src/index.js";

function makeOptions(overrides = {}) {
  return {
    telegram_bot_token: "test-token",
    allowed_chat_ids: ["111", "222"],
    low_battery_threshold_percent: 15,
    ...overrides,
  };
}

function fakeReadFile(options) {
  return () => JSON.stringify(options);
}

function fakeEnv(overrides = {}) {
  return {
    SUPERVISOR_TOKEN: "test-supervisor-token",
    ...overrides,
  };
}

const noopLogger = { log() {}, error() {} };

describe("loadConfig", () => {
  it("sources the Telegram token and allow-list from the options file", () => {
    const config = loadConfig({
      env: fakeEnv(),
      readFile: fakeReadFile(makeOptions()),
    });

    assert.strictEqual(config.telegram.token, "test-token");
    assert.deepStrictEqual(config.telegram.allowedChatIds, ["111", "222"]);
  });

  it("defaults the Home Assistant base URL to the Supervisor proxy", () => {
    const config = loadConfig({
      env: fakeEnv(),
      readFile: fakeReadFile(makeOptions()),
    });

    assert.strictEqual(config.homeAssistant.baseUrl, HA_DEFAULT_BASE_URL);
  });

  it("honours HA_BASE_URL override for non-Supervisor deployments", () => {
    const config = loadConfig({
      env: fakeEnv({ HA_BASE_URL: "http://localhost:9999/api" }),
      readFile: fakeReadFile(makeOptions()),
    });

    assert.strictEqual(config.homeAssistant.baseUrl, "http://localhost:9999/api");
  });

  it("uses the injected SUPERVISOR_TOKEN as the Home Assistant token", () => {
    const config = loadConfig({
      env: fakeEnv({ SUPERVISOR_TOKEN: "another-test-token" }),
      readFile: fakeReadFile(makeOptions()),
    });

    assert.strictEqual(config.homeAssistant.token, "another-test-token");
  });

  it("throws naming SUPERVISOR_TOKEN when missing", () => {
    assert.throws(
      () => loadConfig({ env: {}, readFile: fakeReadFile(makeOptions()) }),
      /SUPERVISOR_TOKEN/
    );
  });

  it("throws naming homeassistant_api guidance when SUPERVISOR_TOKEN is missing", () => {
    assert.throws(
      () => loadConfig({ env: {}, readFile: fakeReadFile(makeOptions()) }),
      /homeassistant_api/
    );
  });

  it("passes the allowed_chat_ids list through unchanged", () => {
    const config = loadConfig({
      env: fakeEnv(),
      readFile: fakeReadFile(makeOptions({ allowed_chat_ids: ["111", "222"] })),
    });

    assert.deepStrictEqual(config.telegram.allowedChatIds, ["111", "222"]);
  });

  it("returns an empty allow-list when allowed_chat_ids is an empty list", () => {
    const config = loadConfig({
      env: fakeEnv(),
      readFile: fakeReadFile(makeOptions({ allowed_chat_ids: [] })),
    });

    assert.deepStrictEqual(config.telegram.allowedChatIds, []);
  });

  it("returns an empty allow-list when allowed_chat_ids is absent", () => {
    const options = makeOptions();
    delete options.allowed_chat_ids;

    const config = loadConfig({ env: fakeEnv(), readFile: fakeReadFile(options) });

    assert.deepStrictEqual(config.telegram.allowedChatIds, []);
  });

  it("coerces a numeric low_battery_threshold_percent string", () => {
    const config = loadConfig({
      env: fakeEnv(),
      readFile: fakeReadFile(makeOptions({ low_battery_threshold_percent: "30" })),
    });

    assert.strictEqual(config.thresholds.lowBattery, 30);
  });

  it("defaults low_battery_threshold_percent to 20 when absent", () => {
    const options = makeOptions();
    delete options.low_battery_threshold_percent;

    const config = loadConfig({ env: fakeEnv(), readFile: fakeReadFile(options) });

    assert.strictEqual(config.thresholds.lowBattery, 20);
  });

  it("rejects a low_battery_threshold_percent above 100, naming the option", () => {
    assert.throws(
      () =>
        loadConfig({
          env: fakeEnv(),
          readFile: fakeReadFile(makeOptions({ low_battery_threshold_percent: 150 })),
        }),
      /low_battery_threshold_percent/
    );
  });

  it("rejects a low_battery_threshold_percent below 0, naming the option", () => {
    assert.throws(
      () =>
        loadConfig({
          env: fakeEnv(),
          readFile: fakeReadFile(makeOptions({ low_battery_threshold_percent: -5 })),
        }),
      /low_battery_threshold_percent/
    );
  });

  it("names the missing option in the thrown error when telegram_bot_token is absent", () => {
    const options = makeOptions();
    delete options.telegram_bot_token;

    assert.throws(
      () => loadConfig({ env: fakeEnv(), readFile: fakeReadFile(options) }),
      /telegram_bot_token/
    );
  });

  it("returns a deep-frozen config object", () => {
    const config = loadConfig({
      env: fakeEnv(),
      readFile: fakeReadFile(makeOptions()),
    });

    assert.strictEqual(Object.isFrozen(config), true);
    assert.strictEqual(Object.isFrozen(config.telegram), true);
    assert.strictEqual(Object.isFrozen(config.homeAssistant), true);
    assert.strictEqual(Object.isFrozen(config.thresholds), true);
  });

  it("reads the options path from OPTIONS_PATH when set", () => {
    let capturedPath;
    loadConfig({
      env: fakeEnv({ OPTIONS_PATH: "/custom/options.json" }),
      readFile: (path) => {
        capturedPath = path;
        return JSON.stringify(makeOptions());
      },
    });

    assert.strictEqual(capturedPath, "/custom/options.json");
  });
});

describe("bootstrap", () => {
  function fakeConfig(overrides = {}) {
    return {
      telegram: { token: "test-token", allowedChatIds: ["111"] },
      homeAssistant: {
        baseUrl: "http://supervisor/core/api",
        token: "test-supervisor-token",
      },
      thresholds: { lowBattery: 20 },
      ...overrides,
    };
  }

  it("builds the Home Assistant client from the config's connection details", async () => {
    let receivedArgs;
    const createHaClient = (args) => {
      receivedArgs = args;
      return { fake: "ha-client" };
    };
    const startBot = () => ({ fake: "bot" });

    await bootstrap({
      config: fakeConfig(),
      createHaClient,
      startBot,
      logger: noopLogger,
      processRef: new EventEmitter(),
      exit: () => {},
    });

    assert.strictEqual(receivedArgs.baseUrl, "http://supervisor/core/api");
    assert.strictEqual(receivedArgs.token, "test-supervisor-token");
  });

  it("starts the bot with the parsed telegram config and the constructed HA client", async () => {
    const haClient = { fake: "ha-client" };
    let receivedArgs;
    const createHaClient = () => haClient;
    const startBot = (args) => {
      receivedArgs = args;
      return { fake: "bot" };
    };

    await bootstrap({
      config: fakeConfig(),
      createHaClient,
      startBot,
      logger: noopLogger,
      processRef: new EventEmitter(),
      exit: () => {},
    });

    assert.strictEqual(receivedArgs.token, "test-token");
    assert.deepStrictEqual(receivedArgs.allowedChatIds, ["111"]);
    assert.strictEqual(receivedArgs.lowBatteryThreshold, 20);
    assert.strictEqual(receivedArgs.ha, haClient);
  });

  it("returns the bot instance created by startBot", async () => {
    const bot = { fake: "bot" };
    const result = await bootstrap({
      config: fakeConfig(),
      createHaClient: () => ({}),
      startBot: () => bot,
      logger: noopLogger,
      processRef: new EventEmitter(),
      exit: () => {},
    });

    assert.strictEqual(result, bot);
  });
});

describe("installProcessHandlers", () => {
  function fakeBot() {
    const calls = { stopPolling: 0 };
    return {
      calls,
      async stopPolling() {
        calls.stopPolling += 1;
      },
    };
  }

  function fakeExit() {
    const calls = [];
    const exit = (code) => calls.push(code);
    exit.calls = calls;
    return exit;
  }

  async function flushMicrotasks() {
    await new Promise((resolve) => setImmediate(resolve));
  }

  it("stops polling once and exits 0 on SIGTERM", async () => {
    const processRef = new EventEmitter();
    const bot = fakeBot();
    const exit = fakeExit();

    installProcessHandlers({ bot, processRef, exit, logger: noopLogger });
    processRef.emit("SIGTERM");
    await flushMicrotasks();

    assert.strictEqual(bot.calls.stopPolling, 1);
    assert.deepStrictEqual(exit.calls, [0]);
  });

  it("ignores a repeated SIGTERM once shutdown is already in progress", async () => {
    const processRef = new EventEmitter();
    const bot = fakeBot();
    const exit = fakeExit();

    installProcessHandlers({ bot, processRef, exit, logger: noopLogger });
    processRef.emit("SIGTERM");
    processRef.emit("SIGTERM");
    await flushMicrotasks();

    assert.strictEqual(bot.calls.stopPolling, 1);
    assert.deepStrictEqual(exit.calls, [0]);
  });

  it("stops polling once and exits 0 on SIGINT", async () => {
    const processRef = new EventEmitter();
    const bot = fakeBot();
    const exit = fakeExit();

    installProcessHandlers({ bot, processRef, exit, logger: noopLogger });
    processRef.emit("SIGINT");
    await flushMicrotasks();

    assert.strictEqual(bot.calls.stopPolling, 1);
    assert.deepStrictEqual(exit.calls, [0]);
  });

  it("logs an unhandledRejection without exiting", async () => {
    const processRef = new EventEmitter();
    const bot = fakeBot();
    const exit = fakeExit();
    const logged = [];
    const logger = { log() {}, error: (...args) => logged.push(args) };

    installProcessHandlers({ bot, processRef, exit, logger });
    processRef.emit("unhandledRejection", new Error("boom"));
    await flushMicrotasks();

    assert.strictEqual(exit.calls.length, 0);
    assert.strictEqual(logged.length, 1);
  });

  it("exits non-zero on an uncaughtException", async () => {
    const processRef = new EventEmitter();
    const bot = fakeBot();
    const exit = fakeExit();

    installProcessHandlers({ bot, processRef, exit, logger: noopLogger });
    processRef.emit("uncaughtException", new Error("fatal"));
    await flushMicrotasks();

    assert.deepStrictEqual(exit.calls, [1]);
  });
});
