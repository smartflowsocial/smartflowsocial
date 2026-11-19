import { beforeEach, describe, expect, it, vi } from "vitest";

interface PushBody {
  title?: string;
  body?: string;
  icon?: string;
  badge?: string;
  image?: string;
  data?: Record<string, unknown>;
}

interface UserRow {
  pushNotificationsEnabled?: boolean;
  pushNotifyPublishSuccess?: boolean;
  pushNotifyPublishFailure?: boolean;
  pushNotifyRunwayLow?: boolean;
  pushNotifyIncludePreview?: boolean | null;
  nostrProfile?: unknown;
  npub?: string;
  runwayNotifyBelowDays?: number | null;
  lastRunwayLowNotificationAt?: Date | null;
}

const webPush = vi.hoisted(() => ({
  sendNotification: vi.fn<
    (
      subscription: {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      },
      payload: string,
      options: { TTL: number; urgency: string }
    ) => Promise<{ statusCode: number }>
  >(),
  setVapidDetails: vi.fn(),
}));

const envState = vi.hoisted(() => ({
  APP_URL: "https://app.example.com",
  NODE_ENV: "test",
}));

const logs = vi.hoisted(() => ({
  logError:
    vi.fn<(error: unknown, context?: Record<string, unknown>) => void>(),
  logInfo:
    vi.fn<(message: string, context?: Record<string, unknown>) => void>(),
}));

const settings = vi.hoisted(() => ({
  getRunwaySettings:
    vi.fn<(userId: string) => Promise<{ redThresholdDays?: number | null }>>(),
}));

const prismaMock = vi.hoisted(() => ({
  longFormPost: {
    findUnique:
      vi.fn<
        (
          args: unknown
        ) => Promise<{ title: string | null; content: string | null } | null>
      >(),
  },
  post: {
    findUnique:
      vi.fn<
        (
          args: unknown
        ) => Promise<{ caption: string | null; content: string | null } | null>
      >(),
  },
  pushSubscription: {
    findMany:
      vi.fn<
        (args: {
          where: { userId: string };
        }) => Promise<
          Array<{ id: string; endpoint: string; p256dh: string; auth: string }>
        >
      >(),
    deleteMany:
      vi.fn<
        (args: {
          where: { id: { in: string[] } };
        }) => Promise<{ count: number }>
      >(),
  },
  user: {
    findUnique: vi.fn<(args: unknown) => Promise<UserRow | null>>(),
    update:
      vi.fn<
        (args: {
          where: { id: string };
          data: { lastRunwayLowNotificationAt: Date };
        }) => Promise<unknown>
      >(),
  },
}));

vi.mock("web-push", () => ({
  default: webPush,
  sendNotification: webPush.sendNotification,
  setVapidDetails: webPush.setVapidDetails,
}));
vi.mock("~/infra/notifications/web-push-config.server", () => ({
  initWebPush: vi.fn(),
}));
vi.mock("~/lib/env.server", () => ({ env: envState }));
vi.mock("~/lib/error-logger.server", () => logs);
vi.mock("~/features/user/services/user-settings.server", () => settings);
vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));

import { getRunwaySettings } from "~/features/user/services/user-settings.server";
import {
  buildPublishFallbackBody,
  buildPublishTemplateKey,
  buildPublishTitle,
  normalizePostKind,
  normalizeQueueName,
} from "~/infra/notifications/publish-copy.server";
import {
  classifyWebPushError,
  sendPublishFailureNotification,
  sendPublishSuccessNotification,
  sendPushNotification,
  sendPushNotificationToUser,
  sendRunwayLowNotification,
} from "~/infra/notifications/push-notification.server";
import { BRAND_NAME } from "~/lib/brand";

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  p256dh: "p256dh-key",
  auth: "auth-key",
};

function webPushError(statusCode: number, body = ""): Error {
  const error = new Error("Received unexpected response code") as Error & {
    statusCode?: number;
    body?: string;
  };
  error.name = "WebPushError";
  error.statusCode = statusCode;
  error.body = body;
  return error;
}

function payloadFrom(index = 0): PushBody {
  const raw = webPush.sendNotification.mock.calls[index]?.[1];
  if (typeof raw !== "string") throw new Error("missing push payload");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("bad payload");
  return parsed;
}

