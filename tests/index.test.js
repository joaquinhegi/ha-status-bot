import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";

import {
  bootstrap,
  HA_DEFAULT_BASE_URL,
  installProcessHandlers,
  loadConfig,
} from "../src/index.js";

// Shaped like a BotFather token so it survives validation, and obviously not a
// real credential.
const FAKE_BOT_TOKEN = "123456789:AAFakeTokenForUnitTestsOnly_0123456789";

function makeOptions(overrides = {}) {
  return {
    telegram_bot_token: FAKE_BOT_TOKEN,
    allowed_chat_ids: ["111", "222"],
    low_battery_threshold_percent: 15,
    ...overrides,
  };
}

function fakeReadFile(options) {
  return () => JSON.stringify(options);
}

// A standalone process has no SUPERVISOR_TOKEN, so every value comes from the
// environment. Passing undefined for a key removes it.
function standaloneEnv(overrides = {}) {
  const env = {
    HA_TOKEN: "test-ha-token",
    HA_BASE_URL: "http://homeassistant.local:8123/api",
    TELEGRAM_BOT_TOKEN: FAKE_BOT_TOKEN,
    ALLOWED_CHAT_IDS: "111,222",
    LOW_BATTERY_THRESHOLD_PERCENT: "15",
    ...overrides,
  };

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }

  return env;
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

    assert.strictEqual(config.telegram.token, FAKE_BOT_TOKEN);
    assert.deepStrictEqual(config.telegram.allowedChatIds, ["111", "222"]);
  });

  it("defaults the Home Assistant base URL to the Supervisor proxy", () => {
    const config = loadConfig({
      env: fakeEnv(),
      readFile: fakeReadFile(makeOptions()),
    });

    // Pinned to the literal on purpose. Comparing against HA_DEFAULT_BASE_URL
    // would hold for any value the constant takes, including the
    // http://homeassistant.local:8123/api default this change was created to
    // remove. An add-on must reach Home Assistant through the Supervisor proxy.
    assert.strictEqual(config.homeAssistant.baseUrl, "http://supervisor/core/api");
    assert.strictEqual(HA_DEFAULT_BASE_URL, "http://supervisor/core/api");
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

  // Without SUPERVISOR_TOKEN the process is not running under the Supervisor,
  // so the add-on advice would be wrong. The error names what a standalone
  // operator actually has to do.
  it("throws naming HA_TOKEN when running standalone without a token", () => {
    assert.throws(
      () => loadConfig({ env: standaloneEnv({ HA_TOKEN: undefined }) }),
      /Missing HA_TOKEN\. Create a long-lived access token/,
    );
  });

  it("throws naming HA_BASE_URL when running standalone without one", () => {
    assert.throws(
      () => loadConfig({ env: standaloneEnv({ HA_BASE_URL: undefined }) }),
      /Missing HA_BASE_URL\. Set it to your Home Assistant API URL/,
    );
  });

  // The Supervisor proxy address only resolves inside Home Assistant, so
  // defaulting to it here would surface as a DNS failure that says nothing
  // about the real mistake.
  it("does not fall back to the Supervisor proxy URL when standalone", () => {
    assert.throws(
      () => loadConfig({ env: standaloneEnv({ HA_BASE_URL: undefined }) }),
      (error) => !error.message.includes(HA_DEFAULT_BASE_URL),
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

  // Production crash-looped on 2.0.0 because Home Assistant keeps an
  // installation's stored option values across an in-place upgrade. Renaming
  // the schema from str to list(str) does not rewrite what is already stored,
  // so upgraded add-ons handed loadConfig the pre-2.0.0 comma-separated string.
  it("accepts the pre-2.0.0 comma-separated allow-list instead of failing to start", () => {
    const config = loadConfig({
      env: fakeEnv(),
      readFile: fakeReadFile(makeOptions({ allowed_chat_ids: "111,222" })),
    });

    assert.deepStrictEqual(config.telegram.allowedChatIds, ["111", "222"]);
  });

  it("trims whitespace and drops empty entries from a legacy comma-separated allow-list", () => {
    const config = loadConfig({
      env: fakeEnv(),
      readFile: fakeReadFile(makeOptions({ allowed_chat_ids: " 111 , ,222, " })),
    });

    assert.deepStrictEqual(config.telegram.allowedChatIds, ["111", "222"]);
  });

  it("returns an empty allow-list when allowed_chat_ids is null", () => {
    const config = loadConfig({
      env: fakeEnv(),
      readFile: fakeReadFile(makeOptions({ allowed_chat_ids: null })),
    });

    assert.deepStrictEqual(config.telegram.allowedChatIds, []);
  });

  // isAllowed compares against String(chat.id). Numeric entries passed the old
  // Array.isArray check, started the add-on, and then silently denied every
  // chat — a worse failure than the crash, because nothing reported it.
  it("coerces numeric allowed_chat_ids entries to strings", () => {
    const config = loadConfig({
      env: fakeEnv(),
      readFile: fakeReadFile(makeOptions({ allowed_chat_ids: [111, 222] })),
    });

    assert.deepStrictEqual(config.telegram.allowedChatIds, ["111", "222"]);
  });

  it("rejects an allowed_chat_ids shape it cannot interpret, naming the fix", () => {
    assert.throws(
      () =>
        loadConfig({
          env: fakeEnv(),
          readFile: fakeReadFile(makeOptions({ allowed_chat_ids: { 111: true } })),
        }),
      /allowed_chat_ids: must be a list of numeric chat IDs/,
    );
  });

  // Reported from production: the stored value was the literal text "str", the
  // schema type name. The compatibility shim parsed it as a one-entry list, the
  // add-on started cleanly, and then matched no chat at all.
  it("rejects an allowed_chat_ids entry that cannot be a chat ID", () => {
    assert.throws(
      () =>
        loadConfig({
          env: fakeEnv(),
          readFile: fakeReadFile(makeOptions({ allowed_chat_ids: "str" })),
        }),
      /allowed_chat_ids: must be a list of numeric chat IDs/,
    );
  });

  // The add-on refuses to start while this option is invalid, so telling the
  // operator to ask the bot for their chat ID sends them to something that
  // cannot answer. Clearing the option is the only exit from this state.
  it("tells the operator to clear the option rather than to ask the bot", () => {
    assert.throws(
      () =>
        loadConfig({
          env: fakeEnv(),
          readFile: fakeReadFile(makeOptions({ allowed_chat_ids: "str" })),
        }),
      (error) =>
        /clear this option to allow every chat/.test(error.message) &&
        !error.message.includes("send /chatid to the bot to find yours"),
    );
  });

  it("accepts negative chat IDs, which Telegram uses for groups and channels", () => {
    const config = loadConfig({
      env: fakeEnv(),
      readFile: fakeReadFile(makeOptions({ allowed_chat_ids: ["-1001234567890"] })),
    });

    assert.deepStrictEqual(config.telegram.allowedChatIds, ["-1001234567890"]);
  });

  // Also from production: a Home Assistant long-lived token was pasted into
  // telegram_bot_token. It passed the non-empty-string check, so the add-on
  // started and every Telegram call answered 404.
  it("rejects a Home Assistant token in telegram_bot_token, naming the confusion", () => {
    const jwtShaped = "eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJmYWtlIn0.fake-signature-for-tests";

    assert.throws(
      () =>
        loadConfig({
          env: fakeEnv(),
          readFile: fakeReadFile(makeOptions({ telegram_bot_token: jwtShaped })),
        }),
      /looks like a Home Assistant long-lived access token\. This add-on never asks for one/,
    );
  });

  it("rejects a telegram_bot_token that is not shaped like a BotFather token", () => {
    assert.throws(
      () =>
        loadConfig({
          env: fakeEnv(),
          readFile: fakeReadFile(makeOptions({ telegram_bot_token: "not-a-token" })),
        }),
      /is not shaped like a BotFather token/,
    );
  });

  it("never puts the rejected token value in the thrown message", () => {
    const secret = "eyJhbGciOiJIUzI1NiJ9.eyJzZWNyZXQiOiJ2YWx1ZSJ9.do-not-leak-me";

    assert.throws(
      () =>
        loadConfig({
          env: fakeEnv(),
          readFile: fakeReadFile(makeOptions({ telegram_bot_token: secret })),
        }),
      (error) => !error.message.includes(secret),
    );
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
      /low_battery_threshold_percent/,
    );
  });

  it("rejects a low_battery_threshold_percent below 0, naming the option", () => {
    assert.throws(
      () =>
        loadConfig({
          env: fakeEnv(),
          readFile: fakeReadFile(makeOptions({ low_battery_threshold_percent: -5 })),
        }),
      /low_battery_threshold_percent/,
    );
  });

  it("names the missing option in the thrown error when telegram_bot_token is absent", () => {
    const options = makeOptions();
    delete options.telegram_bot_token;

    assert.throws(
      () => loadConfig({ env: fakeEnv(), readFile: fakeReadFile(options) }),
      /telegram_bot_token/,
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

describe("loadConfig runtimes", () => {
  it("detects the add-on runtime from the injected SUPERVISOR_TOKEN", () => {
    const config = loadConfig({ env: fakeEnv(), readFile: fakeReadFile(makeOptions()) });

    assert.strictEqual(config.runtime, "addon");
    assert.strictEqual(config.homeAssistant.token, "test-supervisor-token");
    assert.strictEqual(config.homeAssistant.mediaAvailable, true);
  });

  it("reads options from the environment when standalone, without touching a file", () => {
    let readCalls = 0;
    const config = loadConfig({
      env: standaloneEnv(),
      readFile: () => {
        readCalls += 1;
        throw new Error("no options file should be read when standalone");
      },
    });

    assert.strictEqual(readCalls, 0);
    assert.strictEqual(config.runtime, "standalone");
    assert.strictEqual(config.telegram.token, FAKE_BOT_TOKEN);
    assert.deepStrictEqual(config.telegram.allowedChatIds, ["111", "222"]);
    assert.strictEqual(config.thresholds.lowBattery, 15);
    assert.strictEqual(config.homeAssistant.token, "test-ha-token");
    assert.strictEqual(config.homeAssistant.baseUrl, "http://homeassistant.local:8123/api");
  });

  // Recorded video lives in Home Assistant's media folder, which is mapped into
  // the add-on container and reachable nowhere else.
  it("reports media as unavailable when standalone", () => {
    const config = loadConfig({ env: standaloneEnv() });

    assert.strictEqual(config.homeAssistant.mediaAvailable, false);
  });

  it("allows an empty ALLOWED_CHAT_IDS to mean every chat", () => {
    const config = loadConfig({ env: standaloneEnv({ ALLOWED_CHAT_IDS: "" }) });

    assert.deepStrictEqual(config.telegram.allowedChatIds, []);
  });

  // The same validation serves both runtimes, so a bad value is reported the
  // same way whatever supplied it.
  it("applies the same option validation to environment values", () => {
    assert.throws(
      () => loadConfig({ env: standaloneEnv({ TELEGRAM_BOT_TOKEN: "not-a-token" }) }),
      /is not shaped like a BotFather token/,
    );
  });

  it("names the environment as the source when standalone validation fails", () => {
    assert.throws(
      () => loadConfig({ env: standaloneEnv({ ALLOWED_CHAT_IDS: "str" }) }),
      /Invalid environment configuration/,
    );
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
