# Registration lost to a startup race condition

## What happened

This one isn't a security vulnerability, it's a reliability bug, but it's worth documenting because it was found the same way as everything else: by not trusting that the happy path always works.

`secure-device-sim` sends its registration exactly once, in its MQTT `connect` handler, with no retry and no acknowledgement from the server. `secure-server` subscribes to `devices/+/register` in its own `connect` handler. Both are separate processes connecting to the same broker independently, there's no guarantee about which one finishes its post-connect setup first.

If the device's registration message reaches the broker before the server has subscribed, the message is just gone. MQTT (at QoS 0, no retain) doesn't queue messages for subscribers who show up later, it only delivers to whoever is already listening at the moment of publish. The device never finds out its registration was lost, since there's no ack, and it never resends it. Every later auth attempt from that device fails forever with "not registered", even though the device is doing everything right.

## How to reproduce (before the fix)

1. Start the broker alone
2. Start `device-sim` and let it send its (one-shot) registration
3. Wait several seconds, then start the server

Reproduced this directly (not through Docker's usual near-simultaneous startup, which only *sometimes* hits the race, but by forcing a 5 second gap to make it deterministic):

Device device-1 sent registration
... (5 second gap, server not running yet) ...
Secure server running on port 3000
Connected to MQTT broker
Issued nonce to device device-1
Device device-1 tried to authenticate but is not registered
Issued nonce to device device-1
Device device-1 tried to authenticate but is not registered


Stuck there permanently. In a normal `docker compose up --build`, the server and device-sim containers start close enough together that this usually doesn't happen, but "usually" isn't a guarantee, and it also shows up any time the server container alone gets restarted or rebuilt (e.g. after a code change) without touching the broker or device-sim, since the server's in-memory device list is wiped by the restart but the device-sim, still connected from before, has no reason to send its registration again.

## Why it happens

Classic MQTT pub/sub gotcha: a plain publish only reaches subscribers who are already subscribed at that exact moment. There's no persistence for a message once it's been delivered (or failed to be delivered) to the currently-subscribed set, unless something explicitly asks for that.

## Fix

Publish the registration message with the `retain` flag set. A retained message is kept by the broker per-topic, and gets delivered immediately to any client that subscribes to that topic afterward, even if that's long after the original publish.

```javascript
client.publish(
  `devices/${deviceId}/register`,
  JSON.stringify(registrationMessage, bigIntReplacer),
  { retain: true }
);
```

Reproduced the exact same 5 second gap after the fix:

Device device-1 sent registration
... (5 second gap, server not running yet) ...
Secure server running on port 3000
Connected to MQTT broker
Device device-1 registered with public key
Issued nonce to device device-1
Device device-1 authenticated with a valid proof


Registered instantly on subscribe, authenticated on the very next cycle. Same fix also covers the server-restart-alone case, since the server re-subscribing after any restart replays the retained message without device-sim having to do anything.

## Note on the vulnerable broker

`vulnerable-broker` doesn't have this problem, it has no separate registration step at all. Every auth message carries the shared secret and is checked independently, so there's nothing that can be "missed" at startup, the very next auth message (at most 8 seconds later) works regardless of exact startup order. This race is specific to the secure broker's two-phase register-then-authenticate protocol.