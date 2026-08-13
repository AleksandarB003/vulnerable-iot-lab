import mqtt from "mqtt";
import express from "express";

const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const SHARED_SECRET = "iot-secret-123";
const CONTROL_PORT = 4000;

const initialDeviceIds = (process.env.DEVICE_IDS || process.env.DEVICE_ID || "device-1")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const runningDevices = new Set();

const STATUS_OPTIONS = {
  camera: ["idle", "recording"],
  door: ["closed", "open"],
};

const VALID_TYPES = ["sensor", "thermostat", "camera", "door"];

function clamp(value, min, max, fallback) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function buildTelemetry(type, readers) {
  const telemetry = { battery: readers.readBattery() };

  if (type === "sensor" || type === "thermostat") {
    telemetry.temperature = readers.readTemperature();
  }

  if (type === "sensor") {
    telemetry.humidity = readers.readHumidity();
  }

  if (type === "camera" || type === "door") {
    telemetry.status = readers.readStatus();
  }

  return telemetry;
}

function startDevice(deviceId, options = {}) {
  const type = VALID_TYPES.includes(options.type) ? options.type : "sensor";

  const tempBase = clamp(options.temperature, -40, 85, 22);
  const humidityBase = clamp(options.humidity, 0, 100, 45);
  let batteryLevel = clamp(options.battery, 0, 100, 100);

  const statusOptions = STATUS_OPTIONS[type];
  let currentStatus = statusOptions
    ? (statusOptions.includes(options.status) ? options.status : statusOptions[0])
    : null;

  function readTemperature() {
    const variation = (Math.random() * 4 - 2).toFixed(1);
    return clamp(parseFloat((tempBase + parseFloat(variation)).toFixed(1)), -40, 85, tempBase);
  }

  function readHumidity() {
    const variation = (Math.random() * 10 - 5).toFixed(1);
    return clamp(parseFloat((humidityBase + parseFloat(variation)).toFixed(1)), 0, 100, humidityBase);
  }

  function readBattery() {
    const drainMultiplier = type === "camera" && currentStatus === "recording" ? 3 : 1;
    batteryLevel = Math.min(100, Math.max(0, batteryLevel - Math.random() * 0.3 * drainMultiplier));
    return parseFloat(batteryLevel.toFixed(1));
  }

  function readStatus() {
    if (statusOptions && Math.random() < 0.15) {
      currentStatus = currentStatus === statusOptions[0] ? statusOptions[1] : statusOptions[0];
    }
    return currentStatus;
  }

  const client = mqtt.connect(brokerUrl);

  client.on("connect", () => {
    console.log(`Device ${deviceId} (${type}) connected to broker`);

    function scheduleAuth() {
      const goingOffline = Math.random() < 0.08;
      const nextDelay = goingOffline
        ? 15000 + Math.random() * 30000
        : 7000 + Math.random() * 2000;

      if (goingOffline) {
        console.log(`Device ${deviceId} going quiet for a bit (simulated offline)`);
      }

      setTimeout(() => {
        const message = {
          secret: SHARED_SECRET,
          type,
          ...buildTelemetry(type, { readTemperature, readHumidity, readBattery, readStatus }),
          timestamp: new Date().toISOString(),
        };

        const topic = `devices/${deviceId}/auth`;

        client.publish(topic, JSON.stringify(message));
        console.log(`Device ${deviceId} sent:`, message);
        scheduleAuth();
      }, nextDelay);
    }

    const startupDelay = Math.random() * 3000;
    setTimeout(scheduleAuth, startupDelay);
  });
}

console.log(`Starting ${initialDeviceIds.length} simulated device(s): ${initialDeviceIds.join(", ")}`);

for (const deviceId of initialDeviceIds) {
  runningDevices.add(deviceId);
  startDevice(deviceId);
}

const controlApp = express();
controlApp.use(express.json());

controlApp.post("/devices", (req, res) => {
  const { deviceId, type, temperature, humidity, battery, status } = req.body || {};

  if (!deviceId || typeof deviceId !== "string") {
    return res.status(400).json({ error: "deviceId is required" });
  }

  if (runningDevices.has(deviceId)) {
    return res.status(409).json({ error: `Device ${deviceId} is already running in this simulator` });
  }

  runningDevices.add(deviceId);
  startDevice(deviceId, { type, temperature, humidity, battery, status });

  res.status(201).json({ deviceId, started: true });
});

controlApp.get("/devices", (req, res) => {
  res.json(Array.from(runningDevices));
});

controlApp.listen(CONTROL_PORT, () => {
  console.log(`Device-sim control API listening on port ${CONTROL_PORT}`);
});