import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createTelegramBot, entityToken } from "../src/telegram.js";
import { FakeTelegramBot, makeCallbackQuery } from "./helpers/fakeTelegramBot.js";

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

function makeSwitchEntity(id, state = "off") {
  return {
    entity_id: `switch.${id}`,
    state,
    attributes: { friendly_name: `Switch ${id}` },
  };
}

function makeCoverEntity(id, state = "closed") {
  return {
    entity_id: `cover.${id}`,
    state,
    attributes: { friendly_name: `Cover ${id}` },
  };
}

function makeCameraEntity(id) {
  return {
    entity_id: `camera.${id}`,
    state: "idle",
    attributes: { friendly_name: `Camera ${id}` },
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

    await bot.emitText("/status", 42);

    assert.strictEqual(ha.calls.getStates, 1);
    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 42);
  });

  it("denies the command for a chat_id absent from the allow-list without calling HA", async () => {
    const lights = [makeLightEntity("kitchen")];
    const { bot, ha } = setup({ states: lights, allowedChatIds: ["42"] });

    await bot.emitText("/status", 999);

    assert.strictEqual(ha.calls.getStates, 0);
    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 999);
  });

  it("allows every chat_id when the allow-list is empty", async () => {
    const { bot, ha } = setup({ states: [], allowedChatIds: [] });

    await bot.emitText("/status", 7);

    assert.strictEqual(ha.calls.getStates, 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 7);
  });
});

describe("createTelegramBot simple read commands", () => {
  it("/status replies with fixture data derived from the real formatter", async () => {
    const states = [makeLightEntity("kitchen")];
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/status", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.match(bot.sentMessages[0].text, /Light kitchen/);
  });

  it("/sensors replies with the active binary sensor from HA", async () => {
    const states = [makeBinarySensorEntity("hall", "motion")];
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/sensors", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.match(bot.sentMessages[0].text, /Sensor hall/);
  });

  it("/doors replies with the open door/window entity from HA", async () => {
    const states = [makeBinarySensorEntity("frontdoor", "door")];
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/doors", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.match(bot.sentMessages[0].text, /Sensor frontdoor/);
  });

  it("/battery replies with a battery below the configured threshold", async () => {
    const states = [makeBatterySensorEntity("remote", 10)];
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/battery", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.match(bot.sentMessages[0].text, /Battery remote/);
  });

  it("/temperature replies with a temperature sensor reading from HA", async () => {
    const states = [makeTemperatureSensorEntity("living_room", 21.5)];
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/temperature", 1);

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

    await bot.emitText("/status", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 1);
  });
});

describe("createTelegramBot /lights command", () => {
  it("denies the command for a chat_id absent from the allow-list without calling HA", async () => {
    const { bot, ha } = setup({ states: [makeLightEntity("kitchen")], allowedChatIds: ["1"] });

    await bot.emitText("/lights", 999);

    assert.strictEqual(ha.calls.getStates, 0);
    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 999);
  });

  it("sends an inline keyboard with one row per light", async () => {
    const lights = [makeLightEntity("kitchen", "on"), makeLightEntity("hall", "off")];
    const { bot, ha } = setup({ states: lights, allowedChatIds: [] });

    await bot.emitText("/lights", 1);

    assert.strictEqual(ha.calls.getStates, 1);
    assert.strictEqual(bot.sentMessages.length, 1);
    const keyboard = bot.sentMessages[0].options.reply_markup.inline_keyboard;
    assert.strictEqual(keyboard.length, lights.length);
    const callbackDataValues = keyboard.map((row) => row[0].callback_data);
    assert.ok(callbackDataValues.includes(`light_off:${entityToken("light.kitchen")}`));
    assert.ok(callbackDataValues.includes(`light_on:${entityToken("light.hall")}`));
  });

  it("replies without an inline keyboard when there are no lights", async () => {
    const { bot, ha } = setup({ states: [], allowedChatIds: [] });

    await bot.emitText("/lights", 1);

    assert.strictEqual(ha.calls.getStates, 1);
    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].options, undefined);
  });

  it("replies without throwing when HA fails", async () => {
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

    await bot.emitText("/lights", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].options, undefined);
  });
});

