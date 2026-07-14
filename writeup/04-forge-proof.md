# Forge proof without the private key

## What this tests

After fixing the previous two bugs, wanted to confirm the actual core promise of the whole system, can someone authenticate as a device without ever knowing its private key, even if they have access to everything else that's public (the group parameters, the public key, and even the ability to request a nonce like a real device would)?

This is really the whole point of using zero knowledge proofs in the first place, so this test mattered more than the others.

## How it's tested

The `forge_proof.js` script does the following:

1. Pulls the real `params` and `publicKey` for a device from the REST API, exactly what any attacker could see just by looking at the server
2. Requests a nonce the same way a real device would
3. Builds a proof using made up values for `commitment`, `challenge`, and `response`, since without the private key there's no way to compute values that would actually satisfy the verification equation
4. Sends it to the auth topic

## Result

Server logs: `Device device-1 sent an invalid proof`

The nonce check passes (it was requested properly), the public key check passes (it's the real one), but `verify()` fails, because the numbers don't actually satisfy `g^s mod p == (t * y^c) mod p`. There's no way to fake the response value in a proof without solving the discrete logarithm problem first, which is exactly the hard problem the whole protocol is built on.

## Why this is the interesting one

The DoS, impersonation, and replay bugs were all implementation mistakes, things that could be fixed with better code around the protocol. This test is different, it's not testing a bug, it's testing whether the core cryptographic guarantee actually holds. And it does. Even with full knowledge of everything public about the device, forging a valid response without the private key just isn't possible with the parameters used here.