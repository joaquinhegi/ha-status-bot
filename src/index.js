import fs from "fs";
import { pathToFileURL } from "url";
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

function parseAllowedChatIds(value) {
  if (!value || !value.trim()) {
    return [];
  }

  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function coerceLowBatteryThreshold(value) {
  const threshold = Number(value ?? 20);
  return Number.isFinite(threshold) ? threshold : NaN;
}

function buildOptionFields(options) {
  return [
    {
      name: "telegram_token",
      value: options.telegram_token,
      validate: (value) => typeof value === "string" && value.length > 0,
      message: "must be a non-empty string",
      read: () => options.telegram_token,
    },
    {
      name: "allowed_chat_ids",
      value: options.allowed_chat_ids,
      validate: () => true,
      message: "must be a comma-separated string",
      read: () => parseAllowedChatIds(options.allowed_chat_ids),
    },
    {
      name: "low_battery_threshold",
      value: coerceLowBatteryThreshold(options.low_battery_threshold),
      validate: (value) => Number.isFinite(value) && value >= 0 && value <= 100,
      message: "must be a number between 0 and 100",
      read: () => coerceLowBatteryThreshold(options.low_battery_threshold),
    },
  ];
}

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

export async function bootstrap({
  config,
  createHaClient = createHomeAssistantClient,
  startBot = createTelegramBot,
  logger = console,
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

  logger.log("HA Status Bot started successfully.");
  return bot;
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  bootstrap({ config: loadConfig() }).catch((error) => {
    console.error("Error starting HA Status Bot:", error);
    process.exit(1);
  });
}