describe("createTelegramBot /switches command", () => {
  it("denies the command for a chat_id absent from the allow-list without calling HA", async () => {
    const { bot, ha } = setup({ states: [makeSwitchEntity("boiler")], allowedChatIds: ["1"] });

    await bot.emitText("/switches", 999);

    assert.strictEqual(ha.calls.getStates, 0);
    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 999);
  });

  it("sends an inline keyboard with one row per switch", async () => {
    const states = [makeSwitchEntity("boiler", "on"), makeSwitchEntity("fan", "off")];
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/switches", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    const keyboard = bot.sentMessages[0].options.reply_markup.inline_keyboard;
    assert.strictEqual(keyboard.length, 2);
  });

  it("offers turn off for a switch that is on and turn on for one that is off", async () => {
    const states = [makeSwitchEntity("boiler", "on"), makeSwitchEntity("fan", "off")];
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/switches", 1);

    const rows = bot.sentMessages[0].options.reply_markup.inline_keyboard.flat();
    const payloads = rows.map((button) => button.callback_data);
    assert.ok(payloads.includes(`switch_off:${entityToken("switch.boiler")}`));
    assert.ok(payloads.includes(`switch_on:${entityToken("switch.fan")}`));
  });

  it("ignores entities from other domains", async () => {
    const states = [
      makeSwitchEntity("boiler"),
      makeLightEntity("kitchen"),
      makeCoverEntity("blind"),
    ];
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/switches", 1);

    const rows = bot.sentMessages[0].options.reply_markup.inline_keyboard.flat();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].callback_data, `switch_on:${entityToken("switch.boiler")}`);
  });

  it("replies with the empty state when no switch exists", async () => {
    const { bot } = setup({ states: [makeLightEntity("kitchen")], allowedChatIds: [] });

    await bot.emitText("/switches", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].options?.reply_markup, undefined);
  });
});

describe("createTelegramBot switch callbacks", () => {
  it("calls switch.turn_on for an offered switch that is off", async () => {
    const { bot, ha } = setup({ states: [makeSwitchEntity("fan", "off")], allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `switch_on:${entityToken("switch.fan")}` }),
    );

    assert.strictEqual(ha.calls.callService.length, 1);
    assert.deepStrictEqual(ha.calls.callService[0], {
      domain: "switch",
      service: "turn_on",
      data: { entity_id: "switch.fan" },
    });
  });

  it("calls switch.turn_off for an offered switch that is on", async () => {
    const { bot, ha } = setup({ states: [makeSwitchEntity("boiler", "on")], allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `switch_off:${entityToken("switch.boiler")}` }),
    );

    assert.strictEqual(ha.calls.callService.length, 1);
    assert.strictEqual(ha.calls.callService[0].service, "turn_off");
  });

  // The entity gate must cover switches exactly like lights and covers: a
  // crafted callback naming a switch the bot never displayed is an attempt to
  // operate something outside the offered set.
  it("rejects a switch entity_id the bot never offered, calling no HA service", async () => {
    const { bot, ha } = setup({ states: [makeSwitchEntity("fan", "off")], allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `switch_on:${entityToken("switch.neighbour_heater")}` }),
    );

    assert.strictEqual(ha.calls.callService.length, 0);
  });

  it("refreshes the switch keyboard after acting", async () => {
    const { bot } = setup({ states: [makeSwitchEntity("fan", "off")], allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `switch_on:${entityToken("switch.fan")}` }),
    );

    assert.strictEqual(bot.editedReplyMarkups.length, 1);
  });
});

