# DoS via malformed MQTT message

## What happened

While testing the vulnerable broker with a bad payload (just to see what happens), the server crashed completely. Sent one malformed MQTT message on the auth topic and the whole `vulnerable-server` container exited.

## How to reproduce

With the vulnerable broker running:
docker exec -it vulnerable-mosquitto mosquitto_pub -t "devices/device-1/auth" -m '{"secret":'

Check the server logs, you'll see it crash with an unhandled `SyntaxError` and exit.

## Why it happens

The MQTT message handler did this:

```javascript
const message = JSON.parse(payload.toString());
```

No try/catch around it. Anyone who can publish to the broker (which, since `allow_anonymous true` is set, is literally anyone) can send garbage instead of JSON and take the whole server down. No credentials needed, no knowledge of the secret needed, just send bad data and the process dies.

This is worth calling out separately from the "no auth" problem, because it doesn't even require knowing anything about the protocol. It's a pure availability attack.

## Fix

Wrapped the JSON parsing in a try/catch, and just ignore the message (with a log line) if it fails to parse:

```javascript
let message;

try {
  message = JSON.parse(payload.toString());
} catch (error) {
  console.log(`Received malformed message on topic ${topic}, ignoring`);
  return;
}
```

Applied the same fix on the secure broker's handler, even though it wasn't tested there specifically, no reason to leave the same bug in both places.