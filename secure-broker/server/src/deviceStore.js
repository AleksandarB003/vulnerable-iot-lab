const devices = new Map();

export function registerDevice(deviceId, params, publicKey) {
  devices.set(deviceId, {
    deviceId,
    params,
    publicKey,
    authenticated: false,
    lastAuthAt: null,
    temperature: null,
    humidity: null,
    battery: null,
    status: null,
  });
}

export function markAuthenticated(deviceId, telemetry = {}) {
  const device = devices.get(deviceId);

  if (device) {
    device.authenticated = true;
    device.lastAuthAt = new Date().toISOString();

    if (typeof telemetry.temperature === "number") device.temperature = telemetry.temperature;
    if (typeof telemetry.humidity === "number") device.humidity = telemetry.humidity;
    if (typeof telemetry.battery === "number") device.battery = telemetry.battery;
    if (typeof telemetry.status === "string") device.status = telemetry.status;
  }
}

export function getDevice(deviceId) {
  return devices.get(deviceId) || null;
}

export function getAllDevices() {
  return Array.from(devices.values());
} 