import { RouterContextProvider } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => {
  const featureFlags: { contestsV1Enabled: boolean } = {
    contestsV1Enabled: true,
  };
  return { featureFlags };
});

const auth = vi.hoisted(() => ({
  requireUserId: vi.fn(),
}));

const payments = vi.hoisted(() => ({
  requireAnySubscription: vi.fn(),
}));

const paymentsData = vi.hoisted(() => ({
  getUserSubscription: vi.fn(),
}));

const limitsApi = vi.hoisted(() => ({
  getEffectiveGiveawayPlanLimits: vi.fn(),
}));

const planApi = vi.hoisted(() => ({
  getPlanDisplayName: vi.fn(),
  getUserPlanType: vi.fn(),
}));

const posts = vi.hoisted(() => ({
  getRecentPublishedPosts: vi.fn(),
}));

const composer = vi.hoisted(() => ({
  loadNewPostData: vi.fn(),
}));

const users = vi.hoisted(() => ({
  getUserById: vi.fn(),
}));

const presets = vi.hoisted(() => ({
  getContestPresetById: vi.fn(),
}));

const drafts = vi.hoisted(() => ({
  findContestCreationDraftByUserId: vi.fn(),
}));

vi.mock("~/lib/feature-flags.server", () => flags);
vi.mock("~/features/auth/auth.server", () => auth);
vi.mock("~/features/payments", () => payments);
vi.mock("~/features/payments/data", () => paymentsData);
vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => limitsApi
);
vi.mock("~/features/payments/types", () => planApi);
vi.mock("~/features/posts/server", () => posts);
vi.mock("~/features/posts/server/composer", () => composer);
vi.mock("~/features/user", () => users);
vi.mock("~/features/contest/contest-presets.server", () => presets);
vi.mock(
  "~/features/contest/repositories/contest-creation-draft.server",
  () => drafts
);

import { asReturn, buildPreset } from "./contest-test-doubles";

import { requireUserId } from "~/features/auth/auth.server";
import { contestNewLoader } from "~/features/contest/contest-new-route.loader.server";
import { getContestPresetById } from "~/features/contest/contest-presets.server";
import { findContestCreationDraftByUserId } from "~/features/contest/repositories/contest-creation-draft.server";
import { requireAnySubscription } from "~/features/payments";
import { getUserSubscription } from "~/features/payments/data";
import { getEffectiveGiveawayPlanLimits } from "~/features/payments/entitlements/deployment-mode.server";
import { getPlanDisplayName, getUserPlanType } from "~/features/payments/types";
import { getRecentPublishedPosts } from "~/features/posts/server";
import { loadNewPostData } from "~/features/posts/server/composer";
import { getUserById } from "~/features/user";

function loaderArgs(search = ""): LoaderFunctionArgs {
  const request = new Request(
    `http://localhost/dashboard/contests/new${search}`
  );
  return {
    request,
    params: {},
    context: new RouterContextProvider(),
    url: new URL(request.url),
    pattern: "*",
  };
}

