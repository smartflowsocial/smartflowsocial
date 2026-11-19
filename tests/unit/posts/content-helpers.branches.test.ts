import { beforeEach, describe, expect, it, vi } from "vitest";

interface ErrorContext {
  action: string;
  component: string;
}

interface TemporalModule {
  fromDate: (date: Date, timezone?: string) => unknown;
  fromISOString: (value: string | Date, timezone?: string) => unknown;
  fromUnixTimestamp: (timestamp: number, timezone?: string) => unknown;
}

const errors = vi.hoisted(() => ({
  handleErrorSafely: vi.fn<(error: unknown, context: ErrorContext) => void>(),
}));

const temporalControl = vi.hoisted(() => ({
  fromDateFailures: 0,
  fromIsoFailures: 0,
  fromUnixFailures: 0,
}));

vi.mock("~/lib/error-handler.client", () => errors);

vi.mock("~/lib/temporal", async () => {
  const actual = await vi.importActual<TemporalModule>("~/lib/temporal");
  return {
    ...actual,
    fromDate: (date: Date, timezone?: string) => {
      if (temporalControl.fromDateFailures > 0) {
        temporalControl.fromDateFailures -= 1;
        throw new Error("fromDate failed");
      }
      return actual.fromDate(date, timezone);
    },
    fromISOString: (value: string | Date, timezone?: string) => {
      if (temporalControl.fromIsoFailures > 0) {
        temporalControl.fromIsoFailures -= 1;
        throw new Error("fromISOString failed");
      }
      return actual.fromISOString(value, timezone);
    },
    fromUnixTimestamp: (timestamp: number, timezone?: string) => {
      if (temporalControl.fromUnixFailures > 0) {
        temporalControl.fromUnixFailures -= 1;
        throw new Error("fromUnixTimestamp failed");
      }
      return actual.fromUnixTimestamp(timestamp, timezone);
    },
  };
});

import { combinedContentFactory } from "../../factories";

import type { PostData } from "~/features/posts/types";
import {
  formatDate,
  getContentPreview,
  getContentTitle,
  getContentTypeBadge,
  getImageUrls,
  getMediaPreviewUrls,
  getPostRowThumbnailBadge,
  getQueueTypeDisplay,
  getStatusColor,
  getStatusText,
  getStatusTextToneClass,
  isPureRepostSourceContent,
  isRepostContent,
  isRepostPost,
} from "~/features/posts/utils/content-helpers";

function asPost(value: object): PostData {
  return value as PostData;
}

