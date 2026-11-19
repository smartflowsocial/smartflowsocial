import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface PolicyInput {
  mimeType: string;
  sizeBytes: number;
}

interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

interface UploadSettings {
  provider: string;
  customBlossomUrl: string | null;
  enableMirrorBlossom: boolean;
  mirrorUploadUrls: string[];
}

interface IntentCreate {
  intentId: string;
  userId: string;
  provider: string;
  fileCount: number;
  composeSessionId: string | null;
  expiresAt: Date;
}

interface IntentRow {
  userId: string;
  provider: string;
  expiresAt: Date;
}

interface MediaResult {
  id: string;
}

interface AssetRow {
  id: string;
}

interface AssetCreate {
  userId: string;
  status: string;
  sourceMimeType: string;
  sourceBytes: number;
  sha256: string | null;
  sourceProvider: string;
}

interface VariantCreate {
  assetId: string;
  variantKind: string;
  mimeType: string;
  bytes: number;
  url: string;
  provider: string;
  isPrimary: boolean;
  status: string;
}

interface StatusUpdate {
  status: string;
}

interface CommitItemInput {
  fileName: string;
  url: string;
  size: number;
  mimeType: string;
  provider:
    | "S3"
    | "BLOSSOM_PRIMAL"
    | "BLOSSOM_BLOSSTR"
    | "BLOSSOM_SFS"
    | "BLOSSOM_CUSTOM";
  sha256?: string;
}

const ids = vi.hoisted(() => {
  let nextId = 0;
  return {
    reset() {
      nextId = 0;
    },
    next() {
      nextId += 1;
      return `id-${String(nextId)}`;
    },
  };
});

const settingsApi = vi.hoisted(() => ({
  loadUploadProviderSettings: vi.fn(
    async (_userId: string): Promise<UploadSettings> => ({
      provider: "S3",
      customBlossomUrl: null,
      enableMirrorBlossom: false,
      mirrorUploadUrls: [],
    })
  ),
}));

const policyApi = vi.hoisted(() => ({
  evaluateMediaPolicy: vi.fn((input: PolicyInput): PolicyResult => {
    if (input.mimeType === "reject-noreason") return { allowed: false };
    if (input.mimeType === "reject") {
      return { allowed: false, reason: "nope" };
    }
    return { allowed: true };
  }),
}));

const mediaData = vi.hoisted(() => ({
  createMediaAsset: vi.fn(async (_data: AssetCreate): Promise<AssetRow> => ({
    id: "asset-new",
  })),
  createMediaVariant: vi.fn(async (_data: VariantCreate) => ({
    id: "variant",
  })),
  findMediaAssetByUserAndSha256: vi.fn(
    async (_userId: string, _sha256: string): Promise<AssetRow | null> => null
  ),
  findMediaVariantByAssetKindProviderUrl: vi.fn(
    async (
      _assetId: string,
      _kind: string,
      _provider: string,
      _url: string
    ): Promise<{ id: string } | null> => null
  ),
  updateMediaAssetStatus: vi.fn(
    async (_assetId: string, _data: StatusUpdate) => undefined
  ),
}));

const intentData = vi.hoisted(() => ({
  createMediaUploadIntent: vi.fn(async (_data: IntentCreate) => ({
    id: "intent",
  })),
  findMediaUploadIntentByIntentId: vi.fn(
    async (_intentId: string): Promise<IntentRow | null> => null
  ),
}));

const processing = vi.hoisted(() => ({
  enqueueMediaProcessing: vi.fn((_assetId: string) => undefined),
}));

const mediaApi = vi.hoisted(() => ({
  createMediaIfMissing: vi.fn(
    async (_data: {
      userId: string;
      url: string;
      sha256: string | null;
      size: number;
      mimeType: string;
      provider: string;
    }): Promise<MediaResult> => ({ id: "media-1" })
  ),
}));

vi.mock("node:crypto", () => ({ randomUUID: () => ids.next() }));
vi.mock("~/features/user", () => ({
  loadUploadProviderSettings: settingsApi.loadUploadProviderSettings,
}));
vi.mock("~/features/upload/services/media-policy.server", () => ({
  evaluateMediaPolicy: policyApi.evaluateMediaPolicy,
}));
vi.mock("~/features/upload/repositories/media-data.server", () => mediaData);
vi.mock(
  "~/features/upload/repositories/media-intent-data.server",
  () => intentData
);
vi.mock("~/features/upload/services/media-processing.server", () => processing);
vi.mock("~/features/upload/services/media.server", () => mediaApi);