describe("createTelegramBot /covers command", () => {
  it("denies the command for a chat_id absent from the allow-list without calling HA", async () => {
    const { bot, ha } = setup({ states: [makeCoverEntity("garage")], allowedChatIds: ["1"] });

    await bot.emitText("/covers", 999);

    assert.strictEqual(ha.calls.getStates, 0);
    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 999);
  });

  it("sends an inline keyboard with one row per cover", async () => {
    const covers = [makeCoverEntity("garage", "closed"), makeCoverEntity("gate", "open")];
    const { bot, ha } = setup({ states: covers, allowedChatIds: [] });

    await bot.emitText("/covers", 1);

    assert.strictEqual(ha.calls.getStates, 1);
    assert.strictEqual(bot.sentMessages.length, 1);
    const keyboard = bot.sentMessages[0].options.reply_markup.inline_keyboard;
    assert.strictEqual(keyboard.length, covers.length);
    const callbackDataValues = keyboard.map((row) => row[0].callback_data);
    assert.ok(callbackDataValues.includes(`cover_open:${entityToken("cover.garage")}`));
    assert.ok(callbackDataValues.includes(`cover_close:${entityToken("cover.gate")}`));
  });

  it("replies without an inline keyboard when there are no covers", async () => {
    const { bot, ha } = setup({ states: [], allowedChatIds: [] });

    await bot.emitText("/covers", 1);

    assert.strictEqual(ha.calls.getStates, 1);
    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].options, undefined);
  });

  it("replies without throwing when HA fails", async () => {
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

    await bot.emitText("/covers", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].options, undefined);
  });
});

describe("createTelegramBot /cameras command", () => {
  it("denies the command for a chat_id absent from the allow-list without calling HA", async () => {
    const { bot, ha } = setup({ states: [makeCameraEntity("front")], allowedChatIds: ["1"] });

    await bot.emitText("/cameras", 999);

    assert.strictEqual(ha.calls.getStates, 0);
    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 999);
  });

  it("sends an inline keyboard with one row per camera", async () => {
    const cameras = [makeCameraEntity("front"), makeCameraEntity("back")];
    const { bot, ha } = setup({ states: cameras, allowedChatIds: [] });

    await bot.emitText("/cameras", 1);

    assert.strictEqual(ha.calls.getStates, 1);
    assert.strictEqual(bot.sentMessages.length, 1);
    const keyboard = bot.sentMessages[0].options.reply_markup.inline_keyboard;
    assert.strictEqual(keyboard.length, cameras.length);
    const callbackDataValues = keyboard.map((row) => row[0].callback_data);
    assert.ok(callbackDataValues.includes(`camera_pick:${entityToken("camera.front")}`));
    assert.ok(callbackDataValues.includes(`camera_pick:${entityToken("camera.back")}`));
  });

  it("replies without an inline keyboard when there are no cameras", async () => {
    const { bot, ha } = setup({ states: [], allowedChatIds: [] });

    await bot.emitText("/cameras", 1);

    assert.strictEqual(ha.calls.getStates, 1);
    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].options, undefined);
  });

  it("replies without throwing when HA fails", async () => {
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

    await bot.emitText("/cameras", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].options, undefined);
  });
});

