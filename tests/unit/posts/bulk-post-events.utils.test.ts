/**
 * Unit tests for bulk-post-events.utils (Phase 1.1): getFileUrlFromFetcher,
 * buildContent, convertTagsToArray, convertScheduledTime, parseOriginalFileUrl,
 * getFileUrlArray, createFakeFileUrlData, getUserTimezone, getDisplayFileUrl,
 * buildUploadFormData, showValidationErrorToast.
 */

interface NostrToolsModule {
  nip19: {
    decode: (value: string) => unknown;
  };
}

const clientErrors = vi.hoisted(() => ({
  logClientError: vi.fn(),
}));
const nip19Mock = vi.hoisted(() => ({
  failMode: "",
}));

vi.mock("~/lib/error-handler.client", () => ({
  logClientError: clientErrors.logClientError,
}));
vi.mock("nostr-tools", async () => {
  const actual = await vi.importActual<NostrToolsModule>("nostr-tools");
  return {
    ...actual,
    nip19: {
      ...actual.nip19,
      decode: (value: string) => {
        if (nip19Mock.failMode === "string") throw "bad naddr";
        if (nip19Mock.failMode === "error") throw new Error("bad naddr");
        return actual.nip19.decode(value);
      },
    },
  };
});

import { nip19 } from "nostr-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BulkPost } from "~/features/posts/types";
import {
  buildContent,
  buildUploadFormData,
  convertScheduledTime,
  convertTagsToArray,
  createFakeFileUrlData,
  createKind6RepostEvent,
  createLongformQuoteEvent,
  createQuotePostEvent,
  createRegularQuoteEvent,
  getDisplayFileUrl,
  getFileUrlArray,
  getFileUrlFromFetcher,
  getUserTimezone,
  parseOriginalFileUrl,
  showValidationErrorToast,
} from "~/features/posts/utils/bulk-post-events.utils";

const minimalBulkPost = (overrides: Partial<BulkPost> = {}): BulkPost => ({
  clientId: "c1",
  files: [],
  caption: "",
  queueType: "",
  scheduledFor: "",
  isRecyclable: false,
  ...overrides,
});

function isBulkPost(value: object): value is BulkPost {
  return "clientId" in value;
}

