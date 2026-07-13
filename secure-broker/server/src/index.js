import express from "express";
import { startMqttListener } from "./mqttHandler.js";
import { getAllDevices, getDevice } from "./deviceStore.js";

const app = express();
const PORT = 3000;
const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";

startMqttListener(brokerUrl);

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

app.listen(PORT, () => {
  console.log(`Secure server running on port ${PORT}`);
});