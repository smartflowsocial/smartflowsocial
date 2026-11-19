import { SubscriptionStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  longFormPost: { groupBy: vi.fn() },
  post: { groupBy: vi.fn() },
  productSession: { groupBy: vi.fn() },
  referral: { findMany: vi.fn(), groupBy: vi.fn() },
  signerReconnectEvent: { groupBy: vi.fn() },
  user: { count: vi.fn(), findMany: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));

import { getAdminUsersPageData } from "~/features/admin/repositories/admin-users-queries.server";

const HEX_PUBKEY = "a".repeat(64);

const NIP46_PROFILE = {
  type: "nip46",
  method: "bunker_input",
  bunkerInput: "bunker://alice",
  label: null,
  expectedPubkey: null,
  updatedAt: "2026-06-01T00:00:00.000Z",
};

interface DirectoryUser {
  Subscription: {
    createdAt: Date;
    plan: string | null;
    startDate: Date | null;
    status: SubscriptionStatus;
  } | null;
  _count: { longFormPosts: number; media: number; notes: number };
  createdAt: Date;
  engagementLastCheckedAt: Date | null;
  id: string;
  isEnabled: boolean;
  nostrProfile: unknown;
  npub: string;
  nwcLastUsed: Date | null;
  primarySignerProfile: unknown;
  updatedAt: Date;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function baseUser(overrides: Partial<DirectoryUser> = {}): DirectoryUser {
  return {
    id: "user",
    npub: "npub-user",
    nostrProfile: null,
    isEnabled: true,
    createdAt: daysAgo(10),
    updatedAt: daysAgo(1),
    engagementLastCheckedAt: null,
    nwcLastUsed: null,
    primarySignerProfile: null,
    Subscription: null,
    _count: { notes: 0, longFormPosts: 0, media: 0 },
    ...overrides,
  };
}

interface MockReset {
  mockReset: () => void;
}

function isMockReset(value: unknown): value is MockReset {
  if (typeof value !== "function" || !("mockReset" in value)) return false;
  return typeof value.mockReset === "function";
}

function resetTree(tree: Record<string, unknown>): void {
  for (const value of Object.values(tree)) {
    if (isMockReset(value)) {
      value.mockReset();
      continue;
    }
    if (value && typeof value === "object") {
      resetTree(value as Record<string, unknown>);
    }
  }
}

describe("getAdminUsersPageData", () => {
  beforeEach(() => {
    resetTree(prismaMock);
    prismaMock.longFormPost.groupBy.mockResolvedValue([]);
    prismaMock.post.groupBy.mockResolvedValue([]);
    prismaMock.productSession.groupBy.mockResolvedValue([]);
    prismaMock.referral.findMany.mockResolvedValue([]);
    prismaMock.referral.groupBy.mockResolvedValue([]);
    prismaMock.signerReconnectEvent.groupBy.mockResolvedValue([]);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findMany.mockResolvedValue([]);
  });

  it("returns an empty page without loading per-user activity", async () => {
    prismaMock.user.count.mockResolvedValue(0);

    const data = await getAdminUsersPageData({});

    expect(data).toMatchObject({
      users: [],
      total: 0,
      page: 1,
      pageSize: 30,
      filter: "all",
      sort: "createdAt",
      search: "",
    });
    expect(prismaMock.user.count).toHaveBeenCalled();
    expect(prismaMock.referral.groupBy).toHaveBeenCalled();
    expect(prismaMock.post.groupBy).not.toHaveBeenCalled();
    expect(prismaMock.productSession.groupBy).not.toHaveBeenCalled();
    expect(prismaMock.signerReconnectEvent.groupBy).not.toHaveBeenCalled();
  });

  it("returns no rows when the referred filter matches nobody", async () => {
    prismaMock.referral.findMany.mockResolvedValueOnce([]);

    const data = await getAdminUsersPageData({
      filter: "referred",
      page: -3,
      search: "  Hi ",
      sort: "published",
    });

    expect(data).toEqual({
      users: [],
      total: 0,
      page: 1,
      pageSize: 30,
      filter: "referred",
      sort: "published",
      search: "  Hi ",
    });
    expect(prismaMock.user.count).not.toHaveBeenCalled();
  });

  it("applies directory filters, search, paging, and fallback sort", async () => {
    prismaMock.referral.findMany.mockResolvedValue([
      { referredNpub: "npub-referred" },
    ]);

    await getAdminUsersPageData({ filter: "enabled", search: "  AbC " });
    expect(prismaMock.user.count).toHaveBeenCalledWith({
      where: {
        isEnabled: true,
        AND: [
          {
            OR: [
              { npub: { contains: "abc", mode: "insensitive" } },
              { id: { contains: "abc", mode: "insensitive" } },
            ],
          },
        ],
      },
    });

    await getAdminUsersPageData({ filter: "disabled" });
    expect(prismaMock.user.count).toHaveBeenCalledWith({
      where: { isEnabled: false },
    });

    await getAdminUsersPageData({ filter: "paid" });
    expect(prismaMock.user.count).toHaveBeenCalledWith({
      where: { Subscription: { status: SubscriptionStatus.ACTIVE } },
    });

    const referred = await getAdminUsersPageData({ filter: "referred" });
    expect(referred.total).toBe(0);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { npub: { in: ["npub-referred"] } },
      })
    );

    const first = await getAdminUsersPageData({ page: 0, sort: "nope" });
    expect(first.page).toBe(1);
    expect(first.sort).toBe("createdAt");
    expect(prismaMock.user.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 30,
        orderBy: { createdAt: "desc" },
      })
    );

    const second = await getAdminUsersPageData({ page: 2 });
    expect(second.page).toBe(2);
    expect(second.pageSize).toBe(30);
    expect(prismaMock.user.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ skip: 30, take: 30 })
    );
    expect(prismaMock.referral.findMany).toHaveBeenCalled();
  });

  it("sorts the page by published count", async () => {
    prismaMock.user.count.mockResolvedValue(3);
    prismaMock.user.findMany.mockResolvedValue([
      baseUser({
        id: "low",
        _count: { notes: 1, longFormPosts: 0, media: 0 },
      }),
      baseUser({
        id: "high",
        _count: { notes: 5, longFormPosts: 1, media: 0 },
      }),
      baseUser({
        id: "mid",
        _count: { notes: 0, longFormPosts: 4, media: 2 },
      }),
    ]);

    const data = await getAdminUsersPageData({ sort: "published" });

    expect(data.sort).toBe("published");
    expect(data.users.map((user) => [user.id, user.publishedPosts])).toEqual([
      ["high", 6],
      ["mid", 4],
      ["low", 1],
    ]);
    expect(data.users[1]?.mediaCount).toBe(2);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } })
    );
  });

  it("re-sorts last activity after the database updatedAt order", async () => {
    const recent = daysAgo(0.1);
    const mid = daysAgo(1);
    const overridden = daysAgo(0.5);
    prismaMock.user.findMany.mockResolvedValue([
      baseUser({ id: "mid", updatedAt: mid }),
      baseUser({
        id: "old",
        updatedAt: daysAgo(5),
        engagementLastCheckedAt: overridden,
      }),
      baseUser({
        id: "recent",
        updatedAt: daysAgo(5),
        nwcLastUsed: recent,
      }),
    ]);

    const data = await getAdminUsersPageData({ sort: "lastActive" });

    expect(data.sort).toBe("lastActive");
    expect(data.users.map((user) => user.id)).toEqual(["recent", "old", "mid"]);
    expect(data.users[0]?.lastActivityAt).toBe(recent.toISOString());
    expect(data.users[1]?.lastActivityAt).toBe(overridden.toISOString());
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: "desc" } })
    );
  });

  it("maps profiles, segments, referrals, and signer health", async () => {
    const establishedEngagement = daysAgo(0.1);
    const establishedFirst = daysAgo(40);
    const activatingFirst = daysAgo(4);
    const powerFirst = daysAgo(3);
    const subStarted = new Date("2026-01-01T00:00:00.000Z");
    const subCreated = new Date("2026-02-01T00:00:00.000Z");
    const powerUpdated = daysAgo(1);

    prismaMock.user.count.mockResolvedValue(10);
    prismaMock.referral.groupBy.mockResolvedValue([
      { referrerNpub: "npub-established", _count: { _all: 3 } },
    ]);
    prismaMock.referral.findMany.mockResolvedValue([
      { referredNpub: "npub-activating" },
    ]);
    prismaMock.post.groupBy.mockImplementation(
      (args: {
        _count?: unknown;
        _max?: unknown;
        _min?: unknown;
        where?: { publishedAt?: unknown };
      }) => {
        if (args._max) {
          return Promise.resolve([
            {
              userId: "u-established",
              _max: { publishedAt: daysAgo(2) },
            },
            { userId: "u-dormant", _max: { publishedAt: null } },
          ]);
        }
        if (args._min) {
          return Promise.resolve([
            {
              userId: "u-established",
              _min: { publishedAt: establishedFirst },
            },
            {
              userId: "u-activating",
              _min: { publishedAt: activatingFirst },
            },
          ]);
        }
        if (args.where?.publishedAt) {
          return Promise.resolve([
            { userId: "u-power-recent", _count: { _all: 5 } },
            { userId: "u-established", _count: { _all: 1 } },
          ]);
        }
        return Promise.resolve([
          { userId: "u-established", _count: { _all: 2 } },
          { userId: "u-activating", _count: { _all: 1 } },
        ]);
      }
    );
    prismaMock.longFormPost.groupBy.mockImplementation(
      (args: {
        _max?: unknown;
        _min?: unknown;
        where?: { publishedAt?: unknown };
      }) => {
        if (args._max) {
          return Promise.resolve([
            {
              userId: "u-established",
              _max: { publishedAt: daysAgo(1) },
            },
          ]);
        }
        if (args._min) {
          return Promise.resolve([
            {
              userId: "u-established",
              _min: { publishedAt: daysAgo(10) },
            },
            { userId: "u-power-count", _min: { publishedAt: powerFirst } },
          ]);
        }
        if (args.where?.publishedAt) {
          return Promise.resolve([
            { userId: "u-power-recent", _count: { _all: 5 } },
          ]);
        }
        return Promise.resolve([
          { userId: "u-established", _count: { _all: 3 } },
        ]);
      }
    );
    prismaMock.productSession.groupBy.mockResolvedValue([
      { userId: "u-established", _count: { _all: 4 } },
    ]);
    prismaMock.signerReconnectEvent.groupBy.mockResolvedValue([
      { userId: "u-established", _count: { _all: 2 } },
    ]);
    prismaMock.user.findMany.mockResolvedValue([
      baseUser({
        id: "u-new-young",
        npub: HEX_PUBKEY,
        nostrProfile: true,
        createdAt: daysAgo(3),
      }),
      baseUser({
        id: "u-power-count",
        npub: "npub-power",
        nostrProfile: JSON.stringify({
          displayName: "Ada Lovelace",
          picture: "https://cdn.example/ada.png",
        }),
        createdAt: daysAgo(100),
        updatedAt: powerUpdated,
        primarySignerProfile: NIP46_PROFILE,
        Subscription: {
          status: SubscriptionStatus.ACTIVE,
          plan: "  pro  ",
          startDate: subStarted,
          createdAt: subCreated,
        },
        _count: { notes: 20, longFormPosts: 0, media: 1 },
      }),
      baseUser({
        id: "u-power-recent",
        npub: "npub-recent",
        nostrProfile: {
          display_name: "Grace",
          picture: "https://cdn.example/grace.png",
        },
        createdAt: daysAgo(40),
        _count: { notes: 1, longFormPosts: 0, media: 0 },
      }),
      baseUser({
        id: "u-dormant",
        npub: "npub-dormant",
        nostrProfile: "{",
        isEnabled: false,
        createdAt: daysAgo(80),
        updatedAt: daysAgo(30),
        Subscription: {
          status: SubscriptionStatus.CANCELED,
          plan: "pro",
          startDate: null,
          createdAt: subCreated,
        },
        _count: { notes: 3, longFormPosts: 0, media: 0 },
      }),
      baseUser({
        id: "u-at-risk-posts",
        npub: "npub-risk",
        nostrProfile: { name: "  Pat  ", picture: "  " },
        createdAt: daysAgo(60),
        updatedAt: daysAgo(2),
        Subscription: {
          status: SubscriptionStatus.ACTIVE,
          plan: "plus",
          startDate: null,
          createdAt: subCreated,
        },
        _count: { notes: 6, longFormPosts: 0, media: 0 },
      }),
      baseUser({
        id: "u-at-risk-zero",
        npub: "npub-risk-zero",
        nostrProfile: { display_name: "   " },
        createdAt: daysAgo(40),
        Subscription: {
          status: SubscriptionStatus.ACTIVE,
          plan: null,
          startDate: null,
          createdAt: subCreated,
        },
      }),
      baseUser({
        id: "u-activating",
        npub: "npub-activating",
        nostrProfile: { name: "Bob" },
        createdAt: daysAgo(10),
        _count: { notes: 3, longFormPosts: 0, media: 0 },
      }),
      baseUser({
        id: "u-established",
        npub: "npub-established",
        createdAt: daysAgo(50),
        updatedAt: daysAgo(3),
        engagementLastCheckedAt: establishedEngagement,
        _count: { notes: 8, longFormPosts: 4, media: 7 },
      }),
      baseUser({
        id: "u-new-older",
        npub: "npub-older",
        nostrProfile: { displayName: "  ", name: "Bob", picture: 12 },
        createdAt: daysAgo(20),
        Subscription: {
          status: SubscriptionStatus.INACTIVE,
          plan: "plus",
          startDate: subStarted,
          createdAt: subCreated,
        },
      }),
      baseUser({
        id: "u-dormant-zero",
        npub: "npub-quiet",
        nostrProfile: {
          name: "Cara",
          picture: " https://cdn.example/c.png ",
        },
        createdAt: daysAgo(40),
        updatedAt: daysAgo(25),
      }),
    ]);

    const data = await getAdminUsersPageData({});
    const byId = new Map(data.users.map((user) => [user.id, user]));

    expect(data.total).toBe(10);
    expect(data.users.map((user) => user.segment)).toEqual([
      "new",
      "power",
      "power",
      "dormant",
      "at_risk",
      "at_risk",
      "activating",
      "established",
      "new",
      "dormant",
    ]);
    expect(byId.get("u-new-young")?.npub.startsWith("npub1")).toBe(true);
    expect(byId.get("u-new-young")?.npub).not.toBe(HEX_PUBKEY);
    expect(byId.get("u-new-young")?.displayName).toBeNull();
    expect(byId.get("u-new-young")?.firstPublishedAt).toBeNull();
    expect(byId.get("u-power-count")).toMatchObject({
      displayName: "Ada Lovelace",
      pictureUrl: "https://cdn.example/ada.png",
      planLabel: "pro",
      signerModality: "nip46",
      publishedPosts: 20,
      segment: "power",
      subscriptionStartedAt: subStarted.toISOString(),
      firstPublishedAt: powerFirst.toISOString(),
      lastActivityAt: powerUpdated.toISOString(),
    });
    expect(byId.get("u-power-recent")).toMatchObject({
      displayName: "Grace",
      pictureUrl: "https://cdn.example/grace.png",
      recent7dPublishes: 10,
      segment: "power",
      signerModality: "other",
    });
    expect(byId.get("u-dormant")).toMatchObject({
      displayName: null,
      isEnabled: false,
      planLabel: "canceled",
      segment: "dormant",
      subscriptionStartedAt: subCreated.toISOString(),
    });
    expect(byId.get("u-at-risk-posts")).toMatchObject({
      displayName: "Pat",
      pictureUrl: null,
      planLabel: "plus",
      segment: "at_risk",
      publishedPosts: 6,
    });
    expect(byId.get("u-at-risk-zero")).toMatchObject({
      displayName: null,
      planLabel: "active",
      segment: "at_risk",
    });
    expect(byId.get("u-activating")).toMatchObject({
      displayName: "Bob",
      referralAttributed: true,
      scheduledPosts: 1,
      firstPublishedAt: activatingFirst.toISOString(),
      segment: "activating",
    });
    expect(byId.get("u-established")).toMatchObject({
      displayName: null,
      publishedPosts: 12,
      scheduledPosts: 5,
      mediaCount: 7,
      referralCount: 3,
      referralAttributed: false,
      recent7dPublishes: 1,
      sessionsIn30d: 4,
      reconnectFailures30d: 2,
      segment: "established",
      planLabel: "none",
      firstPublishedAt: establishedFirst.toISOString(),
      lastActivityAt: establishedEngagement.toISOString(),
    });
    expect(byId.get("u-new-older")).toMatchObject({
      displayName: null,
      pictureUrl: null,
      planLabel: "inactive",
      segment: "new",
      subscriptionStartedAt: subStarted.toISOString(),
    });
    expect(byId.get("u-dormant-zero")).toMatchObject({
      displayName: "Cara",
      pictureUrl: "https://cdn.example/c.png",
      segment: "dormant",
      publishedPosts: 0,
    });
    expect(prismaMock.post.groupBy).toHaveBeenCalled();
    expect(prismaMock.productSession.groupBy).toHaveBeenCalled();
    expect(prismaMock.signerReconnectEvent.groupBy).toHaveBeenCalled();
  });
});
