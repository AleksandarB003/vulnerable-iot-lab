# Device identity takeover via unauthenticated re-registration

## What happened

All four previous tests on the secure broker (impersonation, replay, forge, sniffing) assume a device is already registered and just attack the *authentication* step. Went one step earlier and looked at *registration* itself: `devices/<id>/register` just takes whatever `params` and `publicKey` are in the message and stores them, no check for who is allowed to register, and no check for whether that device ID is already taken.

That means a device ID isn't actually bound to a key pair at all, it's bound to whoever registers it *last*. Since the broker has `allow_anonymous true` and there's no TLS, anyone who can reach the broker can publish to that topic.

## How to reproduce (before the fix)

With `device-1` already registered and authenticating normally:

1. Generate a brand new key pair, unrelated to the real device, using the same toolkit any legitimate device would use
2. Publish it to `devices/device-1/register`, same topic the real device used, just with our own `params`/`publicKey`
3. Request a nonce for `device-1`
4. Build a real, valid proof using our own private key (`prove(ourKeyPair)`)
5. Publish it to `devices/device-1/auth`

Confirmed this with `exploits/register_hijack.js`. Result:

Device device-1 public key on server: <attacker's key>
Matches OUR key we generated: true
authenticated: true


The server now believes the attacker's key pair *is* `device-1`. The real device's next auth attempt gets rejected too (`sent a proof with a mismatched public key, rejecting`), since the server is now checking its proof against the attacker's stored key. So it's identity theft and a DoS against the real device at the same time.

## Why it happens

The public-key-mismatch fix (writeup 02) made sure the key inside a *proof* matches the key on file for that device. But it never questioned how the key got on file in the first place. The ZKP math is solid, knowing the private key for the registered public key is a real, unforgeable guarantee, but that guarantee is worthless if the "registered public key" itself can be silently swapped out by anyone at any time. The identity binding (which key belongs to `device-1`) has zero access control, even though everything built on top of it assumes that binding is trustworthy.

## Fix

Simplest fix that matches how this lab already provisions devices (each device registers once, on startup): treat registration as trust-on-first-use. Once a device ID has a key on file, ignore further registration messages for that ID instead of overwriting.

```javascript
if (action === "register") {
  const existing = getDevice(deviceId);

  if (existing) {
    console.log(`Device ${deviceId} attempted to re-register, ignoring (already registered)`);
    return;
  }

  const params = parsePublicParams(message.params);
  const publicKey = BigInt(message.publicKey);

  registerDevice(deviceId, params, publicKey);
  console.log(`Device ${deviceId} registered with public key`);
  return;
}
```

Re-ran `register_hijack.js` after the fix:

Device device-1 attempted to re-register, ignoring (already registered)
...
Device device-1 public key on server: <real device's original key>
Matches OUR key we generated: false


## Limitation this doesn't solve

TOFU only protects a device ID *after* it's first claimed. It does nothing for the very first registration, whoever's message the broker sees first for a given ID wins, so there's still a race at initial provisioning time (e.g., if an attacker registers `device-42` before the real `device-42` ever boots for the first time). A real deployment would need registration to be authenticated some other way, for example a provisioning secret or signature issued out of band when the device is manufactured or enrolled, not something the MQTT layer can guarantee on its own. Left as a known gap rather than solved here, same spirit as the nonce-binding limitation noted in the replay writeup.