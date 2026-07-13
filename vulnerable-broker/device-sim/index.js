import mqtt from "mqtt";

const deviceId = process.env.DEVICE_ID || "device-1";
const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const SHARED_SECRET = "iot-secret-123";

const client = mqtt.connect(brokerUrl);

function readTemperature() {
  const base = 22;
  const variation = (Math.random() * 4 - 2).toFixed(1);
  return parseFloat(base) + parseFloat(variation);
}

client.on("connect", () => {
  console.log(`Device ${deviceId} connected to broker`);

  setInterval(() => {
    const message = {
      secret: SHARED_SECRET,
      temperature: readTemperature(),
      timestamp: new Date().toISOString(),
    };

    const topic = `devices/${deviceId}/auth`;

    client.publish(topic, JSON.stringify(message));
    console.log(`Device ${deviceId} sent:`, message);
  }, 8000);
});