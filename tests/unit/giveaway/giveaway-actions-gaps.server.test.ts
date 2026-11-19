import { beforeEach, describe, expect, it, vi } from "vitest";

interface Rel {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
}

interface WinnerShape {
  pubkey: string;
  npub: string;
  qualifyingActions: Array<{ kind: number; eventId: string }>;
}

const subs = vi.hoisted(() => ({
  getUserSubscription: vi.fn(async (_userId: string) => ({ planId: "pro" })),
}));

const plans = vi.hoisted(() => ({
  getUserPlanType: vi.fn((_subscription: unknown) => "pro"),
  getPlanDisplayName: vi.fn((_subscription: unknown) => "Pro"),
}));

const limits = vi.hoisted(() => ({
  getEffectiveGiveawayPlanLimits: vi.fn((_plan: string) => ({
    canUseQueueScope: true,
    maxWinnerCount: 10,
  })),
}));

const repo = vi.hoisted(() => ({
  findGiveawayByIdAndUser: vi.fn(
    async (_id: string, _userId: string): Promise<unknown> => null
  ),
  updateGiveaway: vi.fn(
    async (_id: string, _data: Record<string, unknown>) => ({ id: "saved" })
  ),
  createGiveaway: vi.fn(
    async (_userId: string, _data: Record<string, unknown>) => ({
      id: "created-id",
    })
  ),
  deleteGiveawayById: vi.fn(async (_id: string) => ({ id: "deleted" })),
  listGiveawaysByUser: vi.fn(async () => []),
}));

const eligibility = vi.hoisted(() => ({
  getEligibleParticipantsForGiveaway: vi.fn(
    async (): Promise<{ relatedEvents: Rel[] }> => ({ relatedEvents: [] })
  ),
  runSelectionForGiveaway: vi.fn(
    (_giveaway: unknown, _events: Rel[]): WinnerShape[] => []
  ),
  eligibleAccountCountForPreviewMeta: vi.fn(() => 0),
}));

vi.mock("~/features/payments/data", () => subs);
vi.mock("~/features/payments/types", () => plans);
vi.mock("~/features/payments/entitlements/deployment-mode.server", () => ({
  getEffectiveGiveawayPlanLimits: limits.getEffectiveGiveawayPlanLimits,
  currentDeployment: () => ({ mode: "hosted", operatorLimits: {} }),
}));
vi.mock(
  "~/features/giveaway/repositories/giveaway-actions-data.server",
  () => repo
);
vi.mock(
  "~/features/giveaway/repositories/giveaway-finalization-payment.server",
  () => ({
    findPaidFinalizationForLock: vi.fn(),
    listGiveawayFinalizationRecords: vi.fn(async () => []),
    expireGiveawayFinalizationByIds: vi.fn(async () => undefined),
  })
);
vi.mock(
  "~/features/giveaway/giveaway-actions-eligibility.server",
  () => eligibility
);

import { Prisma } from "~/features/giveaway/data/giveaway-prisma-types.server";
import { appendGiveawayAuditActivity } from "~/features/giveaway/giveaway-actions-audit.server";
import {
  duplicateGiveaway,
  updateGiveaway,
} from "~/features/giveaway/giveaway-actions-crud.server";
import type { UpdateGiveawayInput } from "~/features/giveaway/giveaway-actions-crud.server";
import { resetGiveawayToDraft } from "~/features/giveaway/giveaway-actions-lifecycle.server";
import { excludeWinnerAndRedraw } from "~/features/giveaway/giveaway-actions-preview.server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function asUpdate(value: unknown): UpdateGiveawayInput {
  return value as UpdateGiveawayInput;
}

function stored(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: "abcdef999",
    userId: "u1",
    status: "DRAFT",
    name: "Spring",
    scopeType: "PERIOD",
    scopeReference: { days: 14 },
    eligibilityFrom: new Date("2024-01-01T00:00:00.000Z"),
    eligibilityTo: new Date("2024-02-01T00:00:00.000Z"),
    engagementTypes: ["ZAP", "COMMENT"],
    winnerCount: 3,
    engagementConfig: { ZAP: { winnerCount: 1, satsPerWinner: 5 } },
    selectionMode: "WEIGHTED_BY_ENGAGEMENT",
    engagementWeights: { ZAP: 2 },
    filters: { excludeMuted: true },
    activityLog: [],
    winnerSnapshot: null,
    excludedPubkeys: [],
  };
  return { ...base, ...overrides };
}

