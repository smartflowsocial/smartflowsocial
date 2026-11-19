import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  post: { count: vi.fn() },
  publicStatsSnapshot: { create: vi.fn() },
  user: {
    findUnique: vi.fn(),
    update: vi.fn(
      (_args: {
        where: { id: string };
        data: { hideFromLanding?: boolean };
      }): Promise<{ id: string }> => Promise.resolve({ id: "user-1" })
    ),
  },
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));

import {
  findAvatarSubject,
  findLandingPresence,
  markLandingNoticeSeen,
  queryPublicStats,
  saveStatsSnapshot,
  setLandingVisibility,
} from "~/features/public-stats/repositories/public-stats-data.server";
import type { PublicStats } from "~/features/public-stats/stats-payload";

function queuePopulatedResults(): void {
  prismaMock.$queryRaw
    .mockResolvedValueOnce([{ n: 10 }])
    .mockResolvedValueOnce([{ n: 4n }])
    .mockResolvedValueOnce([{ n: 2 }])
    .mockResolvedValueOnce([{ on_time: 1n, total: 2n }])
    .mockResolvedValueOnce([{ n: 3 }])
    .mockResolvedValueOnce([{ since: new Date("2020-05-06T00:00:00.000Z") }])
    .mockResolvedValueOnce([
      {
        userId: "user-1",
        npub: "npub1example",
        nostrProfile: {
          display_name: "Ada",
          picture: "https://cdn.example/a.png",
        },
        publishedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      {
        userId: "user-2",
        npub: "npub1hidden",
        nostrProfile: { name: "No Picture" },
        publishedAt: new Date("2026-01-03T00:00:00.000Z"),
      },
      {
        userId: "user-3",
        npub: "npub1stale",
        nostrProfile: { picture: "https://cdn.example/b.png" },
        publishedAt: "2026-01-01",
      },
    ]);
  prismaMock.post.count.mockResolvedValueOnce(7);
}

describe("public stats repository", () => {
  beforeEach(() => {
    prismaMock.$queryRaw.mockReset();
    prismaMock.post.count.mockReset();
    prismaMock.publicStatsSnapshot.create.mockReset();
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.update.mockReset();
  });

  it("maps populated query rows into the public payload", async () => {
    queuePopulatedResults();

    const stats = await queryPublicStats("https://smartflow.social/");

    expect(stats.posts_published_total).toBe(10);
    expect(stats.posts_published_30d).toBe(4);
    expect(stats.posts_scheduled_now).toBe(2);
    expect(stats.reposts_scheduled_total).toBe(7);
    expect(stats.on_time_rate_30d).toBe(0.5);
    expect(stats.active_accounts_30d).toBe(3);
    expect(stats.running_since).toBe("2020-05-06");
    expect(stats.people).toEqual([
      {
        npub: "npub1example",
        name: "Ada",
        picture: "https://smartflow.social/api/public/avatar/npub1example",
      },
    ]);
    expect(stats.v).toBe(1);
  });

  it("returns zeros when the queries are empty", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.post.count.mockResolvedValue(0);

    const stats = await queryPublicStats("https://smartflow.social");

    expect(stats.posts_published_total).toBe(0);
    expect(stats.on_time_rate_30d).toBeNull();
    expect(stats.running_since).toBeNull();
    expect(stats.people).toEqual([]);
    expect(stats.posts_scheduled_now).toBe(0);
  });

  it("writes snapshots and landing-page user rows", async () => {
    const payload = { v: 1, people: [] } as unknown as PublicStats;
    prismaMock.publicStatsSnapshot.create.mockResolvedValue({ id: "snap-1" });
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ hideFromLanding: false, nostrProfile: null })
      .mockResolvedValueOnce({
        npub: "npub1example",
        hideFromLanding: true,
        landingNoticeSeenAt: null,
      });
    prismaMock.user.update.mockResolvedValue({ id: "user-1" });

    await expect(saveStatsSnapshot(payload)).resolves.toEqual({ id: "snap-1" });
    expect(prismaMock.publicStatsSnapshot.create).toHaveBeenCalledWith({
      data: { payload },
    });

    await expect(findAvatarSubject("npub1example")).resolves.toEqual({
      hideFromLanding: false,
      nostrProfile: null,
    });
    await expect(findLandingPresence("user-1")).resolves.toMatchObject({
      npub: "npub1example",
    });

    await markLandingNoticeSeen("user-1");
    await setLandingVisibility("user-1", true);
    const visibilityCall = prismaMock.user.update.mock.calls.find(
      (call) => call[0].data.hideFromLanding === true
    );
    expect(visibilityCall?.[0].where).toEqual({ id: "user-1" });
  });
});
