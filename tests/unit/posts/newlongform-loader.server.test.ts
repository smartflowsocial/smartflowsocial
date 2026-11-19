import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAnySubscription: vi.fn(async () => undefined),
  getLongFormPost: vi.fn(),
  getTemplatePrefill: vi.fn(),
  getTemplateListSummaries: vi.fn(async () => []),
  getUserById: vi.fn(),
  getScheduleInterval: vi.fn(async () => []),
  getQueueTypes: vi.fn(async () => []),
  getUserHashTagPresets: vi.fn(async () => []),
  getUserUploadProvider: vi.fn(async () => null),
  loadComposerRelayLists: vi.fn(async () => ({
    default: [],
    app: [],
    nip65Profile: [],
    accountPublishRelaySource: "app",
  })),
}));

vi.mock("~/features/payments/subscriptions.server", () => ({
  requireAnySubscription: mocks.requireAnySubscription,
}));

vi.mock("~/features/posts/composer/index.server", () => ({
  getAccountDisplayLabel: () => "Ada",
}));

vi.mock("~/features/posts/server", () => ({
  getLongFormPost: mocks.getLongFormPost,
}));

vi.mock("~/features/relays/relay-resolution.server", () => ({
  loadComposerRelayLists: mocks.loadComposerRelayLists,
}));

vi.mock("~/features/templates/services/template-data.server", () => ({
  getTemplatePrefill: mocks.getTemplatePrefill,
  getTemplateListSummaries: mocks.getTemplateListSummaries,
}));

vi.mock("~/features/user", () => ({
  getUserById: mocks.getUserById,
  getScheduleInterval: mocks.getScheduleInterval,
  getQueueTypes: mocks.getQueueTypes,
  getUserHashTagPresets: mocks.getUserHashTagPresets,
  getUserUploadProvider: mocks.getUserUploadProvider,
}));

import { loadNewLongFormData } from "~/features/posts/longform/services/newlongform-loader.server";

const user = {
  username: "ada",
  timezone: "America/New_York",
  timeFormat: "24h",
  dateFormat: "yyyymmdd",
};

describe("loadNewLongFormData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserById.mockResolvedValue(user);
    mocks.requireAnySubscription.mockResolvedValue(undefined);
  });

  it("returns an empty composer when nothing is being edited", async () => {
    const data = await loadNewLongFormData("user-1");
    expect(data.initialTemplateData).toBeNull();
    expect(data.hydrationStatus).toBe("ready");
    expect(data.userTimezone).toBe("America/New_York");
    expect(data.editingMeta).toBeNull();
  });

  it("rejects a missing or unscheduled article", async () => {
    mocks.getLongFormPost.mockResolvedValueOnce(null);
    await expect(
      loadNewLongFormData("user-1", null, {
        mode: "edit_scheduled",
        scheduledActionId: "missing",
      })
    ).rejects.toMatchObject({ status: 404 });

    mocks.getLongFormPost.mockResolvedValueOnce({
      id: "article-1",
      currentState: "DRAFT",
    });
    await expect(
      loadNewLongFormData("user-1", null, {
        mode: "edit_scheduled",
        scheduledActionId: "article-1",
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("loads a scheduled article across a daylight-saving instant", async () => {
    mocks.getLongFormPost.mockResolvedValue({
      id: "article-1",
      title: "Spring",
      summary: "Forward",
      content: "The clocks change.",
      image: "",
      tags: ["nostr"],
      currentState: "SCHEDULED",
      scheduledAtUtc: new Date("2026-03-08T07:30:00.000Z"),
      queueType: { name: "Notes" },
    });

    const data = await loadNewLongFormData("user-1", null, {
      mode: "edit_scheduled",
      scheduledActionId: "article-1",
    });

    expect(data.initialTemplateData).toMatchObject({
      id: "article-1",
      title: "Spring",
      tags: ["nostr"],
    });
    expect(data.editingMeta?.statusLabel).toBe("SCHEDULED");
    expect(data.editingMeta?.queueLabel).toBe("Notes");
    expect(data.editingMeta?.accountLabel).toBe("Ada");
    expect(data.editingMeta?.scheduledForLabel).toEqual(expect.any(String));
    expect(data.editingMeta?.scheduledForLabel?.length).toBeGreaterThan(0);
  });

  it("fails when the saved timezone is not a real zone", async () => {
    mocks.getUserById.mockResolvedValue({ ...user, timezone: "Not/AZone" });
    mocks.getLongFormPost.mockResolvedValue({
      id: "article-1",
      title: "Spring",
      summary: "",
      content: "",
      image: "",
      tags: [],
      currentState: "SCHEDULED",
      scheduledAtUtc: new Date("2026-03-08T07:30:00.000Z"),
      queueType: null,
    });

    await expect(
      loadNewLongFormData("user-1", null, {
        mode: "edit_scheduled",
        scheduledActionId: "article-1",
      })
    ).rejects.toThrow();
  });

  it("prefills a long-form template and ignores a different template type", async () => {
    mocks.getTemplatePrefill.mockResolvedValueOnce({
      type: "LONGFORM",
      longform: { id: "template-1", title: "Template", content: "Body" },
    });
    const prefilled = await loadNewLongFormData("user-1", "template-1");
    expect(prefilled.initialTemplateData).toMatchObject({ id: "template-1" });

    mocks.getTemplatePrefill.mockResolvedValueOnce({ type: "SHORT" });
    const skipped = await loadNewLongFormData("user-1", "template-2");
    expect(skipped.initialTemplateData).toBeNull();
  });
});
