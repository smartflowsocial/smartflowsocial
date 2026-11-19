import {
  PostKind,
  PostType,
  ScheduledDependencyMode,
  ScheduledSigningState,
  ScheduledTargetMode,
  Status,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  groupNotificationsByParent,
  groupNotificationsByType,
} from "~/features/engagement/engagement-notification-group.server";
import type {
  Notification,
  NotificationReply,
} from "~/features/engagement/types";
import type { NostrEvent } from "~/features/nostr/types";
import type { LongFormPostData, PostData } from "~/features/posts/types";

const NOW = new Date("2024-05-01T12:00:00.000Z");

function note(
  eventId: string,
  type: Notification["type"],
  createdAt: number,
  originalEventId: string
): Notification {
  const base = {
    id: eventId,
    eventId,
    content: type,
    createdAt,
    originalEventId,
    pubkey: `${type}-pk`,
  };
  if (type === "zap") {
    return {
      ...base,
      type,
      senderPubkey: `${type}-pk`,
      receiverPubkey: "receiver",
      amountSats: 1,
    };
  }
  return { ...base, type };
}

function reply(
  eventId: string,
  createdAt: number,
  originalEventId: string
): NotificationReply {
  const notification = note(eventId, "reply", createdAt, originalEventId);
  if (notification.type !== "reply") {
    throw new Error("expected reply");
  }
  return notification;
}

function basePost(id: string): PostData {
  return {
    id,
    nostrEventId: null,
    caption: null,
    fileUrl: [],
    scheduledAtUtc: null,
    nominalScheduledAtUtc: null,
    publishedAt: null,
    content: null,
    postType: PostType.TEXT,
    repost: false,
    isQuotedPost: false,
    isRecyclable: false,
    createdAt: NOW,
    updatedAt: NOW,
    status: Status.ACTIVE,
    currentState: "PUBLISHED",
    queueTypeId: null,
    tags: [],
    manual_override: false,
    userId: "user-1",
    hashTagPresetId: null,
    creationIdempotencyKey: null,
    enqueueIdempotencyKey: null,
    publishAttemptId: null,
    publishingLockId: null,
    publishingLockExpiresAt: null,
    publishingStartedAt: null,
    repostOfPostId: null,
    repostConditions: null,
    quoteOfPostId: null,
    quoteOfLongFormPostId: null,
    draftMeta: null,
    threadGroupId: null,
    postKind: PostKind.POST,
    replyToEventId: null,
    replyToPostId: null,
    parentScheduledActionId: null,
    rootScheduledActionId: null,
    targetScheduledActionId: null,
    dependencyMode: ScheduledDependencyMode.standalone,
    targetMode: ScheduledTargetMode.direct,
    followUpTimingMode: null,
    followUpOffsetSeconds: null,
    expectedParentEventId: null,
    signedChildEventId: null,
    signingState: ScheduledSigningState.unsigned,
    draftGroupId: null,
  };
}

function baseLongform(id: string): LongFormPostData {
  return {
    id,
    nostrEventId: null,
    title: null,
    summary: null,
    content: null,
    image: null,
    scheduledAtUtc: null,
    nominalScheduledAtUtc: null,
    publishedAt: null,
    postedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    status: Status.ACTIVE,
    currentState: "PUBLISHED",
    queueTypeId: null,
    tags: [],
    userId: "user-1",
    hashTagPresetId: null,
    creationIdempotencyKey: null,
    enqueueIdempotencyKey: null,
    publishAttemptId: null,
    publishingLockId: null,
    publishingLockExpiresAt: null,
    publishingStartedAt: null,
  };
}

describe("groupNotificationsByType", () => {
  it("splits an empty list and one notification of each type", () => {
    expect(groupNotificationsByType([])).toEqual({
      all: [],
      replies: [],
      mentions: [],
      zaps: [],
      quotes: [],
    });

    const notifications = [
      note("r", "reply", 1, "p"),
      note("m", "mention", 2, "p"),
      note("z", "zap", 3, "p"),
      note("q", "quote", 4, "p"),
    ];
    const grouped = groupNotificationsByType(notifications);
    expect(grouped.all).toBe(notifications);
    expect(grouped.replies.map((item) => item.eventId)).toEqual(["r"]);
    expect(grouped.mentions.map((item) => item.eventId)).toEqual(["m"]);
    expect(grouped.zaps.map((item) => item.eventId)).toEqual(["z"]);
    expect(grouped.quotes.map((item) => item.eventId)).toEqual(["q"]);
  });
});

