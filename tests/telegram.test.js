import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createTelegramBot } from "../src/telegram.js";
import { FakeTelegramBot } from "./helpers/fakeTelegramBot.js";

const noopLogger = { log() {}, warn() {}, error() {} };

function createFakeHaClient(overrides = {}) {
  const calls = {
    getStates: 0,
    callService: [],
    getCameraSnapshot: [],
    recordCameraClip: [],
    getMediaFile: [],
  };

  return {
    calls,
    async getStates() {
      calls.getStates += 1;
      return overrides.states ?? [];
    },
    async callService(domain, service, data) {
      calls.callService.push({ domain, service, data });
      if (overrides.onCallService) {
        return overrides.onCallService(domain, service, data);
      }
      return {};
    },
    async getCameraSnapshot(entityId) {
      calls.getCameraSnapshot.push(entityId);
      if (overrides.onGetCameraSnapshot) {
        return overrides.onGetCameraSnapshot(entityId);
      }
      return { buffer: Buffer.from("fake-image"), contentType: "image/jpeg" };
    },
    async recordCameraClip(entityId, seconds) {
      calls.recordCameraClip.push({ entityId, seconds });
      if (overrides.onRecordCameraClip) {
        return overrides.onRecordCameraClip(entityId, seconds);
      }
      return { publicPath: "/fake/clip.mp4" };
    },
    async getMediaFile(path) {
      calls.getMediaFile.push(path);
      if (overrides.onGetMediaFile) {
        return overrides.onGetMediaFile(path);
      }
      return { buffer: Buffer.from("fake-video"), contentType: "video/mp4" };
    },
  };
}

function makeLightEntity(id, state = "on") {
  return {
    entity_id: `light.${id}`,
    state,
    attributes: { friendly_name: `Light ${id}` },
  };
}

function makeBinarySensorEntity(id, deviceClass) {
  return {
    entity_id: `binary_sensor.${id}`,
    state: "on",
    attributes: { friendly_name: `Sensor ${id}`, device_class: deviceClass },
  };
}

function makeBatterySensorEntity(id, value) {
  return {
    entity_id: `sensor.${id}`,
    state: String(value),
    attributes: {
      friendly_name: `Battery ${id}`,
      device_class: "battery",
      unit_of_measurement: "%",
    },
  };
}

function makeTemperatureSensorEntity(id, value) {
  return {
    entity_id: `sensor.${id}`,
    state: String(value),
    attributes: {
      friendly_name: `Temp ${id}`,
      device_class: "temperature",
      unit_of_measurement: "°C",
    },
  };
}

function setup({ states = [], allowedChatIds = [], haOverrides = {} } = {}) {
  const bot = new FakeTelegramBot();
  const ha = createFakeHaClient({ states, ...haOverrides });

  createTelegramBot({
    token: "test-token",
    allowedChatIds,
    lowBatteryThreshold: 20,
    ha,
    createBot: () => bot,
    logger: noopLogger,
  });

  return { bot, ha };
}

describe("createTelegramBot allow-list", () => {
  it("runs the command for a chat_id present in the allow-list", async () => {
    const lights = [makeLightEntity("kitchen")];
    const { bot, ha } = setup({ states: lights, allowedChatIds: ["42"] });

    await bot.emitText("/estado", 42);

    assert.strictEqual(ha.calls.getStates, 1);
    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 42);
  });

  it("denies the command for a chat_id absent from the allow-list without calling HA", async () => {
    const lights = [makeLightEntity("kitchen")];
    const { bot, ha } = setup({ states: lights, allowedChatIds: ["42"] });

    await bot.emitText("/estado", 999);

    assert.strictEqual(ha.calls.getStates, 0);
    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 999);
  });

  it("allows every chat_id when the allow-list is empty", async () => {
    const { bot, ha } = setup({ states: [], allowedChatIds: [] });

    await bot.emitText("/estado", 7);

    assert.strictEqual(ha.calls.getStates, 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 7);
  });
});

describe("createTelegramBot simple read commands", () => {
  it("/estado replies with fixture data derived from the real formatter", async () => {
    const states = [makeLightEntity("kitchen")];
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/estado", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.match(bot.sentMessages[0].text, /Light kitchen/);
  });

  it("/sensores replies with the active binary sensor from HA", async () => {
    const states = [makeBinarySensorEntity("hall", "motion")];
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/sensores", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.match(bot.sentMessages[0].text, /Sensor hall/);
  });

  it("/puertas replies with the open door/window entity from HA", async () => {
    const states = [makeBinarySensorEntity("frontdoor", "door")];
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/puertas", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.match(bot.sentMessages[0].text, /Sensor frontdoor/);
  });

  it("/bateria replies with a battery below the configured threshold", async () => {
    const states = [makeBatterySensorEntity("remote", 10)];
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/bateria", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.match(bot.sentMessages[0].text, /Battery remote/);
  });

  it("/temp replies with a temperature sensor reading from HA", async () => {
    const states = [makeTemperatureSensorEntity("living_room", 21.5)];
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/temp", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.match(bot.sentMessages[0].text, /Temp living_room/);
  });

  it("replies with an error message when HA call fails, without throwing", async () => {
    const bot = new FakeTelegramBot();
    const ha = {
      async getStates() {
        throw new Error("boom");
      },
    };

    createTelegramBot({
      token: "test-token",
      allowedChatIds: [],
      lowBatteryThreshold: 20,
      ha,
      createBot: () => bot,
      logger: noopLogger,
    });

    await bot.emitText("/estado", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 1);
  });
});

describe("createTelegramBot reply chunking", () => {
  it("sends a single message when the formatted reply is under the chunk limit", async () => {
    const states = [makeLightEntity("kitchen")];
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/estado", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
  });

  it("splits the formatted reply into multiple messages over 3900 characters", async () => {
    const states = Array.from({ length: 200 }, (_, index) =>
      makeLightEntity(`bulb_${String(index).padStart(3, "0")}_${"x".repeat(20)}`)
    );
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/estado", 1);

    assert.ok(bot.sentMessages.length > 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 1);
    for (const chunk of bot.sentMessages) {
      assert.ok(chunk.text.length <= 3900);
    }
  });
});

describe("createTelegramBot testability seam", () => {
  it("uses the injected createBot factory instead of constructing node-telegram-bot-api directly", () => {
    let receivedToken;
    const bot = new FakeTelegramBot();

    createTelegramBot({
      token: "seam-test-token",
      allowedChatIds: [],
      lowBatteryThreshold: 20,
      ha: createFakeHaClient(),
      createBot: (token) => {
        receivedToken = token;
        return bot;
      },
      logger: noopLogger,
    });

    assert.strictEqual(receivedToken, "seam-test-token");
    assert.ok(bot.onTextHandlers.length > 0);
  });
});

describe("user-facing copy", () => {
  it("denies an unauthorized chat with guidance text including its chat_id", async () => {
    const { bot } = setup({ states: [], allowedChatIds: ["1"] });

    await bot.emitText("/estado", 999);

    assert.match(bot.sentMessages[0].text, /999/);
  });
});