describe("createTelegramBot reply chunking", () => {
  it("sends a single message when the formatted reply is under the chunk limit", async () => {
    const states = [makeLightEntity("kitchen")];
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/status", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
  });

  it("splits the formatted reply into multiple messages over 3900 characters", async () => {
    const states = Array.from({ length: 200 }, (_, index) =>
      makeLightEntity(`bulb_${String(index).padStart(3, "0")}_${"x".repeat(20)}`),
    );
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/status", 1);

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

describe("createTelegramBot callback_query dispatch", () => {
  it("light_on calls callService turn_on and refreshes the light keyboard", async () => {
    const lights = [makeLightEntity("kitchen", "off"), makeLightEntity("hall", "off")];
    const { bot, ha } = setup({ states: lights, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `light_on:${entityToken("light.kitchen")}` }),
    );

    assert.strictEqual(ha.calls.callService.length, 1);
    assert.deepStrictEqual(ha.calls.callService[0], {
      domain: "light",
      service: "turn_on",
      data: { entity_id: "light.kitchen" },
    });
    assert.strictEqual(bot.answeredCallbacks.length, 1);
    assert.strictEqual(bot.editedReplyMarkups.length, 1);
    const keyboard = bot.editedReplyMarkups[0].replyMarkup.inline_keyboard;
    assert.strictEqual(keyboard.length, lights.length);
    const callbackDataValues = keyboard.map((row) => row[0].callback_data);
    assert.ok(callbackDataValues.includes(`light_on:${entityToken("light.kitchen")}`));
  });

  it("light_off calls callService turn_off and refreshes the light keyboard", async () => {
    const lights = [makeLightEntity("kitchen", "on")];
    const { bot, ha } = setup({ states: lights, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `light_off:${entityToken("light.kitchen")}` }),
    );

    assert.deepStrictEqual(ha.calls.callService[0], {
      domain: "light",
      service: "turn_off",
      data: { entity_id: "light.kitchen" },
    });
    const keyboard = bot.editedReplyMarkups[0].replyMarkup.inline_keyboard;
    assert.strictEqual(keyboard.length, 1);
    assert.strictEqual(keyboard[0][0].callback_data, `light_off:${entityToken("light.kitchen")}`);
  });

  it("cover_open calls callService open_cover and refreshes the cover keyboard", async () => {
    const covers = [makeCoverEntity("garage", "closed")];
    const { bot, ha } = setup({ states: covers, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `cover_open:${entityToken("cover.garage")}` }),
    );

    assert.deepStrictEqual(ha.calls.callService[0], {
      domain: "cover",
      service: "open_cover",
      data: { entity_id: "cover.garage" },
    });
    const keyboard = bot.editedReplyMarkups[0].replyMarkup.inline_keyboard;
    assert.strictEqual(keyboard.length, 1);
    assert.strictEqual(keyboard[0][0].callback_data, `cover_open:${entityToken("cover.garage")}`);
  });

  it("cover_close calls callService close_cover and refreshes the cover keyboard", async () => {
    const covers = [makeCoverEntity("garage", "open")];
    const { bot, ha } = setup({ states: covers, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `cover_close:${entityToken("cover.garage")}` }),
    );

    assert.deepStrictEqual(ha.calls.callService[0], {
      domain: "cover",
      service: "close_cover",
      data: { entity_id: "cover.garage" },
    });
    const keyboard = bot.editedReplyMarkups[0].replyMarkup.inline_keyboard;
    assert.strictEqual(keyboard.length, 1);
    assert.strictEqual(keyboard[0][0].callback_data, `cover_close:${entityToken("cover.garage")}`);
  });

  it("camera_pick edits the message with a 3-row options keyboard for the selected camera", async () => {
    const cameras = [makeCameraEntity("front")];
    const { bot } = setup({ states: cameras, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `camera_pick:${entityToken("camera.front")}` }),
    );

    assert.strictEqual(bot.editedTexts.length, 1);
    const keyboard = bot.editedTexts[0].options.reply_markup.inline_keyboard;
    assert.strictEqual(keyboard.length, 3);
    assert.strictEqual(keyboard[0][0].callback_data, `camera_img:${entityToken("camera.front")}`);
    assert.strictEqual(keyboard[1][0].callback_data, `camera_vid30:${entityToken("camera.front")}`);
    assert.strictEqual(keyboard[2][0].callback_data, "camera_list");
  });

  it("camera_list edits the message with one keyboard row per available camera", async () => {
    const cameras = [makeCameraEntity("front"), makeCameraEntity("back")];
    const { bot } = setup({ states: cameras, allowedChatIds: [] });

    await bot.emitEvent("callback_query", makeCallbackQuery({ data: "camera_list" }));

    assert.strictEqual(bot.editedTexts.length, 1);
    const keyboard = bot.editedTexts[0].options.reply_markup.inline_keyboard;
    assert.strictEqual(keyboard.length, cameras.length);
    const callbackDataValues = keyboard.map((row) => row[0].callback_data);
    assert.ok(callbackDataValues.includes(`camera_pick:${entityToken("camera.front")}`));
    assert.ok(callbackDataValues.includes(`camera_pick:${entityToken("camera.back")}`));
  });
});

