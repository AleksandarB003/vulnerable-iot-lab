// End to end test suite for the vulnerable IoT lab.
//
// Assumes the stack is already up (docker compose --profile vulnerable
// --profile secure up --build), same as running things by hand, this just
// automates the "run each attack, check the event log for what should have
// happened" cycle instead of doing it manually every time.
//
// Run with: node test/run-tests.js

import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const EXPLOITS_DIR = path.join(REPO_ROOT, "exploits");

const SECURE_URL = "http://localhost:3002";
const VULNERABLE_URL = "http://localhost:3001";

const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"} - ${name}${detail ? " (" + detail + ")" : ""}`);
}

async function waitForServer(url, label, timeoutMs = 60000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/devices`);
      if (res.ok) return;
    } catch (error) {

    }
    await sleep(1000);
  }

  throw new Error(`${label} never came up at ${url}`);
}

async function waitForAuthenticatedDevices(url, expectedCount, timeoutMs = 30000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const devices = await (await fetch(`${url}/devices`)).json();

    if (devices.length >= expectedCount && devices.every((d) => d.authenticated)) {
      return devices;
    }

    await sleep(1000);
  }

  throw new Error(`Devices on ${url} never all authenticated within ${timeoutMs}ms`);
}

async function getEvents(url, afterId = 0) {
  const res = await fetch(`${url}/events?afterId=${afterId}`);
  return res.json();
}

async function getLatestEventId(url) {
  const events = await getEvents(url, 0);
  return events.length ? Math.max(...events.map((e) => e.id)) : 0;
}

async function waitForEvent(url, afterId, predicate, timeoutMs = 20000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const events = await getEvents(url, afterId);
    const match = events.find(predicate);
    if (match) return match;
    await sleep(500);
  }

  return null;
}

async function withRetries(attempts, fn) {
  for (let i = 0; i < attempts; i++) {
    const result = await fn();
    if (result) return result;
  }
  return null;
}

function runExploit(script, deviceId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    execFile(
      "node",
      deviceId ? [script, deviceId] : [script],
      { cwd: EXPLOITS_DIR, timeout: timeoutMs },
      (error, stdout, stderr) => {
        resolve({ stdout: stdout || "", stderr: stderr || "", timedOut: Boolean(error && error.killed) });
      }
    );
  });
}

async function waitForDeviceTelemetry(url, deviceId, timeoutMs = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${url}/devices/${deviceId}`);

    if (res.ok) {
      const device = await res.json();
      if (device.temperature != null || device.battery != null) return device;
    }

    await sleep(1000);
  }

  return null;
}

async function testAnomalyGuardUnit() {
  const modulePath = pathToFileURL(path.join(REPO_ROOT, "secure-broker/server/src/anomalyGuard.js")).href;
  const { isBlocked, recordFailure, recordSuccess } = await import(modulePath);

  const deviceA = `unit-test-${Date.now()}-a`;

  for (let i = 0; i < 4; i++) recordFailure(deviceA);
  record("anomalyGuard stays unblocked before the 5th failure", !isBlocked(deviceA));

  recordFailure(deviceA);
  record("anomalyGuard blocks after 5 consecutive failures", isBlocked(deviceA));

  const deviceB = `unit-test-${Date.now()}-b`;

  recordFailure(deviceB);
  recordFailure(deviceB);
  recordSuccess(deviceB);
  recordFailure(deviceB);
  recordFailure(deviceB);
  recordFailure(deviceB);
  record("anomalyGuard resets the counter on a success", !isBlocked(deviceB));
}