describe("contestNewLoader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    flags.featureFlags.contestsV1Enabled = true;
    vi.mocked(requireUserId).mockResolvedValue("user-1");
    vi.mocked(requireAnySubscription).mockResolvedValue(undefined);
    vi.mocked(loadNewPostData).mockResolvedValue(
      asReturn({ relays: ["wss://relay.example"] })
    );
    vi.mocked(getRecentPublishedPosts).mockResolvedValue([]);
    vi.mocked(getUserSubscription).mockResolvedValue(null);
    vi.mocked(getUserPlanType).mockReturnValue("pro");
    vi.mocked(getPlanDisplayName).mockReturnValue("Pro");
    vi.mocked(getEffectiveGiveawayPlanLimits).mockReturnValue({
      maxWinnerCount: 50,
      canUseQueueScope: true,
      canUsePresets: true,
    });
    vi.mocked(getUserById).mockResolvedValue(
      asReturn({ timezone: "Europe/Kyiv" })
    );
    vi.mocked(findContestCreationDraftByUserId).mockResolvedValue(null);
  });

  it("throws not found when contests are disabled", async () => {
    flags.featureFlags.contestsV1Enabled = false;
    await expect(contestNewLoader(loaderArgs())).rejects.toMatchObject({
      status: 404,
    });
    expect(requireUserId).not.toHaveBeenCalled();
  });

  it("returns composer data, filtered posts, and no preset without a usable id", async () => {
    const publishedAt = new Date("2026-05-01T00:00:00.000Z");
    const postsForUser = [
      { id: "missing-note", nostrEventId: "  ", caption: "skip" },
      ...Array.from({ length: 51 }, (_, index) => ({
        id: `post-${index}`,
        nostrEventId: `event-${index}`,
        caption: index === 0 ? null : `caption ${index}`,
        publishedAt: index === 1 ? "not-a-date" : publishedAt,
        fileUrl: [`https://cdn.example/${index}.png`],
        postType: "IMAGE",
      })),
    ];
    vi.mocked(getRecentPublishedPosts).mockResolvedValue(
      asReturn(postsForUser)
    );
    vi.mocked(getUserById).mockResolvedValueOnce(null);
    vi.mocked(findContestCreationDraftByUserId).mockResolvedValueOnce(
      asReturn({ payload: { step: 2 } })
    );

    const data = await contestNewLoader(loaderArgs("?preset=   "));

    expect(data).toMatchObject({
      relays: ["wss://relay.example"],
      planType: "pro",
      planLabel: "Pro",
      presetDefaults: null,
      canUsePresets: true,
      userTimezone: "UTC",
      savedContestDraft: { step: 2 },
    });
    expect(data.posts).toHaveLength(50);
    expect(data.posts[0]).toMatchObject({
      id: "post-0",
      caption: null,
      publishedAt: publishedAt.toISOString(),
    });
    expect(data.posts[1]?.publishedAt).toBe("");
    expect(data.posts[49]?.id).toBe("post-49");
    expect(getContestPresetById).not.toHaveBeenCalled();
    expect(getRecentPublishedPosts).toHaveBeenCalledWith({
      userId: "user-1",
      days: 90,
    });
  });

  it("skips preset lookup when the plan cannot use presets", async () => {
    vi.mocked(getEffectiveGiveawayPlanLimits).mockReturnValue({
      maxWinnerCount: 3,
      canUseQueueScope: false,
      canUsePresets: false,
    });
    const data = await contestNewLoader(loaderArgs("?preset=preset-1"));
    expect(data.canUsePresets).toBe(false);
    expect(data.presetDefaults).toBeNull();
    expect(getContestPresetById).not.toHaveBeenCalled();
  });

  it("loads preset defaults and treats a missing preset or draft payload as null", async () => {
    vi.mocked(getContestPresetById).mockResolvedValueOnce(null);
    vi.mocked(findContestCreationDraftByUserId).mockResolvedValueOnce(
      asReturn({})
    );
    const missing = await contestNewLoader(loaderArgs("?preset=preset-1"));
    expect(missing.presetDefaults).toBeNull();
    expect(missing.savedContestDraft).toBeNull();
    expect(missing.userTimezone).toBe("Europe/Kyiv");

    vi.mocked(getContestPresetById).mockResolvedValueOnce(
      buildPreset({
        title: null,
        equalRewardSats: null,
        rankRewards: null,
        fairnessConfig: null,
        prizeMode: "RANKED",
        winnerCount: 3,
      })
    );
    const found = await contestNewLoader(loaderArgs("?preset= preset-1 "));
    expect(getContestPresetById).toHaveBeenLastCalledWith("user-1", "preset-1");
    expect(found.presetDefaults).toEqual({
      id: "preset-1",
      title: null,
      rankingMetric: "ZAPS",
      prizeMode: "RANKED",
      winnerCount: 3,
      equalRewardSats: 0,
      rankRewards: null,
      fairnessConfig: null,
    });
  });
});
