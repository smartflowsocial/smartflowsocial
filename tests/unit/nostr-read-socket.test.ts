import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";

import {
  queryCacheSocket,
  type CacheSocketLike,
} from "~/features/cache/cache-socket.server";

const EVENT_ID = "a".repeat(64);

interface LocalSocket {
  url: string;
  close: () => Promise<void>;
}

async function serve(
  onMessage: (socket: WebSocket, raw: string) => void
): Promise<LocalSocket> {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  server.on("connection", (socket) => {
    socket.on("message", (data) => onMessage(socket, data.toString()));
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `ws://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function httpStatus(
  status: number
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, response) => {
    response.writeHead(status);
    response.end("no");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `ws://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe("queryCacheSocket", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  it("returns EVENT and EOSE and closes the subscription", async () => {
    const seen: string[] = [];
    const local = await serve((socket, raw) => {
      seen.push(raw);
      const parsed = JSON.parse(raw) as unknown[];
      if (parsed[0] === "REQ") {
        socket.send(
          JSON.stringify(["EVENT", parsed[1], { id: EVENT_ID, kind: 1 }])
        );
        socket.send(JSON.stringify(["EOSE", parsed[1]]));
      }
    });
    closers.push(local.close);
    const result = await queryCacheSocket(
      local.url,
      "events",
      { event_ids: [EVENT_ID] },
      { connectTimeoutMs: 1000, responseTimeoutMs: 1000 }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.messages[0]).toEqual([
        "EVENT",
        expect.any(String),
        { id: EVENT_ID, kind: 1 },
      ]);
      const eose = result.messages[1];
      expect(Array.isArray(eose) ? eose[0] : undefined).toBe("EOSE");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen.some((raw) => raw.includes("CLOSE"))).toBe(true);
  });

  it("treats EOSE-only as an empty page", async () => {
    const local = await serve((socket, raw) => {
      const parsed = JSON.parse(raw) as unknown[];
      socket.send(JSON.stringify(["EOSE", parsed[1]]));
    });
    closers.push(local.close);
    const result = await queryCacheSocket(
      local.url,
      "user_profile",
      { pubkey: "a" },
      {
        connectTimeoutMs: 1000,
        responseTimeoutMs: 1000,
      }
    );
    expect(result).toMatchObject({ ok: false, failure: "empty" });
  });

  it("rejects NOTICE, malformed JSON, unexpected frames, and a close before EOSE", async () => {
    const notice = await serve((socket) => {
      socket.send(JSON.stringify(["NOTICE", "sub", "error"]));
    });
    const malformed = await serve((socket) => {
      socket.send("{ not json");
    });
    const unexpected = await serve((socket) => {
      socket.send(JSON.stringify({ ok: true }));
    });
    const closed = await serve((socket) => {
      socket.send(JSON.stringify(["EVENT", "sub", { id: EVENT_ID, kind: 1 }]));
      socket.close();
    });
    closers.push(notice.close, malformed.close, unexpected.close, closed.close);
    const options = { connectTimeoutMs: 1000, responseTimeoutMs: 1000 };
    expect(
      await queryCacheSocket(
        notice.url,
        "events",
        { event_ids: [EVENT_ID] },
        options
      )
    ).toMatchObject({ ok: false, failure: "invalid_response" });
    expect(
      await queryCacheSocket(
        malformed.url,
        "events",
        { event_ids: [EVENT_ID] },
        options
      )
    ).toMatchObject({ ok: false, failure: "invalid_response" });
    expect(
      await queryCacheSocket(
        unexpected.url,
        "events",
        { event_ids: [EVENT_ID] },
        options
      )
    ).toMatchObject({ ok: false, failure: "invalid_response" });
    expect(
      await queryCacheSocket(
        closed.url,
        "events",
        { event_ids: [EVENT_ID] },
        options
      )
    ).toMatchObject({ ok: false, failure: "partial" });
  });

  it("classifies rate limits and response timeouts", async () => {
    const limited = await serve((socket) => {
      socket.send(JSON.stringify(["NOTICE", "sub", "rate limit"]));
    });
    const silent = await serve(() => undefined);
    const denied = await httpStatus(429);
    closers.push(limited.close, silent.close, denied.close);
    expect(
      await queryCacheSocket(
        limited.url,
        "events",
        { event_ids: [EVENT_ID] },
        { connectTimeoutMs: 1000, responseTimeoutMs: 1000 }
      )
    ).toMatchObject({ ok: false, failure: "rate_limited" });
    expect(
      await queryCacheSocket(
        silent.url,
        "events",
        { event_ids: [EVENT_ID] },
        { connectTimeoutMs: 1000, responseTimeoutMs: 40 }
      )
    ).toMatchObject({ ok: false, failure: "response_timeout" });
    expect(
      await queryCacheSocket(
        denied.url,
        "events",
        { event_ids: [EVENT_ID] },
        { connectTimeoutMs: 1000, responseTimeoutMs: 1000 }
      )
    ).toMatchObject({ ok: false, failure: "rate_limited" });
  });

  it("rejects an oversized frame and a socket that never opens", async () => {
    const huge = await serve((socket) => {
      socket.send(
        JSON.stringify(["EVENT", "sub", { id: "x".repeat(1_100_000) }])
      );
    });
    closers.push(huge.close);
    expect(
      await queryCacheSocket(
        huge.url,
        "events",
        { event_ids: [EVENT_ID] },
        { connectTimeoutMs: 1000, responseTimeoutMs: 1000 }
      )
    ).toMatchObject({ ok: false, failure: "invalid_response" });

    class SilentSocket implements CacheSocketLike {
      on(): void {
        return undefined;
      }
      send(): void {
        return undefined;
      }
      close(): void {
        return undefined;
      }
    }
    expect(
      await queryCacheSocket(
        "ws://127.0.0.1:9",
        "events",
        { event_ids: [EVENT_ID] },
        {
          connectTimeoutMs: 30,
          responseTimeoutMs: 30,
          socket: SilentSocket,
        }
      )
    ).toMatchObject({ ok: false, failure: "connect_timeout" });
  });

  it("rejects an unsupported request before opening a socket", async () => {
    const result = await queryCacheSocket(
      "ws://127.0.0.1:9",
      "search",
      { query: "ada" },
      { connectTimeoutMs: 50, responseTimeoutMs: 50 }
    );
    expect(result).toMatchObject({ ok: false, failure: "unsupported" });
  });
});
