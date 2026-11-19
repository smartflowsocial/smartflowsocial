// @ts-nocheck -- mocked collaborators are narrower than the production types.
import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

interface MediaPolicy {
  canUseSfsBlossomStorage: boolean;
  monthlyStorageBytes: bigint | null;
  monthlyUploadBytes: bigint | null;
  maxFileBytes: number | null;
  maxParallelUploadsHint: number | null;
}

interface FileIntent {
  sha256: string;
  size: number;
  type: string;
  filename?: string;
}

interface IssueContext {
  intentId: string;
  requestedProvider: string;
  requestId?: string;
}

interface IntentRow {
  userId: string;
  provider: string;
  expiresAt: Date;
}

interface ReservationItem {
  jti: string;
  sha256: string;
  size: number;
  mimeType: string;
}

interface TokenPayload {
  sub?: unknown;
  sha256?: unknown;
  size?: unknown;
  type?: unknown;
  iat?: unknown;
  exp?: unknown;
  jti?: unknown;
  batchId?: unknown;
  rateClass?: unknown;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;
const SHA = "ab".repeat(32);
const SHA_B = "cd".repeat(32);
const SECRET = "upload-secret";

const envState = vi.hoisted(() => ({
  BLOSSOM_SFS_API_URL: "https://blossom.example",
  BLOSSOM_UPLOAD_TOKEN_SECRET: "upload-secret",
  BLOSSOM_INTERNAL_SECRET: undefined as string | undefined,
}));

const users = vi.hoisted(() => ({
  getUserById:
    vi.fn<(userId: string) => Promise<{ npub?: string | null } | null>>(),
}));

const subscriptions = vi.hoisted(() => ({
  getUserSubscription: vi.fn<
    (userId: string) => Promise<{
      planId?: string | null;
      Plan?: { id?: string | null; name?: string | null } | null;
    } | null>
  >(),
}));

const policyApi = vi.hoisted(() => ({
  getCanonicalPlanPolicy: vi.fn<(plan: string) => { media: MediaPolicy }>(),
}));

const settingsApi = vi.hoisted(() => ({
  loadUploadProviderSettings:
    vi.fn<(userId: string) => Promise<{ provider: string | null }>>(),
}));

const intents = vi.hoisted(() => ({
  findMediaUploadIntentByIntentId:
    vi.fn<(intentId: string) => Promise<IntentRow | null>>(),
}));

const owned = vi.hoisted(() => ({
  getCanonicalOwnedBytesForUser: vi.fn<(userId: string) => Promise<bigint>>(),
}));

const blossomRepo = vi.hoisted(() => ({
  aggregateReservedSizeForPubkey:
    vi.fn<(pubkey: string) => Promise<{ _sum: { size: number | null } }>>(),
  findBlossomUsagePeriod:
    vi.fn<
      (
        userId: string,
        periodStartUtc: Date
      ) => Promise<{ uploadedBytes: bigint } | null>
    >(),
  createBlossomReservationBatchAndItems:
    vi.fn<
      (
        batchId: string,
        userId: string,
        pubkey: string,
        provider: string,
        intentId: string,
        totalBytes: bigint,
        expiresAt: Date,
        items: ReservationItem[]
      ) => Promise<void>
    >(),
  commitBlossomBatch: vi.fn<
    (
      items: unknown[],
      batchId: string,
      periodStartUtc: Date
    ) => Promise<{
      processed: number;
      duplicate: number;
      failed: number;
      statuses: [];
    }>
  >(),
  expireBlossomReservations:
    vi.fn<
      (now: Date) => Promise<{ itemsExpired: number; batchesExpired: number }>
    >(),
  getActiveReservedBytesForPubkey: vi.fn<(pubkey: string) => Promise<bigint>>(),
  getBlossomReservationDriftStats: vi.fn<
    () => Promise<{
      reservedCount: number;
      activeBatchCount: number;
      oldestReservedCreatedAt: Date | null;
    }>
  >(),
  upsertBlossomUsagePeriod:
    vi.fn<
      (userId: string, periodStartUtc: Date, size: number) => Promise<void>
    >(),
}));

const logs = vi.hoisted(() => ({
  logInfo: vi.fn<(message: string, fields?: Record<string, unknown>) => void>(),
  logWarning:
    vi.fn<(message: string, fields?: Record<string, unknown>) => void>(),
}));

vi.mock("~/lib/env.server", () => ({ env: envState }));
vi.mock("~/features/user", () => users);
vi.mock("~/features/payments/data", () => subscriptions);
vi.mock("~/features/payments/plan-policy", () => policyApi);
vi.mock("~/features/user/services/upload-provider.server", () => settingsApi);
vi.mock(
  "~/features/upload/repositories/media-intent-data.server",
  () => intents
);
vi.mock("~/features/upload/services/media.server", () => owned);
vi.mock(
  "~/features/upload/repositories/blossom-data.server",
  () => blossomRepo
);
vi.mock("~/lib/error-logger.server", () => logs);

import {
  commitBlossomBatch,
  expireBlossomReservations,
  getActiveReservedBytesForPubkey,
  getBlossomReservationDriftStats,
  issueBlossomBulkTokens,
  recordBlossomCompatUsage,
} from "~/features/upload/services/blossom-v2.server";
import { BRAND_NAME } from "~/lib/brand";
import { AuthorizationError } from "~/lib/errors";

function media(overrides: Partial<MediaPolicy> = {}): MediaPolicy {
  return {
    canUseSfsBlossomStorage: true,
    monthlyStorageBytes: 5n * BigInt(GB),
    monthlyUploadBytes: 20n * BigInt(GB),
    maxFileBytes: 50 * MB,
    maxParallelUploadsHint: 4,
    ...overrides,
  };
}

function file(overrides: Partial<FileIntent> = {}): FileIntent {
  return { sha256: SHA, size: 100, type: "image/png", ...overrides };
}

function context(overrides: Partial<IssueContext> = {}): IssueContext {
  return {
    intentId: "intent-1",
    requestedProvider: "BLOSSOM_SFS",
    ...overrides,
  };
}

function decodePayload(token: string): TokenPayload {
  const encoded = token.split(".")[1] ?? "";
  const parsed: unknown = JSON.parse(
    Buffer.from(
      encoded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8")
  );
  if (!parsed || typeof parsed !== "object") throw new Error("bad token");
  return parsed;
}

function signatureMatches(token: string, secret: string): boolean {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return false;
  const expected = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return expected === signature;
}

describe("blossom v2 tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envState.BLOSSOM_SFS_API_URL = "https://blossom.example";
    envState.BLOSSOM_UPLOAD_TOKEN_SECRET = SECRET;
    envState.BLOSSOM_INTERNAL_SECRET = undefined;
    users.getUserById.mockResolvedValue({ npub: "Ab".repeat(32) });
    subscriptions.getUserSubscription.mockResolvedValue({
      planId: "starter",
      Plan: { id: "starter", name: "Starter" },
    });
    policyApi.getCanonicalPlanPolicy.mockImplementation((plan) => ({
      media: media({ maxParallelUploadsHint: plan === "starter" ? 4 : 6 }),
    }));
    settingsApi.loadUploadProviderSettings.mockResolvedValue({
      provider: "BLOSSOM_SFS",
    });
    intents.findMediaUploadIntentByIntentId.mockResolvedValue({
      userId: "user-1",
      provider: "BLOSSOM_SFS",
      expiresAt: new Date(Date.now() + 60_000),
    });
    owned.getCanonicalOwnedBytesForUser.mockResolvedValue(0n);
    blossomRepo.aggregateReservedSizeForPubkey.mockResolvedValue({
      _sum: { size: 0 },
    });
    blossomRepo.findBlossomUsagePeriod.mockResolvedValue(null);
    blossomRepo.createBlossomReservationBatchAndItems.mockResolvedValue(
      undefined
    );
    blossomRepo.commitBlossomBatch.mockResolvedValue({
      processed: 1,
      duplicate: 0,
      failed: 0,
      statuses: [],
    });
    blossomRepo.expireBlossomReservations.mockResolvedValue({
      itemsExpired: 2,
      batchesExpired: 1,
    });
    blossomRepo.getActiveReservedBytesForPubkey.mockResolvedValue(9n);
    blossomRepo.getBlossomReservationDriftStats.mockResolvedValue({
      reservedCount: 3,
      activeBatchCount: 1,
      oldestReservedCreatedAt: null,
    });
    blossomRepo.upsertBlossomUsagePeriod.mockResolvedValue(undefined);
  });

