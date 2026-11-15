/**
 * Loopback HTTP publisher that checks the API token and the event signature,
 * then writes the event to the requested relays with nostr-tools.
 *
 * This is the release-verification publisher. `scripts/local-publisher.mjs`
 * only checks signatures and does not open a relay.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

import { Relay, verifyEvent } from "nostr-tools";

const MAX_BODY_BYTES = 256 * 1024;

function tokensMatch(provided, expected) {
  const left = typeof provided === "string" ? provided.trim() : "";
  const right = typeof expected === "string" ? expected.trim() : "";
  if (right.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function publishToRelay(url, event) {
  const started = Date.now();
  const relay = new Relay(url);
  try {
    await relay.connect();
    await relay.publish(event);
    return { relay: url, ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      relay: url,
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    relay.close();
  }
}

export function createRelayPublisher(options = {}) {
  const token = options.token?.trim() ?? "";
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, mode: "relay-publisher" });
      return;
    }
    if (url.pathname !== "/publish") {
      sendJson(response, 404, { message: "not found" });
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { message: "method not allowed" });
      return;
    }
    if (!tokensMatch(request.headers["api-token"], token)) {
      sendJson(response, 401, { message: "unauthorized" });
      return;
    }

    let raw = "";
    try {
      raw = await readBody(request);
    } catch {
      sendJson(response, 413, { message: "body too large" });
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendJson(response, 400, { message: "invalid json" });
      return;
    }
    const event = parsed?.event;
    const relays = Array.isArray(parsed?.relays)
      ? parsed.relays.filter(
          (relay) => typeof relay === "string" && relay.trim()
        )
      : [];
    if (!event || typeof event !== "object") {
      sendJson(response, 400, { message: "missing event" });
      return;
    }
    let valid = false;
    try {
      valid = verifyEvent(event);
    } catch {
      valid = false;
    }
    if (!valid) {
      sendJson(response, 400, { message: "invalid event signature" });
      return;
    }
    if (relays.length === 0) {
      sendJson(response, 400, { message: "missing relays" });
      return;
    }
    const results = [];
    for (const relayUrl of relays) {
      results.push(await publishToRelay(relayUrl, event));
    }
    const ok = results.some((result) => result.ok);
    sendJson(response, ok ? 200 : 502, { results });
  });

  return {
    listen(port = 0, host = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          const address = server.address();
          if (address == null || typeof address === "string") {
            reject(new Error("publisher did not bind"));
            return;
          }
          resolve(address.port);
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