describe("createTelegramBot camera media flows", () => {
  it("camera_img sends the snapshot buffer as a photo", async () => {
    const cameras = [makeCameraEntity("front")];
    const { bot, ha } = setup({ states: cameras, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `camera_img:${entityToken("camera.front")}` }),
    );

    assert.strictEqual(ha.calls.getCameraSnapshot.length, 1);
    assert.strictEqual(ha.calls.getCameraSnapshot[0], "camera.front");
    assert.strictEqual(bot.sentPhotos.length, 1);
    assert.strictEqual(bot.sentPhotos[0].fileOptions.contentType, "image/jpeg");
  });

  it("camera_vid30 records a clip and sends the resolved video buffer", async () => {
    const cameras = [makeCameraEntity("front")];
    const { bot, ha } = setup({ states: cameras, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `camera_vid30:${entityToken("camera.front")}` }),
    );

    assert.strictEqual(ha.calls.recordCameraClip.length, 1);
    assert.deepStrictEqual(ha.calls.recordCameraClip[0], {
      entityId: "camera.front",
      seconds: 30,
    });
    assert.ok(ha.calls.getMediaFile.includes("/fake/clip.mp4"));
    assert.strictEqual(bot.sentVideos.length, 1);
    assert.strictEqual(bot.sentVideos[0].fileOptions.contentType, "video/mp4");
  });

  it("falls back to a snapshot image when camera.record is unsupported (5xx)", async () => {
    const cameras = [makeCameraEntity("front")];
    const recordError = new Error("record unsupported");
    recordError.path = "/services/camera/record";
    recordError.status = 501;
    const { bot, ha } = setup({
      states: cameras,
      allowedChatIds: [],
      haOverrides: {
        onRecordCameraClip: () => {
          throw recordError;
        },
      },
    });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `camera_vid30:${entityToken("camera.front")}` }),
    );

    assert.strictEqual(bot.sentVideos.length, 0);
    assert.strictEqual(bot.sentPhotos.length, 1);
    assert.strictEqual(ha.calls.getCameraSnapshot.length, 1);
  });

  it("sends the photo as a document when sendPhoto fails", async () => {
    const cameras = [makeCameraEntity("front")];
    const { bot } = setup({ states: cameras, allowedChatIds: [] });
    bot.sendPhoto = async () => {
      throw new Error("sendPhoto unavailable");
    };

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `camera_img:${entityToken("camera.front")}` }),
    );

    assert.strictEqual(bot.sentPhotos.length, 0);
    assert.strictEqual(bot.sentDocuments.length, 1);
  });

  it("sends the video as a document when sendVideo fails", async () => {
    const cameras = [makeCameraEntity("front")];
    const { bot } = setup({ states: cameras, allowedChatIds: [] });
    bot.sendVideo = async () => {
      throw new Error("sendVideo unavailable");
    };

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `camera_vid30:${entityToken("camera.front")}` }),
    );

    assert.strictEqual(bot.sentVideos.length, 0);
    assert.strictEqual(bot.sentDocuments.length, 1);
  });
});

describe("createTelegramBot callback_query allow-list gate", () => {
  it("denies a callback from a chat_id absent from the allow-list without calling HA", async () => {
    const lights = [makeLightEntity("kitchen", "off")];
    const { bot, ha } = setup({ states: lights, allowedChatIds: ["42"] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `light_on:${entityToken("light.kitchen")}`, chatId: 999 }),
    );

    assert.strictEqual(ha.calls.getStates, 0);
    assert.strictEqual(ha.calls.callService.length, 0);
    assert.strictEqual(bot.answeredCallbacks.length, 1);
    assert.strictEqual(bot.editedReplyMarkups.length, 0);
  });

  it("allows a callback from a chat_id present in the allow-list", async () => {
    const lights = [makeLightEntity("kitchen", "off")];
    const { bot, ha } = setup({ states: lights, allowedChatIds: ["42"] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `light_on:${entityToken("light.kitchen")}`, chatId: 42 }),
    );

    assert.strictEqual(ha.calls.callService.length, 1);
  });
});

describe("createTelegramBot callback_query unknown action", () => {
  it("answers the callback without calling any HA service or editing the message", async () => {
    const { bot, ha } = setup({ states: [], allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `not_a_real_action:${entityToken("foo.bar")}` }),
    );

    assert.strictEqual(ha.calls.callService.length, 0);
    assert.strictEqual(bot.answeredCallbacks.length, 1);
    assert.strictEqual(bot.editedTexts.length, 0);
    assert.strictEqual(bot.editedReplyMarkups.length, 0);
  });
});

