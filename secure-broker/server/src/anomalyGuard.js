const FAILURE_THRESHOLD = 5;
const BLOCK_DURATION_MS = 30000;

const failureCounts = new Map();
const blockedUntil = new Map();

export function isBlocked(deviceId) {
  const until = blockedUntil.get(deviceId);

  if (!until) return false;

  if (Date.now() >= until) {
    blockedUntil.delete(deviceId);
    return false;
  }

  return true;
}

export function getBlockedUntil(deviceId) {
  return blockedUntil.get(deviceId) || null;
}

export function recordFailure(deviceId) {
  const count = (failureCounts.get(deviceId) || 0) + 1;
  failureCounts.set(deviceId, count);

  if (count >= FAILURE_THRESHOLD) {
    blockedUntil.set(deviceId, Date.now() + BLOCK_DURATION_MS);
    failureCounts.set(deviceId, 0);
    return true;
  }

  return false;
}

export function recordSuccess(deviceId) {
  failureCounts.set(deviceId, 0);
}