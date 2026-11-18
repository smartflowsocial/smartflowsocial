/**
 * One Primal-compatible WebSocket query.
 * The socket closes after EOSE, on failure, and when the caller aborts.
 */

import { randomBytes } from "node:crypto";

import WebSocket, { type RawData } from "ws";

import {
  isNoticeError,
  isRateLimitedNotice,
  wireCommand,
  type ReadFailureKind,
} from "./payload";
import { cacheReqFrame, canonicalCacheRequest } from "./wire";

const MAX_MESSAGE_CHARS = 1_000_000;
const MAX_MESSAGES = 400;
const MAX_TOTAL_CHARS = 2_000_000;

export type SocketAttempt =
  | { ok: true; messages: unknown[] }
  | {
      ok: false;
      failure: ReadFailureKind;
      detail: string;
      messages?: unknown[];
    };

export interface CacheSocketLike {
  on(event: "open", listener: () => void): void;
  on(event: "message", listener: (data: RawData) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: () => void): void;
  on(
    event: "unexpected-response",
    listener: (request: unknown, response: { statusCode?: number }) => void
  ): void;
  send(data: string): void;
  close(): void;
}

export type CacheSocketConstructor = new (url: string) => CacheSocketLike;

export interface QueryCacheSocketOptions {
  connectTimeoutMs: number;
  responseTimeoutMs: number;
  socket?: CacheSocketConstructor;
}

function subscriptionId(): string {
  return randomBytes(8).toString("hex");
}

function frameText(data: RawData): string | null {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return null;
}

function knownCommand(command: string | undefined): boolean {
  return command === "EVENT" || command === "EOSE" || command === "NOTICE";
}

export function queryCacheSocket(
  endpoint: string,
  requestType: string,
  params: Record<string, unknown> | undefined,
  options: QueryCacheSocketOptions
): Promise<SocketAttempt> {
  const canonical = canonicalCacheRequest(requestType, params);
  if (!canonical) {
    return Promise.resolve({
      ok: false,
      failure: "unsupported",
      detail: "unsupported request type",
    });
  }
  if (options.connectTimeoutMs <= 0) {
    return Promise.resolve({
      ok: false,
      failure: "connect_timeout",
      detail: "read budget exhausted before connect",
    });
  }

  const SocketImpl = options.socket ?? WebSocket;
  const requestId = subscriptionId();

  return new Promise<SocketAttempt>((resolve) => {
    let socket: CacheSocketLike;
    try {
      socket = new SocketImpl(endpoint);
    } catch (error) {
      resolve({
        ok: false,
        failure: "unavailable",
        detail: error instanceof Error ? error.message : "socket open failed",
      });
      return;
    }

    const messages: unknown[] = [];
    let settled = false;
    let opened = false;
    let totalChars = 0;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let responseTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (connectTimer) clearTimeout(connectTimer);
      if (responseTimer) clearTimeout(responseTimer);
      connectTimer = null;
      responseTimer = null;
      try {
        socket.close();
      } catch {
        // The socket may already be closed.
      }
    };

    const finish = (result: SocketAttempt) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    connectTimer = setTimeout(() => {
      finish({
        ok: false,
        failure: "connect_timeout",
        detail: "websocket connect timeout",
      });
    }, options.connectTimeoutMs);

    socket.on("open", () => {
      opened = true;
      if (connectTimer) clearTimeout(connectTimer);
      connectTimer = null;
      responseTimer = setTimeout(
        () => {
          finish({
            ok: false,
            failure: messages.length > 0 ? "partial" : "response_timeout",
            detail: "websocket response timeout before EOSE",
            messages,
          });
        },
        Math.max(1, options.responseTimeoutMs)
      );
      try {
        socket.send(JSON.stringify(cacheReqFrame(requestId, canonical)));
      } catch (error) {
        finish({
          ok: false,
          failure: "unavailable",
          detail:
            error instanceof Error ? error.message : "websocket send failed",
        });
      }
    });

    socket.on("message", (data) => {
      const text = frameText(data);
      if (text === null) {
        finish({
          ok: false,
          failure: "invalid_response",
          detail: "non-text websocket frame",
        });
        return;
      }
      if (
        text.length > MAX_MESSAGE_CHARS ||
        totalChars + text.length > MAX_TOTAL_CHARS
      ) {
        finish({
          ok: false,
          failure: "invalid_response",
          detail: "websocket message exceeds size limit",
        });
        return;
      }
      totalChars += text.length;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        finish({
          ok: false,
          failure: "invalid_response",
          detail: "malformed JSON frame",
        });
        return;
      }
      if (!Array.isArray(parsed)) {
        finish({
          ok: false,
          failure: "invalid_response",
          detail: "websocket frame was not an array",
        });
        return;
      }
      const command = wireCommand(parsed);
      if (!knownCommand(command)) {
        finish({
          ok: false,
          failure: "invalid_response",
          detail: "unexpected websocket frame",
        });
        return;
      }
      if (messages.length >= MAX_MESSAGES) {
        finish({
          ok: false,
          failure: "invalid_response",
          detail: "too many websocket frames",
        });
        return;
      }
      messages.push(parsed);
      if (isNoticeError(parsed)) {
        finish({
          ok: false,
          failure: isRateLimitedNotice(parsed)
            ? "rate_limited"
            : "invalid_response",
          detail: "websocket NOTICE",
          messages,
        });
        return;
      }
      if (command === "EOSE") {
        const hasEvent = messages.some((row) => wireCommand(row) === "EVENT");
        if (!hasEvent) {
          finish({
            ok: false,
            failure: "empty",
            detail: "EOSE with no events",
            messages,
          });
          return;
        }
        try {
          socket.send(JSON.stringify(["CLOSE", requestId]));
        } catch {
          // The page is already complete.
        }
        finish({ ok: true, messages });
      }
    });

    socket.on("unexpected-response", (_request, response) => {
      const status = response.statusCode ?? 0;
      finish({
        ok: false,
        failure: status === 429 ? "rate_limited" : "unavailable",
        detail: `websocket upgrade status ${status}`,
      });
    });

    socket.on("error", (error) => {
      const message =
        error instanceof Error ? error.message : "websocket error";
      const rateLimited = message.toLowerCase().includes("429");
      finish({
        ok: false,
        failure: rateLimited ? "rate_limited" : "unavailable",
        detail: message,
      });
    });

    socket.on("close", () => {
      if (settled) return;
      finish({
        ok: false,
        failure: opened && messages.length > 0 ? "partial" : "unavailable",
        detail: opened
          ? "websocket closed before EOSE"
          : "websocket closed before open",
        messages,
      });
    });
  });
}