describe("createTelegramBot callback_query outer error handler", () => {
  // The post-action keyboard refresh (see the "Refresh the inline keyboard"
  // comment in src/telegram.js) has no try/catch of its own — it deliberately
  // relies on the outer callback_query catch below it. This drives a failure
  // through that exact refresh step (the action itself succeeds, the
  // follow-up state re-fetch for the keyboard does not) to prove the outer
  // handler is what reports it: an error reply to the chat and an error
  // answer to the callback, rather than an unhandled rejection.
  it("reports a keyboard-refresh failure via the outer catch, not the action branch", async () => {
    const entityId = "light.kitchen";
    let getStatesCalls = 0;
    const bot = new FakeTelegramBot();
    const ha = {
      async getStates() {
        getStatesCalls += 1;
        if (getStatesCalls === 1) {
          return [makeLightEntity("kitchen", "off")];
        }
        throw new Error("refresh boom");
      },
      async callService() {
        return {};
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

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `light_on:${entityToken(entityId)}`, chatId: 5, messageId: 9 }),
    );

    assert.strictEqual(getStatesCalls, 2);
    assert.strictEqual(bot.sentMessages.length, 1);
    assert.match(bot.sentMessages[0].text, /refresh boom/);
    assert.strictEqual(bot.answeredCallbacks.length, 2);
    assert.match(bot.answeredCallbacks[1].options.text, /refresh boom/);
    assert.strictEqual(bot.editedReplyMarkups.length, 0);
  });
});

describe("createTelegramBot camera video availability", () => {
  const cameras = [makeCameraEntity("front")];

  async function pickCamera({ cameraVideoAvailable }) {
    const bot = new FakeTelegramBot();
    const ha = createFakeHaClient({ states: cameras });

    createTelegramBot({
      token: "test-token",
      allowedChatIds: [],
      lowBatteryThreshold: 20,
      ha,
      cameraVideoAvailable,
      createBot: () => bot,
      logger: noopLogger,
    });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `camera_pick:${entityToken("camera.front")}` }),
    );

    return { bot, ha };
  }

  it("offers the video button when running inside Home Assistant", async () => {
    const { bot } = await pickCamera({ cameraVideoAvailable: true });

    const rows = bot.editedTexts[0].options.reply_markup.inline_keyboard;
    const payloads = rows.flat().map((button) => button.callback_data);
    assert.ok(payloads.some((payload) => payload.startsWith("camera_vid")));
  });

  // A button that cannot work is worse than no button: standalone has no media
  // mount, so a recorded clip could never be fetched.
  it("omits the video button when running standalone", async () => {
    const { bot } = await pickCamera({ cameraVideoAvailable: false });

    const rows = bot.editedTexts[0].options.reply_markup.inline_keyboard;
    const payloads = rows.flat().map((button) => button.callback_data);
    assert.ok(!payloads.some((payload) => payload.startsWith("camera_vid")));
    assert.ok(payloads.some((payload) => payload.startsWith("camera_img")));
  });

  it("explains why rather than failing when a stale video button is pressed", async () => {
    const bot = new FakeTelegramBot();
    const ha = createFakeHaClient({ states: cameras });

    createTelegramBot({
      token: "test-token",
      allowedChatIds: [],
      lowBatteryThreshold: 20,
      ha,
      cameraVideoAvailable: false,
      createBot: () => bot,
      logger: noopLogger,
    });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `camera_vid30:${entityToken("camera.front")}` }),
    );

    assert.strictEqual(ha.calls.recordCameraClip.length, 0);
    assert.match(bot.answeredCallbacks[0].options.text, /only available when running inside/);
  });
});

describe("createTelegramBot callback_data bounds", () => {
  // Telegram refuses a callback_data over 64 bytes and rejects the WHOLE
  // message when one button breaks it, so a single long entity ID used to make
  // an entire keyboard unsendable. Entity IDs are unbounded; smart plug
  // integrations routinely generate very long ones.
  const LONG_ENTITY = "switch.termotanque_electrico_del_lavadero_proteccion_sobrecarga";

  it("keeps every callback_data within Telegram's 64-byte limit for a long entity ID", async () => {
    const states = [
      { entity_id: LONG_ENTITY, state: "off", attributes: { friendly_name: "Termotanque" } },
    ];
    const { bot } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/switches", 1);

    const buttons = bot.sentMessages[0].options.reply_markup.inline_keyboard.flat();
    assert.strictEqual(buttons.length, 1);
    assert.ok(Buffer.byteLength(buttons[0].callback_data, "utf8") <= 64);

    // The raw ID alone would already have exceeded the limit with its prefix.
    assert.ok(Buffer.byteLength(`switch_on:${LONG_ENTITY}`, "utf8") > 64);
  });

  it("still operates the right entity when the ID is too long to travel in the payload", async () => {
    const states = [
      { entity_id: LONG_ENTITY, state: "off", attributes: { friendly_name: "Termotanque" } },
    ];
    const { bot, ha } = setup({ states, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `switch_on:${entityToken(LONG_ENTITY)}` }),
    );

    assert.deepStrictEqual(ha.calls.callService[0], {
      domain: "switch",
      service: "turn_on",
      data: { entity_id: LONG_ENTITY },
    });
  });

  // Buttons rendered before 2.1.1 carry the entity ID itself. They no longer
  // resolve, and telling someone their keyboard is stale beats a bare refusal.
  it("tells the user a pre-2.1.1 keyboard is stale instead of calling a service", async () => {
    const { bot, ha } = setup({
      states: [makeLightEntity("kitchen", "off")],
      allowedChatIds: [],
    });

    await bot.emitEvent("callback_query", makeCallbackQuery({ data: "light_on:light.kitchen" }));

    assert.strictEqual(ha.calls.callService.length, 0);
    assert.match(bot.answeredCallbacks[0].options.text, /older version/);
  });
});