import {
  commitMediaIngest,
  createMediaIngestIntent,
} from "~/features/upload/services/media-ingest.server";

const NOW = new Date("2026-04-01T00:00:00.000Z");
const EXPIRES = new Date("2026-04-01T00:30:00.000Z");

function settings(provider: string): UploadSettings {
  return {
    provider,
    customBlossomUrl: "https://blossom.example",
    enableMirrorBlossom: true,
    mirrorUploadUrls: ["https://mirror.example"],
  };
}

function commitItem(overrides: Partial<CommitItemInput> = {}): CommitItemInput {
  return {
    fileName: "pic.png",
    url: "https://cdn.example/pic.png",
    size: 100,
    mimeType: "image/png",
    provider: "S3",
    sha256: "abc",
    ...overrides,
  };
}

describe("media ingest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    ids.reset();
    settingsApi.loadUploadProviderSettings.mockReset();
    settingsApi.loadUploadProviderSettings.mockResolvedValue(settings("S3"));
    policyApi.evaluateMediaPolicy.mockClear();
    mediaData.createMediaAsset.mockClear();
    mediaData.createMediaVariant.mockClear();
    mediaData.findMediaAssetByUserAndSha256.mockReset();
    mediaData.findMediaAssetByUserAndSha256.mockResolvedValue(null);
    mediaData.findMediaVariantByAssetKindProviderUrl.mockReset();
    mediaData.findMediaVariantByAssetKindProviderUrl.mockResolvedValue(null);
    mediaData.updateMediaAssetStatus.mockClear();
    intentData.createMediaUploadIntent.mockClear();
    intentData.findMediaUploadIntentByIntentId.mockReset();
    intentData.findMediaUploadIntentByIntentId.mockResolvedValue(null);
    processing.enqueueMediaProcessing.mockClear();
    mediaApi.createMediaIfMissing.mockReset();
    mediaApi.createMediaIfMissing.mockResolvedValue({ id: "media-1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a file when policy denies it, with or without a reason", async () => {
    await expect(
      createMediaIngestIntent("user-1", [
        { fileName: "a.png", size: 1, mimeType: "reject" },
        { fileName: "b.png", size: 1, mimeType: "image/png" },
      ])
    ).rejects.toThrow("nope");
    expect(policyApi.evaluateMediaPolicy).toHaveBeenCalledTimes(1);
    expect(settingsApi.loadUploadProviderSettings).not.toHaveBeenCalled();

    await expect(
      createMediaIngestIntent("user-1", [
        { fileName: "a.bin", size: 4, mimeType: "reject-noreason" },
      ])
    ).rejects.toThrow("policy_rejected");
  });

  it("stores an S3 intent and a direct blossom intent", async () => {
    const created = await createMediaIngestIntent(
      "user-1",
      [
        { fileName: "a.png", size: 10, mimeType: "image/png", sha256: "abc" },
        { fileName: "b.png", size: 11, mimeType: "image/png" },
      ],
      { composeSessionId: "session-1" }
    );
    expect(created).toEqual({
      intentId: "id-1",
      provider: "S3",
      customBlossomUrl: "https://blossom.example",
      enableMirrorBlossom: true,
      mirrorUploadUrls: ["https://mirror.example"],
      files: [
        {
          intentFileId: "id-2",
          fileName: "a.png",
          size: 10,
          mimeType: "image/png",
          sha256: "abc",
          lane: "server_upload",
          uploadEndpoint: "/api/upload",
        },
        {
          intentFileId: "id-3",
          fileName: "b.png",
          size: 11,
          mimeType: "image/png",
          sha256: undefined,
          lane: "server_upload",
          uploadEndpoint: "/api/upload",
        },
      ],
    });
    expect(intentData.createMediaUploadIntent).toHaveBeenCalledWith({
      intentId: "id-1",
      userId: "user-1",
      provider: "S3",
      fileCount: 2,
      composeSessionId: "session-1",
      expiresAt: EXPIRES,
    });
    expect(policyApi.evaluateMediaPolicy).toHaveBeenCalledWith({
      mimeType: "image/png",
      sizeBytes: 10,
    });

    for (const provider of [
      "BLOSSOM_PRIMAL",
      "BLOSSOM_BLOSSTR",
      "BLOSSOM_SFS",
      "BLOSSOM_CUSTOM",
    ]) {
      settingsApi.loadUploadProviderSettings.mockResolvedValueOnce(
        settings(provider)
      );
      const blossom = await createMediaIngestIntent("user-1", []);
      expect(blossom.provider).toBe(provider);
      expect(blossom.files).toEqual([]);
    }
    const lastIntent =
      intentData.createMediaUploadIntent.mock.calls.at(-1)?.[0];
    expect(lastIntent?.provider).toBe("BLOSSOM_CUSTOM");
    expect(lastIntent?.fileCount).toBe(0);
    expect(lastIntent?.composeSessionId).toBeNull();

    settingsApi.loadUploadProviderSettings.mockResolvedValueOnce(
      settings("LOCAL")
    );
    const fallback = await createMediaIngestIntent(
      "user-1",
      [{ fileName: "c.png", size: 1, mimeType: "image/png" }],
      { composeSessionId: null }
    );
    expect(fallback.provider).toBe("S3");
    expect(fallback.files[0]?.lane).toBe("server_upload");
    expect(fallback.files[0]?.uploadEndpoint).toBe("/api/upload");

    settingsApi.loadUploadProviderSettings.mockResolvedValueOnce(
      settings("BLOSSOM_PRIMAL")
    );
    const direct = await createMediaIngestIntent("user-1", [
      { fileName: "d.png", size: 1, mimeType: "image/png" },
    ]);
    expect(direct.files[0]?.lane).toBe("direct_client_upload");
    expect(direct.files[0]?.uploadEndpoint).toBe("/api/upload-blossom");

    settingsApi.loadUploadProviderSettings.mockResolvedValueOnce(
      settings("BLOSSOM_SFS")
    );
    await createMediaIngestIntent(
      "user-1",
      [{ fileName: "e.png", size: 1, mimeType: "image/png" }],
      { composeSessionId: "" }
    );
    expect(
      intentData.createMediaUploadIntent.mock.calls.at(-1)?.[0].composeSessionId
    ).toBe("");
  });

  it("propagates settings lookup failures", async () => {
    settingsApi.loadUploadProviderSettings.mockRejectedValueOnce(
      new Error("settings down")
    );
    await expect(
      createMediaIngestIntent("user-1", [
        { fileName: "a.png", size: 1, mimeType: "image/png" },
      ])
    ).rejects.toThrow("settings down");
    settingsApi.loadUploadProviderSettings.mockRejectedValueOnce(
      "settings string"
    );
    await expect(
      createMediaIngestIntent("user-1", [
        { fileName: "a.png", size: 1, mimeType: "image/png" },
      ])
    ).rejects.toBe("settings string");
  });

  it("rejects a missing, foreign, expired, or mismatched intent", async () => {
    await expect(
      commitMediaIngest("user-1", [commitItem()], { intentId: "missing" })
    ).rejects.toThrow("invalid_media_intent");

    intentData.findMediaUploadIntentByIntentId.mockResolvedValueOnce({
      userId: "other",
      provider: "S3",
      expiresAt: EXPIRES,
    });
    await expect(
      commitMediaIngest("user-1", [commitItem()], { intentId: "foreign" })
    ).rejects.toThrow("invalid_media_intent");

    intentData.findMediaUploadIntentByIntentId.mockResolvedValueOnce({
      userId: "user-1",
      provider: "S3",
      expiresAt: new Date(NOW.getTime() - 1),
    });
    await expect(
      commitMediaIngest("user-1", [commitItem()], { intentId: "old" })
    ).rejects.toThrow("media_intent_expired");

    intentData.findMediaUploadIntentByIntentId.mockResolvedValueOnce({
      userId: "user-1",
      provider: "S3",
      expiresAt: NOW,
    });
    await expect(
      commitMediaIngest(
        "user-1",
        [commitItem({ provider: "BLOSSOM_PRIMAL" })],
        { intentId: "mismatch" }
      )
    ).rejects.toThrow("MEDIA_PROVIDER_MISMATCH");
  });

  it("accepts an unexpired intent and commits new and existing assets", async () => {
    intentData.findMediaUploadIntentByIntentId.mockResolvedValueOnce({
      userId: "user-1",
      provider: "S3",
      expiresAt: NOW,
    });
    mediaData.findMediaAssetByUserAndSha256.mockResolvedValueOnce({
      id: "asset-existing",
    });
    mediaData.findMediaVariantByAssetKindProviderUrl.mockResolvedValueOnce({
      id: "variant-existing",
    });
    mediaApi.createMediaIfMissing
      .mockResolvedValueOnce({ id: "media-a" })
      .mockResolvedValueOnce({ id: "media-b" });

    const result = await commitMediaIngest(
      "user-1",
      [
        commitItem({ fileName: "a.png", sha256: "abc", url: "https://cdn/a" }),
        commitItem({
          fileName: "b.png",
          sha256: undefined,
          url: "https://cdn/b",
          provider: "S3",
        }),
      ],
      { intentId: "intent-1" }
    );

    expect(result).toEqual({
      committed: [
        {
          mediaId: "media-a",
          assetId: "asset-existing",
          status: "processing",
          fileName: "a.png",
          url: "https://cdn/a",
        },
        {
          mediaId: "media-b",
          assetId: "asset-new",
          status: "processing",
          fileName: "b.png",
          url: "https://cdn/b",
        },
      ],
    });
    expect(mediaData.findMediaAssetByUserAndSha256).toHaveBeenCalledTimes(1);
    expect(mediaData.findMediaAssetByUserAndSha256).toHaveBeenCalledWith(
      "user-1",
      "abc"
    );
    expect(mediaData.createMediaAsset).toHaveBeenCalledTimes(1);
    expect(mediaData.createMediaAsset).toHaveBeenCalledWith({
      userId: "user-1",
      status: "uploaded",
      sourceMimeType: "image/png",
      sourceBytes: 100,
      sha256: null,
      sourceProvider: "S3",
    });
    expect(mediaData.createMediaVariant).toHaveBeenCalledTimes(1);
    expect(mediaData.createMediaVariant).toHaveBeenCalledWith({
      assetId: "asset-new",
      variantKind: "original",
      mimeType: "image/png",
      bytes: 100,
      url: "https://cdn/b",
      provider: "S3",
      isPrimary: true,
      status: "pending",
    });
    expect(
      mediaData.findMediaVariantByAssetKindProviderUrl
    ).toHaveBeenNthCalledWith(
      1,
      "asset-existing",
      "original",
      "S3",
      "https://cdn/a"
    );
    expect(mediaData.updateMediaAssetStatus).toHaveBeenNthCalledWith(
      1,
      "asset-existing",
      { status: "processing" }
    );
    expect(mediaData.updateMediaAssetStatus).toHaveBeenNthCalledWith(
      2,
      "asset-new",
      { status: "processing" }
    );
    expect(processing.enqueueMediaProcessing).toHaveBeenNthCalledWith(
      1,
      "asset-existing"
    );
    expect(processing.enqueueMediaProcessing).toHaveBeenNthCalledWith(
      2,
      "asset-new"
    );
    expect(mediaApi.createMediaIfMissing).toHaveBeenNthCalledWith(2, {
      userId: "user-1",
      url: "https://cdn/b",
      sha256: null,
      size: 100,
      mimeType: "image/png",
      provider: "S3",
    });
  });

  it("creates a variant when the asset is new and skips intent checks without an id", async () => {
    mediaData.findMediaAssetByUserAndSha256.mockResolvedValueOnce(null);
    const result = await commitMediaIngest("user-1", [
      commitItem({ sha256: "fresh", provider: "BLOSSOM_BLOSSTR" }),
    ]);
    expect(intentData.findMediaUploadIntentByIntentId).not.toHaveBeenCalled();
    expect(result.committed[0]?.assetId).toBe("asset-new");
    expect(mediaData.createMediaAsset).toHaveBeenCalledWith({
      userId: "user-1",
      status: "uploaded",
      sourceMimeType: "image/png",
      sourceBytes: 100,
      sha256: "fresh",
      sourceProvider: "BLOSSOM_BLOSSTR",
    });
    expect(mediaData.createMediaVariant).toHaveBeenCalledTimes(1);

    intentData.findMediaUploadIntentByIntentId.mockResolvedValueOnce({
      userId: "user-1",
      provider: "S3",
      expiresAt: EXPIRES,
    });
    await expect(
      commitMediaIngest("user-1", [], { intentId: "empty" })
    ).resolves.toEqual({ committed: [] });
  });

  it("propagates commit dependency failures", async () => {
    mediaApi.createMediaIfMissing.mockRejectedValueOnce(
      new Error("media down")
    );
    await expect(commitMediaIngest("user-1", [commitItem()])).rejects.toThrow(
      "media down"
    );
    mediaApi.createMediaIfMissing.mockRejectedValueOnce("media string");
    await expect(commitMediaIngest("user-1", [commitItem()])).rejects.toBe(
      "media string"
    );
  });
});