describe("bulk-post-events.utils", () => {
  describe("getFileUrlFromFetcher", () => {
    it("returns empty fileUrl and scheduledFor for null or non-object", () => {
      expect(getFileUrlFromFetcher(null, 0)).toEqual({
        fileUrl: [],
        scheduledFor: "",
      });
      expect(getFileUrlFromFetcher(undefined, 0)).toEqual({
        fileUrl: [],
        scheduledFor: "",
      });
      expect(getFileUrlFromFetcher("string", 0)).toEqual({
        fileUrl: [],
        scheduledFor: "",
      });
    });

    it("returns fileUrl array and scheduledFor from fileUrls item", () => {
      const data = {
        fileUrls: [
          { fileUrl: ["https://a.com"], scheduledFor: "2024-06-01T12:00" },
          { fileUrl: "https://b.com", scheduledFor: "2024-06-02T14:00" },
        ],
      };
      expect(getFileUrlFromFetcher(data, 0)).toEqual({
        fileUrl: ["https://a.com"],
        scheduledFor: "2024-06-01T12:00",
      });
      expect(getFileUrlFromFetcher(data, 1)).toEqual({
        fileUrl: ["https://b.com"],
        scheduledFor: "2024-06-02T14:00",
      });
    });

    it("filters non-string entries from fileUrl array", () => {
      const data = {
        fileUrls: [
          {
            fileUrl: ["https://a.com", 123, null, "https://b.com"],
            scheduledFor: "",
          },
        ],
      };
      expect(getFileUrlFromFetcher(data, 0).fileUrl).toEqual([
        "https://a.com",
        "https://b.com",
      ]);
    });

    it("returns empty for out-of-range index", () => {
      const data = { fileUrls: [{ fileUrl: [], scheduledFor: "" }] };
      expect(getFileUrlFromFetcher(data, 5)).toEqual({
        fileUrl: [],
        scheduledFor: "",
      });
    });
  });

  describe("buildContent", () => {
    it("joins media, caption, and tags when includeHashtagsInNoteBody is true", () => {
      const out = buildContent(
        ["https://img.com"],
        "My caption",
        "#tag1 #tag2",
        true
      );
      expect(out).toContain("https://img.com");
      expect(out).toContain("My caption");
      expect(out).toContain("#tag1 #tag2");
    });

    it("omits tags when includeHashtagsInNoteBody is false", () => {
      const out = buildContent([], "Caption", "#tag", false);
      expect(out).toBe("Caption");
      expect(out).not.toContain("#tag");
    });

    it("joins only non-empty parts", () => {
      expect(buildContent([], "", "", false)).toBe("");
      expect(buildContent(["u1", "u2"], "cap", "", false)).toBe("u1\nu2\ncap");
    });
  });

  describe("convertTagsToArray", () => {
    it("returns empty for undefined or empty string", () => {
      expect(convertTagsToArray(undefined)).toEqual([]);
      expect(convertTagsToArray("")).toEqual([]);
    });

    it("splits by space and maps to [t, tag] without leading #", () => {
      expect(convertTagsToArray("#foo #bar")).toEqual([
        ["t", "foo"],
        ["t", "bar"],
      ]);
      expect(convertTagsToArray("foo bar")).toEqual([
        ["t", "foo"],
        ["t", "bar"],
      ]);
    });

    it("filters empty tags", () => {
      expect(convertTagsToArray("  #a   #b  ")).toEqual([
        ["t", "a"],
        ["t", "b"],
      ]);
    });
  });

  describe("convertScheduledTime", () => {
    it("parses datetime-local and returns ms", () => {
      const ms = convertScheduledTime("2024-06-15T14:30", "UTC");
      expect(typeof ms).toBe("number");
      expect(ms).toBeGreaterThan(0);
      const date = new Date(ms);
      expect(date.getUTCFullYear()).toBe(2024);
      expect(date.getUTCMonth()).toBe(5);
      expect(date.getUTCDate()).toBe(15);
      expect(date.getUTCHours()).toBe(14);
      expect(date.getUTCMinutes()).toBe(30);
    });

    it("handles ISO-like string in fallback (no trailing Z)", () => {
      const ms = convertScheduledTime("2024-06-15T14:30:00.000", "UTC");
      expect(typeof ms).toBe("number");
      expect(ms).toBeGreaterThan(0);
    });
  });

  describe("parseOriginalFileUrl", () => {
    it("returns first element for array", () => {
      expect(parseOriginalFileUrl(["a", "b"])).toBe("a");
      expect(parseOriginalFileUrl([])).toBe("");
    });

    it("parses JSON array string and returns first", () => {
      expect(parseOriginalFileUrl('["url1","url2"]')).toBe("url1");
    });

    it("returns original string when not JSON array", () => {
      expect(parseOriginalFileUrl("https://single.com")).toBe(
        "https://single.com"
      );
    });

    it("returns original on parse error", () => {
      expect(parseOriginalFileUrl("[invalid")).toBe("[invalid");
    });
  });

  describe("getFileUrlArray", () => {
    it("returns fileUrl array when post has fileUrl array", () => {
      const post = minimalBulkPost({
        fileUrl: ["a", "b"],
        isKind6Repost: false,
      });
      expect(getFileUrlArray(post)).toEqual(["a", "b"]);
    });

    it("returns [url] when post has fileUrl string", () => {
      const post = minimalBulkPost({
        fileUrl: "https://x.com",
        isKind6Repost: false,
      });
      expect(getFileUrlArray(post)).toEqual(["https://x.com"]);
    });

    it("returns from originalFileUrl for isKind6Repost", () => {
      const post = minimalBulkPost({
        isKind6Repost: true,
        originalFileUrl: ["https://orig.com"],
      });
      expect(getFileUrlArray(post)).toEqual(["https://orig.com"]);
    });

    it("returns empty for missing fileUrl", () => {
      const post = minimalBulkPost({ isKind6Repost: false });
      expect(getFileUrlArray(post)).toEqual([]);
    });
  });

  describe("createFakeFileUrlData", () => {
    it("maps posts to fileUrl, scheduledFor, queueType, isRecyclable", () => {
      const post = minimalBulkPost({
        queueType: "Q1",
        scheduledFor: "2024-06-01T12:00",
        isRecyclable: true,
        fileUrl: ["u1"],
      });
      const posts: BulkPost[] = [post];
      const out = createFakeFileUrlData(posts);
      expect(out).toHaveLength(1);
      expect(out[0]).toEqual({
        fileUrl: ["u1"],
        scheduledFor: "2024-06-01T12:00",
        queueType: "Q1",
        isRecyclable: true,
      });
    });
  });

  describe("getUserTimezone", () => {
    it("returns user timezone when present", () => {
      /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- minimal user fixture for test */
      const user = { timezone: "America/New_York" } as Parameters<
        typeof getUserTimezone
      >[0];
      expect(getUserTimezone(user)).toBe("America/New_York");
    });

    it("returns UTC when user is null or missing timezone", () => {
      expect(getUserTimezone(null)).toBe("UTC");
      /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- minimal user fixture for test */
      const user = {} as Parameters<typeof getUserTimezone>[0];
      expect(getUserTimezone(user)).toBe("UTC");
    });
  });

  describe("getDisplayFileUrl", () => {
    it("returns empty when no originalFileUrl", () => {
      const post = minimalBulkPost({ originalFileUrl: undefined });
      expect(getDisplayFileUrl(post)).toBe("");
    });

    it("returns first from JSON array string", () => {
      const post = minimalBulkPost({
        originalFileUrl: '["https://first.com","second"]',
      });
      expect(getDisplayFileUrl(post)).toBe("https://first.com");
    });

    it("returns first from array", () => {
      const post = minimalBulkPost({ originalFileUrl: ["a", "b"] });
      expect(getDisplayFileUrl(post)).toBe("a");
    });

    it("returns string as-is when not array", () => {
      const post = minimalBulkPost({ originalFileUrl: "https://single.com" });
      expect(getDisplayFileUrl(post)).toBe("https://single.com");
    });
  });

  describe("buildUploadFormData", () => {
    it("appends fileUrls, scheduledDates, queueTypes, isRecyclable, _action", () => {
      const post = minimalBulkPost({
        queueType: "Main",
        scheduledFor: "2024-06-01T12:00",
        isRecyclable: false,
      });
      const posts: BulkPost[] = [post];
      const formData = buildUploadFormData(posts, [["url1"]]);
      expect(formData.get("fileUrls")).toBe(JSON.stringify([["url1"]]));
      expect(formData.get("scheduledDates")).toBe("2024-06-01T12:00");
      expect(formData.get("queueTypes")).toBe("Main");
      expect(formData.get("isRecyclable")).toBe("false");
      expect(formData.get("_action")).toBe("_upload_images_preview");
    });

    it("appends extraFormData when provided", () => {
      const post = minimalBulkPost({
        queueType: "Q",
        scheduledFor: "",
        isRecyclable: false,
      });
      const posts: BulkPost[] = [post];
      const formData = buildUploadFormData(posts, [[]], {
        customKey: "customValue",
      });
      expect(formData.get("customKey")).toBe("customValue");
    });
  });

  describe("showValidationErrorToast", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("calls setToast with error message for single error", () => {
      const setToast = vi.fn();
      showValidationErrorToast(["Invalid date"], setToast);
      expect(setToast).toHaveBeenCalledWith({
        type: "error",
        message: "Invalid date",
      });
    });

    it("calls setToast with combined message for multiple errors", () => {
      const setToast = vi.fn();
      showValidationErrorToast(["Error 1", "Error 2"], setToast);
      const twoIssuesMessage = expect.stringContaining("2 issues") as unknown;
      const error1Message = expect.stringContaining("Error 1") as unknown;
      expect(setToast).toHaveBeenCalledWith({
        type: "error",
        message: twoIssuesMessage,
      });
      expect(setToast).toHaveBeenCalledWith({
        type: "error",
        message: error1Message,
      });
    });

    it("schedules setToast(null) after 5s", () => {
      const setToast = vi.fn();
      showValidationErrorToast(["x"], setToast);
      setToast.mockClear();
      vi.advanceTimersByTime(5000);
      expect(setToast).toHaveBeenCalledWith(null);
    });

    it("formats zero, three, and more than three errors", () => {
      const setToast = vi.fn();
      showValidationErrorToast([], setToast);
      expect(setToast).toHaveBeenCalledWith({
        type: "error",
        message: "0 issues found:\n• ",
      });
      const missing: string[] = [];
      missing.length = 1;
      showValidationErrorToast(missing, setToast);
      expect(setToast).toHaveBeenCalledWith({
        type: "error",
        message: "Validation error",
      });
      showValidationErrorToast(["a", "b", "c"], setToast);
      expect(setToast).toHaveBeenLastCalledWith({
        type: "error",
        message: "3 issues found:\n• a\n• b\n• c",
      });
      showValidationErrorToast(["a", "b", "c", "d"], setToast);
      expect(setToast).toHaveBeenLastCalledWith({
        type: "error",
        message: "4 issues found:\n• a\n• b\n• c\n• And more...",
      });
    });
  });

  describe("event builders and remaining parsers", () => {
    const pubkey = "11".repeat(32);

    beforeEach(() => {
      nip19Mock.failMode = "";
      clientErrors.logClientError.mockClear();
    });

    it("reads every fetcher shape", () => {
      expect(getFileUrlFromFetcher([], 0)).toEqual({
        fileUrl: [],
        scheduledFor: "",
      });
      expect(getFileUrlFromFetcher({ fileUrls: "no" }, 0).fileUrl).toEqual([]);
      expect(getFileUrlFromFetcher({ fileUrls: [null, []] }, 0)).toEqual({
        fileUrl: [],
        scheduledFor: "",
      });
      expect(
        getFileUrlFromFetcher(
          { fileUrls: [{ fileUrl: "  ", scheduledFor: 5 }] },
          0
        )
      ).toEqual({ fileUrl: [], scheduledFor: "" });
      expect(
        getFileUrlFromFetcher(
          { fileUrls: [{ fileUrl: ["ok", 1, null, "two"] }] },
          0
        ).fileUrl
      ).toEqual(["ok", "two"]);
      expect(getFileUrlFromFetcher({ fileUrls: [{}] }, 0)).toEqual({
        fileUrl: [],
        scheduledFor: "",
      });
    });

    it("parses original urls and display urls that are not simple strings", () => {
      expect(parseOriginalFileUrl("[1,2]")).toBe("");
      expect(parseOriginalFileUrl("[]")).toBe("[]");
      expect(parseOriginalFileUrl("{}")).toBe("{}");
      expect(
        getDisplayFileUrl(minimalBulkPost({ originalFileUrl: "[bad" }))
      ).toBe("[bad");
      expect(
        getDisplayFileUrl(minimalBulkPost({ originalFileUrl: "[]" }))
      ).toBe("[]");
      expect(
        getDisplayFileUrl(minimalBulkPost({ originalFileUrl: "{}" }))
      ).toBe("{}");
      expect(getDisplayFileUrl(minimalBulkPost({ originalFileUrl: [] }))).toBe(
        ""
      );
    });

    it("collects file urls from kind-6 rows and mixed arrays", () => {
      expect(
        getFileUrlArray(
          minimalBulkPost({ isKind6Repost: true, originalFileUrl: "[1]" })
        )
      ).toEqual([]);
      expect(
        getFileUrlArray(
          minimalBulkPost({ isKind6Repost: true, originalFileUrl: "" })
        )
      ).toEqual([]);
      const mixed = {
        clientId: "c",
        files: [],
        caption: "",
        queueType: "Q",
        scheduledFor: "",
        isRecyclable: false,
        fileUrl: ["ok", 2, "  "],
      };
      if (!isBulkPost(mixed)) throw new Error("expected bulk post");
      expect(getFileUrlArray(mixed)).toEqual(["ok", "  "]);
      expect(getFileUrlArray(minimalBulkPost({ fileUrl: "   " }))).toEqual([]);
    });

    it("falls through scheduled-time parsers", () => {
      expect(Number.isNaN(convertScheduledTime("not-a-date", "UTC"))).toBe(
        true
      );
      const spaced = convertScheduledTime("2024-06-15 14:30:00", "UTC");
      expect(spaced).toBe(new Date("2024-06-15 14:30:00Z").getTime());
      const compact = convertScheduledTime("20240615T143000", "UTC");
      expect(typeof compact).toBe("number");
    });

    it("builds kind 6, regular quote, and longform quote events", () => {
      const post = minimalBulkPost({
        queueType: "Main",
        scheduledFor: "2024-06-01T00:00:00.000Z",
        isRecyclable: true,
        originalPostId: "post-1",
        originalEventId: pubkey,
        originalEventPubkey: pubkey,
        originalFileUrl: ["https://cdn.example/a.jpg"],
        caption: "quote",
      });
      const kind6 = createKind6RepostEvent(post, 5000);
      expect(kind6.fileUrl).toEqual(["https://cdn.example/a.jpg"]);
      expect(kind6.scheduledFor).toBe(1_717_200_000);
      expect(kind6.events.created_at).toBe(5);
      expect(kind6.events.kind).toBe(6);
      expect(kind6.events.tags).toEqual([
        ["e", pubkey, "wss://relay.primal.net"],
        ["p", pubkey],
      ]);

      const missingIds = createKind6RepostEvent(
        minimalBulkPost({ scheduledFor: "" }),
        0
      );
      expect(missingIds.fileUrl).toEqual([]);
      expect(missingIds.events.tags).toEqual([
        ["e", "", "wss://relay.primal.net"],
        ["p", ""],
      ]);
      expect(missingIds.scheduledFor).toBeGreaterThan(1_700_000_000);

      const regular = createRegularQuoteEvent(
        post,
        "1234567890",
        [["t", "tag"]],
        10_000,
        "https://cdn.example/a.jpg"
      );
      expect(regular.events.isQuotePost).toBe(true);
      expect(regular.events.content).toContain("nostr:nevent");
      expect(regular.events.content).toContain("1234567890");
      expect(regular.fileUrl).toEqual(["https://cdn.example/a.jpg"]);
      expect(regular.scheduledFor).toBe(10);

      const omittedTags = createRegularQuoteEvent(
        post,
        "12345678901",
        [],
        0,
        ""
      );
      expect(omittedTags.events.content).not.toContain("12345678901");
      expect(omittedTags.fileUrl).toEqual([]);

      const naddr = nip19.naddrEncode({
        identifier: "hello",
        kind: 30023,
        pubkey,
      });
      const longform = createLongformQuoteEvent(
        minimalBulkPost({
          ...post,
          naddr: `nostr:${naddr}`,
          caption: "",
        }),
        "short",
        [],
        2000,
        ""
      );
      expect(longform.events.tags[0]).toEqual([
        "a",
        `30023:${pubkey}:hello`,
        "wss://relay.primal.net",
        "mention",
      ]);
      expect(longform.events.content).toBe("short");

      const npub = nip19.npubEncode(pubkey);
      const notAddress = createLongformQuoteEvent(
        minimalBulkPost({ ...post, naddr: npub, caption: "cap" }),
        "",
        [],
        0,
        ""
      );
      expect(notAddress.events.tags.some((tag) => tag[0] === "a")).toBe(false);

      nip19Mock.failMode = "error";
      createLongformQuoteEvent(
        minimalBulkPost({ ...post, naddr: "nostr:broken" }),
        "",
        [],
        0,
        ""
      );
      nip19Mock.failMode = "string";
      createLongformQuoteEvent(
        minimalBulkPost({ ...post, naddr: "nostr:broken" }),
        "",
        [],
        0,
        ""
      );
      expect(clientErrors.logClientError).toHaveBeenNthCalledWith(
        1,
        new Error("bad naddr"),
        {
          component: "useBulkPostEvents",
          action: "decodeNaddr",
          message: "Failed to decode naddr for longform quote",
        },
        "warning"
      );
      expect(clientErrors.logClientError).toHaveBeenNthCalledWith(
        2,
        new Error("bad naddr"),
        {
          component: "useBulkPostEvents",
          action: "decodeNaddr",
          message: "Failed to decode naddr for longform quote",
        },
        "warning"
      );

      nip19Mock.failMode = "";
      expect(
        createQuotePostEvent(
          minimalBulkPost({ ...post, isLongformQuote: true, naddr }),
          "",
          [],
          0,
          ""
        ).events.tags.some((tag) => tag[0] === "a")
      ).toBe(true);
      expect(
        createQuotePostEvent(post, "", [], 0, "").events.content
      ).toContain("nostr:nevent");
    });

    it("returns UTC when the timezone is missing and appends every upload field", () => {
      expect(getUserTimezone(undefined)).toBe("UTC");
      expect(getUserTimezone({ timezone: null })).toBe("UTC");
      expect(getUserTimezone({ timezone: "" })).toBe("");
      const posts = [
        minimalBulkPost({
          queueType: "A",
          scheduledFor: "t1",
          isRecyclable: true,
        }),
        minimalBulkPost({
          queueType: "B",
          scheduledFor: "t2",
          isRecyclable: false,
        }),
      ];
      const data = buildUploadFormData(posts, [["u1"], []]);
      expect(data.getAll("scheduledDates")).toEqual(["t1", "t2"]);
      expect(data.getAll("queueTypes")).toEqual(["A", "B"]);
      expect(data.getAll("isRecyclable")).toEqual(["true", "false"]);
      expect(data.get("custom")).toBeNull();
    });
  });
});
