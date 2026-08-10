const devices = new Map();

export function markAuthenticated(deviceId, telemetry = {}) {
  const existing = devices.get(deviceId) || {};

  devices.set(deviceId, {
    deviceId,
    authenticated: true,
    lastAuthAt: new Date().toISOString(),
    temperature: typeof telemetry.temperature === "number" ? telemetry.temperature : existing.temperature ?? null,
    humidity: typeof telemetry.humidity === "number" ? telemetry.humidity : existing.humidity ?? null,
    battery: typeof telemetry.battery === "number" ? telemetry.battery : existing.battery ?? null,
    status: typeof telemetry.status === "string" ? telemetry.status : existing.status ?? null,
  });
}

export function getDevice(deviceId) {
  return devices.get(deviceId) || null;
}

export function getAllDevices() {
  return Array.from(devices.values());
}