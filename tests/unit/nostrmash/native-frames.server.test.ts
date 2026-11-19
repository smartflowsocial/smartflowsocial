import { beforeEach, describe, expect, it, vi } from "vitest";

interface ReadInit {
  body?: string;
  method?: string;
}

interface ReadResult {
  body: unknown;
  status: number;
}

const api = vi.hoisted(() => ({
  nostrmashRead:
    vi.fn<(path: string, init?: ReadInit) => Promise<ReadResult | null>>(),
}));

vi.mock("~/features/nostrmash/api.server", () => api);

import { tryNativePrimalFrames } from "~/features/nostrmash/native-frames.server";

const PUBKEY = "a".repeat(64);
const EVENT_ID = "b".repeat(64);
const OTHER_ID = "c".repeat(64);
const CHILD_ID = "d".repeat(64);
const EXTRA_ID = "e".repeat(64);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function counts(zapCount = 0): Record<string, number> {
  return {
    reaction_count: 1,
    reply_count: 2,
    repost_count: 3,
    zap_count: zapCount,
    zap_msats: 4000,
  };
}

function eventByKind(
  messages: unknown,
  kind: number
): Record<string, unknown> | null {
  if (!isUnknownArray(messages)) return null;
  for (const message of messages) {
    if (!isUnknownArray(message) || message[0] !== "EVENT") continue;
    const event = message[2];
    if (!isRecord(event) || event["kind"] !== kind) continue;
    return event;
  }
  return null;
}

function contentOf(event: Record<string, unknown> | null): unknown {
  const content = event?.["content"];
  if (typeof content !== "string") return content;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content;
  }
}

function readCall(fragment: string): { init?: ReadInit; path: string } {
  const call = api.nostrmashRead.mock.calls.find((item) =>
    item[0].includes(fragment)
  );
  if (!call) throw new Error(`missing read ${fragment}`);
  return { path: call[0], init: call[1] };
}