describe("createTelegramBot entity authorization gate", () => {
  it("rejects an entity_id never offered in a light keyboard, calling no HA service", async () => {
    const lights = [makeLightEntity("kitchen", "off")];
    const { bot, ha } = setup({ states: lights, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `light_on:${entityToken("light.not_offered")}` }),
    );

    assert.strictEqual(ha.calls.callService.length, 0);
    assert.strictEqual(bot.answeredCallbacks.length, 1);
  });

  it("rejects a malformed entity_id shape, calling no HA service", async () => {
    const lights = [makeLightEntity("kitchen", "off")];
    const { bot, ha } = setup({ states: lights, allowedChatIds: [] });

    await bot.emitEvent("callback_query", makeCallbackQuery({ data: "light_on:../../etc" }));

    assert.strictEqual(ha.calls.callService.length, 0);
    assert.strictEqual(bot.answeredCallbacks.length, 1);
  });

  it("rejects a cover entity_id never offered, calling no HA service", async () => {
    const covers = [makeCoverEntity("garage", "closed")];
    const { bot, ha } = setup({ states: covers, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `cover_open:${entityToken("cover.not_offered")}` }),
    );

    assert.strictEqual(ha.calls.callService.length, 0);
    assert.strictEqual(bot.answeredCallbacks.length, 1);
  });

  it("rejects a camera_pick entity_id never offered, without editing the message", async () => {
    const cameras = [makeCameraEntity("front")];
    const { bot } = setup({ states: cameras, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `camera_pick:${entityToken("camera.not_offered")}` }),
    );

    assert.strictEqual(bot.editedTexts.length, 0);
    assert.strictEqual(bot.answeredCallbacks.length, 1);
  });

  it("still accepts an offered entity_id after the gate is in place", async () => {
    const lights = [makeLightEntity("kitchen", "off")];
    const { bot, ha } = setup({ states: lights, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `light_on:${entityToken("light.kitchen")}` }),
    );

    assert.strictEqual(ha.calls.callService.length, 1);
  });
});

