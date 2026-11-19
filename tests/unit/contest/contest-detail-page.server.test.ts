import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  getContestById: vi.fn(),
  getContestByIdPublic: vi.fn(),
}));

const feeApi = vi.hoisted(() => ({
  quoteContestFinalization: vi.fn(),
}));

const profilesApi = vi.hoisted(() => ({
  fetchContestPubkeyProfiles: vi.fn(),
}));

const resolver = vi.hoisted(() => ({
  resolveContestEntries: vi.fn(),
}));

const detailQueries = vi.hoisted(() => ({
  findContestEntriesForDetail: vi.fn(),
  findContestEventLogs: vi.fn(),
  findContestLaunchOrchestrationForDetail: vi.fn(),
  findContestWinnersWithEntries: vi.fn(),
  findLatestContestSnapshot: vi.fn(),
}));

const finalization = vi.hoisted(() => ({
  listContestFinalizationRecords: vi.fn(),
}));

const paymentsCharge = vi.hoisted(() => ({
  resolveFinalizationCollection: vi.fn(),
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
  getPostById: vi.fn(),
}));

const users = vi.hoisted(() => ({
  getUserNWC: vi.fn(),
  hasUsableNwc: vi.fn(),
}));

vi.mock("~/features/contest/contest-actions.server", () => actions);
vi.mock("~/features/contest/contest-finalization-fee.server", () => feeApi);
vi.mock("~/features/contest/contest-pubkey-profiles.server", () => profilesApi);
vi.mock("~/features/contest/contest-resolver.server", () => resolver);
vi.mock(
  "~/features/contest/repositories/contest-detail-queries.server",
  () => detailQueries
);
vi.mock(
  "~/features/contest/repositories/contest-finalization-payment.server",
  () => finalization
);
vi.mock(
  "~/features/payments/campaign-finalization-charge",
  () => paymentsCharge
);
vi.mock("~/features/payments/data", () => paymentsData);
vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => limitsApi
);
vi.mock("~/features/payments/types", () => planApi);
vi.mock("~/features/posts/server", () => posts);
vi.mock("~/features/user", () => users);

import {
  asContestJson,
  asReturn,
  buildContest,
  match,
} from "./contest-test-doubles";

import {
  getContestById,
  getContestByIdPublic,
} from "~/features/contest/contest-actions.server";
import {
  getContestDetailPageData,
  getContestPublicPageData,
} from "~/features/contest/contest-detail-page.server";
import { quoteContestFinalization } from "~/features/contest/contest-finalization-fee.server";
import { fetchContestPubkeyProfiles } from "~/features/contest/contest-pubkey-profiles.server";
import { resolveContestEntries } from "~/features/contest/contest-resolver.server";
import type { ContestResolvedEntry } from "~/features/contest/contest-resolver.server";
import {
  findContestEntriesForDetail,
  findContestEventLogs,
  findContestLaunchOrchestrationForDetail,
  findContestWinnersWithEntries,
  findLatestContestSnapshot,
} from "~/features/contest/repositories/contest-detail-queries.server";
import { listContestFinalizationRecords } from "~/features/contest/repositories/contest-finalization-payment.server";
import { resolveFinalizationCollection } from "~/features/payments/campaign-finalization-charge";
import { getUserSubscription } from "~/features/payments/data";
import { getEffectiveGiveawayPlanLimits } from "~/features/payments/entitlements/deployment-mode.server";
import { getPlanDisplayName, getUserPlanType } from "~/features/payments/types";
import { getPostById } from "~/features/posts/server";
import { getUserNWC, hasUsableNwc } from "~/features/user";

const policyQuote = {
  plannedPayoutSats: 3000,
  feeRateBps: 1000,
  feeSats: 300,
  waivedByPlan: false,
  lockConfigHash: "policy-hash",
};

const collectionQuote = {
  ...policyQuote,
  feeRateBps: 500,
  feeSats: 150,
  waivedByPlan: true,
  lockConfigHash: "collection-hash",
};

