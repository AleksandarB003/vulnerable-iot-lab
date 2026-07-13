import mqtt from "mqtt";
import { markAuthenticated } from "./deviceStore.js";

const SHARED_SECRET = "iot-secret-123";

export function startMqttListener(brokerUrl) {
  const client = mqtt.connect(brokerUrl);

  client.on("connect", () => {
    console.log("Connected to MQTT broker");
    client.subscribe("devices/+/auth");
  });

client.on("message", (topic, payload) => {
  const parts = topic.split("/");
  const deviceId = parts[1];

  let message;

  try {
    message = JSON.parse(payload.toString());
  } catch (error) {
    console.log(`Received malformed message on topic ${topic}, ignoring`);
    return;
  }

  if (message.secret === SHARED_SECRET) {
    markAuthenticated(deviceId);
    console.log(`Device ${deviceId} authenticated`);
  } else {
    console.log(`Device ${deviceId} sent invalid secret`);
  }
});

  return client;
}