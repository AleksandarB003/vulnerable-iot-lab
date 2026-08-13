import mqtt from "mqtt";
import express from "express";
import { writeFileSync } from "fs";
import { generateParams, generateKeyPair, prove } from "schnorr-zkp-toolkit";

const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
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

function bigIntReplacer(key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

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

const VALID_TYPES = ["sensor", "thermostat", "camera", "door"];

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
    batteryLevel = Math.min(100, Math.max(0, batteryLevel - Math.random() * 0.05));
    return parseFloat(batteryLevel.toFixed(1));
  }

  function readStatus() {
    if (statusOptions && Math.random() < 0.15) {
      currentStatus = currentStatus === statusOptions[0] ? statusOptions[1] : statusOptions[0];
    }
    return currentStatus;
  }

  console.log(`Device ${deviceId} (${type}) generating key pair, this may take a moment...`);

  const params = generateParams(128);
  const keyPair = generateKeyPair(params);

  console.log(`Device ${deviceId} key pair ready`);

  const client = mqtt.connect(brokerUrl);

  client.on("connect", () => {
    console.log(`Device ${deviceId} connected to broker`);

    const registrationMessage = {
      params: keyPair.params,
      publicKey: keyPair.publicKey,
    };

    client.publish(
      `devices/${deviceId}/register`,
      JSON.stringify(registrationMessage, bigIntReplacer),
      { retain: true }
    );

    console.log(`Device ${deviceId} sent registration`);

    client.subscribe(`devices/${deviceId}/nonce`);

    function scheduleNonceRequest() {
      const goingOffline = Math.random() < 0.08;
      const nextDelay = goingOffline
        ? 15000 + Math.random() * 30000
        : 7000 + Math.random() * 2000;

      if (goingOffline) {
        console.log(`Device ${deviceId} going quiet for a bit (simulated offline)`);
      }

      setTimeout(() => {
        client.publish(`devices/${deviceId}/nonce-request`, JSON.stringify({}));
        scheduleNonceRequest();
      }, nextDelay);
    }

    const startupDelay = Math.random() * 3000;
    setTimeout(scheduleNonceRequest, startupDelay);
  });

  client.on("message", (topic, payload) => {
    const parts = topic.split("/");
    const action = parts[2];

    if (action === "nonce") {
      const { nonce } = JSON.parse(payload.toString());

      const proof = prove(keyPair);

      const message = {
        ...proof,
        nonce,
        type,
        ...buildTelemetry(type, { readTemperature, readHumidity, readBattery, readStatus }),
        timestamp: new Date().toISOString(),
      };

      const authTopic = `devices/${deviceId}/auth`;

      client.publish(authTopic, JSON.stringify(message, bigIntReplacer));
      console.log(`Device ${deviceId} sent a new proof with nonce`);
      writeFileSync(`/tmp/last-proof-${deviceId}.json`, JSON.stringify(message, bigIntReplacer));
    }
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