const events = [];
const MAX_EVENTS = 300;

let nextId = 1;

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

  return event;
}

export function getEventsAfter(afterId = 0) {
  return events.filter((event) => event.id > afterId);
}