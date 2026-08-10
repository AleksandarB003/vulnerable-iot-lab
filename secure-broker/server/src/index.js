import express from "express";
import { startMqttListener } from "./mqttHandler.js";
import { getAllDevices, getDevice } from "./deviceStore.js";
import { getEventsAfter } from "./eventLog.js";

const app = express();
const PORT = 3000;
const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";

startMqttListener(brokerUrl);

app.use(express.static("public"));
app.use(express.json());

const DEVICE_SIM_CONTROL_URLS = {
  secure: "http://secure-device-sim:4000/devices",
  vulnerable: "http://vulnerable-device-sim:4000/devices",
};

app.post("/simulated-devices", async (req, res) => {
  const { deviceId, temperature, humidity, battery } = req.body || {};

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId is required" });
  }

  const results = {};

  for (const [label, url] of Object.entries(DEVICE_SIM_CONTROL_URLS)) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, temperature, humidity, battery }),
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
  return JSON.parse(JSON.stringify(device, (key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));
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