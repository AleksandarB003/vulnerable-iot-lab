const devices = new Map();

export function registerDevice(deviceId, params, publicKey) {
  devices.set(deviceId, {
    deviceId,
    params,
    publicKey,
    authenticated: false,
    lastAuthAt: null,
  });
}

export function markAuthenticated(deviceId) {
  const device = devices.get(deviceId);

  if (device) {
    device.authenticated = true;
    device.lastAuthAt = new Date().toISOString();
  }
}

export function getDevice(deviceId) {
  return devices.get(deviceId) || null;
}

export function getAllDevices() {
  return Array.from(devices.values());
}