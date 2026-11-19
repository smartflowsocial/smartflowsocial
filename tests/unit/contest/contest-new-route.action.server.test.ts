import { RouterContextProvider } from "react-router";
import type { ActionFunctionArgs } from "react-router";
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

const contestApi = vi.hoisted(() => ({
  createContest: vi.fn(),
  launchContest: vi.fn(),
  touchContestPresetLastUsed: vi.fn(),
  upsertContestCreationDraftPayload: vi.fn(),
  upsertContestLaunchOrchestration: vi.fn(),
}));

const posts = vi.hoisted(() => ({
  getPostById: vi.fn(),
}));

vi.mock("~/lib/feature-flags.server", () => flags);
vi.mock("~/features/auth/auth.server", () => auth);
vi.mock("~/features/payments", () => payments);
vi.mock("~/features/contest", () => contestApi);
vi.mock("~/features/posts/server", () => posts);

import { asReturn, buildContest } from "./contest-test-doubles";

import { requireUserId } from "~/features/auth/auth.server";
import {
  createContest,
  launchContest,
  touchContestPresetLastUsed,
  upsertContestCreationDraftPayload,
  upsertContestLaunchOrchestration,
} from "~/features/contest";
import { contestNewAction } from "~/features/contest/contest-new-route.action.server";
import { requireAnySubscription } from "~/features/payments";
import { getPostById } from "~/features/posts/server";

const END = "2099-08-01T00:00:00.000Z";
const ACTIVATION = "2099-07-01T00:00:00.000Z";

