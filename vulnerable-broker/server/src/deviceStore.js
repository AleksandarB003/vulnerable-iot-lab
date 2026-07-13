const devices = new Map();

export function markAuthenticated(deviceId) {
  devices.set(deviceId, {
    deviceId,
    authenticated: true,
    lastAuthAt: new Date().toISOString(),
  });
}

export function getDevice(deviceId) {
  return devices.get(deviceId) || null;
}

export function getAllDevices() {
  return Array.from(devices.values());
}