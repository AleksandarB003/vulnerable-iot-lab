import mqtt from "mqtt";
import { verify } from "schnorr-zkp-toolkit";
import { registerDevice, markAuthenticated, getDevice } from "./deviceStore.js";
import { parsePublicParams, parseProof } from "./serialize.js";
import { issueNonce, consumeNonce } from "./nonceStore.js";
import { logEvent } from "./eventLog.js";
import { isBlocked, recordFailure, recordSuccess } from "./anomalyGuard.js";

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
      logEvent("malformed_message", deviceId, `Malformed message on topic ${topic}, ignoring`);
      return;
    }

    if (action === "register") {
      const existing = getDevice(deviceId);

      if (existing) {
        console.log(`Device ${deviceId} attempted to re-register, ignoring (already registered)`);
        logEvent("register_blocked", deviceId, `Re-registration attempt blocked (already registered)`);
        return;
      }

      const params = parsePublicParams(message.params);
      const publicKey = BigInt(message.publicKey);

      registerDevice(deviceId, params, publicKey);
      console.log(`Device ${deviceId} registered with public key`);
      logEvent("register", deviceId, `Registered with public key`);
      return;
    }

    if (action === "nonce-request") {
      const nonce = issueNonce(deviceId);

      if (!nonce) {
        console.log(`Device ${deviceId} requested a nonce too soon, rate limiting`);
        logEvent("nonce_rate_limited", deviceId, `Nonce request rate limited`);
        return;
      }

      client.publish(`devices/${deviceId}/nonce`, JSON.stringify({ nonce }));
      console.log(`Issued nonce to device ${deviceId}`);
      logEvent("nonce_issued", deviceId, `Nonce issued`);
      return;
    }

    if (action === "auth") {
      const device = getDevice(deviceId);

      if (!device) {
        console.log(`Device ${deviceId} tried to authenticate but is not registered`);
        logEvent("auth_rejected", deviceId, `Auth attempt rejected: not registered`);
        return;
      }

      if (isBlocked(deviceId)) {
        console.log(`Device ${deviceId} is temporarily blocked, rejecting`);
        logEvent("auth_rejected", deviceId, `Auth attempt rejected: device temporarily blocked`);
        return;
      }

      const providedNonce = message.nonce;

      if (!providedNonce || !consumeNonce(deviceId, providedNonce)) {
        console.log(`Device ${deviceId} sent an invalid or reused nonce, rejecting`);
        logEvent("auth_rejected", deviceId, `Auth attempt rejected: invalid or reused nonce`);
        return;
      }

      let proof;

      try {
        proof = parseProof(message);
      } catch (error) {
        console.log(`Device ${deviceId} sent a malformed proof, ignoring`);
        logEvent("auth_rejected", deviceId, `Auth attempt rejected: malformed proof`);
        if (recordFailure(deviceId)) {
          logEvent("device_blocked", deviceId, `Blocked for 30s after 5 consecutive invalid auth attempts`);
        }
        return;
      }

      if (proof.publicKey !== device.publicKey) {
        console.log(`Device ${deviceId} sent a proof with a mismatched public key, rejecting`);
        logEvent("auth_rejected", deviceId, `Auth attempt rejected: public key mismatch`);
        if (recordFailure(deviceId)) {
          logEvent("device_blocked", deviceId, `Blocked for 30s after 5 consecutive invalid auth attempts`);
        }
        return;
      }

      const isValid = verify(proof);

      if (isValid) {
        markAuthenticated(deviceId, {
          temperature: message.temperature,
          humidity: message.humidity,
          battery: message.battery,
          status: message.status,
        });
        recordSuccess(deviceId);
        console.log(`Device ${deviceId} authenticated with a valid proof`);
        logEvent("auth_success", deviceId, `Authenticated with a valid proof`);
      } else {
        console.log(`Device ${deviceId} sent an invalid proof`);
        logEvent("auth_rejected", deviceId, `Auth attempt rejected: invalid proof`);
        if (recordFailure(deviceId)) {
          logEvent("device_blocked", deviceId, `Blocked for 30s after 5 consecutive invalid auth attempts`);
        }
      }
    }
  });

  return client;
}