function resolved(index: number): ContestResolvedEntry {
  return {
    entryEventId: `evt-${index}`,
    authorPubkey: index === 1 ? "pk-0" : `pk-${index}`,
    createdAtUnix: 100 + index,
    replySnippet: index === 0 ? undefined : `reply ${index}`,
    reactionsCount: 1,
    zapCount: 2,
    satsZapped: 3,
    repliesCount: 4,
    repostsCount: 5,
    score: 100 - index,
  };
}

function entry(overrides: Record<string, unknown>) {
  return {
    rank: 1,
    score: 1,
    authorPubkey: "pk-entry",
    entryEventId: "evt-entry",
    replySnippet: "hello",
    createdAtUnix: 10,
    reactionsCount: 1,
    zapCount: 2,
    satsZapped: 3,
    repliesCount: 4,
    repostsCount: 5,
    isExcluded: false,
    exclusionReason: null,
    ...overrides,
  };
}

describe("contest detail and public pages", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getContestById).mockResolvedValue(buildContest());
    vi.mocked(getContestByIdPublic).mockResolvedValue(null);
    vi.mocked(getUserNWC).mockResolvedValue({
      enabled: true,
      maskedString: "masked",
      lastUsed: new Date("2026-05-02T03:04:00.000Z"),
    });
    vi.mocked(hasUsableNwc).mockResolvedValue(true);
    vi.mocked(getUserSubscription).mockResolvedValue(null);
    vi.mocked(getUserPlanType).mockReturnValue("starter");
    vi.mocked(getPlanDisplayName).mockReturnValue("Starter");
    vi.mocked(getEffectiveGiveawayPlanLimits).mockReturnValue({
      maxWinnerCount: 10,
      canUseQueueScope: false,
      canUsePresets: true,
    });
    vi.mocked(quoteContestFinalization).mockReturnValue(policyQuote);
    vi.mocked(resolveFinalizationCollection).mockReturnValue({
      kind: "collect",
      quote: collectionQuote,
      expireIds: [],
    });
    vi.mocked(listContestFinalizationRecords).mockResolvedValue([]);
    vi.mocked(getPostById).mockResolvedValue(null);
    vi.mocked(resolveContestEntries).mockResolvedValue([]);
    vi.mocked(findContestWinnersWithEntries).mockResolvedValue(asReturn([]));
    vi.mocked(findContestEntriesForDetail).mockResolvedValue(asReturn([]));
    vi.mocked(findLatestContestSnapshot).mockResolvedValue(null);
    vi.mocked(findContestEventLogs).mockResolvedValue(asReturn([]));
    vi.mocked(findContestLaunchOrchestrationForDetail).mockResolvedValue(null);
    vi.mocked(fetchContestPubkeyProfiles).mockResolvedValue({});
  });

  it("returns null when the contest is missing", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(null);
    await expect(
      getContestDetailPageData("user-1", "missing")
    ).resolves.toBeNull();
    expect(getUserNWC).not.toHaveBeenCalled();
  });

  it("builds a draft without a leaderboard and maps logs, quote, and nwc", async () => {
    vi.mocked(findContestEventLogs).mockResolvedValueOnce(
      asReturn([
        {
          id: "log-1",
          eventType: "contest_created",
          message: "Contest created as draft",
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          metadata: { source: "test" },
        },
      ])
    );

    const page = await getContestDetailPageData("user-1", "contest-1");
    expect(page).toMatchObject({
      contest: {
        id: "contest-1",
        title: "Summer zap contest",
        status: "DRAFT",
        statusLabel: "Draft",
        plannedPayoutSats: 2000,
        finalizationFeeSats: 200,
        finalizationFeeRateBps: 500,
        lockConfigHash: "lock-hash",
        planLabel: "Starter",
      },
      quote: {
        plannedPayoutSats: 3000,
        feeSats: 150,
        feeRateBps: 500,
        lockConfigHash: "collection-hash",
        waivedByPlan: true,
        feeSettled: false,
      },
      sourcePost: null,
      livePreview: [],
      liveStats: null,
      winners: [],
      leaderboardEligible: [],
      leaderboardExcluded: [],
      snapshot: null,
      receiptSummaryLine: null,
      publicSummaryText: null,
      winnerAnnouncementText: null,
      fairnessProofText: null,
      launchOrchestration: null,
      canUsePresets: true,
      payoutSummary: {
        winnerSlots: 0,
        paidOrSent: 0,
        pending: 0,
        plannedSats: 2000,
      },
      nwc: {
        enabled: true,
        usable: true,
        maskedString: "masked",
        lastUsed: "2026-05-02T03:04:00.000Z",
      },
    });
    expect(page?.eventLogs).toEqual([
      {
        id: "log-1",
        eventType: "contest_created",
        message: "Contest created as draft",
        createdAt: "2026-05-01T00:00:00.000Z",
        metadata: { source: "test" },
      },
    ]);
    expect(findContestEntriesForDetail).not.toHaveBeenCalled();
    expect(resolveContestEntries).not.toHaveBeenCalled();
    expect(quoteContestFinalization).toHaveBeenCalledWith(
      match({
        planType: "starter",
        contest: match({
          sourceNoteId: "note-source-1",
          snapshotId: null,
        }),
      })
    );
    expect(fetchContestPubkeyProfiles).toHaveBeenCalledWith([]);
  });

  it("falls back when titles, fees, notes, and wallet fields are missing", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({
        title: null,
        sourceNoteId: "   ",
        sourcePostId: null,
        plannedPayoutSats: null,
        finalizationFeeSats: null,
        finalizationFeeStatus: null,
        lockConfigHash: null,
        payoutAutoRunSpendCapSats: null,
        contestStartAt: null,
        completedAt: null,
        lockedAt: null,
        freezeSnapshotAt: null,
        rankRewards: null,
        fairnessConfig: null,
      })
    );
    vi.mocked(getUserNWC).mockResolvedValueOnce({ enabled: false });
    vi.mocked(hasUsableNwc).mockResolvedValueOnce(false);
    vi.mocked(getEffectiveGiveawayPlanLimits).mockReturnValueOnce({
      maxWinnerCount: 3,
      canUseQueueScope: false,
      canUsePresets: false,
    });
    vi.mocked(resolveFinalizationCollection).mockReturnValueOnce({
      kind: "settled",
      quote: collectionQuote,
      paymentId: "pay-1",
    });

    const page = await getContestDetailPageData("user-1", "contest-1");
    expect(page?.contest.title).toBe("Contest contest-");
    expect(page?.contest.plannedPayoutSats).toBe(3000);
    expect(page?.contest.finalizationFeeSats).toBe(150);
    expect(page?.contest.lockConfigHash).toBe("collection-hash");
    expect(page?.contest.contestStartAt).toBeNull();
    expect(page?.quote.feeSettled).toBe(true);
    expect(page?.canUsePresets).toBe(false);
    expect(page?.nwc).toEqual({
      enabled: false,
      usable: false,
      maskedString: null,
      lastUsed: null,
    });
    expect(quoteContestFinalization).toHaveBeenCalledWith({
      contest: match({ sourceNoteId: "pending" }),
      planType: "starter",
    });
    expect(getPostById).not.toHaveBeenCalled();
  });

  it("caps the live preview and aggregates shared participants", async () => {
    const end = new Date("2020-01-02T00:00:00.000Z");
    const rows = Array.from({ length: 51 }, (_, index) => resolved(index));
    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({
        status: "LIVE",
        contestEndAt: end,
        sourceNoteId: "note-source-1",
        fairnessConfig: { excludeMuted: true },
      })
    );
    vi.mocked(resolveContestEntries).mockResolvedValueOnce(rows);

    const page = await getContestDetailPageData("user-1", "contest-1");
    const capped = rows.slice(0, 50);
    expect(page?.livePreview).toHaveLength(50);
    expect(page?.livePreview[0]).toMatchObject({
      rank: 1,
      replySnippet: null,
      score: 100,
    });
    expect(page?.liveStats).toEqual({
      totalEntries: 50,
      uniqueParticipants: 49,
      leadingScore: 100,
      metricSum: capped.reduce((sum, row) => sum + row.score, 0),
    });
    expect(page?.aggregates).toEqual({
      totalReactions: 50,
      totalZaps: 100,
      totalSatsZapped: 150,
      totalReplies: 200,
      totalReposts: 250,
    });
    expect(resolveContestEntries).toHaveBeenCalledWith({
      userId: "user-1",
      sourceNoteId: "note-source-1",
      metric: "ZAPS",
      deadlineUnix: Math.floor(end.getTime() / 1000),
      filters: { excludeMuted: true },
    });
    expect(findContestEntriesForDetail).not.toHaveBeenCalled();
  });

  it("leaves live stats empty when resolution returns nothing or the note is missing", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "LIVE", sourceNoteId: "note-source-1" })
    );
    const empty = await getContestDetailPageData("user-1", "contest-1");
    expect(empty?.liveStats).toEqual({
      totalEntries: 0,
      uniqueParticipants: 0,
      leadingScore: 0,
      metricSum: 0,
    });
    expect(empty?.aggregates.totalReactions).toBe(0);

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "LIVE", sourceNoteId: null })
    );
    const missing = await getContestDetailPageData("user-1", "contest-1");
    expect(missing?.livePreview).toEqual([]);
    expect(missing?.liveStats).toBeNull();
    expect(resolveContestEntries).toHaveBeenCalledTimes(1);
  });

  it("splits eligible and excluded rows for ended review", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "ENDED_REVIEW" })
    );
    vi.mocked(findContestEntriesForDetail).mockResolvedValueOnce(
      asReturn([
        entry({ authorPubkey: "pk-in", reactionsCount: 2 }),
        entry({
          authorPubkey: "pk-out",
          isExcluded: true,
          exclusionReason: "muted",
          rank: null,
          reactionsCount: 99,
        }),
      ])
    );
    vi.mocked(findLatestContestSnapshot).mockResolvedValueOnce(
      asReturn({
        snapshotAt: new Date("2026-06-03T00:00:00.000Z"),
        totalEntries: 2,
        eligibleEntries: 1,
        excludedEntries: 1,
        rankingMetric: "ZAPS",
        tieBreakRule: "earlier",
      })
    );

    const page = await getContestDetailPageData("user-1", "contest-1");
    expect(findContestEntriesForDetail).toHaveBeenCalledWith("contest-1", {
      includeExcluded: true,
    });
    expect(page?.leaderboardEligible).toHaveLength(1);
    expect(page?.leaderboardExcluded[0]).toMatchObject({
      authorPubkey: "pk-out",
      exclusionReason: "muted",
    });
    expect(page?.aggregates.totalReactions).toBe(2);
    expect(page?.snapshot?.eligibleEntries).toBe(1);
    expect(page?.statusLabel).toBeUndefined();
    expect(page?.contest.statusLabel).toBe("Ended - review winners");
  });

  it("loads stored entries for cancelled contests and payout in progress", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "CANCELLED" })
    );
    await getContestDetailPageData("user-1", "contest-1");
    expect(findContestEntriesForDetail).toHaveBeenCalledWith("contest-1", {
      includeExcluded: false,
    });
    expect(findLatestContestSnapshot).not.toHaveBeenCalled();

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "PAYOUT_IN_PROGRESS" })
    );
    await getContestDetailPageData("user-1", "contest-1");
    expect(findContestEntriesForDetail).toHaveBeenLastCalledWith("contest-1", {
      includeExcluded: true,
    });
  });

  it("summarizes every payout status and ignores alternates in the totals", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({
        status: "LOCKED",
        payoutState: asContestJson({
          "pk-sent": {
            status: "sent",
            updatedAt: "2026-06-01T00:00:00.000Z",
            note: "wallet",
          },
          "pk-marked": {
            status: "marked_paid",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
          "pk-failed": {
            status: "failed",
            updatedAt: "2026-06-01T00:00:00.000Z",
            note: "no route",
          },
          "pk-claim": {
            status: "claim_needed",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
          "pk-review": {
            status: "needs_review",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
          "pk-skipped": {
            status: "skipped",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
          "pk-weird": {
            status: "weird",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
        }),
      })
    );
    vi.mocked(findContestWinnersWithEntries).mockResolvedValueOnce(
      asReturn([
        {
          id: "w-sent",
          rank: 1,
          rewardSats: 10,
          isAlternate: false,
          payoutStatus: null,
          entry: {
            authorPubkey: "pk-sent",
            score: 9,
            entryEventId: "e-sent",
            replySnippet: "sent",
          },
        },
        {
          id: "w-marked",
          rank: 2,
          rewardSats: 9,
          isAlternate: false,
          entry: {
            authorPubkey: "pk-marked",
            score: 8,
            entryEventId: "e-marked",
            replySnippet: null,
          },
        },
        {
          id: "w-failed",
          rank: 3,
          rewardSats: 8,
          isAlternate: false,
          entry: {
            authorPubkey: "pk-failed",
            score: 7,
            entryEventId: "e-failed",
            replySnippet: null,
          },
        },
        {
          id: "w-claim",
          rank: 4,
          rewardSats: 7,
          isAlternate: false,
          entry: {
            authorPubkey: "pk-claim",
            score: 6,
            entryEventId: "e-claim",
            replySnippet: null,
          },
        },
        {
          id: "w-review",
          rank: 5,
          rewardSats: 6,
          isAlternate: false,
          entry: {
            authorPubkey: "pk-review",
            score: 5,
            entryEventId: "e-review",
            replySnippet: null,
          },
        },
        {
          id: "w-skipped",
          rank: 6,
          rewardSats: 5,
          isAlternate: false,
          entry: {
            authorPubkey: "pk-skipped",
            score: 4,
            entryEventId: "e-skipped",
            replySnippet: null,
          },
        },
        {
          id: "w-pending",
          rank: 7,
          rewardSats: 4,
          isAlternate: false,
          entry: {
            authorPubkey: "pk-pending",
            score: 3,
            entryEventId: "e-pending",
            replySnippet: null,
          },
        },
        {
          id: "w-weird",
          rank: 8,
          rewardSats: 3,
          isAlternate: false,
          entry: {
            authorPubkey: "pk-weird",
            score: 2,
            entryEventId: "e-weird",
            replySnippet: null,
          },
        },
        {
          id: "w-alt",
          rank: 9,
          rewardSats: 0,
          isAlternate: true,
          payoutStatus: "custom",
          entry: {
            authorPubkey: "pk-alt",
            score: 1,
            entryEventId: "e-alt",
            replySnippet: null,
          },
        },
        {
          id: "w-alt-blank",
          rank: 10,
          rewardSats: 0,
          isAlternate: true,
          payoutStatus: null,
          entry: {
            authorPubkey: "pk-alt-blank",
            score: 0,
            entryEventId: "e-alt-blank",
            replySnippet: null,
          },
        },
      ])
    );

    const page = await getContestDetailPageData("user-1", "contest-1");
    expect(page?.payoutSummary).toEqual({
      winnerSlots: 8,
      paidOrSent: 2,
      pending: 2,
      failed: 1,
      needsReview: 2,
      skipped: 1,
      paidViaWallet: 1,
      paidManually: 1,
      plannedSats: 2000,
    });
    expect(page?.winners.find((row) => row.id === "w-failed")?.payoutNote).toBe(
      "no route"
    );
    expect(page?.winners.find((row) => row.id === "w-alt")?.payoutStatus).toBe(
      "custom"
    );
    expect(
      page?.winners.find((row) => row.id === "w-alt-blank")?.payoutStatus
    ).toBe("pending");
    expect(page?.contest.statusLabel).toBe("Locked");
  });

  it("builds completed share text for a snapshot and for empty winners", async () => {
    const completedAt = new Date("2026-06-01T15:04:00.000Z");
    const start = new Date("2026-06-01T05:04:00.000Z");
    const label = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(completedAt);
    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({
        status: "COMPLETED",
        title: "  Zap race  ",
        contestStartAt: start,
        contestEndAt: completedAt,
        completedAt,
        plannedPayoutSats: 2000,
        finalizationFeeSats: 150,
        sourceNoteId: "note-source-1",
        lockConfigHash: null,
      })
    );
    vi.mocked(findLatestContestSnapshot).mockResolvedValueOnce(
      asReturn({
        snapshotAt: new Date("2026-06-01T15:00:00.000Z"),
        totalEntries: 4,
        eligibleEntries: 3,
        excludedEntries: 1,
        rankingMetric: "ZAPS",
        tieBreakRule: "earlier reply wins",
      })
    );

    const page = await getContestDetailPageData("user-1", "contest-1");
    expect(page?.contest.title).toBe("  Zap race  ");
    expect(page?.receiptSummaryLine).toContain(label);
    expect(page?.publicSummaryText).toContain("over 10 hour(s)");
    expect(page?.publicSummaryText).toContain(`Completed: ${label}`);
    expect(page?.winnerAnnouncementText).toContain("Zap race");
    expect(page?.winnerAnnouncementText).toContain(
      `${(2000).toLocaleString()} sats planned payout`
    );
    const proof = JSON.parse(page?.fairnessProofText ?? "{}") as {
      snapshot: { eligibleEntries: number } | null;
      lockConfigHash: string;
    };
    expect(proof.snapshot?.eligibleEntries).toBe(3);
    expect(proof.lockConfigHash).toBe("collection-hash");

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({
        status: "COMPLETED",
        title: "   ",
        completedAt: null,
        sourceNoteId: null,
        plannedPayoutSats: null,
        contestStartAt: new Date("2026-06-02T00:00:00.000Z"),
        contestEndAt: new Date("2026-06-01T00:00:00.000Z"),
      })
    );
    const empty = await getContestDetailPageData("user-1", "contest-1");
    expect(empty?.winners).toEqual([]);
    expect(empty?.receiptSummaryLine).toBeNull();
    expect(empty?.publicSummaryText).toContain("over the contest window");
    expect(empty?.publicSummaryText).not.toContain("Completed:");
    expect(empty?.winnerAnnouncementText).toContain(
      `${(0).toLocaleString()} sats planned payout`
    );
    const emptyProof = JSON.parse(empty?.fairnessProofText ?? "{}") as {
      snapshot: null;
    };
    expect(emptyProof.snapshot).toBeNull();
  });

  it("maps the source post and launch orchestration", async () => {
    const publishedAt = new Date("2026-05-20T00:00:00.000Z");
    vi.mocked(getContestById).mockResolvedValue(
      buildContest({ sourcePostId: "post-1" })
    );
    vi.mocked(getPostById).mockResolvedValueOnce(
      asReturn({
        id: "post-1",
        caption: null,
        fileUrl: ["https://cdn.example/a.png"],
        publishedAt,
        nostrEventId: "event-1",
      })
    );
    vi.mocked(findContestLaunchOrchestrationForDetail).mockResolvedValueOnce(
      asReturn({
        sourceMode: "new_post",
        launchMode: "schedule",
        sourcePostId: "post-1",
        sourcePostPublishStatus: "scheduled",
        contestActivationStatus: "scheduled",
        lastErrorMessage: "later",
        lastErrorCode: "waiting",
        scheduledFor: new Date("2026-06-01T00:00:00.000Z"),
      })
    );

    const page = await getContestDetailPageData("user-1", "contest-1");
    expect(getPostById).toHaveBeenCalledWith({
      id: "post-1",
      userId: "user-1",
    });
    expect(page?.sourcePost).toEqual({
      id: "post-1",
      caption: null,
      fileUrl: ["https://cdn.example/a.png"],
      publishedAt: publishedAt.toISOString(),
      nostrEventId: "event-1",
    });
    expect(page?.launchOrchestration?.scheduledFor).toBe(
      "2026-06-01T00:00:00.000Z"
    );

    vi.mocked(getPostById).mockResolvedValueOnce(
      asReturn({
        id: "post-1",
        caption: "cap",
        fileUrl: "not-an-array",
        publishedAt: null,
        nostrEventId: null,
      })
    );
    vi.mocked(findContestLaunchOrchestrationForDetail).mockResolvedValueOnce(
      asReturn({
        sourceMode: "existing_post",
        launchMode: "now",
        sourcePostId: null,
        sourcePostPublishStatus: "not_needed",
        contestActivationStatus: "active",
        lastErrorMessage: null,
        lastErrorCode: null,
        scheduledFor: null,
      })
    );
    const fallback = await getContestDetailPageData("user-1", "contest-1");
    expect(fallback?.sourcePost).toEqual({
      id: "post-1",
      caption: "cap",
      fileUrl: [],
      publishedAt: null,
      nostrEventId: null,
    });
    expect(fallback?.launchOrchestration?.scheduledFor).toBeNull();
  });
});

