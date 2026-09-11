import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { HA_DEFAULT_BASE_URL, bootstrap, loadConfig } from "../src/index.js";

function makeOptions(overrides = {}) {
  return {
    telegram_token: "test-token",
    allowed_chat_ids: "111,222",
    low_battery_threshold: 15,
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

  it("parses comma-separated chat IDs and trims whitespace", () => {
    const config = loadConfig({
      env: fakeEnv(),
      readFile: fakeReadFile(makeOptions({ allowed_chat_ids: " 111 , 222 ," })),
    });

    assert.deepStrictEqual(config.telegram.allowedChatIds, ["111", "222"]);
  });

  it("returns an empty allow-list when allowed_chat_ids is blank", () => {
    const config = loadConfig({
      env: fakeEnv(),
      readFile: fakeReadFile(makeOptions({ allowed_chat_ids: "" })),
    });

    assert.deepStrictEqual(config.telegram.allowedChatIds, []);
  });

  it("coerces a numeric low_battery_threshold string", () => {
    const config = loadConfig({
      env: fakeEnv(),
      readFile: fakeReadFile(makeOptions({ low_battery_threshold: "30" })),
    });

    assert.strictEqual(config.thresholds.lowBattery, 30);
  });

  it("defaults low_battery_threshold to 20 when absent", () => {
    const options = makeOptions();
    delete options.low_battery_threshold;

    const config = loadConfig({ env: fakeEnv(), readFile: fakeReadFile(options) });

    assert.strictEqual(config.thresholds.lowBattery, 20);
  });

  it("rejects a low_battery_threshold above 100, naming the option", () => {
    assert.throws(
      () =>
        loadConfig({
          env: fakeEnv(),
          readFile: fakeReadFile(makeOptions({ low_battery_threshold: 150 })),
        }),
      /low_battery_threshold/
    );
  });

  it("rejects a low_battery_threshold below 0, naming the option", () => {
    assert.throws(
      () =>
        loadConfig({
          env: fakeEnv(),
          readFile: fakeReadFile(makeOptions({ low_battery_threshold: -5 })),
        }),
      /low_battery_threshold/
    );
  });

  it("names the missing option in the thrown error when telegram_token is absent", () => {
    const options = makeOptions();
    delete options.telegram_token;

    assert.throws(
      () => loadConfig({ env: fakeEnv(), readFile: fakeReadFile(options) }),
      /telegram_token/
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
    });

    assert.strictEqual(result, bot);
  });
});
