import mqtt from "mqtt";
import { verify } from "schnorr-zkp-toolkit";
import { registerDevice, markAuthenticated, getDevice } from "./deviceStore.js";
import { parsePublicParams, parseProof } from "./serialize.js";
import { issueNonce, consumeNonce } from "./nonceStore.js";

export function startMqttListener(brokerUrl) {
  const client = mqtt.connect(brokerUrl);

  client.on("connect", () => {
    console.log("Connected to MQTT broker");
    client.subscribe("devices/+/register");
    client.subscribe("devices/+/nonce-request");
    client.subscribe("devices/+/auth");
  });

  client.on("message", (topic, payload) => {
    const parts = topic.split("/");
    const deviceId = parts[1];
    const action = parts[2];

    let message;

    try {
      message = JSON.parse(payload.toString());
    } catch (error) {
      console.log(`Received malformed message on topic ${topic}, ignoring`);
      return;
    }

    if (action === "register") {
      const params = parsePublicParams(message.params);
      const publicKey = BigInt(message.publicKey);

      registerDevice(deviceId, params, publicKey);
      console.log(`Device ${deviceId} registered with public key`);
      return;
    }

    if (action === "nonce-request") {
      const nonce = issueNonce(deviceId);
      client.publish(`devices/${deviceId}/nonce`, JSON.stringify({ nonce }));
      console.log(`Issued nonce to device ${deviceId}`);
      return;
    }

    if (action === "auth") {
      const device = getDevice(deviceId);

      if (!device) {
        console.log(`Device ${deviceId} tried to authenticate but is not registered`);
        return;
      }

      const providedNonce = message.nonce;

      if (!providedNonce || !consumeNonce(deviceId, providedNonce)) {
        console.log(`Device ${deviceId} sent an invalid or reused nonce, rejecting`);
        return;
      }

      let proof;

      try {
        proof = parseProof(message);
      } catch (error) {
        console.log(`Device ${deviceId} sent a malformed proof, ignoring`);
        return;
      }

      if (proof.publicKey !== device.publicKey) {
        console.log(`Device ${deviceId} sent a proof with a mismatched public key, rejecting`);
        return;
      }

      const isValid = verify(proof);

      if (isValid) {
        markAuthenticated(deviceId);
        console.log(`Device ${deviceId} authenticated with a valid proof`);
      } else {
        console.log(`Device ${deviceId} sent an invalid proof`);
      }
    }
  });

  return client;
}