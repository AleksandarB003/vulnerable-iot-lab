# Replay attack on a valid proof

## What happened

After fixing the public key mismatch bug, tested whether a real, valid proof could just be captured and resent later. It could. Stopped the device simulator, took the last proof it had sent, and replayed it manually through `mosquitto_pub`. The server accepted it as a fresh authentication, updated the device's `lastAuthAt` timestamp, even though the device itself was offline and never sent anything.

## How to reproduce (before the fix)

Capture any valid auth message from the topic `devices/device-1/auth` (the toolkit's proof format doesn't include anything that changes between publishes besides the timestamp and sensor reading, which aren't checked). Resend the exact same message. Server accepts it again.

Confirmed this with the `replay_attack.js` script later on, it listens for one real proof and immediately republishes it.

## Why it happens

The Schnorr protocol itself, as implemented in the toolkit, proves knowledge of a private key at the moment the proof was generated. It says nothing about freshness. A proof that was valid five minutes ago is still mathematically valid now, nothing about the math itself expires. Without some separate mechanism to track which proofs have already been used, the same message can be replayed indefinitely.

This matters a lot for something like device authentication over MQTT, where messages are just sitting on the wire (especially since TLS isn't set up here either, see the mitm sniffing writeup).

## Fix

Added a nonce request and consume flow on top of the ZKP protocol:

1. Device requests a nonce from the server before authenticating (`devices/device-1/nonce-request`)
2. Server generates a random nonce, stores it for that device, sends it back
3. Device includes that nonce alongside its proof when it publishes to the auth topic
4. Server checks the nonce matches what it issued, and deletes it immediately after checking, so the same nonce (and therefore the same message) can't be used twice

```javascript
if (!providedNonce || !consumeNonce(deviceId, providedNonce)) {
  console.log(`Device ${deviceId} sent an invalid or reused nonce, rejecting`);
  return;
}
```

Worth noting, this nonce isn't cryptographically bound into the proof itself (it's not part of the Fiat-Shamir hash calculation inside the toolkit), it's just checked alongside it at the application level. A stronger version of this would fold the nonce into the challenge computation directly, so the proof itself becomes invalid if the nonce is stripped out or swapped, rather than relying on a separate check next to it. Left as a possible improvement for a future version of the toolkit.