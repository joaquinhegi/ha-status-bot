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

    for (const candidate of candidates) {
      try {
        const media = await requestBinary(candidate.path, {}, candidate.useApiBase);

        if (media.buffer?.length > 0) {
          return media;
        }

        lastError = new Error(`Empty ${label} at ${candidate.path}`);
        logger.warn(`[HA API] Empty ${label} at ${candidate.path}, trying next candidate.`);
      } catch (error) {
        lastError = error;
        logger.warn(`[HA API] Failed to fetch ${label} at ${candidate.path}:`, error.message);
      }
    }

    throw lastError || new Error(`Could not fetch ${label}.`);
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
          "camera snapshot"
        );
      } catch (error) {
        logger.warn(
          `[HA API] Snapshot proxy unavailable for ${entityId}, falling back to service:`,
          error.message
        );
        cameraProxyUnavailable.add(entityId);
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
      return await retryForNonEmpty(
        () => getMediaFile(publicPath, { onlyOriginalPath: true }),
        { attempts: HA_RETRY.ATTEMPTS, delayMs: HA_RETRY.DELAY_MS }
      );
    } catch (error) {
      // Avoid long retry loops: if the camera keeps returning invalid bytes,
      // pause retries for a cooldown window.
      cameraSnapshotUnavailableUntil.set(entityId, now() + HA_RETRY.SNAPSHOT_COOLDOWN_MS);
      throw error || new Error("Could not get a valid image from the camera.");
    }
  }

  async function recordCameraClip(entityId, duration = 30) {
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

  async function getMediaFile(mediaPath, options = {}) {
    const onlyOriginalPath = options.onlyOriginalPath === true;
    const normalizedPath = mediaPath.startsWith("/") ? mediaPath : `/${mediaPath}`;
    const candidatePaths = onlyOriginalPath
      ? [normalizedPath]
      : [
        normalizedPath,
        normalizedPath.startsWith("/media/local/")
          ? normalizedPath.replace("/media/local/", "/media/")
          : normalizedPath,
        normalizedPath.startsWith("/media/local/")
          ? normalizedPath.replace("/media/local/", "/api/media_proxy/media/")
          : normalizedPath,
        normalizedPath.startsWith("/media/")
          ? normalizedPath.replace("/media/", "/api/media_proxy/media/")
          : normalizedPath,
      ];

    return fetchFirstNonEmpty(
      candidatePaths.map((path) => ({ path, useApiBase: false })),
      "media file"
    );
  }

  return {
    getStates,
    callService,
    getCameraSnapshot,
    recordCameraClip,
    getMediaFile,
  };
}