function actionArgs(fields: Record<string, string>): ActionFunctionArgs {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  const request = new Request("http://localhost/dashboard/contests/new", {
    method: "POST",
    body: form,
  });
  return {
    request,
    params: {},
    context: new RouterContextProvider(),
    url: new URL(request.url),
    pattern: "*",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readData(value: unknown): {
  data: unknown;
  status: number | undefined;
} {
  if (!isRecord(value) || !("data" in value)) {
    throw new Error("expected data() result");
  }
  const init = value["init"];
  const status =
    isRecord(init) && typeof init["status"] === "number"
      ? init["status"]
      : undefined;
  return { data: value["data"], status };
}

describe("contestNewAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    flags.featureFlags.contestsV1Enabled = true;
    vi.mocked(requireUserId).mockResolvedValue("user-1");
    vi.mocked(requireAnySubscription).mockResolvedValue(undefined);
    vi.mocked(createContest).mockResolvedValue(
      buildContest({ id: "created-1" })
    );
    vi.mocked(launchContest).mockResolvedValue({ success: true });
    vi.mocked(getPostById).mockResolvedValue(
      asReturn({ id: "post-1", nostrEventId: "event-1" })
    );
  });

  it("throws not found when contests are disabled", async () => {
    flags.featureFlags.contestsV1Enabled = false;
    await expect(contestNewAction(actionArgs({}))).rejects.toMatchObject({
      status: 404,
    });
    expect(requireUserId).not.toHaveBeenCalled();
  });

  it("saves a draft and rejects an invalid payload", async () => {
    const invalid = await contestNewAction(
      actionArgs({ intent: "save-draft", draftPayload: "{" })
    );
    expect(readData(invalid)).toEqual({
      data: { error: "Invalid draft payload" },
      status: 400,
    });

    const saved = await contestNewAction(
      actionArgs({ intent: "save-draft", draftPayload: '{"step":1}' })
    );
    expect(saved).toEqual({ ok: true, draftSaved: true });
    expect(upsertContestCreationDraftPayload).toHaveBeenCalledWith("user-1", {
      step: 1,
    });
  });

  it("rejects prize, end, schedule, and source errors before creating a contest", async () => {
    const ranked = await contestNewAction(
      actionArgs({
        prizeMode: "RANKED",
        winnerCount: "1",
        contestEndAt: END,
        sourcePostId: "post-1",
      })
    );
    expect(readData(ranked).data).toEqual({
      error: "Enter at least one rank reward above 0 sats.",
    });

    const badEnd = await contestNewAction(
      actionArgs({ contestEndAt: "not-a-date", sourcePostId: "post-1" })
    );
    expect(readData(badEnd).data).toEqual({ error: "Set a contest end time." });

    const pastEnd = await contestNewAction(
      actionArgs({
        contestEndAt: "2020-01-01T00:00:00.000Z",
        sourcePostId: "post-1",
      })
    );
    expect(readData(pastEnd).data).toEqual({
      error: "Set a contest end time in the future.",
    });

    const missingActivation = await contestNewAction(
      actionArgs({
        launchMode: "schedule",
        contestEndAt: END,
        sourcePostId: "post-1",
      })
    );
    expect(readData(missingActivation).data).toEqual({
      error: "Choose a future activation date and time.",
    });

    const badActivation = await contestNewAction(
      actionArgs({
        launchMode: "schedule",
        scheduledActivationFor: "nope",
        contestEndAt: END,
        sourcePostId: "post-1",
      })
    );
    expect(readData(badActivation).data).toEqual({
      error: "Choose a future activation date and time.",
    });

    const pastActivation = await contestNewAction(
      actionArgs({
        launchMode: "schedule",
        scheduledActivationFor: "2020-01-01T00:00:00.000Z",
        contestEndAt: END,
        sourcePostId: "post-1",
      })
    );
    expect(readData(pastActivation).data).toEqual({
      error: "Activation must be in the future.",
    });

    const endBefore = await contestNewAction(
      actionArgs({
        launchMode: "schedule",
        scheduledActivationFor: "2099-09-01T00:00:00.000Z",
        contestEndAt: END,
        sourcePostId: "post-1",
      })
    );
    expect(readData(endBefore).data).toEqual({
      error: "End time must be after scheduled activation.",
    });

    const choosePost = await contestNewAction(
      actionArgs({ contestEndAt: END })
    );
    expect(readData(choosePost).data).toEqual({
      error: "Choose a source post.",
    });

    const publishFirst = await contestNewAction(
      actionArgs({
        sourceMode: "create",
        contestEndAt: END,
      })
    );
    expect(readData(publishFirst).data).toEqual({
      error: "Publish the source post from the contest actions first.",
    });

    vi.mocked(getPostById).mockResolvedValueOnce(null);
    const missingPost = await contestNewAction(
      actionArgs({ contestEndAt: END, sourcePostId: "post-1" })
    );
    expect(readData(missingPost).data).toEqual({
      error: "Source post not found.",
    });

    vi.mocked(getPostById).mockResolvedValueOnce(
      asReturn({ id: "post-1", nostrEventId: "  " })
    );
    const unpublished = await contestNewAction(
      actionArgs({ contestEndAt: END, sourcePostId: "post-1" })
    );
    expect(readData(unpublished).data).toEqual({
      error:
        "Selected post must be published with a Nostr note id before launching.",
    });

    vi.mocked(getPostById).mockResolvedValueOnce(
      asReturn({ id: "post-1", nostrEventId: null })
    );
    const createNow = await contestNewAction(
      actionArgs({
        sourceMode: "create",
        launchMode: "now",
        contestEndAt: END,
        sourcePostId: "post-1",
      })
    );
    expect(readData(createNow).data).toEqual({
      error:
        "Publish the source post first (use the primary contest action), then submit again.",
    });
    expect(createContest).not.toHaveBeenCalled();
  });

  it("launches an existing post now and reports a launch failure", async () => {
    const ok = await contestNewAction(
      actionArgs({
        title: "My contest",
        sourceMode: "existing",
        launchMode: "now",
        sourcePostId: "post-1",
        rankingMetric: "REACTIONS",
        contestEndAt: END,
        prizeMode: "EQUAL",
        winnerCount: "0",
        equalRewardSats: "-4",
        excludeMuted: "on",
        minAccountAgeDays: "8",
        minFollowers: "0",
        appliedPresetId: "preset-1",
      })
    );
    expect(ok).toBeInstanceOf(Response);
    if (!(ok instanceof Response)) {
      throw new Error("expected redirect");
    }
    expect(ok.headers.get("Location")).toBe(
      "/dashboard/contests/detail/created-1"
    );
    expect(touchContestPresetLastUsed).toHaveBeenCalledWith(
      "user-1",
      "preset-1"
    );
    const created = vi.mocked(createContest).mock.calls[0]?.[1];
    expect(created).toMatchObject({
      title: "My contest",
      sourceNoteId: "event-1",
      sourcePostId: "post-1",
      rankingMetric: "REACTIONS",
      prizeMode: "EQUAL",
      winnerCount: 1,
      equalRewardSats: 0,
      rankRewards: null,
    });
    if (!created?.fairnessConfig || !isRecord(created.fairnessConfig)) {
      throw new Error("expected fairness config");
    }
    expect(created.fairnessConfig["excludeMuted"]).toBe(true);
    expect(created.fairnessConfig["minAccountAgeDays"]).toBe(8);
    expect(created.fairnessConfig["minFollowers"]).toBeUndefined();

    vi.mocked(launchContest).mockResolvedValueOnce({ success: false });
    const failed = await contestNewAction(
      actionArgs({
        contestEndAt: END,
        sourcePostId: "post-1",
      })
    );
    expect(readData(failed).data).toEqual({
      error: "Contest created but launch failed.",
    });

    vi.mocked(launchContest).mockResolvedValueOnce({
      success: false,
      error: "note missing",
    });
    const detailed = await contestNewAction(
      actionArgs({ contestEndAt: END, sourcePostId: "post-1" })
    );
    expect(readData(detailed).data).toEqual({ error: "note missing" });
  });

  it("schedules an existing post and ignores a preset touch failure", async () => {
    vi.mocked(touchContestPresetLastUsed).mockRejectedValueOnce(
      new Error("missing preset")
    );
    const result = await contestNewAction(
      actionArgs({
        sourceMode: "existing",
        launchMode: "schedule",
        scheduledActivationFor: ACTIVATION,
        contestEndAt: END,
        sourcePostId: "post-1",
        prizeMode: "RANKED",
        winnerCount: "2",
        rankReward_1: "15",
        rankReward_2: "0",
        appliedPresetId: "preset-1",
      })
    );
    expect(result).toBeInstanceOf(Response);
    expect(createContest).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        sourceNoteId: "event-1",
        status: "SCHEDULED_LAUNCH",
        prizeMode: "RANKED",
        equalRewardSats: null,
        rankRewards: [
          { rank: 1, sats: 15 },
          { rank: 2, sats: 0 },
        ],
      })
    );
    expect(upsertContestLaunchOrchestration).toHaveBeenCalledWith({
      userId: "user-1",
      contestId: "created-1",
      sourceMode: "existing_post",
      launchMode: "schedule",
      scheduledFor: new Date(ACTIVATION),
      existingSourcePostId: "post-1",
      sourcePostId: null,
      sourcePostPublishStatus: "not_needed",
      contestActivationStatus: "scheduled",
    });
    expect(launchContest).not.toHaveBeenCalled();
  });

  it("launches or schedules a newly created source post", async () => {
    const launched = await contestNewAction(
      actionArgs({
        sourceMode: "create",
        launchMode: "now",
        contestEndAt: END,
        sourcePostId: "post-1",
      })
    );
    expect(launched).toBeInstanceOf(Response);
    expect(launchContest).toHaveBeenCalledWith("user-1", "created-1");

    vi.mocked(launchContest).mockResolvedValueOnce({
      success: false,
      error: "later",
    });
    const failed = await contestNewAction(
      actionArgs({
        sourceMode: "create",
        launchMode: "now",
        contestEndAt: END,
        sourcePostId: "post-1",
      })
    );
    expect(readData(failed).data).toEqual({ error: "later" });

    vi.mocked(getPostById).mockResolvedValueOnce(
      asReturn({ id: "post-1", nostrEventId: "event-9" })
    );
    await contestNewAction(
      actionArgs({
        sourceMode: "create",
        launchMode: "schedule",
        scheduledActivationFor: ACTIVATION,
        contestEndAt: END,
        sourcePostId: "post-1",
      })
    );
    expect(upsertContestLaunchOrchestration).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMode: "new_post",
        sourcePostId: "post-1",
        sourcePostPublishStatus: "published",
        existingSourcePostId: null,
      })
    );
    expect(createContest).toHaveBeenLastCalledWith(
      "user-1",
      expect.objectContaining({
        sourceNoteId: "event-9",
        status: "SCHEDULED_LAUNCH",
      })
    );

    vi.mocked(getPostById).mockResolvedValueOnce(
      asReturn({ id: "post-1", nostrEventId: "" })
    );
    await contestNewAction(
      actionArgs({
        sourceMode: "create",
        launchMode: "schedule",
        scheduledActivationFor: ACTIVATION,
        contestEndAt: END,
        sourcePostId: "post-1",
      })
    );
    expect(createContest).toHaveBeenLastCalledWith(
      "user-1",
      expect.objectContaining({
        sourceNoteId: null,
        status: "SCHEDULED_LAUNCH",
      })
    );
    expect(upsertContestLaunchOrchestration).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourcePostPublishStatus: "scheduled" })
    );
  });
});
