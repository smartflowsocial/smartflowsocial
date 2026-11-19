// @ts-nocheck -- mocked collaborators are narrower than the production types.
import { beforeEach, describe, expect, it, vi } from "vitest";

const referral = vi.hoisted(() => ({
  recordReferralEarningIfAny: vi.fn(
    async (
      _userId: string,
      _paymentId: string,
      _amount: number
    ): Promise<void> => undefined
  ),
}));

const prisma = vi.hoisted(() => {
  const client = {
    payment: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      update: vi.fn(
        async (_args: {
          where: { id: string };
          data: { status?: string; paidAt?: Date };
        }) => ({})
      ),
      updateMany: vi.fn(
        async (_args: {
          where: { id: string; status: string };
          data: { status?: string; failedAt?: Date; failureReason?: string };
        }) => ({ count: 1 })
      ),
    },
    giveawayFinalizationPayment: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      update: vi.fn(
        async (_args: {
          where: { id: string };
          data: { status?: string; paidAt?: Date };
        }) => ({})
      ),
    },
    giveaway: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: "created" })),
      update: vi.fn(
        async (_args: {
          where: { id: string };
          data: { activityLog?: unknown };
        }) => ({ id: "g1" })
      ),
      delete: vi.fn(async () => ({ id: "g1" })),
    },
    giveawayPreset: {
      create: vi.fn(async () => ({ id: "preset-1" })),
      update: vi.fn(async () => ({ id: "preset-1" })),
      delete: vi.fn(async () => ({ id: "preset-1" })),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
    queueType: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation(
    async (fn: (tx: typeof client) => Promise<unknown>) => fn(client)
  );
  return client;
});

vi.mock("~/lib/prisma.server", () => ({ prisma }));
vi.mock("~/features/referral/record-referral-earning.server", () => referral);

import type { Prisma } from "~/features/giveaway/data/giveaway-prisma-types.server";
import {
  createGiveaway,
  deleteGiveawayById,
  findGiveawayByIdAndUser,
  listGiveawaysByUser,
  updateGiveaway,
} from "~/features/giveaway/repositories/giveaway-actions-data.server";
import {
  findQueueTypeNameByIdAndUser,
  findQueueTypesByIdsAndUser,
} from "~/features/giveaway/repositories/giveaway-display-data.server";
import {
  completeGiveawayFinalizationPayment,
  expireGiveawayFinalizationByIds,
  expireStaleFinalizationPaymentsForGiveaway,
  findPaidFinalizationForLock,
  findReusableGiveawayFinalizationInvoice,
  listGiveawayFinalizationRecords,
} from "~/features/giveaway/repositories/giveaway-finalization-payment.server";
import {
  createGiveawayPreset,
  deleteGiveawayPreset,
  findQueueTypeByIdAndUser as findPresetQueue,
  getGiveawayPresetById,
  getGiveawayPresetsByUser,
  updateGiveawayPreset,
} from "~/features/giveaway/repositories/giveaway-presets-data.server";
import {
  findQueueTypeByIdAndUser,
  findQueueTypeFullByIdAndUser,
} from "~/features/giveaway/repositories/giveaway-scope-data.server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function activityTypes(value: unknown): string[] {
  if (!isUnknownArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    return typeof entry["type"] === "string" ? [entry["type"]] : [];
  });
}

