import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const DATA_DIR = "data";
const DATA_FILE = path.join(DATA_DIR, "events.json");
const MAX_EVENTS = 300;

let events = [];
let nextId = 1;
let saveScheduled = false;

function loadEvents() {
  try {
    if (existsSync(DATA_FILE)) {
      const parsed = JSON.parse(readFileSync(DATA_FILE, "utf-8"));
      events = Array.isArray(parsed.events) ? parsed.events : [];
      nextId = typeof parsed.nextId === "number" ? parsed.nextId : 1;
      console.log(`Loaded ${events.length} events from disk`);
    }
  } catch (error) {
    console.log(`Could not load event history, starting fresh: ${error.message}`);
    events = [];
    nextId = 1;
  }
}

function saveEvents() {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    writeFileSync(DATA_FILE, JSON.stringify({ events, nextId }));
  } catch (error) {
    console.log(`Could not save event history: ${error.message}`);
  }
}

function scheduleSave() {
  if (saveScheduled) return;
  saveScheduled = true;

  setTimeout(() => {
    saveScheduled = false;
    saveEvents();
  }, 500);
}

loadEvents();

export function logEvent(type, deviceId, message) {
  const event = {
    id: nextId++,
    timestamp: new Date().toISOString(),
    type,
    deviceId,
    message,
  };

  events.push(event);

  if (events.length > MAX_EVENTS) {
    events.shift();
  }

  scheduleSave();

  return event;
}

export function getEventsAfter(afterId = 0) {
  return events.filter((event) => event.id > afterId);
}