function activityTypes(value: unknown): string[] {
  if (!isUnknownArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    return typeof entry["type"] === "string" ? [entry["type"]] : [];
  });
}

function lastUpdate(): Record<string, unknown> {
  const data = repo.updateGiveaway.mock.calls.at(-1)?.[1];
  if (!data) throw new Error("update was not called");
  return data;
}

describe("giveaway action gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subs.getUserSubscription.mockResolvedValue({ planId: "pro" });
    plans.getUserPlanType.mockReturnValue("pro");
    plans.getPlanDisplayName.mockReturnValue("Pro");
    limits.getEffectiveGiveawayPlanLimits.mockReturnValue({
      canUseQueueScope: true,
      maxWinnerCount: 10,
    });
    repo.findGiveawayByIdAndUser.mockResolvedValue(null);
    repo.updateGiveaway.mockResolvedValue({ id: "saved" });
    repo.createGiveaway.mockResolvedValue({ id: "created-id" });
  });

  describe("updateGiveaway", () => {
    it("returns not found and refuses every non-draft status", async () => {
      expect(await updateGiveaway("u1", "g1", { name: "Ada" })).toEqual({
        success: false,
        error: "Giveaway not found",
      });
      for (const status of ["PREVIEWED", "LOCKED", "PAID_OUT", "CANCELLED"]) {
        repo.findGiveawayByIdAndUser.mockResolvedValue(stored({ status }));
        const result = await updateGiveaway("u1", "g1", { name: "Ada" });
        expect(result).toEqual({
          success: false,
          error: "Only draft giveaways can be edited",
        });
      }
      expect(repo.updateGiveaway).not.toHaveBeenCalled();
    });

    it("returns success without writing when a draft period update is empty", async () => {
      repo.findGiveawayByIdAndUser.mockResolvedValue(stored());
      expect(await updateGiveaway("u1", "g1", {})).toEqual({ success: true });
      expect(repo.updateGiveaway).not.toHaveBeenCalled();
    });

    it("trims the name and clamps the winner count", async () => {
      repo.findGiveawayByIdAndUser.mockResolvedValue(stored());
      await updateGiveaway("u1", "g1", { name: null, winnerCount: 0.2 });
      await updateGiveaway("u1", "g1", { name: "  Ada  ", winnerCount: 3.9 });
      await updateGiveaway("u1", "g1", { name: "   ", winnerCount: 99 });
      expect(
        repo.updateGiveaway.mock.calls.map((call) => call[1]["name"])
      ).toEqual([null, "Ada", ""]);
      expect(
        repo.updateGiveaway.mock.calls.map((call) => call[1]["winnerCount"])
      ).toEqual([1, 3, 10]);
      expect(activityTypes(lastUpdate()["activityLog"])).toEqual([
        "configuration_updated",
      ]);
    });

    it("requires at least one engagement type when the scope allows a pick", async () => {
      repo.findGiveawayByIdAndUser.mockResolvedValue(stored());
      expect(await updateGiveaway("u1", "g1", { engagementTypes: [] })).toEqual(
        {
          success: false,
          error: "At least one engagement type required",
        }
      );
      expect(
        await updateGiveaway("u1", "g1", asUpdate({ engagementTypes: "ZAP" }))
      ).toEqual({
        success: false,
        error: "At least one engagement type required",
      });
      expect(repo.updateGiveaway).not.toHaveBeenCalled();

      const saved = await updateGiveaway("u1", "g1", {
        engagementTypes: ["ZAP"],
        selectionMode: "WEIGHTED_BY_ENGAGEMENT",
      });
      expect(saved).toEqual({ success: true });
      expect(lastUpdate()["engagementTypes"]).toEqual(["ZAP"]);
      expect(lastUpdate()["selectionMode"]).toBe("WEIGHTED_BY_ENGAGEMENT");
    });

    it("stores per-type sums, simple unified config, and an empty config as null", async () => {
      repo.findGiveawayByIdAndUser.mockResolvedValue(stored());
      await updateGiveaway(
        "u1",
        "g1",
        asUpdate({
          engagementConfig: {
            REACTION: { winnerCount: 3, satsPerWinner: 1 },
            ZAP: { satsPerWinner: 2 },
            COMMENT: { winnerCount: 40, satsPerWinner: 1 },
          },
        })
      );
      expect(lastUpdate()["winnerCount"]).toBe(10);

      await updateGiveaway(
        "u1",
        "g1",
        asUpdate({
          winnerCount: 4,
          engagementConfig: { _simpleUnified: { satsPerWinner: 9 } },
        })
      );
      expect(lastUpdate()["winnerCount"]).toBe(4);
      expect(lastUpdate()["engagementConfig"]).toEqual({
        _simpleUnified: { satsPerWinner: 9 },
      });

      await updateGiveaway("u1", "g1", { engagementConfig: {} });
      expect(lastUpdate()["engagementConfig"]).toBe(Prisma.JsonNull);
      await updateGiveaway("u1", "g1", { engagementConfig: null });
      expect(lastUpdate()["engagementConfig"]).toBe(Prisma.JsonNull);
    });

    it("resets follow-graph drafts and forces queue drafts onto every engagement type", async () => {
      repo.findGiveawayByIdAndUser.mockResolvedValue(
        stored({ scopeType: "FOLLOWERS", scopeReference: {} })
      );
      const followed = await updateGiveaway(
        "u1",
        "g1",
        asUpdate({
          name: "  Ada  ",
          selectionMode: "WEIGHTED_BY_ENGAGEMENT",
          engagementConfig: { _simpleUnified: { satsPerWinner: 9 } },
        })
      );
      expect(followed).toEqual({ success: true });
      expect(lastUpdate()["name"]).toBe("Ada");
      expect(lastUpdate()["engagementTypes"]).toEqual([]);
      expect(lastUpdate()["engagementConfig"]).toBe(Prisma.JsonNull);
      expect(lastUpdate()["selectionMode"]).toBe("UNIQUE_USER");
      expect(lastUpdate()["engagementWeights"]).toBe(Prisma.JsonNull);

      repo.findGiveawayByIdAndUser.mockResolvedValue(
        stored({ scopeType: "QUEUE", scopeReference: { queueId: "q1" } })
      );
      await updateGiveaway(
        "u1",
        "g1",
        asUpdate({
          engagementTypes: ["ZAP"],
          selectionMode: "WEIGHTED_BY_ENGAGEMENT",
          engagementConfig: { REACTION: { winnerCount: 2, satsPerWinner: 3 } },
        })
      );
      expect(lastUpdate()["engagementTypes"]).toEqual([
        "REACTION",
        "REPOST",
        "COMMENT",
        "ZAP",
      ]);
      expect(lastUpdate()["selectionMode"]).toBe("WEIGHTED_BY_ENGAGEMENT");
      expect(lastUpdate()["winnerCount"]).toBe(2);
    });
  });

  describe("duplicateGiveaway", () => {
    it("returns not found without creating a row", async () => {
      expect(await duplicateGiveaway("u1", "g1")).toEqual({
        id: null,
        error: "Giveaway not found",
      });
      expect(repo.createGiveaway).not.toHaveBeenCalled();
    });

    it("copies rules and names the duplicate", async () => {
      repo.findGiveawayByIdAndUser.mockResolvedValue(stored());
      expect(await duplicateGiveaway("u1", "g1")).toEqual({ id: "created-id" });
      const named = repo.createGiveaway.mock.calls[0]?.[1];
      expect(named?.["name"]).toBe("Spring (copy)");
      expect(named?.["scopeType"]).toBe("PERIOD");
      expect(named?.["scopeReference"]).toEqual({ days: 14 });
      expect(named?.["engagementTypes"]).toEqual(["ZAP", "COMMENT"]);
      expect(named?.["winnerCount"]).toBe(1);
      expect(named?.["selectionMode"]).toBe("WEIGHTED_BY_ENGAGEMENT");
      expect(named?.["status"]).toBe("DRAFT");
      expect(named?.["eligibilityFrom"]).toEqual(
        new Date("2024-01-01T00:00:00.000Z")
      );
      expect(named?.["eligibilityTo"]).toEqual(
        new Date("2024-02-01T00:00:00.000Z")
      );

      repo.findGiveawayByIdAndUser.mockResolvedValue(
        stored({ name: null, eligibilityFrom: null, eligibilityTo: null })
      );
      await duplicateGiveaway("u1", "g1");
      expect(repo.createGiveaway.mock.calls[1]?.[1]["name"]).toBe(
        "Giveaway copy abcdef"
      );
      expect(
        repo.createGiveaway.mock.calls[1]?.[1]["eligibilityFrom"]
      ).toBeUndefined();

      repo.findGiveawayByIdAndUser.mockResolvedValue(stored({ name: "" }));
      await duplicateGiveaway("u1", "g1");
      expect(repo.createGiveaway.mock.calls[2]?.[1]["name"]).toBe(
        "Giveaway copy abcdef"
      );

      repo.findGiveawayByIdAndUser.mockResolvedValue(stored({ name: "  " }));
      await duplicateGiveaway("u1", "g1");
      expect(repo.createGiveaway.mock.calls[3]?.[1]["name"]).toBe("(copy)");
    });

    it("propagates the queue-plan error from create", async () => {
      limits.getEffectiveGiveawayPlanLimits.mockReturnValue({
        canUseQueueScope: false,
        maxWinnerCount: 10,
      });
      repo.findGiveawayByIdAndUser.mockResolvedValue(
        stored({ scopeType: "QUEUE", scopeReference: { queueId: "q1" } })
      );
      await expect(duplicateGiveaway("u1", "g1")).rejects.toThrow(
        "Queue filter is available on paid plans"
      );
    });
  });

  describe("excludeWinnerAndRedraw", () => {
    const current: WinnerShape[] = [
      { pubkey: "keep", npub: "n1", qualifyingActions: [] },
      { pubkey: "drop", npub: "n2", qualifyingActions: [] },
    ];
    const redrawn: WinnerShape[] = [
      { pubkey: "new", npub: "n3", qualifyingActions: [] },
    ];

    it("returns not found and refuses non-preview statuses", async () => {
      expect(await excludeWinnerAndRedraw("u1", "g1", "drop")).toEqual({
        winners: [],
        error: "Giveaway not found",
      });
      for (const status of ["DRAFT", "LOCKED", "PAID_OUT", "CANCELLED"]) {
        repo.findGiveawayByIdAndUser.mockResolvedValue(stored({ status }));
        const result = await excludeWinnerAndRedraw("u1", "g1", "drop");
        expect(result).toEqual({
          winners: [],
          error: "Only previewed giveaways can be modified",
        });
      }
    });

    it("returns the current list when the pubkey is absent", async () => {
      repo.findGiveawayByIdAndUser.mockResolvedValue(
        stored({ status: "PREVIEWED", winnerSnapshot: current })
      );
      expect(await excludeWinnerAndRedraw("u1", "g1", "missing")).toEqual({
        winners: current,
        error: "Winner not in list",
      });
      repo.findGiveawayByIdAndUser.mockResolvedValue(
        stored({ status: "PREVIEWED", winnerSnapshot: null })
      );
      expect(await excludeWinnerAndRedraw("u1", "g1", "drop")).toEqual({
        winners: [],
        error: "Winner not in list",
      });
      expect(repo.updateGiveaway).not.toHaveBeenCalled();
    });

    it("redraws without the excluded pubkey and records prior exclusions", async () => {
      repo.findGiveawayByIdAndUser.mockResolvedValue(
        stored({
          status: "PREVIEWED",
          winnerSnapshot: current,
          excludedPubkeys: ["old", "drop"],
          filters: null,
          selectionMode: "UNIQUE_USER",
          activityLog: [{ at: "t", type: "old" }],
        })
      );
      eligibility.getEligibleParticipantsForGiveaway.mockResolvedValue({
        relatedEvents: [
          { id: "e1", pubkey: "keep", created_at: 1, kind: 7 },
          { id: "e2", pubkey: "drop", created_at: 1, kind: 7 },
          { id: "e3", pubkey: "new", created_at: 1, kind: 7 },
        ],
      });
      eligibility.runSelectionForGiveaway.mockReturnValue(redrawn);
      const result = await excludeWinnerAndRedraw("u1", "g1", "drop");
      expect(result).toEqual({ winners: redrawn });
      expect(
        eligibility.runSelectionForGiveaway.mock.calls[0]?.[1].map(
          (event) => event.pubkey
        )
      ).toEqual(["drop", "new"]);
      const data = lastUpdate();
      expect(data["excludedPubkeys"]).toEqual(["old", "drop"]);
      expect(data["rerollCount"]).toEqual({ increment: 1 });
      expect(data["winnerSnapshot"]).toBe(redrawn);
      const meta = data["lastPreviewMeta"];
      if (!isRecord(meta)) throw new Error("missing preview meta");
      expect(meta["eligiblePoolSize"]).toBe(2);
      expect(meta["selectionMode"]).toBe("UNIQUE_USER");
      expect(meta["filters"]).toBeNull();
      expect(activityTypes(data["activityLog"])).toEqual([
        "old",
        "winner_excluded",
      ]);

      repo.findGiveawayByIdAndUser.mockResolvedValue(
        stored({
          status: "PREVIEWED",
          winnerSnapshot: current,
          excludedPubkeys: ["old", 1],
          filters: { excludeMuted: true },
        })
      );
      await excludeWinnerAndRedraw("u1", "g1", "drop");
      expect(lastUpdate()["excludedPubkeys"]).toEqual(["drop"]);
      const replaced = lastUpdate()["lastPreviewMeta"];
      if (!isRecord(replaced)) throw new Error("missing preview meta");
      expect(replaced["filters"]).toEqual({ excludeMuted: true });
    });
  });

  describe("resetGiveawayToDraft", () => {
    it("returns not found and refuses every status except preview", async () => {
      expect(await resetGiveawayToDraft("u1", "g1")).toEqual({
        success: false,
        error: "Giveaway not found",
      });
      for (const status of ["DRAFT", "LOCKED", "PAID_OUT", "CANCELLED"]) {
        repo.findGiveawayByIdAndUser.mockResolvedValue(stored({ status }));
        const result = await resetGiveawayToDraft("u1", "g1");
        expect(result).toEqual({
          success: false,
          error: "Only giveaways in preview can be reset to draft",
        });
      }
      expect(repo.updateGiveaway).not.toHaveBeenCalled();
    });

    it("clears the preview snapshot and returns the giveaway to draft", async () => {
      repo.findGiveawayByIdAndUser.mockResolvedValue(
        stored({
          status: "PREVIEWED",
          activityLog: [{ at: "t", type: "old" }],
        })
      );
      expect(await resetGiveawayToDraft("u1", "g1")).toEqual({ success: true });
      const data = lastUpdate();
      expect(data["status"]).toBe("DRAFT");
      expect(data["winnerSnapshot"]).toBe(Prisma.JsonNull);
      expect(data["lastPreviewMeta"]).toBe(Prisma.JsonNull);
      expect(data["excludedPubkeys"]).toBe(Prisma.JsonNull);
      expect(data["rerollCount"]).toBe(0);
      expect(activityTypes(data["activityLog"])).toEqual([
        "old",
        "reset_to_draft",
      ]);
    });
  });

  describe("appendGiveawayAuditActivity", () => {
    it("returns not found when the giveaway is missing", async () => {
      expect(
        await appendGiveawayAuditActivity("u1", "g1", "csv_exported")
      ).toEqual({ success: false, error: "Giveaway not found" });
      expect(repo.updateGiveaway).not.toHaveBeenCalled();
    });

    it.each(["csv_exported", "proof_summary_copied"] as const)(
      "appends %s",
      async (type) => {
        repo.findGiveawayByIdAndUser.mockResolvedValue(
          stored({ activityLog: [{ at: "t", type: "old" }] })
        );
        expect(await appendGiveawayAuditActivity("u1", "g1", type)).toEqual({
          success: true,
        });
        expect(activityTypes(lastUpdate()["activityLog"])).toEqual([
          "old",
          type,
        ]);
      }
    );
  });
});