describe("giveaway repositories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)
    );
  });

  describe("giveaway-finalization-payment", () => {
    it("rejects a payment that is not a giveaway finalization", async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      await expect(completeGiveawayFinalizationPayment("pay1")).rejects.toThrow(
        "Not a giveaway finalization payment"
      );
      prisma.payment.findUnique.mockResolvedValue({
        id: "pay1",
        status: "COMPLETED",
        purpose: "SUBSCRIPTION",
        userId: "u1",
        amount: 10,
      });
      await expect(completeGiveawayFinalizationPayment("pay1")).rejects.toThrow(
        "Not a giveaway finalization payment"
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(referral.recordReferralEarningIfAny).not.toHaveBeenCalled();
    });

    it("returns before referral work when the payment is already completed", async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: "pay1",
        status: "COMPLETED",
        purpose: "GIVEAWAY_FINALIZATION",
        userId: "u1",
        amount: 100,
      });
      await completeGiveawayFinalizationPayment("pay1");
      expect(
        prisma.giveawayFinalizationPayment.findFirst
      ).not.toHaveBeenCalled();
      expect(referral.recordReferralEarningIfAny).not.toHaveBeenCalled();
    });

    it("throws when the finalization row is missing", async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: "pay1",
        status: "PENDING",
        purpose: "GIVEAWAY_FINALIZATION",
        userId: "u1",
        amount: 100,
      });
      prisma.giveawayFinalizationPayment.findFirst.mockResolvedValue(null);
      await expect(completeGiveawayFinalizationPayment("pay1")).rejects.toThrow(
        "Giveaway finalization record missing"
      );
    });

    it("completes a pending fee, appends activity, and records a referral", async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: "pay1",
        status: "PENDING",
        purpose: "GIVEAWAY_FINALIZATION",
        userId: "u1",
        amount: 100,
      });
      prisma.giveawayFinalizationPayment.findFirst.mockResolvedValue({
        id: "gfp1",
        status: "PENDING",
        giveawayId: "g1",
        feeSats: 15,
        planName: "Pro",
        paymentId: "pay1",
      });
      prisma.giveaway.findUnique.mockResolvedValue({
        id: "g1",
        activityLog: [{ at: "t", type: "created" }],
      });
      await completeGiveawayFinalizationPayment("pay1");
      expect(prisma.payment.findUnique).toHaveBeenCalledWith({
        where: { id: "pay1" },
        select: {
          id: true,
          status: true,
          purpose: true,
          userId: true,
          amount: true,
        },
      });
      const paymentUpdate = prisma.payment.update.mock.calls[0]?.[0];
      expect(paymentUpdate?.where).toEqual({ id: "pay1" });
      expect(paymentUpdate?.data.status).toBe("COMPLETED");
      expect(paymentUpdate?.data.paidAt).toBeInstanceOf(Date);
      const feeUpdate =
        prisma.giveawayFinalizationPayment.update.mock.calls[0]?.[0];
      expect(feeUpdate?.where).toEqual({ id: "gfp1" });
      expect(feeUpdate?.data.status).toBe("PAID");
      expect(feeUpdate?.data.paidAt).toBeInstanceOf(Date);
      const giveawayUpdate = prisma.giveaway.update.mock.calls[0]?.[0];
      expect(giveawayUpdate?.where).toEqual({ id: "g1" });
      expect(activityTypes(giveawayUpdate?.data.activityLog)).toEqual([
        "created",
        "fee_paid",
      ]);
      const log = giveawayUpdate?.data.activityLog;
      const last = isUnknownArray(log) ? log[log.length - 1] : undefined;
      if (!isRecord(last) || !isRecord(last["payload"])) {
        throw new Error("missing fee payload");
      }
      expect(last["payload"]).toEqual({
        feeSats: 15,
        planName: "Pro",
        paymentId: "pay1",
      });
      expect(referral.recordReferralEarningIfAny).toHaveBeenCalledWith(
        "u1",
        "pay1",
        100
      );
    });

    it("skips the fee-row update when it is no longer pending", async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: "pay1",
        status: "PENDING",
        purpose: "GIVEAWAY_FINALIZATION",
        userId: "u1",
        amount: 10,
      });
      prisma.giveawayFinalizationPayment.findFirst.mockResolvedValue({
        id: "gfp1",
        status: "EXPIRED",
        giveawayId: "g1",
        feeSats: 15,
        planName: "Pro",
        paymentId: "pay1",
      });
      prisma.giveaway.findUnique.mockResolvedValue({
        id: "g1",
        activityLog: [],
      });
      await completeGiveawayFinalizationPayment("pay1");
      expect(prisma.giveawayFinalizationPayment.update).not.toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalled();
      expect(prisma.giveaway.update).toHaveBeenCalled();
      expect(referral.recordReferralEarningIfAny).toHaveBeenCalledWith(
        "u1",
        "pay1",
        10
      );
    });

    it("skips the giveaway update and a non-positive referral", async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: "pay1",
        status: "PENDING",
        purpose: "GIVEAWAY_FINALIZATION",
        userId: "u1",
        amount: 0,
      });
      prisma.giveawayFinalizationPayment.findFirst.mockResolvedValue({
        id: "gfp1",
        status: "PENDING",
        giveawayId: "missing",
        feeSats: 15,
        planName: "Pro",
        paymentId: "pay1",
      });
      prisma.giveaway.findUnique.mockResolvedValue(null);
      await completeGiveawayFinalizationPayment("pay1");
      expect(prisma.giveaway.update).not.toHaveBeenCalled();
      expect(prisma.giveawayFinalizationPayment.update).toHaveBeenCalled();
      expect(referral.recordReferralEarningIfAny).not.toHaveBeenCalled();
    });

    it("maps finalization rows and looks up paid or reusable invoices", async () => {
      const expires = new Date("2026-04-01T00:00:00.000Z");
      prisma.giveawayFinalizationPayment.findMany.mockResolvedValue([
        {
          id: "r1",
          status: "PAID",
          feeRateBps: 1000,
          feeSats: 10,
          lockConfigHash: "abc",
          paymentId: "p1",
          payment: { status: "COMPLETED", expiresAt: expires },
        },
        {
          id: "r2",
          status: "PENDING",
          feeRateBps: 500,
          feeSats: 1,
          lockConfigHash: "def",
          paymentId: null,
          payment: null,
        },
        {
          id: "r3",
          status: "PENDING",
          feeRateBps: 500,
          feeSats: 1,
          lockConfigHash: "ghi",
          paymentId: "p3",
          payment: { status: "PENDING", expiresAt: null },
        },
      ]);
      expect(await listGiveawayFinalizationRecords("g1", "u1")).toEqual([
        {
          id: "r1",
          status: "PAID",
          feeRateBps: 1000,
          feeSats: 10,
          lockConfigHash: "abc",
          paymentId: "p1",
          paymentStatus: "COMPLETED",
          paymentExpiresAtMs: expires.getTime(),
        },
        {
          id: "r2",
          status: "PENDING",
          feeRateBps: 500,
          feeSats: 1,
          lockConfigHash: "def",
          paymentId: null,
          paymentStatus: null,
          paymentExpiresAtMs: null,
        },
        {
          id: "r3",
          status: "PENDING",
          feeRateBps: 500,
          feeSats: 1,
          lockConfigHash: "ghi",
          paymentId: "p3",
          paymentStatus: "PENDING",
          paymentExpiresAtMs: null,
        },
      ]);
      expect(prisma.giveawayFinalizationPayment.findMany).toHaveBeenCalledWith({
        where: { giveawayId: "g1", userId: "u1" },
        select: {
          id: true,
          status: true,
          feeRateBps: true,
          feeSats: true,
          lockConfigHash: true,
          paymentId: true,
          payment: { select: { status: true, expiresAt: true } },
        },
      });

      const paid = { id: "paid-row" };
      prisma.giveawayFinalizationPayment.findFirst.mockResolvedValue(paid);
      expect(await findPaidFinalizationForLock("g1", "u1", "hash")).toBe(paid);
      expect(prisma.giveawayFinalizationPayment.findFirst).toHaveBeenCalledWith(
        {
          where: {
            giveawayId: "g1",
            userId: "u1",
            lockConfigHash: "hash",
            status: "PAID",
          },
        }
      );

      const invoice = {
        id: "inv",
        invoice: "lnbc",
        paymentHash: "h",
        amount: 10,
        expiresAt: null,
      };
      prisma.payment.findFirst.mockResolvedValue(invoice);
      expect(await findReusableGiveawayFinalizationInvoice("inv")).toBe(
        invoice
      );
      expect(prisma.payment.findFirst).toHaveBeenCalledWith({
        where: {
          id: "inv",
          status: "PENDING",
          purpose: "GIVEAWAY_FINALIZATION",
        },
        select: {
          id: true,
          invoice: true,
          paymentHash: true,
          amount: true,
          expiresAt: true,
        },
      });
    });

    it("expires pending rows and their invoices, including a stale sweep", async () => {
      await expireGiveawayFinalizationByIds([]);
      expect(
        prisma.giveawayFinalizationPayment.findMany
      ).not.toHaveBeenCalled();

      prisma.giveawayFinalizationPayment.findMany.mockResolvedValue([
        { id: "a", paymentId: "pay-a" },
        { id: "b", paymentId: null },
        { id: "c", paymentId: "" },
      ]);
      await expireGiveawayFinalizationByIds(["a", "b", "c"]);
      expect(prisma.giveawayFinalizationPayment.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["a", "b", "c"] }, status: "PENDING" },
        select: { id: true, paymentId: true },
      });
      expect(prisma.giveawayFinalizationPayment.update).toHaveBeenCalledTimes(
        3
      );
      expect(prisma.payment.updateMany).toHaveBeenCalledTimes(1);
      const expired = prisma.payment.updateMany.mock.calls[0]?.[0];
      expect(expired?.where).toEqual({ id: "pay-a", status: "PENDING" });
      expect(expired?.data.status).toBe("EXPIRED");
      expect(expired?.data.failedAt).toBeInstanceOf(Date);
      expect(expired?.data.failureReason).toBe(
        "Superseded by new finalization invoice"
      );

      prisma.giveawayFinalizationPayment.findMany.mockReset();
      prisma.giveawayFinalizationPayment.update.mockClear();
      prisma.giveawayFinalizationPayment.findMany.mockResolvedValueOnce([]);
      await expireStaleFinalizationPaymentsForGiveaway("g1");
      expect(prisma.giveawayFinalizationPayment.findMany).toHaveBeenCalledTimes(
        1
      );
      expect(prisma.giveawayFinalizationPayment.findMany).toHaveBeenCalledWith({
        where: { giveawayId: "g1", status: "PENDING" },
        select: { id: true },
      });
      expect(prisma.giveawayFinalizationPayment.update).not.toHaveBeenCalled();

      prisma.giveawayFinalizationPayment.findMany.mockReset();
      prisma.giveawayFinalizationPayment.findMany
        .mockResolvedValueOnce([{ id: "a" }, { id: "b" }])
        .mockResolvedValueOnce([
          { id: "a", paymentId: "pay-a" },
          { id: "b", paymentId: null },
        ]);
      await expireStaleFinalizationPaymentsForGiveaway("g1");
      expect(
        prisma.giveawayFinalizationPayment.findMany
      ).toHaveBeenNthCalledWith(1, {
        where: { giveawayId: "g1", status: "PENDING" },
        select: { id: true },
      });
      expect(prisma.giveawayFinalizationPayment.update).toHaveBeenCalledTimes(
        2
      );
    });
  });

  describe("giveaway-display-data and giveaway-scope-data", () => {
    it("resolves queue names and skips an empty id list", async () => {
      prisma.queueType.findFirst.mockResolvedValue({ name: "Memes" });
      expect(await findQueueTypeNameByIdAndUser("u1", "q1")).toBe("Memes");
      prisma.queueType.findFirst.mockResolvedValue(null);
      expect(await findQueueTypeNameByIdAndUser("u1", "missing")).toBeNull();
      expect(prisma.queueType.findFirst).toHaveBeenCalledWith({
        where: { id: "missing", userId: "u1" },
        select: { name: true },
      });

      expect(await findQueueTypesByIdsAndUser("u1", [])).toEqual([]);
      expect(prisma.queueType.findMany).not.toHaveBeenCalled();
      const rows = [{ id: "q1", name: "Memes" }];
      prisma.queueType.findMany.mockResolvedValue(rows);
      expect(await findQueueTypesByIdsAndUser("u1", ["q1"])).toBe(rows);
      expect(prisma.queueType.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["q1"] }, userId: "u1" },
        select: { id: true, name: true },
      });
    });

    it("loads a queue id or the full queue row for scope checks", async () => {
      const idOnly = { id: "q1" };
      prisma.queueType.findFirst.mockResolvedValue(idOnly);
      expect(await findQueueTypeByIdAndUser("u1", "q1")).toBe(idOnly);
      expect(prisma.queueType.findFirst).toHaveBeenCalledWith({
        where: { id: "q1", userId: "u1" },
        select: { id: true },
      });
      const full = { id: "q1", name: "Memes", userId: "u1" };
      prisma.queueType.findFirst.mockResolvedValue(full);
      expect(await findQueueTypeFullByIdAndUser("u1", "q1")).toBe(full);
      expect(prisma.queueType.findFirst).toHaveBeenCalledWith({
        where: { id: "q1", userId: "u1" },
      });
    });
  });

  describe("giveaway-presets-data", () => {
    it("creates, updates, deletes, and reads presets and their queue", async () => {
      const created = { id: "preset-1" };
      prisma.giveawayPreset.create.mockResolvedValue(created);
      const data = {
        name: "Preset",
      } as unknown as Prisma.GiveawayPresetCreateInput;
      expect(await createGiveawayPreset(data)).toBe(created);
      expect(prisma.giveawayPreset.create).toHaveBeenCalledWith({ data });

      const updated = { id: "preset-1", name: "Next" };
      prisma.giveawayPreset.update.mockResolvedValue(updated);
      expect(
        await updateGiveawayPreset("preset-1", "u1", { name: "Next" })
      ).toBe(updated);
      expect(prisma.giveawayPreset.update).toHaveBeenCalledWith({
        where: { id: "preset-1", userId: "u1" },
        data: { name: "Next" },
      });

      await deleteGiveawayPreset("preset-1", "u1");
      expect(prisma.giveawayPreset.delete).toHaveBeenCalledWith({
        where: { id: "preset-1", userId: "u1" },
      });

      const list = [{ id: "preset-1" }];
      prisma.giveawayPreset.findMany.mockResolvedValue(list);
      expect(await getGiveawayPresetsByUser("u1")).toBe(list);
      expect(prisma.giveawayPreset.findMany).toHaveBeenCalledWith({
        where: { userId: "u1" },
        orderBy: { createdAt: "asc" },
      });

      prisma.giveawayPreset.findFirst.mockResolvedValue(null);
      expect(await getGiveawayPresetById("u1", "missing")).toBeNull();
      expect(prisma.giveawayPreset.findFirst).toHaveBeenCalledWith({
        where: { id: "missing", userId: "u1" },
      });

      const queue = { id: "q1", name: "Memes" };
      prisma.queueType.findFirst.mockResolvedValue(queue);
      expect(await findPresetQueue("u1", "q1")).toBe(queue);
      expect(prisma.queueType.findFirst).toHaveBeenCalledWith({
        where: { id: "q1", userId: "u1" },
        select: { id: true, name: true },
      });
    });
  });

  describe("giveaway-actions-data", () => {
    it("reads and writes giveaway rows, including an optional status filter", async () => {
      const row = { id: "g1" };
      prisma.giveaway.findFirst.mockResolvedValue(row);
      expect(await findGiveawayByIdAndUser("g1", "u1")).toBe(row);
      expect(prisma.giveaway.findFirst).toHaveBeenCalledWith({
        where: { id: "g1", userId: "u1" },
      });

      const data = {
        name: "N",
      } as unknown as Prisma.GiveawayCreateInput;
      prisma.giveaway.create.mockResolvedValue({ id: "created" });
      expect(await createGiveaway("u1", data)).toEqual({ id: "created" });
      expect(prisma.giveaway.create).toHaveBeenCalledWith({ data });

      const patch = { name: "Next" } as unknown as Prisma.GiveawayUpdateInput;
      prisma.giveaway.update.mockResolvedValue({ id: "g1" });
      expect(await updateGiveaway("g1", patch)).toEqual({ id: "g1" });
      expect(prisma.giveaway.update).toHaveBeenCalledWith({
        where: { id: "g1" },
        data: patch,
      });

      prisma.giveaway.delete.mockResolvedValue({ id: "g1" });
      expect(await deleteGiveawayById("g1")).toEqual({ id: "g1" });
      expect(prisma.giveaway.delete).toHaveBeenCalledWith({
        where: { id: "g1" },
      });

      prisma.giveaway.findMany.mockResolvedValue([{ id: "g1" }]);
      expect(await listGiveawaysByUser("u1")).toEqual([{ id: "g1" }]);
      expect(prisma.giveaway.findMany).toHaveBeenCalledWith({
        where: { userId: "u1" },
        orderBy: { createdAt: "desc" },
      });
      await listGiveawaysByUser("u1", {});
      expect(prisma.giveaway.findMany).toHaveBeenLastCalledWith({
        where: { userId: "u1" },
        orderBy: { createdAt: "desc" },
      });
      await listGiveawaysByUser("u1", { status: "DRAFT" });
      expect(prisma.giveaway.findMany).toHaveBeenLastCalledWith({
        where: { userId: "u1", status: "DRAFT" },
        orderBy: { createdAt: "desc" },
      });
    });
  });
});