describe("content helper branches", () => {
  beforeEach(() => {
    temporalControl.fromDateFailures = 0;
    temporalControl.fromIsoFailures = 0;
    temporalControl.fromUnixFailures = 0;
    errors.handleErrorSafely.mockClear();
  });

  describe("media and titles", () => {
    it("parses, rejects, and passes through image urls", () => {
      expect(getImageUrls(undefined)).toEqual([]);
      expect(getImageUrls([])).toEqual([]);
      expect(getImageUrls(["https://cdn.example/a.png"])).toEqual([
        "https://cdn.example/a.png",
      ]);
      expect(getImageUrls(['["https://cdn.example/a.png",2]'])).toEqual([
        "https://cdn.example/a.png",
        2,
      ]);
      expect(getImageUrls(['{"url":"https://cdn.example/a.png"}'])).toEqual([
        '{"url":"https://cdn.example/a.png"}',
      ]);
      expect(getImageUrls(["[broken"])).toEqual([]);
      const logged: unknown = errors.handleErrorSafely.mock.calls[0]?.[0];
      expect(logged).toBeInstanceOf(SyntaxError);
      expect(errors.handleErrorSafely.mock.calls[0]?.[1]).toEqual({
        component: "AllContentListing",
        action: "parseFileUrl",
      });
    });

    it("slices longform and post previews", () => {
      const article = combinedContentFactory.longform({
        image: "https://cdn.example/cover.png",
      });
      expect(getMediaPreviewUrls(article, 0)).toEqual([]);
      expect(getMediaPreviewUrls(article, 1)).toEqual([
        "https://cdn.example/cover.png",
      ]);
      expect(getMediaPreviewUrls(combinedContentFactory.longform({}))).toEqual(
        []
      );
      expect(
        getMediaPreviewUrls(
          combinedContentFactory.post({
            fileUrl: ["a", "b", "c", "d", "e"],
          }),
          2
        )
      ).toEqual(["a", "b"]);
      expect(
        getMediaPreviewUrls(
          combinedContentFactory.post({
            fileUrl: ['["https://cdn.example/a.png"]'],
          })
        )
      ).toEqual(["https://cdn.example/a.png"]);
    });

    it("titles and previews posts and articles", () => {
      expect(
        getContentTitle(combinedContentFactory.longform({ title: "Article" }))
      ).toBe("Article");
      expect(getContentTitle(combinedContentFactory.longform({}))).toBe(
        "Untitled Article"
      );
      expect(
        getContentTitle(combinedContentFactory.post({ caption: "" }))
      ).toBe("");
      expect(getContentTitle(combinedContentFactory.post({}))).toBe(
        "No caption"
      );
      const exact = "c".repeat(50);
      expect(
        getContentTitle(combinedContentFactory.post({ caption: exact }))
      ).toBe(exact);
      const truncated = getContentTitle(
        combinedContentFactory.post({ caption: "c".repeat(51) })
      );
      expect(truncated).toBe(`${"c".repeat(50)}...`);

      const article = combinedContentFactory.longform({
        summary: "Summary",
        content: "x".repeat(120),
      });
      expect(getContentPreview(article)).toBe("Summary");
      expect(
        getContentPreview(combinedContentFactory.longform({ summary: "" }))
      ).toBe("");
      expect(
        getContentPreview(combinedContentFactory.longform({ content: "short" }))
      ).toBe("short");
      expect(
        getContentPreview(
          combinedContentFactory.longform({ content: "x".repeat(100) })
        )
      ).toBe("x".repeat(100));
      expect(
        getContentPreview(
          combinedContentFactory.longform({ content: "x".repeat(101) })
        )
      ).toBe(`${"x".repeat(100)}...`);
      expect(
        getContentPreview(combinedContentFactory.longform({ content: "" }))
      ).toBe("");
      expect(getContentPreview(combinedContentFactory.longform({}))).toBe(
        "No content"
      );
      expect(
        getContentPreview(combinedContentFactory.post({ caption: "Post" }))
      ).toBeNull();
    });
  });

  describe("status", () => {
    it("colors every post and longform state, including queue holds", () => {
      const held = combinedContentFactory.post({
        currentState: "PUBLISHED",
        originalData: { queueHoldStatus: "HELD_BY_QUEUE" },
      });
      expect(getStatusColor(held)).toContain("text-text-secondary");
      expect(getStatusColor(held)).not.toContain("text-success");
      expect(getStatusText(held)).toBe("Paused");
      expect(getStatusTextToneClass(held)).toBe("text-text-secondary");

      const resign = combinedContentFactory.longform({
        currentState: "PUBLISHED",
        originalData: {
          queueHoldStatus: "NEEDS_RESIGN_AFTER_QUEUE_RESUME",
        },
      });
      expect(getStatusText(resign)).toBe("Needs re-sign");
      expect(getStatusTextToneClass(resign)).toBe("text-text-secondary");

      const cases = [
        {
          type: "post" as const,
          state: "DRAFT",
          text: "Draft",
          tone: "text-text",
        },
        {
          type: "post" as const,
          state: "PUBLISHED",
          text: "Published",
          tone: "text-success",
        },
        {
          type: "post" as const,
          state: "SCHEDULED",
          text: "Scheduled",
          tone: "text-text-secondary",
        },
        {
          type: "post" as const,
          state: "PUBLISHING",
          text: "Publishing",
          tone: "text-text-secondary",
        },
        {
          type: "post" as const,
          state: "FAILED",
          text: "Failed",
          tone: "text-danger",
        },
        {
          type: "post" as const,
          state: "CANCELLED",
          text: "Cancelled",
          tone: "text-text-secondary",
        },
        {
          type: "post" as const,
          state: "WEIRD",
          text: "Unknown",
          tone: "text-text-secondary",
        },
        {
          type: "longform" as const,
          state: "DRAFT",
          text: "Draft",
          tone: "text-text",
        },
        {
          type: "longform" as const,
          state: "PUBLISHED",
          text: "Published",
          tone: "text-success",
        },
        {
          type: "longform" as const,
          state: "SCHEDULED",
          text: "Scheduled",
          tone: "text-text-secondary",
        },
        {
          type: "longform" as const,
          state: "PUBLISHING",
          text: "Publishing",
          tone: "text-text-secondary",
        },
        {
          type: "longform" as const,
          state: "FAILED",
          text: "Failed",
          tone: "text-danger",
        },
        {
          type: "longform" as const,
          state: "CANCELLED",
          text: "Cancelled",
          tone: "text-text-secondary",
        },
      ];

      for (const entry of cases) {
        const item =
          entry.type === "post"
            ? combinedContentFactory.post({ currentState: entry.state })
            : combinedContentFactory.longform({ currentState: entry.state });
        expect(getStatusText(item)).toBe(entry.text);
        expect(getStatusTextToneClass(item)).toBe(entry.tone);
        if (entry.state === "FAILED") {
          expect(getStatusColor(item)).toContain("text-danger");
        } else if (entry.state === "PUBLISHED") {
          expect(getStatusColor(item)).toContain("text-success");
        } else if (entry.state === "DRAFT") {
          expect(getStatusColor(item)).not.toContain("text-text-secondary");
        } else {
          expect(getStatusColor(item)).toContain("text-text-secondary");
        }
      }

      const fromOriginal = combinedContentFactory.post({
        originalData: { currentState: "FAILED" },
      });
      expect(getStatusText(fromOriginal)).toBe("Failed");
      expect(getStatusColor(fromOriginal)).toContain("text-danger");

      const unknown = combinedContentFactory.post({
        originalData: { queueHoldStatus: "none" },
      });
      expect(getStatusText(unknown)).toBe("Unknown");
      expect(getStatusTextToneClass(unknown)).toBe("text-text-secondary");
      expect(getStatusColor(unknown)).toContain("text-text-secondary");

      const broken = combinedContentFactory.post({ currentState: "DRAFT" });
      Reflect.set(broken, "originalData", null);
      expect(() => getStatusColor(broken)).toThrow(TypeError);
    });
  });

  describe("dates and queues", () => {
    const noon = new Date("2024-01-15T14:30:00Z");

    it("formats dates, timezones, and fallbacks", () => {
      expect(formatDate(undefined)).toBe("-");
      expect(formatDate("")).toBe("-");
      expect(formatDate(new Date("invalid"))).toBe("-");
      expect(formatDate("not-a-date")).toBe("-");
      expect(formatDate("nope", true)).toBe("-");

      const utc = formatDate(noon, false, "UTC", "24h", "en-GB");
      const ny = formatDate(noon, false, "America/New_York", "24h", "en-GB");
      expect(utc).toContain("15/01/2024");
      expect(utc).toContain("14");
      expect(ny).not.toBe(utc);

      expect(
        formatDate(noon, false, "UTC", "12h", "en-US").toLowerCase()
      ).toContain("pm");
      expect(
        formatDate(noon, false, "UTC", "24h", "en-US").toLowerCase()
      ).not.toContain("pm");
      expect(formatDate(noon, false, "UTC", "24h", "en-US")).toContain(
        "01/15/2024"
      );
      expect(formatDate("1705329000", true, "UTC", "24h")).toContain("14");

      temporalControl.fromDateFailures = 1;
      expect(formatDate(noon, false, "UTC", "24h")).toContain("15/01/2024");

      temporalControl.fromDateFailures = 2;
      expect(formatDate("2024-01-15T14:30:00Z", false, "UTC", "24h")).toContain(
        "15/01/2024"
      );

      temporalControl.fromDateFailures = 2;
      temporalControl.fromIsoFailures = 1;
      expect(formatDate("2024-01-15T14:30:00Z")).toBe("-");

      temporalControl.fromUnixFailures = 1;
      expect(formatDate("1705329000", true, "UTC", "24h")).toContain("14");

      temporalControl.fromUnixFailures = 5;
      expect(formatDate("1705329000", true)).toBe("-");

      temporalControl.fromDateFailures = 5;
      expect(formatDate(noon)).toBe("-");
    });

    it("renders queue chips with and without a color token", () => {
      const colored = getQueueTypeDisplay({
        id: "q1",
        name: "Morning",
        colorToken: "red",
      });
      expect(colored.name).toBe("Morning");
      expect(colored.style?.color).toBe("#D62F2F");
      expect(colored.className).toContain("inline-flex");

      const plain = getQueueTypeDisplay({ id: "q2", name: "Night" });
      expect(plain.name).toBe("Night");
      expect(plain.style).toBeUndefined();
      expect(plain.className).toContain("inline-flex");

      const missingToken = getQueueTypeDisplay({
        id: "q3",
        name: "Dawn",
        colorToken: null,
      });
      expect(missingToken.name).toBe("Dawn");
      expect(missingToken.style).toBeUndefined();
      expect(getQueueTypeDisplay(undefined).name).toBe("unassigned");
    });
  });

  describe("badges and repost detection", () => {
    it("classifies reposts, quotes, threads, replies, polls, and articles", () => {
      expect(
        isRepostPost(
          asPost(combinedContentFactory.post({ postKind: "REPOST" }))
        )
      ).toBe(true);
      expect(
        isRepostPost(asPost(combinedContentFactory.post({ postKind: "QUOTE" })))
      ).toBe(false);
      expect(isRepostPost(asPost({ postKind: 6 }))).toBe(false);
      expect(isRepostPost(asPost({}))).toBe(false);

      expect(
        isPureRepostSourceContent(
          combinedContentFactory.longform({ postKind: "REPOST" })
        )
      ).toBe(false);
      expect(
        isPureRepostSourceContent(
          combinedContentFactory.post({ postKind: "REPOST" })
        )
      ).toBe(true);
      expect(
        isPureRepostSourceContent(
          combinedContentFactory.post({ repost: true, isQuotedPost: false })
        )
      ).toBe(true);
      expect(
        isPureRepostSourceContent(
          combinedContentFactory.post({ repost: true, isQuotedPost: true })
        )
      ).toBe(false);
      expect(
        isPureRepostSourceContent(
          combinedContentFactory.post({ originalData: { repost: true } })
        )
      ).toBe(true);

      expect(
        isRepostContent(combinedContentFactory.longform({ postKind: "REPOST" }))
      ).toBe(false);
      expect(
        isRepostContent(combinedContentFactory.post({ postKind: "REPOST" }))
      ).toBe(true);
      expect(
        isRepostContent(
          combinedContentFactory.post({ originalData: { postKind: "REPOST" } })
        )
      ).toBe(true);
      expect(
        isRepostContent(combinedContentFactory.post({ repost: true }))
      ).toBe(false);

      expect(
        getPostRowThumbnailBadge({
          contentKind: "longform",
          repost: true,
          postType: "POLL",
        })
      ).toBe("ART");
      expect(
        getPostRowThumbnailBadge({
          contentKind: "post",
          repost: true,
          postType: "POLL",
        })
      ).toBe("REPOST");
      expect(
        getPostRowThumbnailBadge({ contentKind: "post", postKind: "REPOST" })
      ).toBe("REPOST");
      expect(
        getPostRowThumbnailBadge({ contentKind: "post", postType: "POLL" })
      ).toBe("POLL");
      expect(
        getPostRowThumbnailBadge({
          contentKind: "post",
          signedEvent: { kind: 1068 },
        })
      ).toBe("POLL");
      expect(
        getPostRowThumbnailBadge({
          contentKind: "post",
          signedEvent: null,
        })
      ).toBe("TEXT");

      expect(
        getContentTypeBadge(
          combinedContentFactory.post({
            postKind: "QUOTE",
            signedEvent: { kind: 6 },
          })
        ).text
      ).toBe("QUOTE");
      expect(
        getContentTypeBadge(combinedContentFactory.post({ postKind: "THREAD" }))
          .text
      ).toBe("THREAD");
      expect(
        getContentTypeBadge(combinedContentFactory.post({ postKind: "REPLY" }))
          .text
      ).toBe("REPLY");
      expect(
        getContentTypeBadge(
          combinedContentFactory.post({
            originalData: { postKind: "REPOST" },
          })
        ).text
      ).toBe("REPOST");
      expect(
        getContentTypeBadge(
          combinedContentFactory.post({ signedEvent: { kind: 6 } })
        ).text
      ).toBe("REPOST");
      expect(
        getContentTypeBadge(
          combinedContentFactory.post({ signedEvent: { kind: 30023 } })
        ).text
      ).toBe("ARTICLE");
      expect(
        getContentTypeBadge(
          combinedContentFactory.post({
            originalData: { signedEvent: { kind: 30023 } },
          })
        ).text
      ).toBe("ARTICLE");
      expect(
        getContentTypeBadge(combinedContentFactory.post({ postType: "POLL" }))
          .text
      ).toBe("POLL");
      expect(getContentTypeBadge(combinedContentFactory.post({})).text).toBe(
        "POST"
      );
      expect(
        getContentTypeBadge(combinedContentFactory.longform({})).text
      ).toBe("Article");

      const cleared = combinedContentFactory.post({
        signedEvent: { kind: 6 },
      });
      Reflect.set(cleared, "originalData", null);
      expect(getContentTypeBadge(cleared).text).toBe("REPOST");
    });
  });
});