describe("createTelegramBot retired Spanish commands", () => {
  // The 2.0.0 rename kept no Spanish aliases. Each retired command now gets a
  // migration reply naming its exact English replacement, instead of the
  // silence the very first 2.0.0 cut shipped with. It still calls no Home
  // Assistant service: only a real command runs a flow.
  const RETIRED_COMMAND_REPLACEMENTS = {
    "/estado": "/status",
    "/luces": "/lights",
    "/sensores": "/sensors",
    "/puertas": "/doors",
    "/bateria": "/battery",
    "/temp": "/temperature",
    "/persianas": "/covers",
    "/camaras": "/cameras",
  };

  for (const [command, replacement] of Object.entries(RETIRED_COMMAND_REPLACEMENTS)) {
    it(`replies to ${command} naming ${replacement} as its replacement, calling no HA service`, async () => {
      const lights = [makeLightEntity("kitchen")];
      const { bot, ha } = setup({ states: lights, allowedChatIds: [] });

      await bot.emitText(command, 42);

      assert.strictEqual(bot.sentMessages.length, 1);
      assert.strictEqual(bot.sentMessages[0].chatId, 42);
      assert.match(bot.sentMessages[0].text, new RegExp(replacement.replace("/", "\\/")));
      assert.strictEqual(ha.calls.getStates, 0);
      assert.strictEqual(ha.calls.callService.length, 0);
    });
  }

  it("gates the migration reply by the allow-list, like every other command", async () => {
    const { bot, ha } = setup({ states: [], allowedChatIds: ["1"] });

    await bot.emitText("/luces", 999);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 999);
    assert.doesNotMatch(bot.sentMessages[0].text, /\/lights/);
    assert.strictEqual(ha.calls.getStates, 0);
  });

  it("still replies with the migration text once the chat is allowed", async () => {
    const { bot } = setup({ states: [], allowedChatIds: ["1"] });

    await bot.emitText("/luces", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.match(bot.sentMessages[0].text, /\/lights/);
  });

  // Regression guard for the highest-risk part of this feature: bot.onText
  // matching is unanchored, and "/temp" is a substring of "/temperature".
  // An unanchored retired-command pattern would fire on both, sending the
  // migration notice alongside (or instead of) the real temperature reply.
  it("does not intercept /temperature: only the real temperature flow replies", async () => {
    const states = [makeTemperatureSensorEntity("living_room", 21.5)];
    const { bot, ha } = setup({ states, allowedChatIds: [] });

    await bot.emitText("/temperature", 1);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(ha.calls.getStates, 1);
    assert.doesNotMatch(bot.sentMessages[0].text, /renamed/);
  });
});

describe("createTelegramBot /start and /help gating", () => {
  it("denies /start for a chat_id absent from the allow-list", async () => {
    const { bot } = setup({ states: [], allowedChatIds: ["42"] });

    await bot.emitText("/start", 999);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 999);
    assert.strictEqual(bot.sentMessages[0].text.split("\n").length, 1);
  });

  it("sends the full command list for /start when the chat_id is allowed", async () => {
    const { bot } = setup({ states: [], allowedChatIds: ["42"] });

    await bot.emitText("/start", 42);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.ok(bot.sentMessages[0].text.split("\n").length > 1);
  });

  it("allows /start for every chat_id when the allow-list is empty", async () => {
    const { bot } = setup({ states: [], allowedChatIds: [] });

    await bot.emitText("/start", 7);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.ok(bot.sentMessages[0].text.split("\n").length > 1);
  });

  it("denies /help for a chat_id absent from the allow-list", async () => {
    const { bot } = setup({ states: [], allowedChatIds: ["42"] });

    await bot.emitText("/help", 999);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 999);
    assert.strictEqual(bot.sentMessages[0].text.split("\n").length, 1);
  });

  it("sends the command list for /help when the chat_id is allowed", async () => {
    const { bot } = setup({ states: [], allowedChatIds: ["42"] });

    await bot.emitText("/help", 42);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.ok(bot.sentMessages[0].text.split("\n").length > 1);
  });

  it("keeps /chatid reachable for a chat_id absent from the allow-list", async () => {
    const { bot } = setup({ states: [], allowedChatIds: ["42"] });

    await bot.emitText("/chatid", 999);

    assert.strictEqual(bot.sentMessages.length, 1);
    assert.strictEqual(bot.sentMessages[0].chatId, 999);
  });
});

describe("user-facing copy", () => {
  it("denies an unauthorized chat with guidance text including its chat_id", async () => {
    const { bot } = setup({ states: [], allowedChatIds: ["1"] });

    await bot.emitText("/status", 999);

    assert.match(bot.sentMessages[0].text, /999/);
  });

  it("/chatid replies without an authorization error for a chat_id absent from the allow-list", async () => {
    const { bot } = setup({ states: [], allowedChatIds: ["1"] });

    await bot.emitText("/chatid", 999);

    assert.doesNotMatch(bot.sentMessages[0].text, /[Nn]ot authorized/);
  });

  it("denies a callback from a disallowed chat with a not-authorized answer", async () => {
    const { bot } = setup({ states: [], allowedChatIds: ["42"] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: `light_on:${entityToken("light.kitchen")}`, chatId: 999 }),
    );

    assert.match(bot.answeredCallbacks[0].options.text, /[Nn]ot authorized/);
  });
});
