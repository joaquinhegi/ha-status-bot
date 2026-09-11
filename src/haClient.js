export function createHomeAssistantClient({ baseUrl, token }) {
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
    console.log(`[HA API] ${method} ${path}`);
    const start = Date.now();

    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    const elapsed = Date.now() - start;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[HA API] ${method} ${path} → ${response.status} (${elapsed}ms)`);
      throw buildApiError(method, path, response.status, body);
    }

    console.log(`[HA API] ${method} ${path} → ${response.status} (${elapsed}ms)`);
    return response.json();
  }

  async function requestBinary(path, options = {}, useApiBase = true) {
    const method = options.method || "GET";
    const url = `${useApiBase ? baseUrl : rootUrl}${path}`;
    console.log(`[HA API] ${method} ${path}`);
    const start = Date.now();

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });

    const elapsed = Date.now() - start;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[HA API] ${method} ${path} → ${response.status} (${elapsed}ms)`);
      throw buildApiError(method, path, response.status, body);
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "application/octet-stream";

    console.log(`[HA API] ${method} ${path} → ${response.status} (${elapsed}ms)`);
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType,
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function getStates() {
    return request("/states");
  }

  async function callService(domain, service, serviceData = {}) {
    console.log(`[HA API] Llamando servicio ${domain}.${service} → ${JSON.stringify(serviceData)}`);
    return request(`/services/${domain}/${service}`, {
      method: "POST",
      body: JSON.stringify(serviceData),
    });
  }

  async function getCameraSnapshot(entityId) {
    const unavailableUntil = cameraSnapshotUnavailableUntil.get(entityId) || 0;
    if (Date.now() < unavailableUntil) {
      const waitSeconds = Math.ceil((unavailableUntil - Date.now()) / 1000);
      throw new Error(`La cámara no está entregando snapshots válidos. Reintentá en ${waitSeconds}s.`);
    }

    const encodedEntityId = encodeURIComponent(entityId);
    const skipProxy = cameraProxyUnavailable.has(entityId);

    if (!skipProxy) {
      try {
        const proxyMedia = await requestBinary(`/camera_proxy/${encodedEntityId}`);

        if (proxyMedia.buffer?.length > 0) {
          return proxyMedia;
        }

        console.warn(`[HA API] Snapshot vacío por proxy para ${entityId}, uso fallback por servicio.`);
      } catch (error) {
        console.warn(`[HA API] Fallback snapshot para ${entityId}:`, error.message);
        try {
          const proxyMedia = await requestBinary(`/api/camera_proxy/${encodedEntityId}`, {}, false);

          if (proxyMedia.buffer?.length > 0) {
            return proxyMedia;
          }

          console.warn(`[HA API] Snapshot vacío por proxy alternativo para ${entityId}, uso fallback por servicio.`);
        } catch (secondError) {
          console.warn(`[HA API] Fallback snapshot service para ${entityId}:`, secondError.message);
          cameraProxyUnavailable.add(entityId);
        }
      }
    }

    const safeEntityId = entityId.replace(/[^a-zA-Z0-9_]/g, "_");
    const fileName = `ha_status_bot_snapshot_${safeEntityId}_${Date.now()}.jpg`;
    const internalPath = `/media/${fileName}`;
    const publicPath = `/media/local/${fileName}`;

    await callService("camera", "snapshot", {
      entity_id: entityId,
      filename: internalPath,
    });

    let lastError;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const media = await getMediaFile(publicPath, { onlyOriginalPath: true });

        if (media.buffer?.length > 0) {
          return media;
        }

        lastError = new Error("Snapshot vacío");
      } catch (error) {
        lastError = error;
      }

      await sleep(1200);
    }

    // Evita loops largos: si la cámara no da bytes válidos, pausamos reintentos por 5 min.
    cameraSnapshotUnavailableUntil.set(entityId, Date.now() + 5 * 60 * 1000);
    throw lastError || new Error("No se pudo obtener una imagen válida de la cámara.");
  }

  async function recordCameraClip(entityId, duration = 30) {
    const safeEntityId = entityId.replace(/[^a-zA-Z0-9_]/g, "_");
    const fileName = `ha_status_bot_${safeEntityId}_${Date.now()}.mp4`;
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
    const candidates = onlyOriginalPath
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

    let lastError;

    for (const candidate of candidates) {
      try {
        const media = await requestBinary(candidate, {}, false);

        if (media.buffer?.length > 0) {
          return media;
        }

        lastError = new Error(`Archivo multimedia vacío en ${candidate}`);
        console.warn(`[HA API] Archivo multimedia vacío en ${candidate}`);
      } catch (error) {
        lastError = error;
        console.warn(`[HA API] Falló descarga de media en ${candidate}:`, error.message);
      }
    }

    throw lastError || new Error("No se pudo descargar el archivo multimedia.");
  }

  return {
    getStates,
    callService,
    getCameraSnapshot,
    recordCameraClip,
    getMediaFile,
  };
}