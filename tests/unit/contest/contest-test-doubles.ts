import { expect } from "vitest";

import type {
  Contest,
  ContestPreset,
} from "~/features/contest/data/contest-prisma-types.server";

export function buildContest(overrides: Partial<Contest> = {}): Contest {
  const contest: Contest = {
    id: "contest-1",
    userId: "user-1",
    title: "Summer zap contest",
    status: "DRAFT",
    sourceNoteId: "note-source-1",
    sourcePostId: null,
    entryType: "REPLY_DIRECT",
    rankingMetric: "ZAPS",
    contestStartAt: new Date("2026-06-01T00:00:00.000Z"),
    contestEndAt: new Date("2026-06-03T00:00:00.000Z"),
    freezeSnapshotAt: null,
    freezeSnapshotWindowEndsAt: null,
    prizeMode: "EQUAL",
    winnerCount: 2,
    equalRewardSats: 1000,
    rankRewards: null,
    fairnessConfig: null,
    tieBreakRule: "earlier reply wins",
    plannedPayoutSats: 2000,
    finalizationFeeRateBps: 1000,
    finalizationFeeSats: 200,
    finalizationFeeStatus: null,
    planAtFinalization: null,
    lockConfigHash: "lock-hash",
    payoutState: null,
    payoutWalletMode: "manual",
    payoutAutoRunEnabled: false,
    payoutAutoRunSpendCapSats: null,
    lockedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-02T00:00:00.000Z"),
    ...overrides,
  };
  return contest;
}

export function buildPreset(
  overrides: Partial<ContestPreset> = {}
): ContestPreset {
  const preset: ContestPreset = {
    id: "preset-1",
    userId: "user-1",
    name: "Preset",
    title: "Preset title",
    rankingMetric: "ZAPS",
    prizeMode: "EQUAL",
    winnerCount: 1,
    equalRewardSats: 100,
    rankRewards: null,
    fairnessConfig: null,
    lastUsedAt: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    ...overrides,
  };
  return preset;
}

export function asReturn<T>(value: unknown): T {
  return value as T;
}

export function asContestJson(
  value: unknown
): NonNullable<Contest["payoutState"]> {
  return value as NonNullable<Contest["payoutState"]>;
}

/* Vitest asymmetric matchers are typed as any. Keep that cast in one place. */

export function match<T>(partial: T): T {
  return expect.objectContaining(partial) as T;
}

export function omitMatch<T>(partial: Partial<T>): T {
  return expect.not.objectContaining(partial) as T;
}

export function listIncluding<T>(items: readonly T[]): T[] {
  return expect.arrayContaining(items) as T[];
}

export function anyDate(): Date {
  return expect.any(Date) as Date;
}

export function anything(): unknown {
  return expect.anything() as unknown;
}

export const signedPostEvent = {
  id: "a".repeat(64),
  pubkey: "b".repeat(64),
  created_at: 1_700_000_000,
  kind: 1,
  tags: [] as string[][],
  content: "hello",
  sig: "c".repeat(128),
};
