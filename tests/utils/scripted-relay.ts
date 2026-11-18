/**
 * Loopback WebSocket relays for publisher tests.
 * They speak enough NIP-01 to accept EVENT and answer REQ.
 */
import {
  createServer,
  type AddressInfo,
  type Server,
  type Socket,
} from "node:net";

import WebSocket, { WebSocketServer, type RawData } from "ws";

export type ScriptedRelayMode =
  "ok" | "reject" | "ignore" | "drop-once" | "hold";

export interface StoredRelayEvent {
  id: string;
  kind?: number;
  content?: string;
  pubkey?: string;
}

export interface ScriptedRelay {
  url: string;
  events: Map<string, StoredRelayEvent>;
  connections: number;
  peakConnections: number;
  attempts: number;
  release(): void;
  close(): Promise<void>;
}

interface HeldEvent {
  socket: WebSocket;
  event: StoredRelayEvent;
}

function asEvent(value: unknown): StoredRelayEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as StoredRelayEvent;
  if (typeof event.id !== "string" || event.id.length === 0) return null;
  return event;
}

export function startScriptedRelay(
  mode: ScriptedRelayMode = "ok"
): Promise<ScriptedRelay> {
  const events = new Map<string, StoredRelayEvent>();
  const held: HeldEvent[] = [];
  let connections = 0;
  let peakConnections = 0;
  let attempts = 0;
  let dropped = 0;
  let released = false;
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });

  server.on("connection", (socket) => {
    connections += 1;
    peakConnections = Math.max(peakConnections, connections);
    socket.on("close", () => {
      connections = Math.max(0, connections - 1);
    });
    socket.on("error", () => undefined);
    socket.on("message", (raw: RawData) => {
      let message: unknown;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!Array.isArray(message)) return;
      if (message[0] === "REQ") {
        const subscriptionId = String(message[1] ?? "");
        const filters = message.slice(2) as Array<{ ids?: unknown }>;
        const ids = filters.find((filter) => Array.isArray(filter?.ids))?.ids;
        const wanted = Array.isArray(ids)
          ? ids.filter((id): id is string => typeof id === "string")
          : null;
        for (const event of events.values()) {
          if (!wanted || wanted.includes(event.id)) {
            socket.send(JSON.stringify(["EVENT", subscriptionId, event]));
          }
        }
        socket.send(JSON.stringify(["EOSE", subscriptionId]));
        return;
      }
      if (message[0] !== "EVENT") return;
      const event = asEvent(message[1]);
      if (!event) return;
      attempts += 1;
      if (mode === "drop-once" && dropped === 0) {
        dropped += 1;
        socket.close();
        return;
      }
      if (mode === "ignore") return;
      if (mode === "hold" && !released) {
        held.push({ socket, event });
        return;
      }
      if (mode === "reject") {
        socket.send(JSON.stringify(["OK", event.id, false, "blocked: test"]));
        return;
      }
      const duplicate = events.has(event.id);
      events.set(event.id, event);
      socket.send(
        JSON.stringify([
          "OK",
          event.id,
          true,
          duplicate ? "duplicate: already have this event" : "",
        ])
      );
    });
  });

  const relay = {
    events,
    get url() {
      const address = server.address() as AddressInfo;
      return `ws://127.0.0.1:${address.port}`;
    },
    get connections() {
      return connections;
    },
    get peakConnections() {
      return peakConnections;
    },
    get attempts() {
      return attempts;
    },
    release() {
      released = true;
      for (const item of held.splice(0)) {
        events.set(item.event.id, item.event);
        if (item.socket.readyState === WebSocket.OPEN) {
          item.socket.send(JSON.stringify(["OK", item.event.id, true, ""]));
        }
      }
    },
    close() {
      return new Promise<void>((done) => {
        const timer = setTimeout(done, 500);
        for (const client of server.clients) client.terminate();
        server.close(() => {
          clearTimeout(timer);
          done();
        });
      });
    },
  };

  return new Promise((resolve, reject) => {
    const ready = () => resolve(relay);
    if (server.address()) {
      ready();
      return;
    }
    server.once("error", reject);
    server.once("listening", ready);
  });
}

export function startSilentTcpServer(): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done) => {
            const timer = setTimeout(done, 500);
            for (const socket of sockets) socket.destroy();
            server.close(() => {
              clearTimeout(timer);
              done();
            });
          }),
      });
    });
  });
}

export function readRelayEvent(
  url: string,
  eventId: string
): Promise<StoredRelayEvent | null> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("timed out reading the event back from the relay"));
    }, 3000);
    socket.on("error", () => undefined);
    socket.on("open", () => {
      socket.send(JSON.stringify(["REQ", "readback", { ids: [eventId] }]));
    });
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as unknown[];
      if (
        message[0] === "EVENT" &&
        message[2] &&
        typeof message[2] === "object"
      ) {
        const event = message[2] as StoredRelayEvent;
        if (event.id === eventId) {
          clearTimeout(timer);
          socket.close();
          resolve(event);
        }
      }
      if (message[0] === "EOSE") {
        clearTimeout(timer);
        socket.close();
        resolve(null);
      }
    });
  });
}