async function main() {
  await testAnomalyGuardUnit();

  console.log("Waiting for both brokers to come up...");
  await waitForServer(VULNERABLE_URL, "vulnerable broker");
  await waitForServer(SECURE_URL, "secure broker");

  console.log("Waiting for the default devices to authenticate at least once...");
  await waitForAuthenticatedDevices(VULNERABLE_URL, 3);
  await waitForAuthenticatedDevices(SECURE_URL, 3);

  
  const secureDevices = await (await fetch(`${SECURE_URL}/devices`)).json();
  const vulnDevices = await (await fetch(`${VULNERABLE_URL}/devices`)).json();

  record(
    "secure broker has 3+ authenticated default devices",
    secureDevices.length >= 3 && secureDevices.every((d) => d.authenticated),
    `${secureDevices.length} devices`
  );

  record(
    "vulnerable broker has 3+ authenticated default devices",
    vulnDevices.length >= 3 && vulnDevices.every((d) => d.authenticated),
    `${vulnDevices.length} devices`
  );

  {
    let lastEvents = [];

    const rejection = await withRetries(3, async () => {
      const afterId = await getLatestEventId(SECURE_URL);
      await runExploit("forge_proof.js", "sensor-livingroom");
      await sleep(2000);

      lastEvents = (await getEvents(SECURE_URL, afterId)).filter((e) => e.deviceId === "sensor-livingroom");

      return lastEvents.find(
        (e) =>
          e.type === "auth_rejected" &&
          (e.message.includes("invalid proof") || e.message.includes("invalid or reused nonce"))
      );
    });

    record("forge_proof gets rejected on secure broker", Boolean(rejection), rejection?.message);

    if (!rejection) {
      console.log("  events seen for sensor-livingroom in that window:");
      for (const e of lastEvents) console.log(`    ${e.type}: ${e.message}`);
      if (lastEvents.length === 0) console.log("    (none)");
    }
  }

  {
    const rejection = await withRetries(3, async () => {
      const afterId = await getLatestEventId(SECURE_URL);
      await runExploit("replay_attack.js", "sensor-garage");

      return waitForEvent(
        SECURE_URL,
        afterId,
        (e) => e.type === "auth_rejected" && e.deviceId === "sensor-garage" && e.message.includes("nonce")
      );
    });

    record("replay_attack gets rejected on secure broker (nonce reuse)", Boolean(rejection), rejection?.message);
  }

  {
    let blocked = null;
    let rejected = null;
    let lastEvents = [];

    await withRetries(3, async () => {
      const afterId = await getLatestEventId(SECURE_URL);
      await runExploit("register_hijack.js", "thermostat-bedroom");
      await sleep(2000);

      lastEvents = (await getEvents(SECURE_URL, afterId)).filter((e) => e.deviceId === "thermostat-bedroom");

      blocked = blocked || lastEvents.find((e) => e.type === "register_blocked");
      rejected = lastEvents.find(
        (e) =>
          e.type === "auth_rejected" &&
          (e.message.includes("public key mismatch") || e.message.includes("invalid or reused nonce"))
      );

      return rejected;
    });

    record("register_hijack re-registration attempt blocked", Boolean(blocked));

    if (!rejected) {
      console.log("  events seen for thermostat-bedroom in that window:");
      for (const e of lastEvents) console.log(`    ${e.type}: ${e.message}`);
      if (lastEvents.length === 0) console.log("    (none)");
    }
    record("register_hijack forged auth rejected (public key mismatch)", Boolean(rejected), rejected?.message);
  }

  {
    const afterId = await getLatestEventId(SECURE_URL);
    await runExploit("nonce_spam_burst.js", "sensor-livingroom");

    const events = await getEvents(SECURE_URL, afterId);
    const rateLimitedCount = events.filter(
      (e) => e.type === "nonce_rate_limited" && e.deviceId === "sensor-livingroom"
    ).length;

    record("nonce_spam_burst gets rate limited", rateLimitedCount > 50, `${rateLimitedCount} rate limited`);
  }

  {
    const result = await runExploit("mitm_sniff.js", null, 25000);
    const sawSecure = result.stdout.includes("[SECURE] connected");
    const sawVulnerable = result.stdout.includes("[VULNERABLE] connected");
    const capturedSecureAuth = /\[SECURE\] devices\/.+\/auth/.test(result.stdout);

    record("mitm_sniff connects to both brokers", sawSecure && sawVulnerable);
    record("mitm_sniff captures at least one secure auth message", capturedSecureAuth);
  }

  {
    const afterId = await getLatestEventId(VULNERABLE_URL);
    const fakeId = `test-impersonate-${Date.now()}`;

    const res = await fetch(`${VULNERABLE_URL}/impersonate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: fakeId, battery: 42 }),
    });

    const success = await waitForEvent(
      VULNERABLE_URL,
      afterId,
      (e) => e.type === "auth_success" && e.deviceId === fakeId
    );

    record("vulnerable impersonate: forged device accepted", res.ok && Boolean(success));
  }

  {
    const afterId = await getLatestEventId(VULNERABLE_URL);

    const res = await fetch(`${VULNERABLE_URL}/replay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "sensor-livingroom" }),
    });

    const success = await waitForEvent(
      VULNERABLE_URL,
      afterId,
      (e) => e.type === "auth_success" && e.deviceId === "sensor-livingroom"
    );

    record("vulnerable replay: captured message accepted again", res.ok && Boolean(success));
  }

  {
    const afterId = await getLatestEventId(VULNERABLE_URL);

    const res = await fetch(`${VULNERABLE_URL}/flood`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "sensor-garage", count: 20 }),
    });

    const data = await res.json();
    await sleep(2000);

    const events = await getEvents(VULNERABLE_URL, afterId);
    const successCount = events.filter(
      (e) => e.type === "auth_success" && e.deviceId === "sensor-garage"
    ).length;

    record(
      "vulnerable flood: all messages accepted, no rate limiting",
      successCount >= 20,
      `${successCount}/${data.sent || "?"} accepted`
    );
  }

  {
    const testId = `test-bounds-impersonate-${Date.now()}`;

    await fetch(`${VULNERABLE_URL}/impersonate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: testId, temperature: 999, humidity: -50, battery: 500 }),
    });

    const device = await waitForDeviceTelemetry(VULNERABLE_URL, testId);

    record(
      "bounds validation clamps out-of-range impersonate values",
      Boolean(device) && device.temperature === 85 && device.humidity === 0 && device.battery === 100,
      device ? `temp=${device.temperature} humidity=${device.humidity} battery=${device.battery}` : "device not found"
    );
  }

  {
    const testId = `test-bounds-sim-${Date.now()}`;

    await fetch(`${SECURE_URL}/simulated-devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: testId, type: "sensor", temperature: 999, humidity: -50, battery: 500 }),
    });

    const device = await waitForDeviceTelemetry(SECURE_URL, testId);

    record(
      "bounds validation clamps out-of-range device-sim startup values",
      Boolean(device) && device.temperature <= 85 && device.humidity <= 100 && device.battery <= 100,
      device ? `temp=${device.temperature} humidity=${device.humidity} battery=${device.battery}` : "device not found"
    );
  }

  console.log("\n=== Summary ===");
  const failed = results.filter((r) => !r.passed);
  console.log(`${results.length - failed.length}/${results.length} passed`);

  if (failed.length > 0) {
    console.log("\nFailed:");
    for (const f of failed) console.log(`  - ${f.name}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exitCode = 1;
});