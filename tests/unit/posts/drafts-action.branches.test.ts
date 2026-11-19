import { beforeEach, describe, expect, it, vi } from "vitest";

interface CloneResult {
  ok: true;
  postId: string;
}

interface CloneFailure {
  ok: false;
  error: string;
}

interface UpdateArgs {
  id: string;
  userId: string;
  data: {
    queueTypeId?: string | null;
    content?: string;
    caption?: string;
    scheduledAtUtc?: number;
    signedEvent?: unknown;
    nostrEvent?: unknown;
  };
}

interface TemplateArgs {
  userId: string;
  name: string;
  templateType: string;
  postId: string;
  longFormPostId: null;
}

const postsApi = vi.hoisted(() => ({
  cloneDraftPost: vi.fn(
    async (
      _userId: string,
      _postId: string
    ): Promise<CloneResult | CloneFailure> => ({
      ok: true,
      postId: "cloned",
    })
  ),
  deleteLongFormPost: vi.fn(async (_args: { id: string; userId: string }) => ({
    id: _args.id,
  })),
  deletePost: vi.fn(async (_args: { id: string; userId: string }) => ({
    id: _args.id,
  })),
  getDraftPostIdsForUser: vi.fn(
    async (_userId: string, postIds: string[]) => postIds
  ),
  updatePost: vi.fn(async (_args: UpdateArgs) => ({ id: _args.id })),
}));

const queues = vi.hoisted(() => ({
  resolveQueueTypeId: vi.fn(
    async (
      _userId: string,
      queueTypeId: string | null,
      queueType: string | null
    ) => {
      if (queueTypeId) return `id:${queueTypeId}`;
      if (queueType) return `name:${queueType}`;
      return null;
    }
  ),
}));

const machine = vi.hoisted(() => ({
  transition: vi.fn(
    async (_postId: string, _userId: string, _state: string, _reason: string) =>
      undefined
  ),
}));

const templates = vi.hoisted(() => ({
  createTemplate: vi.fn(async (_args: TemplateArgs) => ({ id: "template-1" })),
}));

const capacity = vi.hoisted(() => ({
  assertScheduleCapacity: vi.fn(
    async (_userId: string, _count: number) => undefined
  ),
}));

vi.mock("~/features/payments/entitlements/schedule-cap-policy.server", () => ({
  assertScheduleCapacity: capacity.assertScheduleCapacity,
}));
vi.mock("~/features/posts/server", () => postsApi);
vi.mock("~/features/posts/services/queue-type-resolver.server", () => queues);
vi.mock("~/features/posts/state-machine/post-state-machine.server", () => ({
  PostStateMachine: class PostStateMachine {
    transition = machine.transition;
  },
}));
vi.mock("~/features/templates/services/template-data.server", () => templates);

import { handleDraftsAction } from "~/features/posts/drafts/services/drafts-action.server";

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        data.append(key, entry);
      }
    } else {
      data.append(key, value);
    }
  }
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function responseBody(response: Response): Promise<unknown> {
  return response.json();
}

async function errorText(result: unknown): Promise<string> {
  if (!(result instanceof Response)) {
    throw new Error("expected a response");
  }
  expect(result.status).toBe(400);
  const body = await responseBody(result);
  if (!isRecord(body) || typeof body.error !== "string") {
    throw new Error("expected an error message");
  }
  return body.error;
}

const SIGNED = JSON.stringify({ id: "event-1" });
const NOSTR = JSON.stringify({ id: "nostr-1" });

