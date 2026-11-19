import { beforeEach, describe, expect, it, vi } from "vitest";

interface LogFields {
  eventId?: string;
  message: string;
  pubkey?: string;
}

function raise(value: unknown): never {
  throw value;
}

const logger = vi.hoisted(() => ({
  logError: vi.fn((_error: Error, _fields: LogFields) => undefined),
}));

vi.mock("~/lib/error-logger.server", () => ({
  logError: logger.logError,
}));

import { processQuoteReposts } from "~/features/engagement/engagement-quote-reposts.server";
import type { NotificationEvent } from "~/features/engagement/types";

const connect = vi.fn(
  async (
    _requestType: string,
    _params: Record<string, unknown>
  ): Promise<unknown[]> => []
);

function useConnect(
  impl: (requestType: string, params: Record<string, unknown>) => unknown
): void {
  connect.mockImplementation(async (requestType, params) => {
    const value = await impl(requestType, params);
    return value as unknown[];
  });
}

function param(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

interface QuoteFields {
  content?: string;
  created_at?: number;
  id: string;
  pubkey?: string;
  tags?: string[][];
}

function quote(fields: QuoteFields): NotificationEvent {
  return {
    content: fields.content ?? "quoted",
    created_at: fields.created_at ?? 1,
    id: fields.id,
    kind: 1,
    pubkey: fields.pubkey ?? "author",
    tags: fields.tags ?? [["e", "orig", "", "mention"]],
  };
}

function asEvents(events: unknown[]): NotificationEvent[] {
  return events as NotificationEvent[];
}

function loggedAt(index: number): { error: Error; fields: LogFields } {
  const call = logger.logError.mock.calls[index];
  if (!call) throw new Error(`missing log ${index}`);
  return { error: call[0], fields: call[1] };
}

function logFor(pubkey: string): { error: Error; fields: LogFields } {
  const call = logger.logError.mock.calls.find(
    (item) => item[1].pubkey === pubkey
  );
  if (!call) throw new Error(`missing log for ${pubkey}`);
  return { error: call[0], fields: call[1] };
}

function profileEvent(content: unknown, kind = 0): unknown[] {
  return ["EVENT", "sub", { content, kind }];
}

describe("processQuoteReposts", () => {
  beforeEach(() => {
    connect.mockReset();
    logger.logError.mockReset();
    useConnect(() => []);
  });

  it("returns an empty list without calling the cache", async () => {
    await expect(processQuoteReposts([], connect)).resolves.toEqual([]);
    expect(connect).not.toHaveBeenCalled();
  });

  it("drops rows without a mention id after fetching profiles once per pubkey", async () => {
    const events = [
      quote({
        id: "blank",
        pubkey: "pk",
        tags: [["e", "", "", "mention"]],
      }),
      quote({
        id: "marker",
        pubkey: "pk",
        tags: [
          ["e", "orig", "", "Mention"],
          ["p", "someone"],
        ],
      }),
      quote({ id: "none", pubkey: "pk", tags: [["e", "orig"]] }),
      quote({ id: "empty", pubkey: "pk", tags: [] }),
    ];
    await expect(processQuoteReposts(events, connect)).resolves.toEqual([]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith("user_profile", { pubkey: "pk" });
  });

  it("builds sorted quotes with profiles and stats", async () => {
    useConnect((requestType, params) => {
      if (requestType === "user_profile") {
        const pubkey = param(params, "pubkey");
        if (pubkey === "pk-ada") {
          return [
            "skip",
            ["EOSE", "sub"],
            ["EVENT", "sub", ["nope"]],
            profileEvent("{}", 1),
            ["EVENT", "sub", { content: "{}" }],
            profileEvent(
              JSON.stringify({
                display_name: "",
                name: "Ada",
                nip05: "ada@example.com",
                picture: "https://cdn.example/a.png",
              })
            ),
          ];
        }
        return [
          profileEvent(JSON.stringify({ name: "Bea" })),
          profileEvent(JSON.stringify({ display_name: "Ignored" })),
        ];
      }
      const eventId = param(params, "event_id");
      if (eventId === "q-new") {
        return [
          ["EVENT", "sub", { content: "nope", kind: 10000100 }],
          [
            "EVENT",
            "sub",
            {
              content: JSON.stringify({
                likes: 4,
                mentions: 2,
                ref: "q-new",
                replies: 1,
                reposts: 3,
                satszapped: 9,
                zaps: 8,
              }),
              kind: 10000100,
            },
          ],
        ];
      }
      if (eventId === "q-partial") {
        return [
          [
            "EVENT",
            "sub",
            {
              content: JSON.stringify({ ref: "q-partial", zaps: 2 }),
              kind: 10000100,
            },
          ],
        ];
      }
      return [];
    });

    const result = await processQuoteReposts(
      [
        quote({
          content: "older",
          created_at: 10,
          id: "q-old",
          pubkey: "pk-bea",
        }),
        quote({
          content: "newer",
          created_at: 40,
          id: "q-new",
          pubkey: "pk-ada",
          tags: [
            ["e", "else"],
            ["e", "orig-1", "", "mention"],
          ],
        }),
        quote({
          content: "partial",
          created_at: 20,
          id: "q-partial",
          pubkey: "pk-ada",
        }),
      ],
      connect
    );

    expect(result.map((item) => item.id)).toEqual([
      "q-new",
      "q-partial",
      "q-old",
    ]);
    expect(result[0]).toEqual({
      authorName: "",
      authorNip05: "ada@example.com",
      authorPicture: "https://cdn.example/a.png",
      content: "newer",
      createdAt: 40,
      eventId: "q-new",
      id: "q-new",
      originalEventId: "orig-1",
      pubkey: "pk-ada",
      stats: {
        likes: 4,
        mentions: 2,
        replies: 1,
        reposts: 3,
        satszapped: 9,
        zaps: 8,
      },
      type: "quote",
    });
    expect(result[1]?.stats).toEqual({
      likes: 0,
      mentions: 0,
      replies: 0,
      reposts: 0,
      satszapped: 0,
      zaps: 2,
    });
    expect(result[2]).toMatchObject({
      authorName: "Bea",
      originalEventId: "orig",
      stats: {
        likes: 0,
        mentions: 0,
        replies: 0,
        reposts: 0,
        satszapped: 0,
        zaps: 0,
      },
    });
    const profileCalls = connect.mock.calls.filter(
      (call) => call[0] === "user_profile"
    );
    expect(profileCalls).toEqual([
      ["user_profile", { pubkey: "pk-bea" }],
      ["user_profile", { pubkey: "pk-ada" }],
    ]);
    expect(
      connect.mock.calls.filter((call) => call[0] === "thread_view")
    ).toHaveLength(3);
  });

  it("logs profile fetch failures and still returns other quotes", async () => {
    const profileError = new Error("profile down");
    useConnect((requestType, params) => {
      if (requestType !== "user_profile") return [];
      const pubkey = param(params, "pubkey");
      if (pubkey === "pk-error") raise(profileError);
      if (pubkey === "pk-string") raise("profile down");
      if (pubkey === "pk-null") return [["EVENT", "sub", null]];
      if (pubkey === "pk-json") return [profileEvent("{")];
      if (pubkey === "pk-number") return [profileEvent(5)];
      if (pubkey === "pk-empty") return [profileEvent(undefined)];
      if (pubkey === "pk-odd") {
        const payload: unknown = { not: "array" };
        return payload;
      }
      return [profileEvent(JSON.stringify({ name: "Ok" }))];
    });

    const result = await processQuoteReposts(
      [
        quote({ id: "ok", pubkey: "pk-ok" }),
        quote({ id: "err", pubkey: "pk-error" }),
        quote({ id: "str", pubkey: "pk-string" }),
        quote({ id: "nil", pubkey: "pk-null" }),
        quote({ id: "json", pubkey: "pk-json" }),
        quote({ id: "num", pubkey: "pk-number" }),
        quote({ id: "empty", pubkey: "pk-empty" }),
        quote({ id: "odd", pubkey: "pk-odd" }),
      ],
      connect
    );

    expect(result.find((item) => item.id === "ok")?.authorName).toBe("Ok");
    expect(
      result.find((item) => item.id === "err")?.authorName
    ).toBeUndefined();
    expect(logFor("pk-error").error).toBe(profileError);
    expect(logFor("pk-error").fields).toEqual({
      message: "Failed to fetch profile",
      pubkey: "pk-error",
    });
    expect(logFor("pk-string").error.message).toBe("profile down");
    expect(logFor("pk-string").fields).toEqual({
      message: "Failed to fetch profile",
      pubkey: "pk-string",
    });
    expect(logFor("pk-null").error).toBeInstanceOf(TypeError);
    expect(logFor("pk-json").error).toBeInstanceOf(SyntaxError);
    expect(logFor("pk-odd").error).toBeInstanceOf(TypeError);
    expect(logger.logError).toHaveBeenCalledTimes(5);
  });

  it("logs a profile batch failure when logging the inner error throws", async () => {
    useConnect((requestType) => {
      if (requestType === "user_profile") raise(new Error("profile down"));
      return [
        [
          "EVENT",
          "sub",
          {
            content: JSON.stringify({ likes: 1, ref: "q1" }),
            kind: 10000100,
          },
        ],
      ];
    });
    logger.logError.mockImplementationOnce(() => {
      raise(new Error("logger failed"));
    });

    const result = await processQuoteReposts(
      [quote({ id: "q1", pubkey: "pk" })],
      connect
    );
    expect(result[0]).toMatchObject({
      authorName: undefined,
      id: "q1",
      stats: { likes: 1, replies: 0 },
    });
    expect(loggedAt(1).error.message).toBe("logger failed");
    expect(loggedAt(1).fields).toEqual({
      message: "Error fetching user profiles",
    });

    logger.logError.mockReset();
    logger.logError.mockImplementationOnce(() => {
      raise("logger failed");
    });
    await processQuoteReposts([quote({ id: "q1", pubkey: "pk" })], connect);
    const outer = logger.logError.mock.calls[1];
    if (!outer) throw new Error("missing outer log");
    expect(outer[0].message).toBe("logger failed");
    expect(outer[1]).toEqual({ message: "Error fetching user profiles" });
  });

  it("keeps default stats when thread view fails or has no usable stats", async () => {
    useConnect((requestType, params) => {
      if (requestType === "user_profile") return [];
      const eventId = param(params, "event_id");
      if (eventId === "q-error") raise(new Error("thread down"));
      if (eventId === "q-string") raise("thread down");
      if (eventId === "q-odd") {
        const payload: unknown = { not: "array" };
        return payload;
      }
      if (eventId === "q-json") {
        return [["EVENT", "sub", { content: "q-json {", kind: 10000100 }]];
      }
      if (eventId === "q-kind") {
        return [["EVENT", "sub", { content: "q-kind", kind: 1 }]];
      }
      if (eventId === "q-num") {
        return [["EVENT", "sub", { content: 5, kind: 10000100 }]];
      }
      return [["EVENT", "sub", { content: "", kind: 10000100 }]];
    });

    const result = await processQuoteReposts(
      [
        quote({ created_at: 2, id: "q-error" }),
        quote({ created_at: 3, id: "q-string" }),
        quote({ created_at: 4, id: "q-odd" }),
        quote({ created_at: 5, id: "q-json" }),
        quote({ created_at: 6, id: "q-kind" }),
        quote({ created_at: 7, id: "q-num" }),
        quote({ created_at: 8, id: "q-empty" }),
      ],
      connect
    );
    expect(result).toHaveLength(7);
    for (const item of result) {
      expect(item.stats).toEqual({
        likes: 0,
        mentions: 0,
        replies: 0,
        reposts: 0,
        satszapped: 0,
        zaps: 0,
      });
    }
    expect(logger.logError).not.toHaveBeenCalled();
  });

  it("logs quote processing failures and filters them out", async () => {
    const error = new Error("bad tags");
    const brokenError: NotificationEvent = quote({ id: "bad-error" });
    Object.defineProperty(brokenError, "tags", {
      get() {
        return raise(error);
      },
    });
    const brokenString: NotificationEvent = quote({ id: "bad-string" });
    Object.defineProperty(brokenString, "tags", {
      get() {
        return raise("bad tags");
      },
    });
    const missingTags = asEvents([
      {
        content: "x",
        created_at: 1,
        id: "bad-missing",
        kind: 1,
        pubkey: "author",
      },
    ]);

    const fromError = await processQuoteReposts(
      [brokenError, quote({ created_at: 9, id: "kept" })],
      connect
    );
    expect(fromError.map((item) => item.id)).toEqual(["kept"]);
    expect(loggedAt(0).error).toBe(error);
    expect(loggedAt(0).fields).toEqual({
      eventId: "bad-error",
      message: "Error processing quote repost",
    });

    logger.logError.mockClear();
    await expect(processQuoteReposts([brokenString], connect)).resolves.toEqual(
      []
    );
    expect(loggedAt(0).error.message).toBe("bad tags");
    expect(loggedAt(0).fields.eventId).toBe("bad-string");

    logger.logError.mockClear();
    await expect(processQuoteReposts(missingTags, connect)).resolves.toEqual(
      []
    );
    expect(loggedAt(0).error).toBeInstanceOf(Error);
    expect(loggedAt(0).fields).toEqual({
      eventId: "bad-missing",
      message: "Error processing quote repost",
    });
  });
});
