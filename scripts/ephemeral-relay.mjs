/**
 * Small NIP-01 relay for tests. It accepts signed events on loopback and
 * answers REQ. It is not a public relay.
 */
import { WebSocketServer } from "ws";

function eventMatches(event, filters) {
  if (!Array.isArray(filters) || filters.length === 0) return true;
  return filters.some((filter) => {
    if (!filter || typeof filter !== "object") return false;
    if (Array.isArray(filter.ids) && !filter.ids.includes(event.id)) {
      return false;
    }
    if (
      Array.isArray(filter.authors) &&
      !filter.authors.includes(event.pubkey)
    ) {
      return false;
    }
    if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
    return true;
  });
}

export function startEphemeralRelay() {
  const events = new Map();
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });

  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!Array.isArray(message) || message.length === 0) return;
      const [type, ...rest] = message;
      if (type === "EVENT") {
        const event = rest[0];
        const id = typeof event?.id === "string" ? event.id : "";
        if (
          !id ||
          typeof event.pubkey !== "string" ||
          typeof event.sig !== "string"
        ) {
          socket.send(JSON.stringify(["OK", id, false, "invalid: event"]));
          return;
        }
        if (!events.has(id)) events.set(id, event);
        socket.send(JSON.stringify(["OK", id, true, ""]));
        return;
      }
      if (type === "REQ") {
        const subscriptionId = rest[0];
        const filters = rest.slice(1);
        for (const event of events.values()) {
          if (eventMatches(event, filters)) {
            socket.send(JSON.stringify(["EVENT", subscriptionId, event]));
          }
        }
        socket.send(JSON.stringify(["EOSE", subscriptionId]));
      }
    });
  });

  return new Promise((resolve, reject) => {
    wss.once("error", reject);
    wss.once("listening", () => {
      const address = wss.address();
      if (address == null || typeof address === "string") {
        reject(new Error("relay did not bind"));
        return;
      }
      resolve({
        url: `ws://127.0.0.1:${address.port}`,
        events,
        close() {
          return new Promise((done) => {
            wss.close(() => done());
          });
        },
      });
    });
  });
}