describe("groupNotificationsByParent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps posts and longform parents, skipping rows without an event id", () => {
    const carousel = basePost("post-carousel");
    carousel.caption = "carousel";
    carousel.fileUrl = ["https://cdn/first.jpg", "https://cdn/second.jpg"];
    carousel.publishedAt = new Date("2024-04-01T00:00:00.000Z");
    carousel.signedEvent = {
      id: "event-carousel",
      pubkey: "post-pk",
      created_at: 1,
      kind: 1,
      tags: [],
      content: "c",
      sig: "sig",
    };
    const singleFile = basePost("post-single");
    Object.assign(singleFile, { fileUrl: "https://cdn/only.jpg" });
    singleFile.signedEvent = {
      id: "event-single",
      pubkey: "single-pk",
      created_at: 1,
      kind: 1,
      tags: [],
      content: "c",
      sig: "sig",
    };
    const skipped = basePost("post-skipped");
    skipped.signedEvent = {
      id: "",
      pubkey: "skipped-pk",
      created_at: 1,
      kind: 1,
      tags: [],
      content: "c",
      sig: "sig",
    };

    const fromSigned = baseLongform("long-signed");
    fromSigned.title = "Signed title";
    fromSigned.content = "Signed body";
    fromSigned.publishedAt = new Date("2024-04-02T00:00:00.000Z");
    fromSigned.nostrEventId = "ignored-because-signed-id";
    fromSigned.signedEvent = {
      id: "event-long",
      pubkey: "long-pk",
      created_at: 2,
      kind: 30023,
      tags: [],
      content: "body",
      sig: "sig",
    };
    const fromNostr = baseLongform("long-nostr");
    fromNostr.nostrEventId = "event-nostr";
    const nostrEvent: NostrEvent = {
      content: "n",
      created_at: 3,
      kind: 30023,
      tags: [],
    };
    Object.assign(nostrEvent, { pubkey: "nostr-pk" });
    fromNostr.nostrEvent = nostrEvent;
    const blankPubkey = baseLongform("long-blank");
    blankPubkey.nostrEventId = "event-blank";
    const overwritten = basePost("post-overwritten");
    overwritten.signedEvent = {
      id: "event-shared",
      pubkey: "post-wins-then-loses",
      created_at: 1,
      kind: 1,
      tags: [],
      content: "c",
      sig: "sig",
    };
    const longOverwrite = baseLongform("long-overwrite");
    longOverwrite.nostrEventId = "event-shared";
    longOverwrite.title = "Long wins";

    const stats = {
      "event-carousel": {
        likes: 1,
        replies: 1,
        mentions: 1,
        reposts: 1,
        zaps: 1,
        satszapped: 1,
      },
    };
    const grouped = groupNotificationsByParent(
      [
        reply("n-late", 50, "event-carousel"),
        reply("n-early", 10, "event-carousel"),
        reply("n-single", 5, "event-single"),
        reply("n-long", 40, "event-long"),
        reply("n-nostr", 30, "event-nostr"),
        reply("n-blank", 20, "event-blank"),
        reply("n-shared", 15, "event-shared"),
        reply("n-missing", 100, "missing-parent"),
      ],
      [carousel, singleFile, skipped, overwritten],
      [fromSigned, fromNostr, blankPubkey, longOverwrite],
      stats
    );

    expect(grouped.map((item) => item.parentPost.eventId)).toEqual([
      "event-carousel",
      "event-long",
      "event-nostr",
      "event-blank",
      "event-shared",
      "event-single",
    ]);
    expect(grouped[0]?.notifications.map((item) => item.createdAt)).toEqual([
      50, 10,
    ]);
    expect(grouped[0]?.parentPost).toMatchObject({
      id: "post-carousel",
      pubkey: "post-pk",
      caption: "carousel",
      fileUrl: "https://cdn/first.jpg",
      isLongform: false,
      publishedAt: new Date("2024-04-01T00:00:00.000Z"),
      stats: stats["event-carousel"],
    });
    expect(grouped[5]?.parentPost.fileUrl).toBe("https://cdn/only.jpg");
    expect(grouped[5]?.parentPost.publishedAt).toEqual(NOW);
    expect(grouped[1]?.parentPost).toMatchObject({
      id: "long-signed",
      pubkey: "long-pk",
      title: "Signed title",
      content: "Signed body",
      isLongform: true,
    });
    expect(grouped[2]?.parentPost.pubkey).toBe("nostr-pk");
    expect(grouped[3]?.parentPost.pubkey).toBe("");
    expect(grouped[4]?.parentPost).toMatchObject({
      id: "long-overwrite",
      title: "Long wins",
      isLongform: true,
    });
  });

  it("builds a synthetic parent when the note is not an app post", () => {
    const orphan = reply("orphan", 8, "outside-event");
    const dropped = groupNotificationsByParent([orphan], [], []);
    expect(dropped).toEqual([]);

    const [synthetic] = groupNotificationsByParent(
      [orphan],
      [],
      [],
      {
        "outside-event": {
          likes: 2,
          replies: 0,
          mentions: 0,
          reposts: 0,
          zaps: 0,
          satszapped: 0,
        },
      },
      { syntheticFallbackPubkey: "viewer-pk" }
    );

    expect(synthetic?.parentPost).toEqual({
      id: "synthetic-context-outside-event",
      eventId: "outside-event",
      pubkey: "viewer-pk",
      caption: null,
      fileUrl: null,
      title: null,
      content: null,
      publishedAt: null,
      isLongform: false,
      stats: {
        likes: 2,
        replies: 0,
        mentions: 0,
        reposts: 0,
        zaps: 0,
        satszapped: 0,
      },
      contextLabel: "Referenced note (Nostr)",
    });
    expect(synthetic?.notifications).toEqual([orphan]);
  });
});
