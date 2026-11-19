import { describe, expect, it } from "vitest";

import { postToCombinedContent } from "~/features/posts/combined";
import type { CombinedContent, PostData } from "~/features/posts/types";
import {
  attachedCombinedByParentId,
  attachedCombinedForThreadRow,
  attachedFollowUpChipLabelFromCombinedContent,
  attachedFollowUpKindChipLabel,
  attachedFollowUpMenuTitle,
  attachedPostsByParentId,
  attachedPostsForThreadRow,
  effectiveDependencyModeForContent,
  effectiveScheduledOrPublishedAtForAttachedMenuItem,
  isAttachedFollowUpContent,
  isAttachedFollowUpPost,
  isStandaloneRepostContent,
  isStandaloneRepostPost,
  postKindForAttachedMenuItem,
} from "~/features/posts/utils/attached-follow-up-rows";

function isPostData(value: object): value is PostData {
  return "id" in value;
}

function isContent(value: object): value is CombinedContent {
  return "id" in value && "type" in value;
}

function makePost(fields: {
  id: string;
  parentScheduledActionId?: string | null;
  dependencyMode?: "standalone" | "attached";
  postKind?: string;
  repost?: boolean;
  scheduledAtUtc?: Date | null;
  nominalScheduledAtUtc?: Date | null;
  publishedAt?: Date | null;
}): PostData {
  const value = {
    id: fields.id,
    userId: "user-1",
    parentScheduledActionId: fields.parentScheduledActionId,
    dependencyMode: fields.dependencyMode,
    postKind: fields.postKind,
    repost: fields.repost,
    scheduledAtUtc: fields.scheduledAtUtc,
    nominalScheduledAtUtc: fields.nominalScheduledAtUtc,
    publishedAt: fields.publishedAt,
  };
  if (!isPostData(value)) throw new Error("expected post");
  return value;
}

function makeContent(fields: {
  id: string;
  type: "post" | "longform";
  dependencyMode?: "standalone" | "attached";
  parentScheduledActionId?: string | null;
  postKind?: string;
  postType?: string;
  scheduledAtUtc?: Date | string | number | null;
  publishedAt?: Date | null;
  originalData?: PostData;
}): CombinedContent {
  const value = {
    id: fields.id,
    type: fields.type,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "SCHEDULED",
    userId: "user-1",
    dependencyMode: fields.dependencyMode,
    parentScheduledActionId: fields.parentScheduledActionId,
    postKind: fields.postKind,
    postType: fields.postType,
    scheduledAtUtc: fields.scheduledAtUtc,
    publishedAt: fields.publishedAt,
    originalData:
      fields.originalData ??
      makePost({
        id: fields.id,
        dependencyMode: fields.dependencyMode,
        postKind: fields.postKind,
      }),
  };
  if (!isContent(value)) throw new Error("expected content");
  return value;
}

