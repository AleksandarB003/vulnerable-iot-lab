# Passive sniffing comparison

## What this tests

Neither broker uses TLS in this project (noted as a known limitation, see the README), so all MQTT traffic is plaintext either way. This test looks at what a passive attacker, someone just listening on the wire without doing anything active, actually gets to see on each broker.

## How it's tested

The `mitm_sniff.js` script connects to both brokers at once, subscribes to every topic (`#` wildcard), and logs everything it sees for 20 seconds.

## Result

On the vulnerable broker, every message looks like this:

```json
{"secret":"iot-secret-123","temperature":22.6,"timestamp":"2026-07-14T10:52:06.842Z"}
```

The secret is sitting right there in plaintext. Anyone sniffing this even once has everything they need to authenticate as the device themselves, no further work required.

On the secure broker, the messages look like this:

```json
{"params":{"p":"...","q":"...","g":"..."},"publicKey":"...","commitment":"...","challenge":"...","response":"...","nonce":"...","temperature":22.5,"timestamp":"..."}
```

More data gets exposed per message here, but none of it is useful the way the plaintext secret is. The attacker sees a valid proof, but as shown in the forge proof test, being able to see a proof doesn't mean you can generate a new one, and as shown in the replay test, even resending the exact same proof gets rejected because of the nonce check.

## Why this matters

This is really a side by side illustration of what "zero knowledge" actually buys you here. Even in a system with no transport encryption at all, the proof itself reveals nothing that helps an attacker beyond that single, already-consumed authentication attempt. That's a meaningfully different security property than the vulnerable broker, where a single captured message is a permanent, reusable credential.

Worth being clear about the limitation though, TLS would still be a good idea in a real deployment, since metadata like device IDs, sensor readings, and timing patterns are still visible either way, and there's nothing here that specifically prevents traffic analysis attacks based on message frequency or size.