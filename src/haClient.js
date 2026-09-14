import { readFile } from "node:fs/promises";

// Single source of truth for the camera clip length, shared with
// src/telegram.js so the recorded duration and every user-facing string that
// mentions it can never drift apart.
export const CAMERA_CLIP_DURATION_SECONDS = 30;

// config.yaml maps Home Assistant's media folder here. camera.record and
// camera.snapshot write into that same folder from Home Assistant's side, so
// the add-on reads the file straight off the mount.
//
// Fetching it over HTTP does not work and never did: Home Assistant serves the
// media folder through signed media-source URLs, so a request carrying only a
// bearer token is answered 403, and every /api/media_proxy/... spelling is a
// 404. The add-on mount is the supported path.
const MEDIA_MOUNT = "/media";

const MEDIA_CONTENT_TYPES = Object.freeze({
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
});

function mediaContentType(path) {
  const dot = path.lastIndexOf(".");
  const extension = dot === -1 ? "" : path.slice(dot).toLowerCase();
  return MEDIA_CONTENT_TYPES[extension] || "application/octet-stream";
}

// Home Assistant names the same file two ways: camera.record writes to
// /media/<name>, while the media source refers to it as /media/local/<name>.
// Both resolve to one file on the mapped mount.
export function resolveMediaMountPath(mediaPath) {
  const normalized = mediaPath.startsWith("/") ? mediaPath : `/${mediaPath}`;
  const relative = normalized.replace(/^\/media\/local\//, "").replace(/^\/media\//, "");
  return `${MEDIA_MOUNT}/${relative}`;
}

function mediaUnavailable() {
  return new Error(
    "Recorded media is only reachable from inside Home Assistant. This bot is running " +
      "standalone, where the media folder is not mapped and Home Assistant refuses HTTP " +
      "access to it.",
  );
}

function mediaNotReady(message) {
  const error = new Error(message);
  // Callers poll until Home Assistant finishes writing the file. They must not
  // decide that by matching on an error message: this used to test for the
  // literal text "API error 404", which silently stopped being true the moment
  // the read moved off HTTP.
  error.mediaNotFound = true;
  return error;
}

async function defaultReadMediaFile(path) {
  return readFile(path);
}

const HA_RETRY = Object.freeze({
  ATTEMPTS: 3,
  DELAY_MS: 1200,
  SNAPSHOT_COOLDOWN_MS: 5 * 60 * 1000,
});

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createHomeAssistantClient({
  baseUrl,
  token,
  fetchImpl = fetch,
  sleep = defaultSleep,
  now = Date.now,
  logger = console,
  readMediaFile = defaultReadMediaFile,
  mediaAvailable = true,
}) {
  const rootUrl = baseUrl.replace(/\/api\/?$/, "");
  const cameraProxyUnavailable = new Set();
  const cameraSnapshotUnavailableUntil = new Map();

  function buildApiError(method, path, status, body) {
    const error = new Error(`Home Assistant API error ${status}: ${body}`);
    error.status = status;
    error.path = path;
    error.method = method;
    error.body = body;
    return error;
  }

  async function request(path, options = {}) {
    const method = options.method || "GET";
    logger.log(`[HA API] ${method} ${path}`);
    const start = now();

    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    const elapsed = now() - start;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error(`[HA API] ${method} ${path} → ${response.status} (${elapsed}ms)`);
      throw buildApiError(method, path, response.status, body);
    }

    logger.log(`[HA API] ${method} ${path} → ${response.status} (${elapsed}ms)`);
    return response.json();
  }

  async function requestBinary(path, options = {}, useApiBase = true) {
    const method = options.method || "GET";
    const url = `${useApiBase ? baseUrl : rootUrl}${path}`;
    logger.log(`[HA API] ${method} ${path}`);
    const start = now();

    const response = await fetchImpl(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });

    const elapsed = now() - start;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error(`[HA API] ${method} ${path} → ${response.status} (${elapsed}ms)`);
      throw buildApiError(method, path, response.status, body);
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "application/octet-stream";

    logger.log(`[HA API] ${method} ${path} → ${response.status} (${elapsed}ms)`);
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType,
    };
  }

  // Tries each candidate `{ path, useApiBase }` in order via requestBinary,
  // returning the first response with a non-empty buffer. Continues past
  // both an empty-but-ok response and a thrown request error, unifying the
  // camera-snapshot proxy fallback chain and the media-file candidate chain
  // that previously duplicated this loop.
  async function fetchFirstNonEmpty(candidates, label) {
    let lastError;
    let sawEmptyResponse = false;

    for (const candidate of candidates) {
      try {
        const media = await requestBinary(candidate.path, {}, candidate.useApiBase);

        if (media.buffer?.length > 0) {
          return media;
        }

        sawEmptyResponse = true;
        lastError = new Error(`Empty ${label} at ${candidate.path}`);
        logger.warn(`[HA API] Empty ${label} at ${candidate.path}, trying next candidate.`);
      } catch (error) {
        lastError = error;
        logger.warn(`[HA API] Failed to fetch ${label} at ${candidate.path}:`, error.message);
      }
    }

    const failure = lastError || new Error(`Could not fetch ${label}.`);

    // An endpoint that answered with an empty body is still reachable, so the
    // caller must not disable it permanently. Only a chain where every
    // candidate raised a request error counts as unreachable.
    failure.everyCandidateFailed = !sawEmptyResponse;
    throw failure;
  }

  // Calls `fn` up to `attempts` times, waiting `delayMs` between tries,
  // returning the first result with a non-empty buffer. Replaces the inline
  // camera-snapshot retry loop.
  async function retryForNonEmpty(fn, { attempts, delayMs }) {
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const result = await fn();

        if (result.buffer?.length > 0) {
          return result;
        }

        lastError = new Error("Empty snapshot");
      } catch (error) {
        lastError = error;
      }

      await sleep(delayMs);
    }

    throw lastError;
  }

  async function getStates() {
    return request("/states");
  }

  async function callService(domain, service, serviceData = {}) {
    logger.log(`[HA API] Calling service ${domain}.${service} → ${JSON.stringify(serviceData)}`);
    return request(`/services/${domain}/${service}`, {
      method: "POST",
      body: JSON.stringify(serviceData),
    });
  }

  async function getCameraSnapshot(entityId) {
    const unavailableUntil = cameraSnapshotUnavailableUntil.get(entityId) || 0;
    if (now() < unavailableUntil) {
      const waitSeconds = Math.ceil((unavailableUntil - now()) / 1000);
      throw new Error(`Camera is not delivering valid snapshots. Retry in ${waitSeconds}s.`);
    }

    const encodedEntityId = encodeURIComponent(entityId);
    const skipProxy = cameraProxyUnavailable.has(entityId);

    if (!skipProxy) {
      try {
        return await fetchFirstNonEmpty(
          [
            { path: `/camera_proxy/${encodedEntityId}`, useApiBase: true },
            { path: `/api/camera_proxy/${encodedEntityId}`, useApiBase: false },
          ],
          "camera snapshot",
        );
      } catch (error) {
        // Without the media mount there is nothing to fall back TO: the service
        // writes a file this process cannot reach. Surface the proxy failure
        // itself rather than a confusing second failure behind it.
        if (!mediaAvailable) {
          logger.error(`[HA API] Camera proxy failed for ${entityId}:`, error.message);
          throw error;
        }

        logger.warn(
          `[HA API] Snapshot proxy unavailable for ${entityId}, falling back to service:`,
          error.message,
        );

        // Skip the proxy on later calls only when every candidate raised a
        // request error. An empty snapshot is treated as transient, so a
        // camera that returns one blank frame keeps using the fast proxy path.
        if (error.everyCandidateFailed) {
          cameraProxyUnavailable.add(entityId);
        }
      }
    }

    const safeEntityId = entityId.replace(/[^a-zA-Z0-9_]/g, "_");
    const fileName = `ha_status_bot_snapshot_${safeEntityId}_${now()}.jpg`;
    const internalPath = `/media/${fileName}`;
    const publicPath = `/media/local/${fileName}`;

    await callService("camera", "snapshot", {
      entity_id: entityId,
      filename: internalPath,
    });

    try {
      return await retryForNonEmpty(() => getMediaFile(publicPath), {
        attempts: HA_RETRY.ATTEMPTS,
        delayMs: HA_RETRY.DELAY_MS,
      });
    } catch (error) {
      // Avoid long retry loops: if the camera keeps returning invalid bytes,
      // pause retries for a cooldown window.
      cameraSnapshotUnavailableUntil.set(entityId, now() + HA_RETRY.SNAPSHOT_COOLDOWN_MS);
      throw error || new Error("Could not get a valid image from the camera.");
    }
  }

  async function recordCameraClip(entityId, duration = CAMERA_CLIP_DURATION_SECONDS) {
    if (!mediaAvailable) {
      throw mediaUnavailable();
    }

    const safeEntityId = entityId.replace(/[^a-zA-Z0-9_]/g, "_");
    const fileName = `ha_status_bot_${safeEntityId}_${now()}.mp4`;
    const internalPath = `/media/${fileName}`;
    const publicPath = `/media/local/${fileName}`;

    await callService("camera", "record", {
      entity_id: entityId,
      duration,
      filename: internalPath,
    });

    return {
      internalPath,
      publicPath,
    };
  }

  async function getMediaFile(mediaPath) {
    if (!mediaAvailable) {
      throw mediaUnavailable();
    }

    const path = resolveMediaMountPath(mediaPath);
    let buffer;

    try {
      buffer = await readMediaFile(path);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw mediaNotReady(`Media file ${path} is not on the mount yet`);
      }

      logger.error(`[HA API] Could not read media file at ${path}:`, error.message);
      throw error;
    }

    if (!buffer?.length) {
      throw mediaNotReady(`Media file ${path} is still empty`);
    }

    logger.log(`[HA API] Read media file ${path} (${buffer.length} bytes)`);
    return { buffer, contentType: mediaContentType(path) };
  }

  return {
    getStates,
    callService,
    getCameraSnapshot,
    recordCameraClip,
    getMediaFile,
  };
}
