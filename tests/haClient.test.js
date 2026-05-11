import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import { createHomeAssistantClient } from "../src/haClient.js";

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
    }));
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
});
