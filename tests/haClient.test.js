import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

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

  // Stands in for the mapped /media mount. Keys are absolute container paths.
  function makeMediaMount(files = {}) {
    const reads = [];
    const readMediaFile = async (path) => {
      reads.push(path);
      const content = files[path];
      if (content === undefined) {
        const error = new Error("ENOENT");
        error.code = "ENOENT";
        throw error;
      }
      return content;
    };
    readMediaFile.reads = reads;
    return readMediaFile;
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
    it("calls GET /states with the correct headers", async () => {
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

    it("throws when the response is not ok", async () => {
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
    it("sends a POST carrying the service data", async () => {
      mockFetch(200, []);

      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
      });

      await ha.callService("light", "turn_off", {
        entity_id: "light.salon",
      });

      const [url, options] = globalThis.fetch.mock.calls[0].arguments;
      assert.strictEqual(url, "http://supervisor/core/api/services/light/turn_off");
      assert.strictEqual(options.method, "POST");
      assert.deepStrictEqual(JSON.parse(options.body), {
        entity_id: "light.salon",
      });
    });

    it("sends a POST with an empty payload by default", async () => {
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
    it("downloads a camera snapshot as binary", async () => {
      mockFetch(200, { image: true });

      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
      });

      const result = await ha.getCameraSnapshot("camera.entrada");

      const [url, options] = globalThis.fetch.mock.calls[0].arguments;
      assert.strictEqual(url, "http://supervisor/core/api/camera_proxy/camera.entrada");
      assert.ok(Buffer.isBuffer(result.buffer));
      assert.strictEqual(result.contentType, "application/json");
      assert.strictEqual(options.headers.Authorization, "Bearer test-token");
    });

    it("falls back to the snapshot service and reads the file off the media mount", async () => {
      mockFetchSequence([
        { status: 404, body: { message: "not found" } },
        { status: 500, body: { message: "proxy failed" } },
        { status: 200, body: [] },
      ]);

      // The snapshot filename carries a timestamp, so the mount answers any
      // path rather than one spelled out here.
      const reads = [];
      const readMediaFile = async (path) => {
        reads.push(path);
        return Buffer.from("snapshot-bytes");
      };

      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
        readMediaFile,
      });

      const result = await ha.getCameraSnapshot("camera.entrada");
      assert.ok(Buffer.isBuffer(result.buffer));
      assert.strictEqual(result.contentType, "image/jpeg");

      const [url1] = globalThis.fetch.mock.calls[0].arguments;
      const [url2] = globalThis.fetch.mock.calls[1].arguments;
      const [url3, options3] = globalThis.fetch.mock.calls[2].arguments;
      assert.strictEqual(url1, "http://supervisor/core/api/camera_proxy/camera.entrada");
      assert.strictEqual(url2, "http://supervisor/core/api/camera_proxy/camera.entrada");
      assert.strictEqual(url3, "http://supervisor/core/api/services/camera/snapshot");
      assert.strictEqual(options3.method, "POST");

      // Only three HTTP calls: reading the file is no longer one of them.
      assert.strictEqual(globalThis.fetch.mock.calls.length, 3);
      assert.strictEqual(reads.length, 1);
      assert.ok(reads[0].startsWith("/media/ha_status_bot_snapshot_camera_entrada_"));
      assert.ok(reads[0].endsWith(".jpg"));
    });

    it("calls camera.record with a duration and a file name", async () => {
      mockFetch(200, []);

      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
      });

      const result = await ha.recordCameraClip("camera.patio", 30);

      const [url, options] = globalThis.fetch.mock.calls[0].arguments;
      assert.strictEqual(url, "http://supervisor/core/api/services/camera/record");
      assert.strictEqual(options.method, "POST");

      const payload = JSON.parse(options.body);
      assert.strictEqual(payload.entity_id, "camera.patio");
      assert.strictEqual(payload.duration, 30);
      assert.ok(payload.filename.startsWith("/media/ha_status_bot_camera_patio_"));
      assert.ok(payload.filename.endsWith(".mp4"));

      assert.ok(result.internalPath.startsWith("/media/ha_status_bot_camera_patio_"));
      assert.ok(result.publicPath.startsWith("/media/local/ha_status_bot_camera_patio_"));
    });

    it("reads a media file off the mapped mount instead of over HTTP", async () => {
      mockFetch(200, {});
      const readMediaFile = makeMediaMount({ "/media/clip.mp4": Buffer.from("video-bytes") });

      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
        readMediaFile,
      });

      const result = await ha.getMediaFile("/media/local/clip.mp4");

      assert.deepStrictEqual(result.buffer, Buffer.from("video-bytes"));
      assert.strictEqual(result.contentType, "video/mp4");
      assert.deepStrictEqual(readMediaFile.reads, ["/media/clip.mp4"]);
      // Home Assistant answers a bearer-token request for media with 403, so a
      // media read must never reach the network.
      assert.strictEqual(globalThis.fetch.mock.calls.length, 0);
    });

    it("marks a missing media file as not-ready so callers keep polling", async () => {
      const readMediaFile = makeMediaMount({});

      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
        readMediaFile,
      });

      await assert.rejects(
        () => ha.getMediaFile("/media/local/missing.mp4"),
        (error) => error.mediaNotFound === true,
      );
    });

    it("marks an empty media file as not-ready rather than returning it", async () => {
      const readMediaFile = makeMediaMount({ "/media/clip.mp4": Buffer.alloc(0) });

      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
        readMediaFile,
      });

      await assert.rejects(
        () => ha.getMediaFile("/media/clip.mp4"),
        (error) => error.mediaNotFound === true,
      );
    });
  });

  describe("camera snapshot retry and cooldown", () => {
    it("retries HA_RETRY.ATTEMPTS times via the injected sleep before giving up, then pauses further attempts during the cooldown window", async () => {
      mockFetchSequence([
        { status: 404, body: { message: "not found" } },
        { status: 500, body: { message: "proxy failed" } },
        { status: 200, body: [] },
      ]);

      const sleep = makeSleepSpy();
      const now = makeControllableNow(1_700_000_000_000);
      // The snapshot never lands on the mount, so every retry finds nothing.
      const readMediaFile = makeMediaMount({});

      const ha = createHomeAssistantClient({
        baseUrl: "http://supervisor/core/api",
        token: "test-token",
        sleep,
        now,
        readMediaFile,
      });

      await assert.rejects(() => ha.getCameraSnapshot("camera.entrada"));

      assert.strictEqual(sleep.calls.length, 3);
      assert.deepStrictEqual(sleep.calls, [1200, 1200, 1200]);

      // Two proxy candidates plus the snapshot service. The three retries read
      // the mount instead of the network, which is the whole point of the fix.
      assert.strictEqual(globalThis.fetch.mock.calls.length, 3);
      assert.strictEqual(readMediaFile.reads.length, 3);

      now.advance(1000);

      await assert.rejects(() => ha.getCameraSnapshot("camera.entrada"), {
        message: /Retry in \d+s/,
      });

      // The cooldown branch rejects without any new HA request or mount read.
      assert.strictEqual(globalThis.fetch.mock.calls.length, 3);
      assert.strictEqual(readMediaFile.reads.length, 3);
    });

    it("keeps using the proxy path after an empty snapshot, and abandons it only when every proxy candidate raises a request error", async () => {
      // Every proxy candidate answers 200 with an empty body: the endpoint is
      // reachable, so the blank frame must be treated as transient.
      mockFetchSequence([{ status: 200, body: {}, arrayBuffer: Buffer.alloc(0) }]);

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
