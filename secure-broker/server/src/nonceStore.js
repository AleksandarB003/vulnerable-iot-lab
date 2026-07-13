import { randomBytes } from "crypto";

const nonces = new Map();

export function issueNonce(deviceId) {
  const nonce = randomBytes(16).toString("hex");
  nonces.set(deviceId, nonce);
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