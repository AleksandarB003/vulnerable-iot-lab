import { randomBytes } from "crypto";

const nonces = new Map();
const lastIssuedAt = new Map();

const MIN_ISSUE_INTERVAL_MS = 2000;

export function issueNonce(deviceId) {
  const now = Date.now();
  const last = lastIssuedAt.get(deviceId);

  if (last !== undefined && now - last < MIN_ISSUE_INTERVAL_MS) {
    return null;
  }

  const nonce = randomBytes(16).toString("hex");
  nonces.set(deviceId, nonce);
  lastIssuedAt.set(deviceId, now);
  return nonce;
}

export function consumeNonce(deviceId, providedNonce) {
  const expected = nonces.get(deviceId);

  if (!expected || expected !== providedNonce) {
    return false;
  }

  nonces.delete(deviceId);
  return true;
}