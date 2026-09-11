import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import { createHomeAssistantClient } from "../src/haClient.js";

// Mirrors HA_RETRY.SNAPSHOT_COOLDOWN_MS in src/haClient.js, which is module
// private. Tests advance past it to reach a second snapshot attempt.
const HA_RETRY_SNAPSHOT_COOLDOWN_MS = 5 * 60 * 1000;

describe("createHomeAssistantClient", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(status, body) {
    globalThis.fetch = mock.fn(async () => ({
      ok: status >= 200 && status < 400,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
      arrayBuffer: async () => Buffer.from(JSON.stringify(body)),
      headers: {
        get: () => "application/json",
      },
    }));
  }

  function mockFetchSequence(responses) {
    let index = 0;
    globalThis.fetch = mock.fn(async () => {
      const current = responses[index] || responses[responses.length - 1];
      index += 1;

      return {
        ok: current.status >= 200 && current.status < 400,
        status: current.status,
        json: async () => current.body,
        text: async () => JSON.stringify(current.body),
        arrayBuffer: async () => current.arrayBuffer ?? Buffer.from(JSON.stringify(current.body)),
        headers: {
          get: () => current.contentType || "application/json",
        },
      };
    });
  }

  function makeControllableNow(startValue) {
    let current = startValue;
    const now = () => current;
    now.advance = (ms) => {
      current += ms;
    };
    return now;
  }

  function makeSleepSpy() {
    const calls = [];
    const sleep = async (ms) => {
      calls.push(ms);
    };
    sleep.calls = calls;
    return sleep;
  }

  describe("getStates", () => {
    it("llama a GET /states con las cabeceras correctas", async () => {
      const fakeStates = [{ entity_id: "light.test", state: "on" }];
      mockFetch(200, fakeStates);

      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
      });

      const result = await ha.getStates();

      assert.deepStrictEqual(result, fakeStates);

      const [url, options] = globalThis.fetch.mock.calls[0].arguments;
      assert.strictEqual(url, "http://supervisor/core/api/states");
      assert.strictEqual(options.headers.Authorization, "Bearer test-token");
      assert.strictEqual(options.headers["Content-Type"], "application/json");
    });

    it("lanza error si la respuesta no es OK", async () => {
      mockFetch(401, { message: "Unauthorized" });

      const ha = createHomeAssistantClient({
        baseUrl: "http://localhost",
        token: "bad-token",
      });

      await assert.rejects(() => ha.getStates(), {
        message: /Home Assistant API error 401/,
      });
    });
  });

  describe("callService", () => {
    it("envía POST con los datos de servicio", async () => {
      mockFetch(200, []);

      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
      });

      await ha.callService("light", "turn_off", {
        entity_id: "light.salon",
      });

      const [url, options] = globalThis.fetch.mock.calls[0].arguments;
      assert.strictEqual(
        url,
        "http://supervisor/core/api/services/light/turn_off"
      );
      assert.strictEqual(options.method, "POST");
      assert.deepStrictEqual(JSON.parse(options.body), {
        entity_id: "light.salon",
      });
    });

    it("envía POST sin datos por defecto", async () => {
      mockFetch(200, []);

      const ha = createHomeAssistantClient({
        baseUrl: "http://localhost",
        token: "t",
      });

      await ha.callService("switch", "toggle");

      const [, options] = globalThis.fetch.mock.calls[0].arguments;
      assert.deepStrictEqual(JSON.parse(options.body), {});
    });
  });

  describe("camera methods", () => {
    it("descarga snapshot de cámara como binario", async () => {
      mockFetch(200, { image: true });

      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
      });

      const result = await ha.getCameraSnapshot("camera.entrada");

      const [url, options] = globalThis.fetch.mock.calls[0].arguments;
      assert.strictEqual(
        url,
        "http://supervisor/core/api/camera_proxy/camera.entrada"
      );
      assert.ok(Buffer.isBuffer(result.buffer));
      assert.strictEqual(result.contentType, "application/json");
      assert.strictEqual(options.headers.Authorization, "Bearer test-token");
    });

    it("usa fallback de snapshot cuando falla camera_proxy directo", async () => {
      mockFetchSequence([
        { status: 404, body: { message: "not found" } },
        { status: 500, body: { message: "proxy failed" } },
        { status: 200, body: [] },
        { status: 200, body: { image: true } },
      ]);

      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
      });

      const result = await ha.getCameraSnapshot("camera.entrada");
      assert.ok(Buffer.isBuffer(result.buffer));

      const [url1] = globalThis.fetch.mock.calls[0].arguments;
      const [url2] = globalThis.fetch.mock.calls[1].arguments;
      const [url3, options3] = globalThis.fetch.mock.calls[2].arguments;
      const [url4] = globalThis.fetch.mock.calls[3].arguments;
      assert.strictEqual(url1, "http://supervisor/core/api/camera_proxy/camera.entrada");
      assert.strictEqual(url2, "http://supervisor/core/api/camera_proxy/camera.entrada");
      assert.strictEqual(url3, "http://supervisor/core/api/services/camera/snapshot");
      assert.strictEqual(options3.method, "POST");
      assert.ok(
        url4.startsWith("http://supervisor/core/media/local/ha_status_bot_snapshot_camera_entrada_")
      );
      assert.ok(url4.endsWith(".jpg"));
    });

    it("llama camera.record con duración y nombre de archivo", async () => {
      mockFetch(200, []);

      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
      });

      const result = await ha.recordCameraClip("camera.patio", 30);

      const [url, options] = globalThis.fetch.mock.calls[0].arguments;
      assert.strictEqual(
        url,
        "http://supervisor/core/api/services/camera/record"
      );
      assert.strictEqual(options.method, "POST");

      const payload = JSON.parse(options.body);
      assert.strictEqual(payload.entity_id, "camera.patio");
      assert.strictEqual(payload.duration, 30);
      assert.ok(payload.filename.startsWith("/media/ha_status_bot_camera_patio_"));
      assert.ok(payload.filename.endsWith(".mp4"));

      assert.ok(result.internalPath.startsWith("/media/ha_status_bot_camera_patio_"));
      assert.ok(result.publicPath.startsWith("/media/local/ha_status_bot_camera_patio_"));
    });

    it("descarga media desde la URL raíz de Home Assistant", async () => {
      mockFetch(200, { video: true });

      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
      });

      await ha.getMediaFile("/media/local/clip.mp4");

      const [url] = globalThis.fetch.mock.calls[0].arguments;
      assert.strictEqual(url, "http://supervisor/core/media/local/clip.mp4");
    });

    it("prueba rutas alternativas cuando no encuentra media", async () => {
      mockFetchSequence([
        { status: 404, body: { message: "not found" } },
        { status: 404, body: { message: "not found" } },
        { status: 200, body: { video: true } },
      ]);

      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
      });

      const result = await ha.getMediaFile("/media/local/clip.mp4");
      assert.ok(Buffer.isBuffer(result.buffer));

      const [u1] = globalThis.fetch.mock.calls[0].arguments;
      const [u2] = globalThis.fetch.mock.calls[1].arguments;
      const [u3] = globalThis.fetch.mock.calls[2].arguments;

      assert.strictEqual(u1, "http://supervisor/core/media/local/clip.mp4");
      assert.strictEqual(u2, "http://supervisor/core/media/clip.mp4");
      assert.strictEqual(u3, "http://supervisor/core/api/media_proxy/media/clip.mp4");
    });
  });

  describe("camera snapshot retry and cooldown", () => {
    it("retries HA_RETRY.ATTEMPTS times via the injected sleep before giving up, then pauses further attempts during the cooldown window", async () => {
      mockFetchSequence([
        { status: 404, body: { message: "not found" } },
        { status: 500, body: { message: "proxy failed" } },
        { status: 200, body: [] },
        { status: 200, body: {}, arrayBuffer: Buffer.alloc(0) },
        { status: 200, body: {}, arrayBuffer: Buffer.alloc(0) },
        { status: 200, body: {}, arrayBuffer: Buffer.alloc(0) },
      ]);

      const sleep = makeSleepSpy();
      const now = makeControllableNow(1_700_000_000_000);

      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
        sleep,
        now,
      });

      await assert.rejects(() => ha.getCameraSnapshot("camera.entrada"));

      assert.strictEqual(sleep.calls.length, 3);
      assert.deepStrictEqual(sleep.calls, [1200, 1200, 1200]);
      assert.strictEqual(globalThis.fetch.mock.calls.length, 6);

      now.advance(1000);

      await assert.rejects(() => ha.getCameraSnapshot("camera.entrada"), {
        message: /Retry in \d+s/,
      });

      // The cooldown branch rejects without any new HA request.
      assert.strictEqual(globalThis.fetch.mock.calls.length, 6);
    });

    it("keeps using the proxy path after an empty snapshot, and abandons it only when every proxy candidate raises a request error", async () => {
      // Every proxy candidate answers 200 with an empty body: the endpoint is
      // reachable, so the blank frame must be treated as transient.
      mockFetchSequence([
        { status: 200, body: {}, arrayBuffer: Buffer.alloc(0) },
      ]);

      const now = makeControllableNow(1_700_000_000_000);
      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
        sleep: makeSleepSpy(),
        now,
      });

      await assert.rejects(() => ha.getCameraSnapshot("camera.entrada"));

      const firstCallCount = globalThis.fetch.mock.calls.length;
      now.advance(HA_RETRY_SNAPSHOT_COOLDOWN_MS + 1);

      await assert.rejects(() => ha.getCameraSnapshot("camera.entrada"));

      const [retriedUrl] = globalThis.fetch.mock.calls[firstCallCount].arguments;
      assert.match(retriedUrl, /\/camera_proxy\/camera\.entrada$/);
    });

    it("stops using the proxy path once every proxy candidate raises a request error", async () => {
      // Both proxy candidates fail outright, then the service fallback runs.
      mockFetchSequence([
        { status: 502, body: { message: "proxy down" } },
        { status: 502, body: { message: "proxy down" } },
        { status: 200, body: [] },
        { status: 200, body: {}, arrayBuffer: Buffer.alloc(0) },
        { status: 200, body: {}, arrayBuffer: Buffer.alloc(0) },
        { status: 200, body: {}, arrayBuffer: Buffer.alloc(0) },
      ]);

      const now = makeControllableNow(1_700_000_000_000);
      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
        sleep: makeSleepSpy(),
        now,
      });

      await assert.rejects(() => ha.getCameraSnapshot("camera.entrada"));

      const firstCallCount = globalThis.fetch.mock.calls.length;
      now.advance(HA_RETRY_SNAPSHOT_COOLDOWN_MS + 1);

      await assert.rejects(() => ha.getCameraSnapshot("camera.entrada"));

      const [retriedUrl] = globalThis.fetch.mock.calls[firstCallCount].arguments;
      assert.doesNotMatch(retriedUrl, /camera_proxy/);
    });
  });
});