describe("getContestPublicPageData", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveContestEntries).mockResolvedValue([]);
    vi.mocked(findContestEntriesForDetail).mockResolvedValue(asReturn([]));
    vi.mocked(findLatestContestSnapshot).mockResolvedValue(null);
  });

  it("returns null when the contest is missing or not public", async () => {
    vi.mocked(getContestByIdPublic).mockResolvedValueOnce(null);
    await expect(getContestPublicPageData("missing")).resolves.toBeNull();

    for (const status of ["DRAFT", "SCHEDULED_LAUNCH", "CANCELLED"] as const) {
      vi.mocked(getContestByIdPublic).mockResolvedValueOnce(
        buildContest({ status })
      );
      await expect(getContestPublicPageData("contest-1")).resolves.toBeNull();
    }
    expect(findContestEntriesForDetail).not.toHaveBeenCalled();
  });

  it("ranks a live note from resolution and falls back to stored entries", async () => {
    const end = new Date("2020-01-02T00:00:00.000Z");
    vi.mocked(getContestByIdPublic).mockResolvedValueOnce(
      buildContest({
        status: "LIVE",
        contestEndAt: end,
        fairnessConfig: null,
        sourceNoteId: "note-source-1",
      })
    );
    vi.mocked(resolveContestEntries).mockResolvedValueOnce(
      Array.from({ length: 11 }, (_, index) => resolved(index))
    );
    const live = await getContestPublicPageData("contest-1");
    expect(live?.rows).toHaveLength(10);
    expect(live?.rows[0]).toMatchObject({ rank: 1, replySnippet: null });
    expect(live?.eligibleEntries).toBeNull();
    expect(live?.publicSummaryLines).toBeNull();
    expect(resolveContestEntries).toHaveBeenCalledWith(
      match({
        deadlineUnix: Math.floor(end.getTime() / 1000),
        filters: undefined,
      })
    );

    vi.mocked(getContestByIdPublic).mockResolvedValueOnce(
      buildContest({ status: "LIVE", sourceNoteId: null })
    );
    vi.mocked(findContestEntriesForDetail).mockResolvedValueOnce(
      asReturn([
        entry({ rank: null, authorPubkey: "pk-a", score: 3 }),
        entry({ rank: 4, authorPubkey: "pk-b", score: 2, replySnippet: null }),
      ])
    );
    const stored = await getContestPublicPageData("contest-1");
    expect(stored?.rows.map((row) => row.rank)).toEqual([1, 4]);
    expect(stored?.rows[1]?.replySnippet).toBeNull();
    expect(findLatestContestSnapshot).not.toHaveBeenCalled();
  });

  it.each(["LOCKED", "PAYOUT_IN_PROGRESS"] as const)(
    "publishes %s standings from stored entries",
    async (status) => {
      vi.mocked(getContestByIdPublic).mockResolvedValueOnce(
        buildContest({ status })
      );
      const page = await getContestPublicPageData("contest-1");
      expect(page?.status).toBe(status);
      expect(page?.publicSummaryLines).toBeNull();
      expect(page?.fairnessProofLines).toBeNull();
      expect(findContestEntriesForDetail).toHaveBeenCalledWith("contest-1", {
        includeExcluded: false,
      });
      expect(findLatestContestSnapshot).toHaveBeenCalledWith("contest-1");
    }
  );

  it("describes a completed contest across duration branches", async () => {
    const cases = [
      {
        contestStartAt: new Date("2026-06-01T00:00:00.000Z"),
        contestEndAt: new Date("2026-06-02T23:00:00.000Z"),
        text: "47 hour(s)",
      },
      {
        contestStartAt: new Date("2026-06-01T00:00:00.000Z"),
        contestEndAt: new Date("2026-06-03T00:00:00.000Z"),
        text: "2 day(s)",
      },
      {
        contestStartAt: new Date("2026-06-01T00:00:00.000Z"),
        contestEndAt: new Date("2026-06-01T00:10:00.000Z"),
        text: "1 hour(s)",
      },
      {
        contestStartAt: null,
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
        contestEndAt: new Date("2026-06-01T10:00:00.000Z"),
        text: "10 hour(s)",
      },
      {
        contestStartAt: new Date("2026-06-02T00:00:00.000Z"),
        contestEndAt: new Date("2026-06-01T00:00:00.000Z"),
        text: "the contest window",
      },
    ];

    for (const item of cases) {
      vi.mocked(getContestByIdPublic).mockResolvedValueOnce(
        buildContest({
          status: "COMPLETED",
          title: null,
          plannedPayoutSats: null,
          completedAt: new Date("2026-06-04T00:00:00.000Z"),
          contestStartAt: item.contestStartAt,
          contestEndAt: item.contestEndAt,
          ...(item.createdAt ? { createdAt: item.createdAt } : {}),
        })
      );
      const page = await getContestPublicPageData("contest-1");
      expect(page?.title).toBe("Contest contest-");
      expect(page?.plannedPayoutSats).toBe(0);
      expect(page?.publicSummaryLines?.join("\n")).toContain(item.text);
      expect(page?.fairnessProofLines?.join("\n")).toContain(
        "Eligible entries (frozen snapshot):  - "
      );
    }

    vi.mocked(getContestByIdPublic).mockResolvedValueOnce(
      buildContest({
        status: "COMPLETED",
        contestEndAt: new Date("not-a-date"),
      })
    );
    await expect(getContestPublicPageData("contest-1")).rejects.toThrow(
      RangeError
    );

    vi.mocked(getContestByIdPublic).mockResolvedValueOnce(
      buildContest({
        status: "COMPLETED",
        completedAt: null,
        updatedAt: new Date("2026-06-05T12:00:00.000Z"),
        tieBreakRule: null,
      })
    );
    vi.mocked(findLatestContestSnapshot).mockResolvedValueOnce(
      asReturn({ eligibleEntries: 0 })
    );
    const dated = await getContestPublicPageData("contest-1");
    const updatedLabel = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date("2026-06-05T12:00:00.000Z"));
    expect(dated?.publicSummaryLines?.join("\n")).toContain(updatedLabel);
    expect(dated?.eligibleEntries).toBe(0);
    expect(dated?.fairnessProofLines?.join("\n")).toContain("Tie-break:  - ");

    vi.mocked(findLatestContestSnapshot).mockResolvedValueOnce(
      asReturn({ id: "snap-without-count" })
    );
    vi.mocked(getContestByIdPublic).mockResolvedValueOnce(
      buildContest({ status: "ENDED_REVIEW" })
    );
    const missingCount = await getContestPublicPageData("contest-1");
    expect(missingCount?.eligibleEntries).toBeNull();
  });
});
