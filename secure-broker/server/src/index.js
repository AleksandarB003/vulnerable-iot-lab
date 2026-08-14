import express from "express";
import { execFile } from "node:child_process";
import path from "node:path";
import { startMqttListener } from "./mqttHandler.js";
import { getAllDevices, getDevice } from "./deviceStore.js";
import { getEventsAfter } from "./eventLog.js";
import { isBlocked, getBlockedUntil } from "./anomalyGuard.js";

const app = express();
const PORT = 3000;
const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";

startMqttListener(brokerUrl);

app.use(express.static("public"));
app.use(express.json());

const rateLimitState = new Map();

function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const entry = rateLimitState.get(key) || { count: 0, windowStart: now };

    if (now - entry.windowStart > windowMs) {
      entry.count = 0;
      entry.windowStart = now;
    }

    entry.count += 1;
    rateLimitState.set(key, entry);

    if (entry.count > maxRequests) {
      return res.status(429).json({ error: "Too many requests, slow down" });
    }

    next();
  };
}

const EXPLOITS_DIR = path.join(process.cwd(), "exploits");
const EXPLOIT_TIMEOUT_MS = 22000;

const EXPLOIT_SCRIPTS = {
  forge_proof: "forge_proof.js",
  replay_attack: "replay_attack.js",
  register_hijack: "register_hijack.js",
  nonce_spam_burst: "nonce_spam_burst.js",
  mitm_sniff: "mitm_sniff.js",
};

app.post("/run-exploit", rateLimit(5, 30000), (req, res) => {
  const { exploit, deviceId } = req.body || {};
  const scriptFile = EXPLOIT_SCRIPTS[exploit];

  if (!scriptFile) {
    return res.status(400).json({ error: "Unknown exploit" });
  }

  const args = [scriptFile];
  if (deviceId) args.push(deviceId);

  execFile(
    "node",
    args,
    {
      cwd: EXPLOITS_DIR,
      timeout: EXPLOIT_TIMEOUT_MS,
      env: {
        ...process.env,
        MQTT_URL: "mqtt://secure-mosquitto:1883",
        SERVER_URL: "http://localhost:3000",
        VULNERABLE_MQTT_URL: "mqtt://vulnerable-mosquitto:1883",
        SECURE_MQTT_URL: "mqtt://secure-mosquitto:1883",
      },
    },
    (error, stdout, stderr) => {
      res.json({
        exploit,
        deviceId: deviceId || null,
        timedOut: Boolean(error && error.killed),
        output: [stdout, stderr].filter(Boolean).join("\n"),
      });
    }
  );
});

const DEVICE_SIM_CONTROL_URLS = {
  secure: "http://secure-device-sim:4000/devices",
  vulnerable: "http://vulnerable-device-sim:4000/devices",
};

app.post("/simulated-devices", rateLimit(10, 30000), async (req, res) => {
  const { deviceId, type, temperature, humidity, battery, status } = req.body || {};

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId is required" });
  }

  const results = {};

  for (const [label, url] of Object.entries(DEVICE_SIM_CONTROL_URLS)) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, type, temperature, humidity, battery, status }),
      });

      if (response.ok) {
        results[label] = "started";
      } else {
        const body = await response.json().catch(() => ({}));
        results[label] = body.error || `error (status ${response.status})`;
      }
    } catch (error) {
      results[label] = "unreachable (that side isn't running)";
    }
  }

  res.json({ deviceId, results });
});

function serializeDevice(device) {
  const plain = JSON.parse(JSON.stringify(device, (key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));

  plain.blocked = isBlocked(device.deviceId);
  plain.blockedUntil = getBlockedUntil(device.deviceId);

  return plain;
}

app.get("/devices", (req, res) => {
  res.json(getAllDevices().map(serializeDevice));
});

app.get("/devices/:id", (req, res) => {
  const device = getDevice(req.params.id);

  if (!device) {
    return res.status(404).json({ error: "Device not found" });
  }

  res.json(serializeDevice(device));
});

app.get("/events", (req, res) => {
  const afterId = parseInt(req.query.afterId, 10) || 0;
  res.json(getEventsAfter(afterId));
});

app.listen(PORT, () => {
  console.log(`Secure server running on port ${PORT}`);
});