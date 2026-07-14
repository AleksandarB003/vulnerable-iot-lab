# Impersonation via public key mismatch

## What happened

While testing the secure broker (the one using the ZKP toolkit), captured an old proof from a previous run of the device (it had a different key pair from a restart) and sent it to the server. Expected it to get rejected since the key pair had changed. It got accepted instead.

Turns out the bug wasn't really about the old proof being replayed, it was something more fundamental, the server never checked whether the public key inside the submitted proof actually matched the public key that was registered for that device.

## How to reproduce (before the fix)

Register a device, note its public key. Then construct a valid proof using a completely different key pair (any key pair, doesn't even need to belong to the real device), keeping the same `deviceId` in the topic. Send it to `devices/device-1/auth`.

The server would call `verify(proof)`, and since `verify()` only checks that the proof is internally consistent (that the math checks out for the public key included in the proof itself), it returned `true`. The server had no separate check tying that public key back to the specific device it claimed to be.

## Why it happens

This is a good example of a gap between "the cryptography is correct" and "the system that uses it is secure". The `verify()` function from the toolkit does exactly what it's supposed to do, confirm that someone knows the private key matching the public key included in the proof. But it has no idea, and no way to know, whether that public key is the one that was actually assigned to `device-1` during registration. That check has to happen at the application level.

Basically, anyone could generate their own key pair, prove they know their own private key (trivially true, they made it up themselves), and just claim to be any device ID they want.

## Fix

Added an explicit check comparing the public key inside the incoming proof against the one stored for that device at registration time, before even calling `verify()`:

```javascript
if (proof.publicKey !== device.publicKey) {
  console.log(`Device ${deviceId} sent a proof with a mismatched public key, rejecting`);
  return;
}
```

This is the kind of bug that's easy to miss because the ZKP math itself is working exactly as designed, the vulnerability is entirely in how the verification result gets used.