describe("drafts action branches", () => {
  beforeEach(() => {
    postsApi.cloneDraftPost.mockReset();
    postsApi.cloneDraftPost.mockResolvedValue({ ok: true, postId: "cloned" });
    postsApi.deleteLongFormPost.mockReset();
    postsApi.deleteLongFormPost.mockResolvedValue({ id: "lf" });
    postsApi.deletePost.mockReset();
    postsApi.deletePost.mockResolvedValue({ id: "post" });
    postsApi.getDraftPostIdsForUser.mockReset();
    postsApi.getDraftPostIdsForUser.mockImplementation(
      async (_userId, postIds) => postIds
    );
    postsApi.updatePost.mockReset();
    postsApi.updatePost.mockImplementation(async (args) => ({ id: args.id }));
    queues.resolveQueueTypeId.mockClear();
    machine.transition.mockClear();
    templates.createTemplate.mockClear();
    capacity.assertScheduleCapacity.mockReset();
    capacity.assertScheduleCapacity.mockResolvedValue(undefined);
  });

  it("returns the validation response for an unknown action", async () => {
    const message = await errorText(
      await handleDraftsAction(form({ _action: "nope" }), "user-1")
    );
    expect(message.length).toBeGreaterThan(0);
    expect(postsApi.deletePost).not.toHaveBeenCalled();
  });

  it("deletes one post or one longform post", async () => {
    await expect(
      handleDraftsAction(
        form({ _action: "delete", postId: "post-1" }),
        "user-1"
      )
    ).resolves.toEqual({ success: true });
    expect(postsApi.deletePost).toHaveBeenCalledWith({
      id: "post-1",
      userId: "user-1",
    });

    await expect(
      handleDraftsAction(
        form({ _action: "deleteLongForm", postId: "long-1" }),
        "user-1"
      )
    ).resolves.toEqual({ success: true });
    expect(postsApi.deleteLongFormPost).toHaveBeenCalledWith({
      id: "long-1",
      userId: "user-1",
    });

    postsApi.deletePost.mockRejectedValueOnce(new Error("delete down"));
    await expect(
      handleDraftsAction(
        form({ _action: "delete", postId: "post-1" }),
        "user-1"
      )
    ).rejects.toThrow("delete down");
    postsApi.deleteLongFormPost.mockRejectedValueOnce("delete string");
    await expect(
      handleDraftsAction(
        form({ _action: "deleteLongForm", postId: "long-1" }),
        "user-1"
      )
    ).rejects.toBe("delete string");
  });

  it("deletes many posts, longform posts, or a mix", async () => {
    await expect(
      handleDraftsAction(
        form({
          _action: "bulkDelete",
          postIds: JSON.stringify(["a", "b"]),
        }),
        "user-1"
      )
    ).resolves.toEqual({ success: true });
    expect(postsApi.deletePost).toHaveBeenCalledWith({
      id: "a",
      userId: "user-1",
    });
    expect(postsApi.deletePost).toHaveBeenCalledWith({
      id: "b",
      userId: "user-1",
    });

    await expect(
      handleDraftsAction(
        form({
          _action: "bulkDeleteLongForm",
          postIds: JSON.stringify(["lf-1"]),
        }),
        "user-1"
      )
    ).resolves.toEqual({ success: true });
    expect(postsApi.deleteLongFormPost).toHaveBeenCalledWith({
      id: "lf-1",
      userId: "user-1",
    });

    await expect(
      handleDraftsAction(
        form({
          _action: "bulkDeleteMixed",
          itemData: JSON.stringify([
            { id: "p", type: "post" },
            { id: "l", type: "longform" },
          ]),
        }),
        "user-1"
      )
    ).resolves.toEqual({ success: true });
    expect(postsApi.deletePost).toHaveBeenCalledWith({
      id: "p",
      userId: "user-1",
    });
    expect(postsApi.deleteLongFormPost).toHaveBeenCalledWith({
      id: "l",
      userId: "user-1",
    });
  });

  it("assigns a queue only when every draft belongs to the user", async () => {
    postsApi.getDraftPostIdsForUser.mockResolvedValueOnce(["a"]);
    await expect(
      handleDraftsAction(
        form({
          _action: "bulkAssignQueue",
          postIds: JSON.stringify(["a", "b"]),
          queueType: "Main",
          queueTypeId: "queue-1",
        }),
        "user-1"
      )
    ).resolves.toEqual({ error: "One or more drafts were not found." });
    expect(postsApi.updatePost).not.toHaveBeenCalled();

    await expect(
      handleDraftsAction(
        form({
          _action: "bulkAssignQueue",
          postIds: JSON.stringify(["a", "b"]),
          queueType: "Main",
        }),
        "user-1"
      )
    ).resolves.toEqual({ success: true });
    expect(queues.resolveQueueTypeId).toHaveBeenCalledWith(
      "user-1",
      null,
      "Main"
    );
    expect(postsApi.updatePost).toHaveBeenCalledWith({
      id: "a",
      userId: "user-1",
      data: { queueTypeId: "name:Main" },
    });
    expect(postsApi.updatePost).toHaveBeenCalledWith({
      id: "b",
      userId: "user-1",
      data: { queueTypeId: "name:Main" },
    });
  });

  it("duplicates a draft or returns the clone error", async () => {
    postsApi.cloneDraftPost.mockResolvedValueOnce({
      ok: false,
      error: "Draft not found",
    });
    await expect(
      handleDraftsAction(
        form({ _action: "duplicateDraftPost", postId: "post-1" }),
        "user-1"
      )
    ).resolves.toEqual({ error: "Draft not found" });

    postsApi.cloneDraftPost.mockResolvedValueOnce({
      ok: true,
      postId: "post-2",
    });
    await expect(
      handleDraftsAction(
        form({ _action: "duplicateDraftPost", postId: "post-1" }),
        "user-1"
      )
    ).resolves.toEqual({ success: true, newPostId: "post-2" });
    expect(postsApi.cloneDraftPost).toHaveBeenCalledWith("user-1", "post-1");
  });

  it("converts a draft into a named or default template", async () => {
    postsApi.cloneDraftPost.mockResolvedValueOnce({
      ok: false,
      error: "at capacity",
    });
    await expect(
      handleDraftsAction(
        form({
          _action: "convertDraftToTemplate",
          postId: "post-1",
          templateName: "Ignored",
        }),
        "user-1"
      )
    ).resolves.toEqual({ error: "at capacity" });
    expect(templates.createTemplate).not.toHaveBeenCalled();

    postsApi.cloneDraftPost.mockResolvedValueOnce({
      ok: true,
      postId: "copy-1",
    });
    await expect(
      handleDraftsAction(
        form({
          _action: "convertDraftToTemplate",
          postId: "post-1",
          templateName: "  Launch  ",
        }),
        "user-1"
      )
    ).resolves.toEqual({ success: true });
    expect(templates.createTemplate).toHaveBeenCalledWith({
      userId: "user-1",
      name: "Launch",
      templateType: "POST",
      postId: "copy-1",
      longFormPostId: null,
    });
    expect(postsApi.deletePost).toHaveBeenCalledWith({
      id: "post-1",
      userId: "user-1",
    });

    postsApi.cloneDraftPost.mockResolvedValueOnce({
      ok: true,
      postId: "copy-2",
    });
    await handleDraftsAction(
      form({
        _action: "convertDraftToTemplate",
        postId: "post-1",
        templateName: "   ",
      }),
      "user-1"
    );
    expect(templates.createTemplate.mock.calls.at(-1)?.[0].name).toBe(
      "Template from draft"
    );

    postsApi.cloneDraftPost.mockResolvedValueOnce({
      ok: true,
      postId: "copy-3",
    });
    await handleDraftsAction(
      form({ _action: "convertDraftToTemplate", postId: "post-1" }),
      "user-1"
    );
    expect(templates.createTemplate.mock.calls.at(-1)?.[0].name).toBe(
      "Template from draft"
    );
  });

  it("duplicates the drafts that clone and stops when one is missing", async () => {
    postsApi.getDraftPostIdsForUser.mockResolvedValueOnce(["a"]);
    await expect(
      handleDraftsAction(
        form({
          _action: "bulkDuplicateDrafts",
          postIds: JSON.stringify(["a", "b"]),
        }),
        "user-1"
      )
    ).resolves.toEqual({ error: "One or more drafts were not found." });

    postsApi.cloneDraftPost
      .mockResolvedValueOnce({ ok: true, postId: "a-copy" })
      .mockResolvedValueOnce({ ok: false, error: "nope" });
    await expect(
      handleDraftsAction(
        form({
          _action: "bulkDuplicateDrafts",
          postIds: JSON.stringify(["a", "b"]),
        }),
        "user-1"
      )
    ).resolves.toEqual({ success: true, newPostIds: ["a-copy"] });

    postsApi.cloneDraftPost.mockRejectedValueOnce("clone string");
    await expect(
      handleDraftsAction(
        form({
          _action: "bulkDuplicateDrafts",
          postIds: JSON.stringify(["a"]),
        }),
        "user-1"
      )
    ).rejects.toBe("clone string");
  });

  it("rejects a bulk resume that exceeds capacity or has a bad time", async () => {
    capacity.assertScheduleCapacity.mockRejectedValueOnce(
      new Error("over cap")
    );
    await expect(
      handleDraftsAction(resumeForm(["post-1"], ["100"]), "user-1")
    ).rejects.toThrow("over cap");
    expect(postsApi.updatePost).not.toHaveBeenCalled();

    capacity.assertScheduleCapacity.mockRejectedValueOnce("cap string");
    await expect(
      handleDraftsAction(resumeForm(["post-1"], ["100"]), "user-1")
    ).rejects.toBe("cap string");

    await expect(
      handleDraftsAction(resumeForm(["post-1"], ["nope"]), "user-1")
    ).rejects.toThrow("Invalid scheduledFor in bulk resume data");
    expect(postsApi.updatePost).not.toHaveBeenCalled();
    expect(machine.transition).not.toHaveBeenCalled();
  });

  it("schedules every resumed draft and omits a blank time", async () => {
    await expect(
      handleDraftsAction(
        resumeForm(
          ["post-1", "post-2"],
          ["1700000000", ""],
          [" q1 ", "   "],
          ["Main", "Side"]
        ),
        "user-1"
      )
    ).resolves.toEqual({ success: true });
    expect(capacity.assertScheduleCapacity).toHaveBeenCalledWith("user-1", 2);
    expect(queues.resolveQueueTypeId).toHaveBeenCalledWith(
      "user-1",
      " q1 ",
      "Main"
    );
    expect(queues.resolveQueueTypeId).toHaveBeenCalledWith(
      "user-1",
      null,
      "Side"
    );

    const updates = postsApi.updatePost.mock.calls.map((call) => call[0]);
    const first = updates.find((entry) => entry.id === "post-1");
    const second = updates.find((entry) => entry.id === "post-2");
    expect(first?.data).toEqual({
      content: "body-post-1",
      caption: "cap-post-1",
      queueTypeId: "id: q1 ",
      scheduledAtUtc: 1700000000,
      signedEvent: { id: "event-1" },
      nostrEvent: { id: "nostr-1" },
    });
    expect(second?.data).toEqual({
      content: "body-post-2",
      caption: "cap-post-2",
      queueTypeId: "name:Side",
      signedEvent: { id: "event-1" },
      nostrEvent: { id: "nostr-1" },
    });
    expect(second?.data.scheduledAtUtc).toBeUndefined();
    expect(machine.transition).toHaveBeenCalledWith(
      "post-1",
      "user-1",
      "SCHEDULED",
      "Draft signed and scheduled"
    );
    expect(machine.transition).toHaveBeenCalledWith(
      "post-2",
      "user-1",
      "SCHEDULED",
      "Draft signed and scheduled"
    );
  });

  it("treats a missing queue slot as null and keeps a zero timestamp", async () => {
    await handleDraftsAction(
      form({
        _action: "bulkSignAndResume",
        postIds: ["post-1", "post-2"],
        contents: ["c1", "c2"],
        captions: ["a1", "a2"],
        queueTypes: ["Main"],
        queueTypeIds: [""],
        scheduledFors: ["0", "   "],
        signedEvents: [SIGNED, SIGNED],
        nostrEvents: [NOSTR, NOSTR],
      }),
      "user-1"
    );
    expect(queues.resolveQueueTypeId).toHaveBeenCalledWith(
      "user-1",
      null,
      "Main"
    );
    expect(queues.resolveQueueTypeId).toHaveBeenCalledWith(
      "user-1",
      null,
      null
    );
    const second = postsApi.updatePost.mock.calls
      .map((call) => call[0])
      .find((entry) => entry.id === "post-2");
    const first = postsApi.updatePost.mock.calls
      .map((call) => call[0])
      .find((entry) => entry.id === "post-1");
    expect(first?.data.scheduledAtUtc).toBe(0);
    expect(second?.data.queueTypeId).toBeNull();
    expect(second?.data.scheduledAtUtc).toBeUndefined();
  });
});

function resumeForm(
  postIds: string[],
  scheduledFors: string[],
  queueTypeIds = postIds.map(() => "queue-1"),
  queueTypes = postIds.map(() => "Main")
): FormData {
  return form({
    _action: "bulkSignAndResume",
    postIds,
    contents: postIds.map((id) => `body-${id}`),
    captions: postIds.map((id) => `cap-${id}`),
    queueTypes,
    queueTypeIds,
    scheduledFors,
    signedEvents: postIds.map(() => SIGNED),
    nostrEvents: postIds.map(() => NOSTR),
  });
}
