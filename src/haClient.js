export function createHomeAssistantClient({ baseUrl, token }) {
  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Home Assistant API error ${response.status}: ${body}`);
    }

    return response.json();
  }

  async function getStates() {
    return request("/states");
  }

  async function callService(domain, service, serviceData = {}) {
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