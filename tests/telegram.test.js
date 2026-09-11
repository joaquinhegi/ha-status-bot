import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createTelegramBot } from "../src/telegram.js";
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

describe("createTelegramBot callback_query dispatch", () => {
  it("light_on calls callService turn_on and refreshes the light keyboard", async () => {
    const lights = [makeLightEntity("kitchen", "off"), makeLightEntity("hall", "off")];
    const { bot, ha } = setup({ states: lights, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: "light_on:light.kitchen" })
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
    assert.ok(callbackDataValues.includes("light_on:light.kitchen"));
  });

  it("light_off calls callService turn_off and refreshes the light keyboard", async () => {
    const lights = [makeLightEntity("kitchen", "on")];
    const { bot, ha } = setup({ states: lights, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: "light_off:light.kitchen" })
    );

    assert.deepStrictEqual(ha.calls.callService[0], {
      domain: "light",
      service: "turn_off",
      data: { entity_id: "light.kitchen" },
    });
    const keyboard = bot.editedReplyMarkups[0].replyMarkup.inline_keyboard;
    assert.strictEqual(keyboard.length, 1);
    assert.strictEqual(keyboard[0][0].callback_data, "light_off:light.kitchen");
  });

  it("cover_open calls callService open_cover and refreshes the cover keyboard", async () => {
    const covers = [makeCoverEntity("garage", "closed")];
    const { bot, ha } = setup({ states: covers, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: "cover_open:cover.garage" })
    );

    assert.deepStrictEqual(ha.calls.callService[0], {
      domain: "cover",
      service: "open_cover",
      data: { entity_id: "cover.garage" },
    });
    const keyboard = bot.editedReplyMarkups[0].replyMarkup.inline_keyboard;
    assert.strictEqual(keyboard.length, 1);
    assert.strictEqual(keyboard[0][0].callback_data, "cover_open:cover.garage");
  });

  it("cover_close calls callService close_cover and refreshes the cover keyboard", async () => {
    const covers = [makeCoverEntity("garage", "open")];
    const { bot, ha } = setup({ states: covers, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: "cover_close:cover.garage" })
    );

    assert.deepStrictEqual(ha.calls.callService[0], {
      domain: "cover",
      service: "close_cover",
      data: { entity_id: "cover.garage" },
    });
    const keyboard = bot.editedReplyMarkups[0].replyMarkup.inline_keyboard;
    assert.strictEqual(keyboard.length, 1);
    assert.strictEqual(keyboard[0][0].callback_data, "cover_close:cover.garage");
  });

  it("camera_pick edits the message with a 3-row options keyboard for the selected camera", async () => {
    const cameras = [makeCameraEntity("front")];
    const { bot } = setup({ states: cameras, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: "camera_pick:camera.front" })
    );

    assert.strictEqual(bot.editedTexts.length, 1);
    const keyboard = bot.editedTexts[0].options.reply_markup.inline_keyboard;
    assert.strictEqual(keyboard.length, 3);
    assert.strictEqual(keyboard[0][0].callback_data, "camera_img:camera.front");
    assert.strictEqual(keyboard[1][0].callback_data, "camera_vid30:camera.front");
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
    assert.ok(callbackDataValues.includes("camera_pick:camera.front"));
    assert.ok(callbackDataValues.includes("camera_pick:camera.back"));
  });
});

describe("createTelegramBot camera media flows", () => {
  it("camera_img sends the snapshot buffer as a photo", async () => {
    const cameras = [makeCameraEntity("front")];
    const { bot, ha } = setup({ states: cameras, allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: "camera_img:camera.front" })
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
      makeCallbackQuery({ data: "camera_vid30:camera.front" })
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
      makeCallbackQuery({ data: "camera_vid30:camera.front" })
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
      makeCallbackQuery({ data: "camera_img:camera.front" })
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
      makeCallbackQuery({ data: "camera_vid30:camera.front" })
    );

    assert.strictEqual(bot.sentVideos.length, 0);
    assert.strictEqual(bot.sentDocuments.length, 1);
  });
});

describe("createTelegramBot callback_query unknown action", () => {
  it("answers the callback without calling any HA service or editing the message", async () => {
    const { bot, ha } = setup({ states: [], allowedChatIds: [] });

    await bot.emitEvent(
      "callback_query",
      makeCallbackQuery({ data: "not_a_real_action:foo.bar" })
    );

    assert.strictEqual(ha.calls.callService.length, 0);
    assert.strictEqual(bot.answeredCallbacks.length, 1);
    assert.strictEqual(bot.editedTexts.length, 0);
    assert.strictEqual(bot.editedReplyMarkups.length, 0);
  });
});

describe("user-facing copy", () => {
  it("denies an unauthorized chat with guidance text including its chat_id", async () => {
    const { bot } = setup({ states: [], allowedChatIds: ["1"] });

    await bot.emitText("/estado", 999);

    assert.match(bot.sentMessages[0].text, /999/);
  });
});
