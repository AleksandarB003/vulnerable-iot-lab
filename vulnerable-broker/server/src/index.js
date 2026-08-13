import express from "express";
import { startMqttListener, SHARED_SECRET } from "./mqttHandler.js";
import { getAllDevices, getDevice, getRawMessage } from "./deviceStore.js";
import { getEventsAfter, logEvent } from "./eventLog.js";

const app = express();
const PORT = 3000;
const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";

const mqttClient = startMqttListener(brokerUrl);

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

app.get("/devices", (req, res) => {
  res.json(getAllDevices());
});

app.get("/devices/:id", (req, res) => {
  const device = getDevice(req.params.id);

  if (!device) {
    return res.status(404).json({ error: "Device not found" });
  }

  res.json(device);
});

app.get("/events", (req, res) => {
  const afterId = parseInt(req.query.afterId, 10) || 0;
  res.json(getEventsAfter(afterId));
});

function clamp(value, min, max) {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

app.post("/impersonate", rateLimit(10, 30000), (req, res) => {
  const { deviceId, temperature, humidity, battery, status } = req.body || {};

  if (!deviceId || typeof deviceId !== "string") {
    return res.status(400).json({ error: "deviceId is required" });
  }

  const message = { secret: SHARED_SECRET, timestamp: new Date().toISOString() };

  const clampedTemperature = clamp(temperature, -40, 85);
  const clampedHumidity = clamp(humidity, 0, 100);
  const clampedBattery = clamp(battery, 0, 100);

  if (clampedTemperature !== undefined) message.temperature = clampedTemperature;
  if (clampedHumidity !== undefined) message.humidity = clampedHumidity;
  if (clampedBattery !== undefined) message.battery = clampedBattery;
  if (typeof status === "string") message.status = status;

  mqttClient.publish(`devices/${deviceId}/auth`, JSON.stringify(message));

  res.json({ deviceId, published: true });
});

app.post("/replay", rateLimit(10, 30000), (req, res) => {
  const { deviceId } = req.body || {};

  if (!deviceId || typeof deviceId !== "string") {
    return res.status(400).json({ error: "deviceId is required" });
  }

  const raw = getRawMessage(deviceId);

  if (!raw) {
    return res.status(404).json({ error: `No captured message for ${deviceId} yet` });
  }

  mqttClient.publish(`devices/${deviceId}/auth`, raw);

  res.json({ deviceId, replayed: true });
});

app.post("/flood", rateLimit(5, 30000), (req, res) => {
  const { deviceId, count } = req.body || {};

  if (!deviceId || typeof deviceId !== "string") {
    return res.status(400).json({ error: "deviceId is required" });
  }

  const total = Math.min(Math.max(parseInt(count, 10) || 50, 1), 200);

  logEvent("flood", deviceId, `Sending ${total} auth messages back to back — no rate limiting to stop this`);

  for (let i = 0; i < total; i++) {
    const message = {
      secret: SHARED_SECRET,
      battery: 100,
      timestamp: new Date().toISOString(),
    };

    mqttClient.publish(`devices/${deviceId}/auth`, JSON.stringify(message));
  }

  res.json({ deviceId, sent: total });
});

app.listen(PORT, () => {
  console.log(`Vulnerable server running on port ${PORT}`);
});