function enabledUser(overrides: UserRow = {}): UserRow {
  return {
    pushNotificationsEnabled: true,
    pushNotifyPublishSuccess: true,
    pushNotifyPublishFailure: true,
    pushNotifyRunwayLow: true,
    pushNotifyIncludePreview: true,
    nostrProfile: {
      display_name: "Ada",
      name: "ada",
      picture: "https://cdn.example/a.png",
    },
    npub: "npub1aaaaaaaaaaaaaaaa",
    runwayNotifyBelowDays: 3,
    lastRunwayLowNotificationAt: null,
    ...overrides,
  };
}

describe("publish notification copy helpers", () => {
  it("treats QUOTE as a normal post title", () => {
    const title = buildPublishTitle({
      isLongForm: false,
      displayName: BRAND_NAME,
      postKind: "QUOTE",
    });

    expect(title).toBe(`Post published as ${BRAND_NAME}`);
  });

  it("adds queue context for scheduled post fallback copy", () => {
    const body = buildPublishFallbackBody({
      isLongForm: false,
      source: "scheduled",
      queueName: "Morning Queue",
      postKind: "REPOST",
    });

    expect(body).toContain("Your repost is now live on Nostr.");
    expect(body).toContain("Queue: Morning Queue.");
  });

  it("builds longform template keys without post flavor", () => {
    const templateKey = buildPublishTemplateKey({
      isLongForm: true,
      source: "scheduled",
      postKind: "POST",
    });

    expect(templateKey).toBe("publish_success_article_scheduled");
  });

  it("normalizes queue name and post kind defensively", () => {
    expect(normalizeQueueName("  Growth  ")).toBe("Growth");
    expect(normalizeQueueName("   ")).toBeNull();
    expect(normalizePostKind("unexpected")).toBe("POST");
  });
});

describe("classifyWebPushError", () => {
  it("classifies status codes, bodies, and message fallbacks", () => {
    expect(classifyWebPushError(webPushError(410)).expired).toBe(true);
    expect(classifyWebPushError(webPushError(404)).expired).toBe(true);
    expect(classifyWebPushError(webPushError(429)).expired).toBe(false);
    expect(classifyWebPushError(webPushError(500, "")).body).toBeNull();
    expect(
      classifyWebPushError(webPushError(500, "x".repeat(800))).body
    ).toHaveLength(500);
    expect(
      classifyWebPushError(webPushError(Number.NaN)).statusCode
    ).toBeNull();
    expect(
      classifyWebPushError(webPushError(Number.POSITIVE_INFINITY)).statusCode
    ).toBeNull();
    const conflicting = new Error("410 Gone expired");
    (conflicting as Error & { statusCode: number }).statusCode = 500;
    expect(classifyWebPushError(conflicting).expired).toBe(false);
    expect(
      classifyWebPushError(new Error("subscription expired")).expired
    ).toBe(true);
    expect(classifyWebPushError(new Error("410")).expired).toBe(true);
    expect(classifyWebPushError(new Error("Gone")).expired).toBe(true);
    expect(classifyWebPushError("plain").expired).toBe(false);
    expect(classifyWebPushError(410).expired).toBe(true);
    expect(classifyWebPushError(null).expired).toBe(false);
    expect(classifyWebPushError(500)).toEqual({
      statusCode: null,
      body: null,
      expired: false,
    });
  });
});