  it("rejects an empty batch, an oversized batch, and a missing intent", async () => {
    await expect(
      issueBlossomBulkTokens("user-1", [], context())
    ).rejects.toThrow("files array is required");
    await expect(
      issueBlossomBulkTokens(
        "user-1",
        null as unknown as FileIntent[],
        context()
      )
    ).rejects.toThrow("files array is required");
    await expect(
      issueBlossomBulkTokens(
        "user-1",
        Array.from({ length: 501 }, () => file()),
        context()
      )
    ).rejects.toThrow("batch size exceeds max of 500");
    await expect(
      issueBlossomBulkTokens("user-1", [file()], context({ intentId: "" }))
    ).rejects.toThrow("media_intent_required");
    await expect(
      issueBlossomBulkTokens(
        "user-1",
        [file()],
        context({ requestedProvider: "" })
      )
    ).rejects.toThrow("media_intent_required");
    expect(intents.findMediaUploadIntentByIntentId).not.toHaveBeenCalled();
  });

  it("rejects unknown and mismatched providers", async () => {
    await expect(
      issueBlossomBulkTokens(
        "user-1",
        [file()],
        context({ requestedProvider: "NOPE" })
      )
    ).rejects.toThrow("MEDIA_PROVIDER_MISMATCH");
    expect(intents.findMediaUploadIntentByIntentId).not.toHaveBeenCalled();
    expect(logs.logWarning).not.toHaveBeenCalled();

    settingsApi.loadUploadProviderSettings.mockResolvedValueOnce({
      provider: "NOPE",
    });
    await expect(
      issueBlossomBulkTokens("user-1", [file()], context())
    ).rejects.toThrow("MEDIA_PROVIDER_MISMATCH");
    expect(logs.logWarning).not.toHaveBeenCalled();

    intents.findMediaUploadIntentByIntentId.mockResolvedValueOnce({
      userId: "user-1",
      provider: "NOPE",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      issueBlossomBulkTokens("user-1", [file()], context())
    ).rejects.toThrow("MEDIA_PROVIDER_MISMATCH");
    expect(logs.logWarning).not.toHaveBeenCalled();

    settingsApi.loadUploadProviderSettings.mockResolvedValueOnce({
      provider: "S3",
    });
    await expect(
      issueBlossomBulkTokens(
        "user-1",
        [file()],
        context({ requestedProvider: "BLOSSOM_SFS", requestId: "req-1" })
      )
    ).rejects.toThrow("MEDIA_PROVIDER_MISMATCH");
    expect(logs.logWarning).toHaveBeenCalledWith(
      "MEDIA_PROVIDER_MISMATCH",
      expect.objectContaining({
        reason: "requested_resolved_intent_mismatch",
        requestId: "req-1",
        userId: "user-1",
        intentId: "intent-1",
      })
    );

    settingsApi.loadUploadProviderSettings.mockResolvedValue({
      provider: "S3",
    });
    intents.findMediaUploadIntentByIntentId.mockResolvedValue({
      userId: "user-1",
      provider: "S3",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      issueBlossomBulkTokens(
        "user-1",
        [file()],
        context({ requestedProvider: "S3" })
      )
    ).rejects.toThrow("MEDIA_PROVIDER_MISMATCH");
    expect(logs.logWarning).toHaveBeenLastCalledWith(
      "MEDIA_PROVIDER_MISMATCH",
      expect.objectContaining({
        reason: "token_lane_requires_blossom_sfs",
        authorizationProvider: "S3",
      })
    );
  });

  it("rejects a missing, foreign, or expired intent and a missing user", async () => {
    intents.findMediaUploadIntentByIntentId.mockResolvedValueOnce(null);
    await expect(
      issueBlossomBulkTokens("user-1", [file()], context())
    ).rejects.toThrow("media_intent_not_found");
    intents.findMediaUploadIntentByIntentId.mockResolvedValueOnce({
      userId: "other",
      provider: "BLOSSOM_SFS",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      issueBlossomBulkTokens("user-1", [file()], context())
    ).rejects.toThrow("media_intent_not_found");
    intents.findMediaUploadIntentByIntentId.mockResolvedValueOnce({
      userId: "user-1",
      provider: "BLOSSOM_SFS",
      expiresAt: new Date(Date.now() - 1),
    });
    await expect(
      issueBlossomBulkTokens("user-1", [file()], context())
    ).rejects.toThrow("media_intent_expired");

    envState.BLOSSOM_SFS_API_URL = undefined;
    await expect(
      issueBlossomBulkTokens("user-1", [file()], context())
    ).rejects.toThrow(/BLOSSOM_SFS_API_URL is not set/);
    expect(logs.logInfo).not.toHaveBeenCalled();

    envState.BLOSSOM_SFS_API_URL = "https://blossom.example";
    users.getUserById.mockResolvedValueOnce(null);
    await expect(
      issueBlossomBulkTokens("user-1", [file()], context())
    ).rejects.toThrow("User not found for blossom token issuance");
    users.getUserById.mockResolvedValueOnce({ npub: "" });
    await expect(
      issueBlossomBulkTokens("user-1", [file()], context())
    ).rejects.toThrow("User not found for blossom token issuance");
    expect(logs.logInfo).toHaveBeenCalledWith(
      "blossom_token_issuance_provider_resolved",
      expect.objectContaining({ userId: "user-1", intentId: "intent-1" })
    );
  });

  it("rejects an invalid plan, an unpaid plan, missing quota, and a missing secret", async () => {
    subscriptions.getUserSubscription.mockResolvedValueOnce(null);
    await expect(
      issueBlossomBulkTokens("user-1", [file()], context())
    ).rejects.toBeInstanceOf(AuthorizationError);
    subscriptions.getUserSubscription.mockResolvedValueOnce({
      planId: "",
      Plan: { id: null, name: "pro" },
    });
    await expect(
      issueBlossomBulkTokens("user-1", [file()], context())
    ).rejects.toThrow("Invalid subscription plan configuration.");
    subscriptions.getUserSubscription.mockResolvedValueOnce({
      planId: null,
      Plan: { id: null, name: "pro" },
    });
    await issueBlossomBulkTokens(
      "user-1",
      [file({ sha256: "nope" })],
      context()
    );
    expect(policyApi.getCanonicalPlanPolicy).toHaveBeenCalledWith("pro");

    policyApi.getCanonicalPlanPolicy.mockReturnValue({
      media: media({ canUseSfsBlossomStorage: false }),
    });
    await expect(
      issueBlossomBulkTokens("user-1", [file()], context())
    ).rejects.toThrow(`${BRAND_NAME}-hosted media is available on paid plans.`);

    const missing: MediaPolicy[] = [
      media({ monthlyStorageBytes: null }),
      media({ monthlyUploadBytes: null }),
      media({ maxFileBytes: null }),
      media({ maxParallelUploadsHint: null }),
    ];
    for (const item of missing) {
      policyApi.getCanonicalPlanPolicy.mockReturnValue({ media: item });
      await expect(
        issueBlossomBulkTokens("user-1", [file()], context())
      ).rejects.toThrow(
        "Hosted media policy is missing quota fields for planType=starter"
      );
    }

    policyApi.getCanonicalPlanPolicy.mockImplementation((plan) => ({
      media: media({ maxParallelUploadsHint: plan === "starter" ? 4 : 6 }),
    }));
    envState.BLOSSOM_UPLOAD_TOKEN_SECRET = "   ";
    envState.BLOSSOM_INTERNAL_SECRET = "internal-secret";
    await expect(
      issueBlossomBulkTokens("user-1", [file()], context())
    ).rejects.toThrow("BLOSSOM_UPLOAD_TOKEN_SECRET");
    envState.BLOSSOM_UPLOAD_TOKEN_SECRET = undefined;
    envState.BLOSSOM_INTERNAL_SECRET = undefined;
    await expect(
      issueBlossomBulkTokens("user-1", [file()], context())
    ).rejects.toThrow("BLOSSOM_INTERNAL_SECRET");
  });

  it("issues signed tokens, skips invalid files, and records the reservation", async () => {
    const result = await issueBlossomBulkTokens(
      "user-1",
      [
        file(),
        file({ sha256: "not-a-hash", size: 10 }),
        file({ sha256: SHA_B, size: 0 }),
        file({ sha256: SHA_B, size: -5 }),
        file({ sha256: SHA_B, size: Number.NaN }),
        file({ sha256: SHA_B, size: Number.POSITIVE_INFINITY }),
        { sha256: SHA_B, size: 20, type: "" },
      ],
      context({ requestId: "req-9" })
    );

    expect(result.uploadUrl).toBe("https://blossom.example/upload");
    expect(result.expiresIn).toBe(900);
    expect(result.maxParallelUploadsHint).toBe(4);
    expect(result.results.filter((item) => item.token)).toHaveLength(1);
    expect(
      result.results.filter((item) => item.error === "invalid_request")
    ).toHaveLength(6);
    const issued = result.results[0];
    expect(issued?.token).toBeDefined();
    expect(signatureMatches(issued?.token ?? "", SECRET)).toBe(true);
    const payload = decodePayload(issued?.token ?? "");
    expect(payload.sub).toBe("ab".repeat(32));
    expect(payload.sha256).toBe(SHA);
    expect(payload.size).toBe(100);
    expect(payload.type).toBe("image/png");
    expect(payload.batchId).toBe(result.batchId);
    expect(payload.rateClass).toBe("starter");
    expect(payload.exp).toBe((payload.iat as number) + 180);
    expect(blossomRepo.aggregateReservedSizeForPubkey).toHaveBeenCalledWith(
      "ab".repeat(32)
    );
    const reservation =
      blossomRepo.createBlossomReservationBatchAndItems.mock.calls[0];
    expect(reservation?.[0]).toBe(result.batchId);
    expect(reservation?.[1]).toBe("user-1");
    expect(reservation?.[2]).toBe("ab".repeat(32));
    expect(reservation?.[3]).toBe("BLOSSOM_SFS");
    expect(reservation?.[4]).toBe("intent-1");
    expect(reservation?.[5]).toBe(100n);
    expect(reservation?.[6]).toBeInstanceOf(Date);
    expect(reservation?.[7]).toEqual([
      {
        jti: payload.jti,
        sha256: SHA,
        size: 100,
        mimeType: "image/png",
      },
    ]);
    expect(logs.logInfo).toHaveBeenCalledWith(
      "blossom_token_issuance_completed",
      expect.objectContaining({
        requestId: "req-9",
        issuedTokenCount: 1,
        batchId: result.batchId,
      })
    );
  });

  it("signs with the internal secret when the upload secret is unset", async () => {
    envState.BLOSSOM_UPLOAD_TOKEN_SECRET = undefined;
    envState.BLOSSOM_INTERNAL_SECRET = "  internal-secret  ";
    const result = await issueBlossomBulkTokens("user-1", [file()], context());
    expect(
      signatureMatches(result.results[0]?.token ?? "", "internal-secret")
    ).toBe(true);
  });

  it("returns file errors without a reservation when nothing is acceptable", async () => {
    const result = await issueBlossomBulkTokens(
      "user-1",
      [file({ sha256: "bad" })],
      context()
    );
    expect(result.results).toEqual([
      { sha256: "bad", size: 100, error: "invalid_request" },
    ]);
    expect(
      blossomRepo.createBlossomReservationBatchAndItems
    ).not.toHaveBeenCalled();
    expect(result.batchId).not.toBe("");
  });

  it("describes size limits and enforces storage before upload", async () => {
    policyApi.getCanonicalPlanPolicy.mockReturnValue({
      media: media({ maxFileBytes: 2 * GB }),
    });
    const gigabytes = await issueBlossomBulkTokens(
      "user-1",
      [file({ size: 2 * GB + 1 })],
      context()
    );
    expect(gigabytes.results[0]?.message).toContain("2 GB");

    policyApi.getCanonicalPlanPolicy.mockReturnValue({
      media: media({ maxFileBytes: 50 * MB }),
    });
    const megabytes = await issueBlossomBulkTokens(
      "user-1",
      [file({ size: 50 * MB + 1 })],
      context()
    );
    expect(megabytes.results[0]?.message).toContain("50 MB");

    policyApi.getCanonicalPlanPolicy.mockReturnValue({
      media: media({ maxFileBytes: Math.round(1.5 * MB) }),
    });
    const fractional = await issueBlossomBulkTokens(
      "user-1",
      [file({ size: Math.round(1.5 * MB) + 1 })],
      context()
    );
    expect(fractional.results[0]?.message).toContain("1.5 MB");

    policyApi.getCanonicalPlanPolicy.mockReturnValue({
      media: media({ maxFileBytes: 0 }),
    });
    const emptyLimit = await issueBlossomBulkTokens(
      "user-1",
      [file({ size: 1 })],
      context()
    );
    expect(emptyLimit.results[0]?.message).toContain("limit ().");

    policyApi.getCanonicalPlanPolicy.mockReturnValue({
      media: media({
        monthlyStorageBytes: 150n,
        monthlyUploadBytes: 10_000n,
        maxFileBytes: 1_000,
      }),
    });
    const storage = await issueBlossomBulkTokens(
      "user-1",
      [file({ sha256: SHA, size: 100 }), file({ sha256: SHA_B, size: 80 })],
      context()
    );
    expect(storage.results[0]?.error).toBe("quota_exceeded");
    expect(storage.results[1]?.token).toBeDefined();

    policyApi.getCanonicalPlanPolicy.mockReturnValue({
      media: media({
        monthlyStorageBytes: 10_000n,
        monthlyUploadBytes: 50n,
        maxFileBytes: 1_000,
      }),
    });
    blossomRepo.findBlossomUsagePeriod.mockResolvedValue({ uploadedBytes: 0n });
    blossomRepo.aggregateReservedSizeForPubkey.mockResolvedValue({
      _sum: { size: null },
    });
    owned.getCanonicalOwnedBytesForUser.mockResolvedValue(0n);
    const upload = await issueBlossomBulkTokens(
      "user-1",
      [file({ size: 80 })],
      context()
    );
    expect(upload.results[0]?.error).toBe("quota_exceeded");
    expect(
      blossomRepo.createBlossomReservationBatchAndItems
    ).toHaveBeenCalledTimes(1);
  });

  it("delegates commit, expiry, drift, and usage to the repository", async () => {
    const items = [
      {
        jti: "jti-1",
        pubkey: "ab",
        sha256: SHA,
        size: 10,
        url: "https://blossom.example/ab",
      },
    ];
    await expect(commitBlossomBatch("batch-1", items)).resolves.toEqual({
      processed: 1,
      duplicate: 0,
      failed: 0,
      statuses: [],
    });
    const period = blossomRepo.commitBlossomBatch.mock.calls[0]?.[2];
    expect(blossomRepo.commitBlossomBatch.mock.calls[0]?.[0]).toBe(items);
    expect(blossomRepo.commitBlossomBatch.mock.calls[0]?.[1]).toBe("batch-1");
    expect(period?.getUTCDate()).toBe(1);
    expect(period?.getUTCHours()).toBe(0);

    blossomRepo.commitBlossomBatch.mockRejectedValueOnce(
      new Error("commit down")
    );
    await expect(commitBlossomBatch("batch-1", items)).rejects.toThrow(
      "commit down"
    );
    blossomRepo.commitBlossomBatch.mockRejectedValueOnce("commit string");
    await expect(commitBlossomBatch("batch-1", items)).rejects.toBe(
      "commit string"
    );

    const now = new Date("2024-05-15T12:00:00.000Z");
    await expect(expireBlossomReservations(now)).resolves.toEqual({
      itemsExpired: 2,
      batchesExpired: 1,
    });
    expect(blossomRepo.expireBlossomReservations).toHaveBeenCalledWith(now);
    await expect(getActiveReservedBytesForPubkey("ab")).resolves.toBe(9n);
    await expect(getBlossomReservationDriftStats()).resolves.toEqual({
      reservedCount: 3,
      activeBatchCount: 1,
      oldestReservedCreatedAt: null,
    });
    await recordBlossomCompatUsage(
      "user-1",
      12,
      new Date("2024-03-01T00:30:00.000Z")
    );
    expect(blossomRepo.upsertBlossomUsagePeriod).toHaveBeenCalledWith(
      "user-1",
      new Date(Date.UTC(2024, 2, 1)),
      12
    );
    blossomRepo.upsertBlossomUsagePeriod.mockRejectedValueOnce("usage string");
    await expect(recordBlossomCompatUsage("user-1", 1, now)).rejects.toBe(
      "usage string"
    );
  });
});
