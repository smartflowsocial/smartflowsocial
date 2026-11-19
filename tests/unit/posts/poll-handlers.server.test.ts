import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  publish: vi.fn(),
  parsePoll: vi.fn(),
  validateSignedEvent: vi.fn((event: unknown) => event),
  isContestEmbedRequest: vi.fn(() => false),
  getHashtagPresetTags: vi.fn(),
}));

vi.mock("react-router", () => ({
  redirect: (to: string) => ({ redirect: to }),
}));

vi.mock("~/features/polls", () => ({
  KIND_POLL: 1068,
  parsePollFromSignedEvent: mocks.parsePoll,
}));

vi.mock(
  "~/features/posts/composer/use-cases/create-post.use-case.server",
  () => ({
    CreatePostUseCase: class {
      execute = mocks.execute;
    },
  })
);

vi.mock("~/features/posts/server/publishing", () => ({
  PublishNowUseCase: class {
    execute = mocks.publish;
  },
}));

vi.mock("~/lib/validation/nostr-events.server", () => ({
  validateSignedEvent: mocks.validateSignedEvent,
}));

vi.mock(
  "~/features/posts/composer/services/newpost-action/contest-embed-response.server",
  () => ({
    isContestEmbedRequest: mocks.isContestEmbedRequest,
    jsonContestEmbedPost: vi.fn(async () => ({ embed: true })),
  })
);

vi.mock(
  "~/features/posts/composer/services/newpost-action/hashtag-preset-utils.server",
  () => ({
    getHashtagPresetTags: mocks.getHashtagPresetTags,
  })
);

import {
  handlePostOrSchedulePoll,
  resolvePollHashtagContext,
} from "~/features/posts/composer/services/newpost-action/poll-handlers.server";

const PUBKEY = "b".repeat(64);

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "a".repeat(64),
    pubkey: PUBKEY,
    created_at: 1_700_000_000,
    kind: 1068,
    tags: [],
    content: "Which time?",
    sig: "c".repeat(128),
    ...overrides,
  };
}

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function params(
  action: "post-poll" | "schedule-poll",
  values: Record<string, string>
) {
  return {
    userId: "user-1",
    sessionPubkey: PUBKEY,
    formData: form(values),
    sanitizedRelays: ["wss://relay.example"],
    action,
    queueType: "unassigned",
    queueTypeId: null,
    isRecyclable: false,
    hashTagPresetId: null,
  };
}

describe("poll publishing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSignedEvent.mockImplementation((value: unknown) => value);
    mocks.isContestEmbedRequest.mockReturnValue(false);
    mocks.parsePoll.mockReturnValue({
      question: "Which time?",
      endsAt: 1_700_003_600,
      options: ["Morning", "Evening"],
    });
    mocks.execute.mockImplementation(async () => ({
      post: { id: "poll-1", signedEvent: event() },
    }));
    mocks.publish.mockResolvedValue(undefined);
  });

  it("rejects an empty question, malformed JSON, and the wrong kind", async () => {
    await expect(
      handlePostOrSchedulePoll(params("post-poll", { content: "  " }))
    ).rejects.toThrow("Poll question is required");

    await expect(
      handlePostOrSchedulePoll(
        params("post-poll", { content: "Which time?", signedEvent: "{" })
      )
    ).rejects.toThrow("Invalid signedEvent");

    const wrongKind = event({ kind: 1 });
    await expect(
      handlePostOrSchedulePoll(
        params("post-poll", {
          content: "Which time?",
          signedEvent: JSON.stringify(wrongKind),
          nostrEvent: JSON.stringify(wrongKind),
        })
      )
    ).rejects.toThrow("kind 1068");
  });

  it("rejects malformed options, a bad end time, and a question mismatch", async () => {
    const signed = event();
    const body = {
      content: "Which time?",
      signedEvent: JSON.stringify(signed),
      nostrEvent: JSON.stringify(signed),
    };
    mocks.parsePoll.mockReturnValueOnce(null);
    await expect(
      handlePostOrSchedulePoll(params("post-poll", body))
    ).rejects.toThrow("Invalid NIP-88 poll event");

    mocks.parsePoll.mockReturnValueOnce({
      question: "Which time?",
      endsAt: signed.created_at,
      options: ["Morning"],
    });
    await expect(
      handlePostOrSchedulePoll(params("schedule-poll", body))
    ).rejects.toThrow("Poll end must be after publish time");

    mocks.parsePoll.mockReturnValueOnce({
      question: "Different",
      endsAt: signed.created_at + 60,
      options: ["Morning", "Evening"],
    });
    await expect(
      handlePostOrSchedulePoll(params("post-poll", body))
    ).rejects.toThrow("does not match");
  });

  it("schedules a valid poll and publishes an immediate one", async () => {
    const signed = event();
    const body = {
      content: "Which time?",
      signedEvent: JSON.stringify(signed),
      nostrEvent: JSON.stringify(signed),
      nominalScheduledFor: String(signed.created_at),
    };

    await expect(
      handlePostOrSchedulePoll(params("schedule-poll", body))
    ).resolves.toEqual({
      redirect: "/dashboard/compose?type=poll&scheduled=poll-1",
    });
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        postType: "POLL",
        scheduledFor: signed.created_at,
        nominalScheduledFor: signed.created_at,
      })
    );

    await expect(
      handlePostOrSchedulePoll(params("post-poll", body))
    ).resolves.toEqual({
      redirect: "/dashboard/compose?type=poll&published=poll-1",
    });
    expect(mocks.publish).toHaveBeenCalledOnce();
  });

  it("surfaces a publish failure and an event that fails validation after create", async () => {
    const signed = event();
    const body = {
      content: "Which time?",
      signedEvent: JSON.stringify(signed),
      nostrEvent: JSON.stringify(signed),
    };
    mocks.publish.mockRejectedValueOnce(new Error("relay rejected"));
    await expect(
      handlePostOrSchedulePoll(params("post-poll", body))
    ).rejects.toThrow("relay rejected");

    mocks.validateSignedEvent.mockReturnValueOnce(null);
    await expect(
      handlePostOrSchedulePoll(params("post-poll", body))
    ).rejects.toThrow("Invalid signedEvent after poll creation");
  });

  it("rejects a poll signed by a different pubkey", async () => {
    const signed = event({ pubkey: "d".repeat(64) });
    await expect(
      handlePostOrSchedulePoll(
        params("post-poll", {
          content: "Which time?",
          signedEvent: JSON.stringify(signed),
          nostrEvent: JSON.stringify(signed),
        })
      )
    ).rejects.toThrow();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("reads hashtag preset tags and ignores a non-object result", async () => {
    mocks.getHashtagPresetTags.mockResolvedValueOnce({
      tags: "#nostr",
      presetId: "from-result",
    });
    await expect(
      resolvePollHashtagContext("user-1", true, "preset-1", "queue", null)
    ).resolves.toEqual({
      hashTagPresetTags: "#nostr",
      hashTagPresetId: "from-result",
    });

    mocks.getHashtagPresetTags.mockResolvedValueOnce("unused");
    await expect(
      resolvePollHashtagContext("user-1", false, null, "queue", null)
    ).resolves.toEqual({ hashTagPresetTags: "", hashTagPresetId: null });
  });
});