describe("attached-follow-up-rows", () => {
  it("attachedCombinedForThreadRow collects follow-ups keyed to root or any thread segment", () => {
    const early = {
      id: "seg-a",
      threadGroupId: "g1",
      caption: "first",
      scheduledAtUtc: new Date("2025-06-01T10:00:00Z"),
      userId: "u",
      createdAt: new Date(),
      updatedAt: new Date(),
      status: "SCHEDULED",
      currentState: "SCHEDULED",
      fileUrl: [],
    };
    const late = {
      ...early,
      id: "seg-b",
      caption: "second",
      scheduledAtUtc: new Date("2025-06-01T11:00:00Z"),
    };
    const followRoot = {
      ...early,
      id: "fu1",
      caption: "child of root",
      dependencyMode: "attached" as const,
      parentScheduledActionId: "seg-a",
      threadGroupId: null,
    };
    const followSegment = {
      ...early,
      id: "fu2",
      caption: "child of segment b",
      dependencyMode: "attached" as const,
      parentScheduledActionId: "seg-b",
      threadGroupId: null,
    };
    const combined = [late, early, followRoot, followSegment].map((p) =>
      postToCombinedContent(p as never)
    );
    const byParent = attachedCombinedByParentId(combined);
    const rowsEarlyRoot = {
      root: combined.find((c) => c.id === "seg-a")!,
      threadSegments: [combined.find((c) => c.id === "seg-b")!],
    };
    const merged = attachedCombinedForThreadRow(byParent, rowsEarlyRoot);
    expect(merged.map((c) => c.id).sort()).toEqual(["fu1", "fu2"]);
  });

  it("attachedFollowUpMenuTitle reflects post kind", () => {
    expect(attachedFollowUpMenuTitle("REPOST", 1)).toBe("Follow-up repost 1");
    expect(attachedFollowUpMenuTitle("QUOTE", 2)).toBe("Follow-up quote 2");
    expect(attachedFollowUpMenuTitle(undefined, 3)).toBe("Follow-up 3");
  });

  it("attachedFollowUpChipLabelFromCombinedContent returns kind chip for attached posts", () => {
    const fu = postToCombinedContent({
      id: "fu",
      userId: "u",
      caption: "c",
      content: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: "SCHEDULED",
      currentState: "SCHEDULED",
      dependencyMode: "attached",
      parentScheduledActionId: "p",
      postKind: "REPOST",
      fileUrl: [],
      postType: "TEXT",
      tags: [],
      manual_override: false,
      repost: false,
      isQuotedPost: false,
      isRecyclable: false,
      hashTagPresetId: null,
      nostrEventId: null,
      scheduledAtUtc: new Date(),
      publishedAt: null,
      signedEvent: null,
      nostrEvent: null,
    } as unknown as PostData);
    expect(attachedFollowUpChipLabelFromCombinedContent(fu)).toBe(
      "Follow-up repost"
    );
  });

  it("effectiveScheduledOrPublishedAtForAttachedMenuItem prefers originalData times", () => {
    const parentWrong = new Date("2025-06-01T10:00:00Z");
    const childCorrect = new Date("2025-06-01T18:00:00Z");
    const raw: PostData = {
      id: "child",
      userId: "u",
      caption: "x",
      content: null,
      scheduledAtUtc: childCorrect,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: "SCHEDULED",
      currentState: "SCHEDULED",
      dependencyMode: "attached",
      parentScheduledActionId: "root",
      postKind: "REPOST",
      fileUrl: [],
      postType: "TEXT",
      tags: [],
      manual_override: false,
      repost: false,
      isQuotedPost: false,
      isRecyclable: false,
      hashTagPresetId: null,
      nostrEventId: null,
      publishedAt: null,
      signedEvent: null,
      nostrEvent: null,
    } as unknown as PostData;
    const item = postToCombinedContent(raw);
    /** Simulate a stale top-level hydrate mirroring the parent row */
    item.scheduledAtUtc = parentWrong;

    expect(
      effectiveScheduledOrPublishedAtForAttachedMenuItem(item, "scheduled")
    ).toEqual(childCorrect);
  });

  it("effectiveScheduledOrPublishedAtForAttachedMenuItem prefers nominal over scheduled on originalData", () => {
    const nominal = new Date("2025-06-02T12:00:00Z");
    const scheduled = new Date("2025-06-02T15:00:00Z");
    const raw: PostData = {
      id: "child",
      userId: "u",
      caption: "x",
      content: null,
      scheduledAtUtc: scheduled,
      nominalScheduledAtUtc: nominal,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: "SCHEDULED",
      currentState: "SCHEDULED",
      dependencyMode: "attached",
      parentScheduledActionId: "root",
      postKind: "REPOST",
      fileUrl: [],
      postType: "TEXT",
      tags: [],
      manual_override: false,
      repost: false,
      isQuotedPost: false,
      isRecyclable: false,
      hashTagPresetId: null,
      nostrEventId: null,
      publishedAt: null,
      signedEvent: null,
      nostrEvent: null,
    } as unknown as PostData;
    const item = postToCombinedContent(raw);
    expect(
      effectiveScheduledOrPublishedAtForAttachedMenuItem(item, "scheduled")
    ).toEqual(nominal);
  });

  it("effectiveScheduledOrPublishedAtForAttachedMenuItem parses ISO schedule strings on originalData", () => {
    const raw: PostData = {
      id: "child",
      userId: "u",
      caption: "x",
      content: null,
      scheduledAtUtc: "2025-07-01T08:30:00.000Z" as unknown as Date,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: "SCHEDULED",
      currentState: "SCHEDULED",
      dependencyMode: "attached",
      parentScheduledActionId: "root",
      fileUrl: [],
      postType: "TEXT",
      tags: [],
      manual_override: false,
      repost: false,
      isQuotedPost: false,
      isRecyclable: false,
      hashTagPresetId: null,
      nostrEventId: null,
      publishedAt: null,
      signedEvent: null,
      nostrEvent: null,
    } as unknown as PostData;
    const item = postToCombinedContent(raw);
    expect(
      effectiveScheduledOrPublishedAtForAttachedMenuItem(
        item,
        "scheduled"
      )?.toISOString()
    ).toBe("2025-07-01T08:30:00.000Z");
  });

  it("classifies attached posts and standalone reposts", () => {
    expect(isAttachedFollowUpPost(makePost({ id: "a" }))).toBe(false);
    expect(
      isAttachedFollowUpPost(makePost({ id: "a", parentScheduledActionId: "" }))
    ).toBe(false);
    expect(
      isAttachedFollowUpPost(
        makePost({
          id: "a",
          parentScheduledActionId: "parent",
          dependencyMode: "standalone",
        })
      )
    ).toBe(false);
    expect(
      isAttachedFollowUpPost(
        makePost({ id: "a", parentScheduledActionId: "parent" })
      )
    ).toBe(true);
    const repost = makePost({ id: "r", postKind: "REPOST" });
    const nested = makePost({
      id: "n",
      postKind: "REPOST",
      parentScheduledActionId: "parent",
    });
    expect(isStandaloneRepostPost(repost)).toBe(true);
    expect(isStandaloneRepostPost(nested)).toBe(false);
    expect(
      isStandaloneRepostPost(makePost({ id: "p", postKind: "POST" }))
    ).toBe(false);
  });

  it("reads dependency mode from the row or its original data", () => {
    const fromRow = makeContent({
      id: "row",
      type: "post",
      dependencyMode: "standalone",
      originalData: makePost({ id: "row", dependencyMode: "attached" }),
    });
    expect(effectiveDependencyModeForContent(fromRow)).toBe("standalone");
    const fromOriginal = makeContent({
      id: "original",
      type: "post",
      originalData: makePost({ id: "original", dependencyMode: "attached" }),
    });
    expect(effectiveDependencyModeForContent(fromOriginal)).toBe("attached");
    expect(
      effectiveDependencyModeForContent(
        makeContent({ id: "none", type: "post" })
      )
    ).toBeUndefined();
  });

  it("treats only non-standalone posts with a parent or attached mode as follow-ups", () => {
    expect(
      isAttachedFollowUpContent(
        makeContent({ id: "lf", type: "longform", dependencyMode: "attached" })
      )
    ).toBe(false);
    expect(
      isAttachedFollowUpContent(
        makeContent({
          id: "alone",
          type: "post",
          dependencyMode: "standalone",
          parentScheduledActionId: "parent",
        })
      )
    ).toBe(false);
    expect(
      isAttachedFollowUpContent(
        makeContent({ id: "mode", type: "post", dependencyMode: "attached" })
      )
    ).toBe(true);
    expect(
      isAttachedFollowUpContent(
        makeContent({
          id: "parent",
          type: "post",
          parentScheduledActionId: "p",
        })
      )
    ).toBe(true);
    expect(
      isAttachedFollowUpContent(
        makeContent({ id: "blank", type: "post", parentScheduledActionId: "" })
      )
    ).toBe(false);
    expect(
      isAttachedFollowUpContent(makeContent({ id: "missing", type: "post" }))
    ).toBe(false);
    const standaloneRepost = makeContent({
      id: "repost",
      type: "post",
      postKind: "REPOST",
    });
    const attachedRepost = makeContent({
      id: "nested",
      type: "post",
      postKind: "REPOST",
      dependencyMode: "attached",
      parentScheduledActionId: "parent",
    });
    expect(isStandaloneRepostContent(standaloneRepost)).toBe(true);
    expect(isStandaloneRepostContent(attachedRepost)).toBe(false);
    expect(
      isStandaloneRepostContent(
        makeContent({ id: "note", type: "post", postKind: "POST" })
      )
    ).toBe(false);
  });

  it("labels every follow-up kind and ignores rows that are not attached", () => {
    expect(attachedFollowUpMenuTitle("REPOST", 1)).toBe("Follow-up repost 1");
    expect(attachedFollowUpMenuTitle("QUOTE", 2)).toBe("Follow-up quote 2");
    expect(attachedFollowUpMenuTitle("REPLY", 3)).toBe("Follow-up reply 3");
    expect(attachedFollowUpMenuTitle("THREAD", 4)).toBe("Follow-up thread 4");
    expect(attachedFollowUpMenuTitle("POST", 5)).toBe("Follow-up 5");
    expect(attachedFollowUpMenuTitle(null, 6)).toBe("Follow-up 6");
    expect(attachedFollowUpKindChipLabel("REPOST")).toBe("Follow-up repost");
    expect(attachedFollowUpKindChipLabel("QUOTE")).toBe("Follow-up quote");
    expect(attachedFollowUpKindChipLabel("REPLY")).toBe("Follow-up reply");
    expect(attachedFollowUpKindChipLabel("THREAD")).toBe("Follow-up thread");
    expect(attachedFollowUpKindChipLabel("POST")).toBe("Follow-up post");
    expect(attachedFollowUpKindChipLabel(undefined)).toBe("Follow-up");
    const attached = makeContent({
      id: "chip",
      type: "post",
      dependencyMode: "attached",
      postKind: "QUOTE",
    });
    expect(attachedFollowUpChipLabelFromCombinedContent(attached)).toBe(
      "Follow-up quote"
    );
    expect(
      attachedFollowUpChipLabelFromCombinedContent(
        makeContent({ id: "no", type: "post" })
      )
    ).toBeNull();
    expect(
      postKindForAttachedMenuItem(makeContent({ id: "lf", type: "longform" }))
    ).toBeUndefined();
    expect(postKindForAttachedMenuItem(attached)).toBe("QUOTE");
    const fromOriginal = makeContent({
      id: "kind",
      type: "post",
      dependencyMode: "attached",
      originalData: makePost({ id: "kind", postKind: "REPLY" }),
    });
    expect(postKindForAttachedMenuItem(fromOriginal)).toBe("REPLY");
  });

  it("reads schedule and publish instants only from original data", () => {
    const nominal = new Date("2026-02-01T00:00:00.000Z");
    const scheduled = new Date("2026-02-02T00:00:00.000Z");
    const published = new Date("2026-02-03T00:00:00.000Z");
    const post = makeContent({
      id: "post",
      type: "post",
      originalData: makePost({
        id: "post",
        nominalScheduledAtUtc: nominal,
        scheduledAtUtc: scheduled,
        publishedAt: published,
      }),
    });
    expect(
      effectiveScheduledOrPublishedAtForAttachedMenuItem(post, "scheduled")
    ).toEqual(nominal);
    expect(
      effectiveScheduledOrPublishedAtForAttachedMenuItem(post, "published")
    ).toEqual(published);

    const scheduledOnly = makeContent({
      id: "only",
      type: "post",
      originalData: makePost({ id: "only", scheduledAtUtc: scheduled }),
    });
    expect(
      effectiveScheduledOrPublishedAtForAttachedMenuItem(
        scheduledOnly,
        "scheduled"
      )
    ).toEqual(scheduled);

    const article = makeContent({
      id: "article",
      type: "longform",
      originalData: makePost({
        id: "article",
        nominalScheduledAtUtc: nominal,
        publishedAt: published,
      }),
    });
    expect(
      effectiveScheduledOrPublishedAtForAttachedMenuItem(article, "scheduled")
    ).toEqual(nominal);
    expect(
      effectiveScheduledOrPublishedAtForAttachedMenuItem(article, "published")
    ).toEqual(published);

    const stamped = {
      id: "bad",
      userId: "user-1",
      nominalScheduledAtUtc: "not-a-date",
      scheduledAtUtc: scheduled,
      publishedAt: new Date(Number.NaN),
    };
    if (!isPostData(stamped)) throw new Error("expected post");
    const bad = makeContent({
      id: "bad",
      type: "post",
      originalData: stamped,
    });
    expect(
      effectiveScheduledOrPublishedAtForAttachedMenuItem(bad, "scheduled")
    ).toBeUndefined();
    expect(
      effectiveScheduledOrPublishedAtForAttachedMenuItem(bad, "published")
    ).toBeUndefined();

    const numeric = {
      id: "num",
      userId: "user-1",
      nominalScheduledAtUtc: 12,
      publishedAt: "2026-03-01T00:00:00.000Z",
    };
    if (!isPostData(numeric)) throw new Error("expected post");
    const numbered = makeContent({
      id: "num",
      type: "longform",
      originalData: numeric,
    });
    expect(
      effectiveScheduledOrPublishedAtForAttachedMenuItem(numbered, "scheduled")
    ).toBeUndefined();
    expect(
      effectiveScheduledOrPublishedAtForAttachedMenuItem(
        numbered,
        "published"
      )?.toISOString()
    ).toBe("2026-03-01T00:00:00.000Z");
  });

  it("groups, sorts, and dedupes follow-ups under a thread row", () => {
    const early = makePost({
      id: "early",
      parentScheduledActionId: "root",
      scheduledAtUtc: new Date("2026-04-01T00:00:00.000Z"),
    });
    const late = makePost({
      id: "late",
      parentScheduledActionId: "root",
      scheduledAtUtc: new Date("2026-04-02T00:00:00.000Z"),
    });
    const undated = makePost({
      id: "undated",
      parentScheduledActionId: "seg",
      scheduledAtUtc: null,
    });
    const byParent = attachedPostsByParentId([
      late,
      makePost({ id: "skip-empty", parentScheduledActionId: "" }),
      makePost({ id: "skip-null", parentScheduledActionId: null }),
      makePost({
        id: "skip-standalone",
        parentScheduledActionId: "root",
        dependencyMode: "standalone",
      }),
      undated,
      early,
    ]);
    expect(
      attachedPostsForThreadRow(byParent, {
        root: makePost({ id: "missing" }),
        threadSegments: [],
      })
    ).toEqual([]);
    expect(
      attachedPostsForThreadRow(byParent, {
        root: makePost({ id: "root" }),
        threadSegments: [makePost({ id: "seg" }), makePost({ id: "root" })],
      }).map((post) => post.id)
    ).toEqual(["undated", "early", "late"]);

    const earlyRow = makeContent({
      id: "early-row",
      type: "post",
      parentScheduledActionId: "root",
      scheduledAtUtc: new Date("2026-04-02T00:00:00.000Z"),
    });
    const invalidDate = makeContent({
      id: "invalid-date",
      type: "post",
      parentScheduledActionId: "root",
      scheduledAtUtc: new Date(Number.NaN),
    });
    const textDate = {
      id: "text-date",
      type: "post",
      createdAt: new Date(0),
      updatedAt: new Date(0),
      status: "SCHEDULED",
      userId: "user-1",
      parentScheduledActionId: "seg",
      scheduledAtUtc: "2026-04-03T00:00:00.000Z",
      originalData: makePost({ id: "text-date" }),
    };
    if (!isContent(textDate)) throw new Error("expected content");
    const byCombined = attachedCombinedByParentId([
      earlyRow,
      invalidDate,
      textDate,
      makeContent({
        id: "article",
        type: "longform",
        parentScheduledActionId: "root",
      }),
      makeContent({
        id: "standalone",
        type: "post",
        parentScheduledActionId: "root",
        dependencyMode: "standalone",
      }),
      makeContent({ id: "blank", type: "post", parentScheduledActionId: "" }),
    ]);
    expect(
      attachedCombinedForThreadRow(byCombined, {
        root: makeContent({ id: "root", type: "post" }),
        threadSegments: [
          makeContent({ id: "seg", type: "post" }),
          makeContent({ id: "root", type: "post" }),
        ],
      }).map((item) => item.id)
    ).toEqual(["invalid-date", "text-date", "early-row"]);
  });
});
