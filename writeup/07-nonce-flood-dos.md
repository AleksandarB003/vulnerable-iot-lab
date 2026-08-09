# Denial of service via unauthenticated nonce flooding

## What happened

Found this right next to the registration hijack (writeup 06), by asking the same question about the other topic the server listens on: `devices/<id>/nonce-request`. Just like `register`, this topic has no check for who's allowed to call it. Anyone can request a fresh nonce for any device ID, as often as they want.

The nonce store only holds one nonce per device at a time (`nonces.set(deviceId, nonce)` overwrites). So if an attacker requests nonces faster than the real device can respond, the real device's in-flight proof keeps getting invalidated before it arrives, since the nonce it was built against no longer matches what the server has on file.

## How to reproduce (before the fix)

With `device-1` already registered and authenticating normally on its usual 8 second cycle:

1. Connect to the broker as an anonymous attacker (trivial, `allow_anonymous true`)
2. Publish to `devices/device-1/nonce-request` in a tight loop, as fast as the event loop allows, no auth, no rate limit
3. Watch the real device try to keep up

Confirmed with `exploits/nonce_spam_burst.js` (2000 requests, no delay):

Issued nonce to device device-1 x2000
Device device-1 authenticated with a valid proof x2
Device device-1 sent an invalid or reused nonce, rejecting x1998


99% of the real device's authentication attempts failed during the flood, not because its key or proof was wrong, but because the nonce it was responding to had already been replaced by the time its message reached the server. The device also burned CPU computing 2000 Schnorr proofs for nothing.

Worth noting: this isn't an impersonation bug like writeup 06, the attacker never gets authenticated as the device. It's pure availability damage, the device is functionally locked out of ever completing a fresh auth cycle for as long as the flood continues, and it's doing real cryptographic work the whole time for no reason.

## Why it happens

Same root cause as the registration hijack: an MQTT topic that changes server state (`nonces` map) with zero access control, on a broker that allows anonymous connections. The nonce mechanism itself is fine, it does what nonces are supposed to do (prevent replay). The gap is that *requesting* one isn't gated at all, so it doubles as a free way to repeatedly invalidate whatever nonce is currently outstanding for a device.

## Fix

Rate-limit nonce issuance per device ID. A device only legitimately needs a new nonce right before it authenticates, on this lab's 8 second cycle that's nowhere near a 2 second minimum interval, so real usage is unaffected. A flood gets silently ignored instead of triggering a fresh nonce (and therefore a fresh, wasted proof computation) on every single request.

```javascript
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
```

`mqttHandler.js` skips publishing (and skips logging a fresh "issued" line) whenever `issueNonce` returns `null`.

Re-ran `nonce_spam_burst.js` (2000 requests, no delay) after the fix:

0 nonces issued during the burst
0 successful auths during the burst
0 rejected proofs during the burst
2000 requests silently rate-limited


Confirmed the real device resumed its normal cycle immediately once the flood stopped, and kept authenticating successfully every 8 seconds as before.

## Limitation this doesn't solve

This is throttling, not authentication. It stops a single attacker from *flooding*, but a low-and-slow attacker sending one nonce-request every 2 seconds, indefinitely, forever wins the race against the real device's own 8 second cycle and keeps it locked out just as effectively, just slower and quieter. A real fix would require actually authenticating who's allowed to request a nonce for a given device ID, which is the same open problem noted as unresolved in writeup 06 (registration itself has no strong identity binding at first-use time). Rate limiting narrows the attack window, it doesn't close it.