describe("push delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envState.APP_URL = "https://app.example.com";
    webPush.sendNotification.mockResolvedValue({ statusCode: 201 });
    prismaMock.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.pushSubscription.findMany.mockResolvedValue([]);
    prismaMock.user.update.mockResolvedValue({});
    settings.getRunwaySettings.mockResolvedValue({ redThresholdDays: 3 });
  });

  it("sends with normal or high urgency and classifies transport failures", async () => {
    await expect(
      sendPushNotification(subscription, {
        title: "Hi",
        body: "There",
        data: { action: "publish_success" },
      })
    ).resolves.toEqual({ sent: true });
    expect(webPush.sendNotification.mock.calls[0]?.[2]).toEqual({
      TTL: 86400,
      urgency: "normal",
    });
    expect(webPush.sendNotification.mock.calls[0]?.[0]).toEqual({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    });

    await sendPushNotification(subscription, {
      title: "Hi",
      body: "There",
    });
    expect(webPush.sendNotification.mock.calls[1]?.[2].urgency).toBe("normal");

    webPush.sendNotification.mockRejectedValueOnce(webPushError(410, "gone"));
    await expect(
      sendPushNotification(
        { ...subscription, endpoint: "not a url" },
        { title: "Hi", body: "There", data: { action: "publish_failure" } }
      )
    ).resolves.toEqual({ sent: false, expired: true });
    expect(logs.logInfo).toHaveBeenCalledWith(
      "Push subscription expired, pruning",
      expect.objectContaining({
        statusCode: 410,
        endpointHost: null,
        action: "publish_failure",
      })
    );
    expect(logs.logError).not.toHaveBeenCalled();

    const named = new Error("Received unexpected response code");
    named.name = "WebPushError";
    named.stack = "stack-line";
    (named as Error & { statusCode: number; body: string }).statusCode = 503;
    (named as Error & { body: string }).body = "later";
    webPush.sendNotification.mockRejectedValueOnce(named);
    await expect(
      sendPushNotification(subscription, {
        title: "Hi",
        body: "There",
        data: { action: "runway_low" },
      })
    ).resolves.toEqual({ sent: false, expired: false });
    const logged = logs.logError.mock.calls[0]?.[0];
    expect(logged).toBeInstanceOf(Error);
    expect((logged as Error).name).toBe("WebPushError");
    expect((logged as Error).message).toContain("push service status 503");
    expect((logged as Error).message).toContain("later");
    expect((logged as Error).stack).toBe("stack-line");

    webPush.sendNotification.mockRejectedValueOnce("socket down");
    await expect(
      sendPushNotification(subscription, { title: "Hi", body: "There" })
    ).resolves.toEqual({ sent: false, expired: false });
    const stringError = logs.logError.mock.calls[1]?.[0];
    expect((stringError as Error).name).toBe("PushError");
    expect((stringError as Error).message).toContain("status unknown");
    expect((stringError as Error).message).toContain("socket down");
    expect((stringError as Error).stack).not.toBe("stack-line");
  });

  it("counts deliveries and prunes only expired subscriptions", async () => {
    await expect(
      sendPushNotificationToUser("user-1", { title: "Hi", body: "There" })
    ).resolves.toEqual({ sent: 0, failed: 0 });
    expect(webPush.sendNotification).not.toHaveBeenCalled();

    prismaMock.pushSubscription.findMany.mockResolvedValue([
      { id: "ok", endpoint: "https://push.example/1", p256dh: "k", auth: "a" },
      {
        id: "gone",
        endpoint: "https://push.example/2",
        p256dh: "k",
        auth: "a",
      },
      { id: "", endpoint: "https://push.example/3", p256dh: "k", auth: "a" },
      {
        id: "later",
        endpoint: "https://push.example/4",
        p256dh: "k",
        auth: "a",
      },
    ]);
    webPush.sendNotification
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockRejectedValueOnce(webPushError(410))
      .mockRejectedValueOnce(webPushError(404))
      .mockRejectedValueOnce(webPushError(503));
    await expect(
      sendPushNotificationToUser("user-1", { title: "Hi", body: "There" })
    ).resolves.toEqual({ sent: 1, failed: 3 });
    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["gone"] } },
    });
  });

  it("builds publish success payloads from profile, preview, and asset urls", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await sendPublishSuccessNotification("user-1", "post-1", "attempt-1");
    expect(webPush.sendNotification).not.toHaveBeenCalled();

    prismaMock.user.findUnique.mockResolvedValue(
      enabledUser({ pushNotificationsEnabled: false })
    );
    await sendPublishSuccessNotification("user-1", "post-1", "attempt-1");
    prismaMock.user.findUnique.mockResolvedValue(
      enabledUser({ pushNotifyPublishSuccess: false })
    );
    await sendPublishSuccessNotification("user-1", "post-1", "attempt-1");
    expect(webPush.sendNotification).not.toHaveBeenCalled();

    prismaMock.user.findUnique.mockResolvedValue(
      enabledUser({ pushNotifyIncludePreview: false })
    );
    prismaMock.pushSubscription.findMany.mockResolvedValue([
      { id: "ok", endpoint: subscription.endpoint, p256dh: "k", auth: "a" },
    ]);
    await sendPublishSuccessNotification("user-1", "post-1", "attempt-1", {
      source: "scheduled",
      queueName: "Morning",
      postKind: "REPLY",
    });
    expect(prismaMock.post.findUnique).not.toHaveBeenCalled();
    const skipped = payloadFrom();
    expect(skipped.title).toContain("Ada");
    expect(skipped.icon).toBe(
      "https://app.example.com/api/notification-asset?url=https%3A%2F%2Fcdn.example%2Fa.png"
    );
    expect(skipped.image).toBe(skipped.icon);
    expect(skipped.data?.["postKind"]).toBe("REPLY");
    expect(skipped.data?.["queueName"]).toBe("Morning");
    expect(skipped.data?.["contentType"]).toBe("post");

    prismaMock.user.findUnique.mockResolvedValue(
      enabledUser({
        pushNotifyIncludePreview: null,
        nostrProfile: JSON.stringify({
          display_name: "  ",
          name: "Bea",
          picture: " HTTPS://cdn.example/b.png ",
        }),
      })
    );
    prismaMock.post.findUnique.mockResolvedValue({
      caption: "  hello   world \n today  ",
      content: "ignored",
    });
    envState.APP_URL = "https://app.example.com/base";
    await sendPublishSuccessNotification("user-1", "post-1", "attempt-1", {
      source: "immediate",
      queueName: null,
      postKind: "THREAD",
    });
    const preview = payloadFrom(1);
    expect(preview.title).toContain("Bea");
    expect(preview.body).toBe("hello world today");
    expect(preview.icon).toBe("HTTPS://cdn.example/b.png");
    expect(preview.data?.["queueName"]).toBeUndefined();

    prismaMock.post.findUnique.mockResolvedValue({
      caption: "",
      content: "from content",
    });
    await sendPublishSuccessNotification("user-1", "post-1", "attempt-1");
    expect(payloadFrom(2).body).not.toContain("from content");

    const longCaption = "word ".repeat(40);
    prismaMock.post.findUnique.mockResolvedValue({
      caption: longCaption,
      content: null,
    });
    await sendPublishSuccessNotification("user-1", "post-1", "attempt-1", {
      source: "scheduled",
      queueName: "  ",
    });
    expect(payloadFrom(3).body?.endsWith("…")).toBe(true);
    expect(payloadFrom(3).body?.startsWith("Scheduled queue ·")).toBe(true);
    expect(payloadFrom(3).body?.length).toBe(101);

    prismaMock.user.findUnique.mockResolvedValue(
      enabledUser({
        nostrProfile: { name: "  ", picture: "http://cdn.example/c.png" },
        npub: "npub-short",
      })
    );
    prismaMock.longFormPost.findUnique.mockResolvedValue({
      title: null,
      content: "Article body",
    });
    envState.APP_URL = "not a url";
    await sendPublishSuccessNotification("user-1", "post-1", "attempt-1", {
      isLongForm: true,
      source: "scheduled",
      queueName: "Night",
    });
    const article = payloadFrom(4);
    expect(article.data?.["contentType"]).toBe("article");
    expect(article.data?.["postKind"]).toBeUndefined();
    expect(article.icon).toBe("/icon-192.png");
    expect(article.title).toContain("npub-short");
    expect(article.body).toContain("Night");
    expect(article.body).toContain("Article body");

    prismaMock.longFormPost.findUnique.mockResolvedValue({
      title: "",
      content: "hidden",
    });
    prismaMock.user.findUnique.mockResolvedValue(
      enabledUser({ nostrProfile: "not-json", npub: "n".repeat(20) })
    );
    envState.APP_URL = "";
    await sendPublishSuccessNotification("user-1", "post-1", "attempt-1", {
      isLongForm: true,
    });
    expect(payloadFrom(5).title).toContain("nnnnnnnnnnnn…");
    expect(payloadFrom(5).body).not.toContain("hidden");

    prismaMock.longFormPost.findUnique.mockResolvedValue(null);
    prismaMock.post.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(
      enabledUser({ nostrProfile: ["nope"] })
    );
    await sendPublishSuccessNotification("user-1", "missing", "attempt-1");
    await sendPublishSuccessNotification("user-1", "missing", "attempt-1", {
      isLongForm: true,
    });
    expect(logs.logInfo).toHaveBeenCalledWith(
      "Publish success push notification dispatched",
      expect.objectContaining({ userId: "user-1", postId: "missing" })
    );
  });

  it("sends publish failure notifications only when enabled", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await sendPublishFailureNotification("user-1", "post-1", "attempt-1");
    prismaMock.user.findUnique.mockResolvedValue(
      enabledUser({ pushNotificationsEnabled: false })
    );
    await sendPublishFailureNotification(
      "user-1",
      "post-1",
      "attempt-1",
      "boom"
    );
    prismaMock.user.findUnique.mockResolvedValue(
      enabledUser({ pushNotifyPublishFailure: false })
    );
    await sendPublishFailureNotification("user-1", "post-1", "attempt-1");
    expect(webPush.sendNotification).not.toHaveBeenCalled();

    prismaMock.user.findUnique.mockResolvedValue(enabledUser());
    prismaMock.pushSubscription.findMany.mockResolvedValue([
      { id: "ok", endpoint: subscription.endpoint, p256dh: "k", auth: "a" },
    ]);
    await sendPublishFailureNotification("user-1", "post-1", "attempt-1");
    expect(payloadFrom().body).toBe(
      "Your post failed to publish. Please check and retry."
    );
    expect(payloadFrom().data?.["action"]).toBe("publish_failure");
    expect(payloadFrom().data?.["url"]).toBe(
      "/dashboard/scheduled?postId=post-1"
    );
    expect(webPush.sendNotification.mock.calls[0]?.[2].urgency).toBe("high");

    await sendPublishFailureNotification(
      "user-1",
      "post-1",
      "attempt-1",
      "Relay rejected the event"
    );
    expect(payloadFrom(1).body).toBe("Relay rejected the event");
  });

  it("throttles runway warnings and uses the configured threshold", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await sendRunwayLowNotification("user-1", 0);
    prismaMock.user.findUnique.mockResolvedValue(
      enabledUser({ pushNotificationsEnabled: false })
    );
    await sendRunwayLowNotification("user-1", 0);
    prismaMock.user.findUnique.mockResolvedValue(
      enabledUser({ pushNotifyRunwayLow: false })
    );
    await sendRunwayLowNotification("user-1", 0);
    expect(settings.getRunwaySettings).not.toHaveBeenCalled();

    prismaMock.user.findUnique.mockResolvedValue(
      enabledUser({ runwayNotifyBelowDays: 5 })
    );
    await sendRunwayLowNotification("user-1", 6);
    expect(webPush.sendNotification).not.toHaveBeenCalled();
    expect(getRunwaySettings).toHaveBeenCalledWith("user-1");

    prismaMock.pushSubscription.findMany.mockResolvedValue([
      { id: "ok", endpoint: subscription.endpoint, p256dh: "k", auth: "a" },
    ]);
    await sendRunwayLowNotification("user-1", 1);
    expect(payloadFrom().body).toBe(
      "Your runway has 1 day left. Schedule more posts to keep the flow."
    );
    await sendRunwayLowNotification("user-1", 0);
    expect(payloadFrom(1).body).toContain("0 days");
    expect(prismaMock.user.update).toHaveBeenCalledTimes(2);
    expect(
      prismaMock.user.update.mock.calls[0]?.[0].data.lastRunwayLowNotificationAt
    ).toBeInstanceOf(Date);

    prismaMock.user.findUnique.mockResolvedValue(
      enabledUser({
        runwayNotifyBelowDays: null,
        lastRunwayLowNotificationAt: new Date(Date.now() - 60 * 60 * 1000),
      })
    );
    settings.getRunwaySettings.mockResolvedValue({ redThresholdDays: 2 });
    await sendRunwayLowNotification("user-1", 2);
    expect(webPush.sendNotification).toHaveBeenCalledTimes(2);

    prismaMock.user.findUnique.mockResolvedValue(
      enabledUser({
        runwayNotifyBelowDays: null,
        lastRunwayLowNotificationAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      })
    );
    settings.getRunwaySettings.mockResolvedValue({ redThresholdDays: null });
    await sendRunwayLowNotification("user-1", 3);
    expect(payloadFrom(2).body).toContain("3 days");

    settings.getRunwaySettings.mockResolvedValue({});
    prismaMock.user.findUnique.mockResolvedValue(
      enabledUser({
        runwayNotifyBelowDays: null,
        lastRunwayLowNotificationAt: null,
      })
    );
    await sendRunwayLowNotification("user-1", 4);
    expect(webPush.sendNotification).toHaveBeenCalledTimes(3);
  });
});
