import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createHomeAssistantClient } from "./haClient.js";
import { createTelegramBot } from "./telegram.js";

export const HA_DEFAULT_BASE_URL = "http://supervisor/core/api";

function defaultReadFile(path) {
  return fs.readFileSync(path, "utf8");
}

function requireEnv(env, name) {
  const value = env[name];

  if (!value) {
    throw new Error(`Missing ${name}. Check homeassistant_api: true in config.yaml.`);
  }

  return value;
}

function coerceLowBatteryThreshold(value) {
  const threshold = Number(value ?? 20);
  return Number.isFinite(threshold) ? threshold : NaN;
}

// Normalizes whatever the Supervisor writes into /data/options.json for
// allowed_chat_ids into an array of trimmed strings, or null when the value is
// a shape this add-on cannot interpret.
//
// Three shapes reach this function in the field:
//   - absent, null, or an empty string — the option was never set, meaning
//     every chat is allowed;
//   - an array — the list(str) schema introduced in 2.0.0, whose entries the
//     Supervisor may hand over as numbers rather than strings;
//   - a comma-separated string — the pre-2.0.0 str schema, which Home Assistant
//     keeps in stored options when an add-on is upgraded in place.
//
// The last one is why 2.0.0 crash-looped on upgrade: renaming the schema type
// does not migrate an installation's stored value. Accepting it with a warning
// keeps the add-on running while the owner moves to list entries.
export function normalizeAllowedChatIds(value) {
  if (value === undefined || value === null || value === "") {
    return { ids: [], legacy: false };
  }

  let entries = null;

  if (Array.isArray(value)) {
    entries = value;
  } else if (typeof value === "string") {
    entries = value.split(",");
  }

  if (entries === null) {
    return { ids: null, legacy: false };
  }

  if (entries.some((entry) => typeof entry !== "string" && typeof entry !== "number")) {
    return { ids: null, legacy: false };
  }

  return {
    // isAllowed compares against String(chat.id), so an entry the Supervisor
    // delivered as a number would never match and would silently deny every
    // chat. Coerce here rather than at the comparison site.
    ids: entries.map((entry) => String(entry).trim()).filter(Boolean),
    legacy: typeof value === "string",
  };
}

function buildOptionFields(options) {
  const allowedChatIds = normalizeAllowedChatIds(options.allowed_chat_ids);

  return [
    {
      name: "telegram_bot_token",
      value: options.telegram_bot_token,
      validate: (value) => typeof value === "string" && value.length > 0,
      message: "must be a non-empty string",
      read: () => options.telegram_bot_token,
    },
    {
      name: "allowed_chat_ids",
      value: allowedChatIds.ids,
      validate: (ids) => ids !== null,
      message:
        "must be a list of chat IDs. Open the add-on Configuration tab and enter each ID as its own list entry",
      read: () => {
        if (allowedChatIds.legacy) {
          console.warn(
            "[Config] allowed_chat_ids is a comma-separated string left over from a version before 2.0.0. " +
              "It still works, but move each ID to its own list entry in the add-on Configuration tab.",
          );
        }

        return allowedChatIds.ids;
      },
    },
    {
      name: "low_battery_threshold_percent",
      value: coerceLowBatteryThreshold(options.low_battery_threshold_percent),
      validate: (value) => Number.isFinite(value) && value >= 0 && value <= 100,
      message: "must be a number between 0 and 100",
      read: () => coerceLowBatteryThreshold(options.low_battery_threshold_percent),
    },
  ];
}

// loadConfig is the single authorized entry point for reading process.env;
// every other module receives config through injected parameters (see
// design Decision 2).
// biome-ignore lint/style/noProcessEnv: authorized single entry point, see comment above
export function loadConfig({ env = process.env, readFile = defaultReadFile } = {}) {
  const optionsPath = env.OPTIONS_PATH || "/data/options.json";
  console.log(`Loading options from ${optionsPath}...`);
  const options = JSON.parse(readFile(optionsPath));
  console.log("Options loaded successfully.");

  const fields = buildOptionFields(options);
  const errors = fields
    .filter((field) => !field.validate(field.value))
    .map((field) => `${field.name}: ${field.message}`);

  if (errors.length) {
    throw new Error(`Invalid add-on configuration — ${errors.join("; ")}`);
  }

  const [telegramToken, allowedChatIds, lowBattery] = fields.map((field) => field.read());
  const supervisorToken = requireEnv(env, "SUPERVISOR_TOKEN");
  const baseUrl = env.HA_BASE_URL || HA_DEFAULT_BASE_URL;

  console.log(`Allowed chat IDs: ${allowedChatIds.length ? allowedChatIds.join(", ") : "(all)"}`);
  console.log(`Low battery threshold: ${lowBattery}%`);

  return Object.freeze({
    telegram: Object.freeze({
      token: telegramToken,
      allowedChatIds: Object.freeze(allowedChatIds),
    }),
    homeAssistant: Object.freeze({ baseUrl, token: supervisorToken }),
    thresholds: Object.freeze({ lowBattery }),
  });
}

// Registers process-level lifecycle handlers. The Supervisor sends SIGTERM on
// every add-on stop, restart, and update; long polling holds an open HTTP
// request, so an idempotent graceful stop is required.
export function installProcessHandlers({
  bot,
  processRef = process,
  exit = process.exit,
  logger = console,
  timeoutMs = 10_000,
}) {
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.log(`Received ${signal}, shutting down gracefully...`);

    const forceExitTimer = setTimeout(() => {
      logger.error(`Graceful shutdown timed out after ${timeoutMs}ms, forcing exit.`);
      exit(1);
    }, timeoutMs);
    forceExitTimer.unref?.();

    try {
      await bot.stopPolling({ cancel: true });
      clearTimeout(forceExitTimer);
      exit(0);
    } catch (error) {
      clearTimeout(forceExitTimer);
      logger.error("Error while stopping the bot:", error);
      exit(1);
    }
  }

  processRef.on("SIGTERM", () => shutdown("SIGTERM"));
  processRef.on("SIGINT", () => shutdown("SIGINT"));

  // A transient Home Assistant error (e.g. a 502) surfaces here as a rejected
  // promise somewhere in the polling/handler chain. It must not take down the
  // add-on: log it and keep running.
  processRef.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection:", reason);
  });

  processRef.on("uncaughtException", (error) => {
    logger.error("Uncaught exception:", error);
    exit(1);
  });
}

export async function bootstrap({
  config,
  createHaClient = createHomeAssistantClient,
  startBot = createTelegramBot,
  logger = console,
  processRef = process,
  exit = process.exit,
  shutdownTimeoutMs = 10_000,
} = {}) {
  logger.log("Connecting to Home Assistant API...");
  const ha = createHaClient({
    baseUrl: config.homeAssistant.baseUrl,
    token: config.homeAssistant.token,
  });

  const bot = startBot({
    token: config.telegram.token,
    allowedChatIds: config.telegram.allowedChatIds,
    lowBatteryThreshold: config.thresholds.lowBattery,
    ha,
  });

  installProcessHandlers({ bot, processRef, exit, logger, timeoutMs: shutdownTimeoutMs });

  logger.log("HA Status Bot started successfully.");
  return bot;
}

// process.argv[1] is absent under `node -e` and in a REPL, where pathToFileURL
// throws. This guard exists so importing the module never starts a bot, so it
// must stay inert rather than become the thing that crashes the import.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  bootstrap({ config: loadConfig() }).catch((error) => {
    console.error("Error starting HA Status Bot:", error);
    process.exit(1);
  });
}