describe("native primal frame branches", () => {
  beforeEach(() => {
    api.nostrmashRead.mockReset();
  });

  it("returns null for unknown requests and missing profile inputs", async () => {
    expect(
      await tryNativePrimalFrames("notifications", { pubkey: PUBKEY })
    ).toBeNull();
    expect(api.nostrmashRead).not.toHaveBeenCalled();
    expect(await tryNativePrimalFrames("user_profile", undefined)).toBeNull();
    expect(
      await tryNativePrimalFrames("user_profile", { pubkey: "short" })
    ).toBeNull();
    expect(
      await tryNativePrimalFrames("user_infos", { pubkeys: [] })
    ).toBeNull();
    expect(
      await tryNativePrimalFrames("user_infos", { pubkeys: "nope" })
    ).toBeNull();
    expect(await tryNativePrimalFrames("events", { event_ids: [] })).toBeNull();
    expect(
      await tryNativePrimalFrames("thread_view", { event_id: "nope" })
    ).toBeNull();
  });

  it("builds a profile from string, object, and displayName metadata", async () => {
    api.nostrmashRead.mockResolvedValue({
      status: 200,
      body: {
        metadata_event_id: "f".repeat(64),
        metadata_created_at: 12,
        profile: { name: "ada", displayName: "Ada", tags: ["skip"] },
        stats: { follower_count: 0, following_count: 0 },
      },
    });
    const messages = await tryNativePrimalFrames("user_profile", {
      pubkey: `  ${PUBKEY.toUpperCase()}  `,
    });
    const profile = eventByKind(messages, 0);
    expect(profile?.["id"]).toBe("f".repeat(64));
    expect(profile?.["pubkey"]).toBe(PUBKEY.toUpperCase());
    expect(profile?.["created_at"]).toBe(12);
    expect(profile?.["synthetic"]).toBe(true);
    expect(profile?.["sig"]).toBe("");
    expect(contentOf(profile)).toEqual({
      name: "ada",
      display_name: "Ada",
    });
    expect(contentOf(eventByKind(messages, 10000105))).toMatchObject({
      followers_count: 0,
      follows_count: 0,
    });
    expect(isUnknownArray(messages) ? messages.at(-1) : null).toEqual([
      "EOSE",
      expect.stringMatching(/^nm[0-9a-f]{8}$/u),
    ]);
    expect(readCall("/summary").path).toContain(
      encodeURIComponent(PUBKEY.toUpperCase())
    );
  });

  it("keeps a profile when metadata ids are the wrong type", async () => {
    api.nostrmashRead.mockResolvedValue({
      status: 200,
      body: {
        metadata_event_id: 5,
        metadata_created_at: "12",
        profile: '  {"name":"ada"}  ',
        stats: null,
      },
    });
    const messages = await tryNativePrimalFrames("user_profile", {
      pubkey: PUBKEY,
    });
    const profile = eventByKind(messages, 0);
    expect(profile?.["id"]).toBe("");
    expect(profile?.["created_at"]).toBe(0);
    expect(profile?.["content"]).toBe('{"name":"ada"}');
    expect(eventByKind(messages, 10000105)).toBeNull();
  });

  it("treats each positive stat as a profile and rejects empty stats", async () => {
    const fields = [
      "follower_count",
      "following_count",
      "note_count",
      "reply_count",
      "zap_received_count",
      "sats_zapped",
      "media_count",
      "long_form_note_count",
    ];
    for (const field of fields) {
      api.nostrmashRead.mockResolvedValueOnce({
        status: 200,
        body: { profile: null, stats: { [field]: 1 } },
      });
      const messages = await tryNativePrimalFrames("user_profile", {
        pubkey: PUBKEY,
      });
      expect(eventByKind(messages, 0)).toBeNull();
      expect(eventByKind(messages, 10000105)).not.toBeNull();
    }

    api.nostrmashRead.mockResolvedValue({
      status: 200,
      body: {
        profile: "null",
        stats: { follower_count: 0, media_count: 0 },
      },
    });
    expect(
      await tryNativePrimalFrames("user_profile", { pubkey: PUBKEY })
    ).toBeNull();

    for (const body of [null, [], "text"]) {
      api.nostrmashRead.mockResolvedValueOnce({ status: 200, body });
      expect(
        await tryNativePrimalFrames("user_profile", { pubkey: PUBKEY })
      ).toBeNull();
    }
    api.nostrmashRead.mockResolvedValueOnce(null);
    expect(
      await tryNativePrimalFrames("user_profile", { pubkey: PUBKEY })
    ).toBeNull();
    api.nostrmashRead.mockResolvedValueOnce({ status: 404, body: {} });
    expect(
      await tryNativePrimalFrames("user_profile", { pubkey: PUBKEY })
    ).toBeNull();
  });

  it("keeps requested pubkey casing and skips bad profile rows", async () => {
    const first = "A".repeat(64);
    const second = "B".repeat(64);
    const pubkeys = [first, first.toLowerCase(), "zz", second];
    api.nostrmashRead.mockResolvedValue({
      status: 200,
      body: {
        profiles: [
          null,
          { pubkey: "nope", profile: { name: "skip" } },
          {
            pubkey: first.toLowerCase(),
            profile: { name: "ada" },
            metadata_event_id: "f".repeat(64),
            metadata_created_at: 3,
          },
          { pubkey: second.toLowerCase(), profile: {} },
          { pubkey: second.toLowerCase(), profile: "{}" },
        ],
      },
    });
    const messages = await tryNativePrimalFrames("user_infos", { pubkeys });
    expect(eventByKind(messages, 0)?.["pubkey"]).toBe(first);
    expect(
      isUnknownArray(messages)
        ? messages.filter(
            (message) => isUnknownArray(message) && message[0] === "EVENT"
          )
        : []
    ).toHaveLength(1);
    const init = readCall("/profiles/batch").init;
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body ?? "null") as unknown).toEqual({
      pubkeys: [first, second],
    });
  });

  it("caps profile batches at 100 and rejects bad batch responses", async () => {
    const pubkeys = Array.from({ length: 101 }, (_item, index) =>
      index.toString(16).padStart(64, "b")
    );
    api.nostrmashRead.mockResolvedValue({
      status: 200,
      body: { profiles: [] },
    });
    expect(await tryNativePrimalFrames("user_infos", { pubkeys })).toBeNull();
    const sent = JSON.parse(
      readCall("/profiles/batch").init?.body ?? "null"
    ) as {
      pubkeys?: string[];
    };
    expect(sent.pubkeys).toHaveLength(100);

    api.nostrmashRead.mockResolvedValueOnce({ status: 500, body: {} });
    expect(
      await tryNativePrimalFrames("user_infos", { pubkeys: [PUBKEY] })
    ).toBeNull();
    api.nostrmashRead.mockResolvedValueOnce(null);
    expect(
      await tryNativePrimalFrames("user_infos", { pubkeys: [PUBKEY] })
    ).toBeNull();
    api.nostrmashRead.mockResolvedValueOnce({
      status: 200,
      body: { profiles: "nope" },
    });
    expect(
      await tryNativePrimalFrames("user_infos", { pubkeys: [PUBKEY] })
    ).toBeNull();
  });

  it("returns event frames and drops rows that are not events", async () => {
    const upper = EVENT_ID.toUpperCase();
    api.nostrmashRead.mockResolvedValue({
      status: 200,
      body: {
        events: [
          { id: EVENT_ID, kind: 1, content: "note" },
          JSON.stringify({ id: OTHER_ID, content: "text" }),
          "{",
          { kind: 1, content: { text: "obj" } },
          { nope: true },
          null,
        ],
      },
    });
    const messages = await tryNativePrimalFrames("events", {
      event_ids: [upper, EVENT_ID, "bad", 4],
    });
    expect(
      isUnknownArray(messages)
        ? messages.filter((item) => isUnknownArray(item) && item[0] === "EVENT")
        : []
    ).toHaveLength(3);
    expect(eventByKind(messages, 1)?.["content"]).toBe("note");
    const sent = JSON.parse(readCall("/events/batch").init?.body ?? "null") as {
      ids?: string[];
    };
    expect(sent.ids).toEqual([EVENT_ID]);

    api.nostrmashRead.mockResolvedValueOnce({ status: 200, body: {} });
    expect(
      await tryNativePrimalFrames("events", { event_ids: [EVENT_ID] })
    ).toBeNull();
    api.nostrmashRead.mockResolvedValueOnce({
      status: 200,
      body: { events: [null] },
    });
    expect(
      await tryNativePrimalFrames("events", { event_ids: [EVENT_ID] })
    ).toBeNull();
    api.nostrmashRead.mockResolvedValueOnce({ status: 503, body: {} });
    expect(
      await tryNativePrimalFrames("events", { event_ids: [EVENT_ID] })
    ).toBeNull();
    api.nostrmashRead.mockResolvedValueOnce(null);
    expect(
      await tryNativePrimalFrames("events", { event_ids: [EVENT_ID] })
    ).toBeNull();
  });

  it("stops thread reads that are missing, zapped, or not indexed", async () => {
    api.nostrmashRead.mockResolvedValue(null);
    expect(
      await tryNativePrimalFrames("thread_view", { event_id: EVENT_ID })
    ).toBeNull();
    expect(api.nostrmashRead).toHaveBeenCalledTimes(2);

    api.nostrmashRead.mockReset();
    api.nostrmashRead.mockImplementation(async (path: string) => {
      if (path.endsWith("/counts")) return { status: 200, body: counts(2) };
      return {
        status: 200,
        body: { event: { id: EVENT_ID, kind: 1, content: "zapped" } },
      };
    });
    expect(
      await tryNativePrimalFrames("thread_view", {
        event_id: EVENT_ID,
        limit: 40,
      })
    ).toBeNull();
    expect(
      api.nostrmashRead.mock.calls.some((call) => call[0].includes("/threads/"))
    ).toBe(false);

    api.nostrmashRead.mockReset();
    api.nostrmashRead.mockImplementation(async (path: string) => {
      if (path.endsWith("/counts")) return { status: 500, body: counts(0) };
      return { status: 404, body: { error: { code: "not_found" } } };
    });
    expect(
      await tryNativePrimalFrames("thread_view", { event_id: EVENT_ID })
    ).toBeNull();

    api.nostrmashRead.mockReset();
    api.nostrmashRead.mockImplementation(async (path: string) => {
      if (path.endsWith("/counts"))
        return { status: 200, body: { reaction_count: 1 } };
      return {
        status: 200,
        body: { event: { id: EVENT_ID, kind: 1 } },
      };
    });
    expect(
      await tryNativePrimalFrames("thread_view", { event_id: EVENT_ID })
    ).toBeNull();
  });

  it("bounds thread limits and returns null when the focal note is absent", async () => {
    const limits: Array<{ expected: number; limit: unknown }> = [
      { limit: undefined, expected: 100 },
      { limit: 0, expected: 100 },
      { limit: -4, expected: 100 },
      { limit: Number.NaN, expected: 100 },
      { limit: 1.9, expected: 1 },
      { limit: 40, expected: 40 },
      { limit: 250, expected: 100 },
    ];
    for (const entry of limits) {
      api.nostrmashRead.mockReset();
      api.nostrmashRead.mockImplementation(async (path: string) => {
        if (path.includes("/threads/")) return { status: 404, body: {} };
        if (path.endsWith("/counts")) return { status: 200, body: counts(0) };
        return { status: 200, body: { event: { id: EVENT_ID, kind: 1 } } };
      });
      expect(
        await tryNativePrimalFrames("thread_view", {
          event_id: EVENT_ID,
          limit: entry.limit,
        })
      ).toBeNull();
      const thread = readCall("/threads/");
      expect(thread.path).toContain(`limit=${entry.expected}`);
      expect(thread.path).toContain(`max_depth=${entry.expected}`);
    }

    api.nostrmashRead.mockReset();
    api.nostrmashRead.mockImplementation(async (path: string) => {
      if (path.includes("/threads/")) {
        return { status: 200, body: { event: { id: OTHER_ID, kind: 1 } } };
      }
      if (path.endsWith("/counts")) return { status: 200, body: counts(0) };
      return { status: 200, body: { event: { id: EVENT_ID, kind: 1 } } };
    });
    expect(
      await tryNativePrimalFrames("thread_view", { event_id: EVENT_ID })
    ).toBeNull();

    api.nostrmashRead.mockReset();
    api.nostrmashRead.mockImplementation(async (path: string) => {
      if (path.includes("/threads/")) return { status: 200, body: null };
      if (path.endsWith("/counts")) return { status: 200, body: counts(0) };
      return { status: 200, body: { event: { id: EVENT_ID, kind: 1 } } };
    });
    expect(
      await tryNativePrimalFrames("thread_view", { event_id: EVENT_ID })
    ).toBeNull();
  });

  it("assembles thread notes, profiles, and note stats", async () => {
    api.nostrmashRead.mockImplementation(async (path: string) => {
      if (path.includes("/threads/")) {
        return {
          status: 200,
          body: {
            event: {
              id: EVENT_ID,
              kind: 1,
              pubkey: PUBKEY,
              content: "root",
            },
            ancestors: [
              { id: OTHER_ID, kind: 1, pubkey: PUBKEY, content: "parent" },
              { id: EVENT_ID, kind: 1, pubkey: PUBKEY, content: "dup" },
              "nope",
            ],
            replies: [
              JSON.stringify({
                id: CHILD_ID,
                kind: 1,
                pubkey: PUBKEY,
                content: "child",
              }),
              "{",
              { kind: 1, content: "kind-only" },
              { id: EXTRA_ID },
            ],
          },
        };
      }
      if (path.includes("/profiles/batch")) {
        return {
          status: 200,
          body: {
            profiles: [
              null,
              { pubkey: "bad" },
              {
                pubkey: PUBKEY,
                profile: { name: "ada" },
                metadata_created_at: 8,
              },
            ],
          },
        };
      }
      if (path.endsWith(`/${OTHER_ID}/counts`)) {
        return { status: 200, body: counts(0) };
      }
      if (path.endsWith(`/${CHILD_ID}/counts`)) {
        return { status: 404, body: {} };
      }
      if (path.endsWith(`/${EXTRA_ID}/counts`)) {
        return { status: 200, body: { zap_count: 0 } };
      }
      if (path.endsWith("/counts")) return { status: 200, body: counts(0) };
      return { status: 200, body: { event: { id: EVENT_ID, kind: 1 } } };
    });

    const messages = await tryNativePrimalFrames("thread_view", {
      event_id: EVENT_ID,
      limit: 40,
    });
    expect(eventByKind(messages, 0)?.["pubkey"]).toBe(PUBKEY);
    const stats = contentOf(eventByKind(messages, 10000100));
    expect(stats).toMatchObject({
      event_id: EVENT_ID,
      likes: 1,
      replies: 2,
      reposts: 3,
      zaps: 0,
      satszapped: 4,
    });
    const statEvents = isUnknownArray(messages)
      ? messages.filter(
          (message) =>
            isUnknownArray(message) &&
            isRecord(message[2]) &&
            message[2]["kind"] === 10000100
        )
      : [];
    expect(statEvents).toHaveLength(2);
    expect(isUnknownArray(messages) ? messages.at(-1) : null).toEqual([
      "EOSE",
      expect.stringMatching(/^nm/u),
    ]);
  });

  it("skips profiles when the batch fails or notes have no pubkeys", async () => {
    api.nostrmashRead.mockImplementation(async (path: string) => {
      if (path.includes("/threads/")) {
        return {
          status: 200,
          body: {
            event: { id: EVENT_ID, kind: 1, content: "root" },
            ancestors: "nope",
            replies: null,
          },
        };
      }
      if (path.endsWith("/counts")) return { status: 200, body: counts(0) };
      return { status: 200, body: { event: { id: EVENT_ID, kind: 1 } } };
    });
    const withoutPubkey = await tryNativePrimalFrames("thread_view", {
      event_id: EVENT_ID,
    });
    expect(eventByKind(withoutPubkey, 0)).toBeNull();
    expect(
      api.nostrmashRead.mock.calls.some((call) =>
        call[0].includes("/profiles/batch")
      )
    ).toBe(false);

    api.nostrmashRead.mockImplementation(async (path: string) => {
      if (path.includes("/threads/")) {
        return {
          status: 200,
          body: {
            event: { id: EVENT_ID, kind: 1, pubkey: PUBKEY, content: "root" },
          },
        };
      }
      if (path.includes("/profiles/batch")) return { status: 500, body: {} };
      if (path.endsWith("/counts")) return { status: 200, body: counts(0) };
      return { status: 200, body: { event: { id: EVENT_ID, kind: 1 } } };
    });
    const failedProfiles = await tryNativePrimalFrames("thread_view", {
      event_id: EVENT_ID,
    });
    expect(eventByKind(failedProfiles, 0)).toBeNull();
    expect(eventByKind(failedProfiles, 1)?.["content"]).toBe("root");
  });
});
