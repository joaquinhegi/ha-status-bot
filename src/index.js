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

function buildOptionFields(options) {
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
      value: options.allowed_chat_ids,
      validate: (value) => value === undefined || Array.isArray(value),
      message: "must be a list of strings",
      read: () => (Array.isArray(options.allowed_chat_ids) ? options.allowed_chat_ids : []),
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

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  bootstrap({ config: loadConfig() }).catch((error) => {
    console.error("Error starting HA Status Bot:", error);
    process.exit(1);
  });
}
