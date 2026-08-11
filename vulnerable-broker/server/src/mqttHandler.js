import mqtt from "mqtt";
import { markAuthenticated, recordRawMessage } from "./deviceStore.js";
import { logEvent } from "./eventLog.js";

export const SHARED_SECRET = "iot-secret-123";

export function startMqttListener(brokerUrl) {
  const client = mqtt.connect(brokerUrl);

  client.on("connect", () => {
    console.log("Connected to MQTT broker");
    client.subscribe("devices/+/auth");
  });

client.on("message", (topic, payload) => {
  const parts = topic.split("/");
  const deviceId = parts[1];
  const raw = payload.toString();

  let message;

  try {
    message = JSON.parse(raw);
  } catch (error) {
    console.log(`Received malformed message on topic ${topic}, ignoring`);
    return;
  }

  if (message.secret === SHARED_SECRET) {
    markAuthenticated(deviceId, {
      temperature: message.temperature,
      humidity: message.humidity,
      battery: message.battery,
      status: message.status,
    });
    recordRawMessage(deviceId, raw);
    console.log(`Device ${deviceId} authenticated`);
    logEvent("auth_success", deviceId, `Authenticated using secret: ${SHARED_SECRET}`);
  } else {
    console.log(`Device ${deviceId} sent invalid secret`);
    logEvent("auth_rejected", deviceId, "Rejected: invalid secret");
  }
});

  return client;
}