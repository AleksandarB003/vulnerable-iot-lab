import mqtt from "mqtt";
import { writeFileSync } from "fs";
import { generateParams, generateKeyPair, prove } from "schnorr-zkp-toolkit";

const deviceId = process.env.DEVICE_ID || "device-1";
const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";

function bigIntReplacer(key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function readTemperature() {
  const base = 22;
  const variation = (Math.random() * 4 - 2).toFixed(1);
  return parseFloat(base) + parseFloat(variation);
}

console.log(`Device ${deviceId} generating key pair, this may take a moment...`);

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
    JSON.stringify(registrationMessage, bigIntReplacer)
  );

  console.log(`Device ${deviceId} sent registration`);

  client.subscribe(`devices/${deviceId}/nonce`);

  setInterval(() => {
    client.publish(`devices/${deviceId}/nonce-request`, JSON.stringify({}));
  }, 8000);
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
      temperature: readTemperature(),
      timestamp: new Date().toISOString(),
    };

    const authTopic = `devices/${deviceId}/auth`;

    client.publish(authTopic, JSON.stringify(message, bigIntReplacer));
    console.log(`Device ${deviceId} sent a new proof with nonce`);
    writeFileSync("/tmp/last-proof.json", JSON.stringify(message, bigIntReplacer));
  }
});