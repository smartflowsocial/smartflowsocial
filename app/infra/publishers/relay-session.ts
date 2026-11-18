/**
 * One NIP-01 EVENT/OK exchange over a WebSocket.
 *
 * DNS answers are checked before the socket can use them, including answers
 * that arrive from the lookup the socket itself performs.
 */

import type { LookupOptions } from "node:dns";
import type { LookupFunction } from "node:net";

import WebSocket, { type RawData } from "ws";

import type { SignedEvent } from "~/features/nostr/types";

import {
  isBlockedRelayAddress,
  type PublishFailureCategory,
} from "./relay-target";

const openSockets = new Set<WebSocket>();

export function internalPublisherOpenSocketCount(): number {
  return openSockets.size;
}

export async function closeInternalPublisherConnections(): Promise<void> {
  const sockets = [...openSockets];
  for (const socket of sockets) {
    socket.close();
  }
  await Promise.race([
    Promise.all(
      sockets.map(
        (socket) =>
          new Promise<void>((resolve) => {
            if (socket.readyState === WebSocket.CLOSED) {
              resolve();
              return;
            }
            socket.once("close", () => resolve());
          })
      )
    ),
    new Promise<void>((resolve) => {
      setTimeout(resolve, 1500);
    }),
  ]);
  for (const socket of sockets) {
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
    openSockets.delete(socket);
  }
}

export class RelaySocketError extends Error {
  readonly category: PublishFailureCategory;

  constructor(message: string, category: PublishFailureCategory) {
    super(message);
    this.name = "RelaySocketError";
    this.category = category;
  }
}

function safeLookup(
  resolveAddresses: (hostname: string) => Promise<string[]>,
  allowPrivateRelays: boolean
): LookupFunction {
  return (
    hostname: string,
    options: LookupOptions,
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number
    ) => void
  ) => {
    resolveAddresses(hostname)
      .then((addresses) => {
        if (addresses.length === 0) {
          callback(
            new RelaySocketError(
              "relay DNS lookup returned no addresses",
              "connection_failed"
            ),
            "",
            4
          );
          return;
        }
        for (const address of addresses) {
          if (isBlockedRelayAddress(address, allowPrivateRelays)) {
            callback(
              new RelaySocketError(
                "relay resolved to a blocked address",
                "private_address"
              ),
              "",
              4
            );
            return;
          }
        }
        const familyOf = (address: string) => (address.includes(":") ? 6 : 4);
        if (options.all) {
          callback(
            null,
            addresses.map((address) => ({
              address,
              family: familyOf(address),
            }))
          );
          return;
        }
        const selected = addresses[0] ?? "";
        callback(null, selected, familyOf(selected));
      })
      .catch((error: unknown) => {
        const wrapped =
          error instanceof RelaySocketError
            ? error
            : new RelaySocketError(
                error instanceof Error
                  ? error.message
                  : "relay DNS lookup failed",
                "connection_failed"
              );
        callback(wrapped, "", 4);
      });
  };
}

function parseOk(
  data: RawData,
  eventId: string
): { ok: boolean; message: string } | null {
  const text = data.toString();
  if (text.length > 64 * 1024) {
    throw new RelaySocketError("relay message is too large", "too_large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed[0] !== "OK" || parsed[1] !== eventId) {
    return null;
  }
  const message = typeof parsed[3] === "string" ? parsed[3].slice(0, 300) : "";
  return { ok: parsed[2] === true, message };
}

function waitForOk(
  socket: WebSocket,
  eventId: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new RelaySocketError("relay acknowledgment timeout", "ack_timeout")
        )
      );
    }, timeoutMs);
    const onAbort = () => {
      finish(() =>
        reject(new RelaySocketError("publish timed out", "ack_timeout"))
      );
    };
    const onMessage = (data: RawData) => {
      try {
        const parsed = parseOk(data, eventId);
        if (!parsed) return;
        finish(() => resolve(parsed));
      } catch (error) {
        finish(() => reject(error));
      }
    };
    const onClose = () => {
      finish(() =>
        reject(
          new RelaySocketError(
            "relay connection closed before acknowledgment",
            "closed"
          )
        )
      );
    };
    const onError = (error: Error) => {
      finish(() =>
        reject(
          error instanceof RelaySocketError
            ? error
            : new RelaySocketError(
                error.message || "relay connection failed",
                "connection_failed"
              )
        )
      );
    };
    function finish(settle: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      socket.off("message", onMessage);
      socket.off("close", onClose);
      socket.off("error", onError);
      settle();
    }
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    socket.on("message", onMessage);
    socket.on("close", onClose);
    socket.on("error", onError);
  });
}

export async function publishEventOnce(input: {
  connectUrl: string;
  event: SignedEvent;
  connectTimeoutMs: number;
  ackTimeoutMs: number;
  allowPrivateRelays: boolean;
  resolveAddresses: (hostname: string) => Promise<string[]>;
  signal: AbortSignal;
}): Promise<{ ok: boolean; message: string }> {
  if (input.signal.aborted) {
    throw new RelaySocketError("publish timed out", "ack_timeout");
  }
  const socket = new WebSocket(input.connectUrl, {
    handshakeTimeout: input.connectTimeoutMs,
    maxPayload: 64 * 1024,
    followRedirects: false,
    perMessageDeflate: false,
    lookup: safeLookup(input.resolveAddresses, input.allowPrivateRelays),
  });
  openSockets.add(socket);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new RelaySocketError("connection timed out", "connection_timeout")
        );
      }, input.connectTimeoutMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(
          new RelaySocketError("connection timed out", "connection_timeout")
        );
      };
      input.signal.addEventListener("abort", onAbort, { once: true });
      socket.once("open", () => {
        clearTimeout(timer);
        input.signal.removeEventListener("abort", onAbort);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        input.signal.removeEventListener("abort", onAbort);
        reject(
          error instanceof RelaySocketError
            ? error
            : new RelaySocketError(
                error.message || "relay connection failed",
                error.message.includes("blocked address")
                  ? "private_address"
                  : "connection_failed"
              )
        );
      });
    });
    socket.send(JSON.stringify(["EVENT", input.event]));
    return await waitForOk(
      socket,
      input.event.id,
      input.ackTimeoutMs,
      input.signal
    );
  } finally {
    openSockets.delete(socket);
    socket.on("error", () => {});
    if (
      socket.readyState === WebSocket.CONNECTING ||
      socket.readyState === WebSocket.OPEN
    ) {
      socket.close();
    }
    socket.terminate();
  }
}
