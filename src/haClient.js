export function createHomeAssistantClient({ baseUrl, token }) {
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
      throw new Error(`Home Assistant API error ${response.status}: ${body}`);
    }

    console.log(`[HA API] ${method} ${path} → ${response.status} (${elapsed}ms)`);
    return response.json();
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

  return {
    getStates,
    callService,
  };
}