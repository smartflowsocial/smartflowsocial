import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirstPost: vi.fn(),
  findPostByIdAndUser: vi.fn(),
  updatePost: vi.fn(),
  execute: vi.fn(),
  createShortDraftVersion: vi.fn(),
  checkDraftCapacity: vi.fn(),
  resolveQueueTypeId: vi.fn(),
  getHashtagPresetTags: vi.fn(),
  isContestEmbedRequest: vi.fn(),
}));

vi.mock("~/features/posts/repositories/post-queries-data.server", () => ({
  findFirstPost: mocks.findFirstPost,
  findPostByIdAndUser: mocks.findPostByIdAndUser,
  updatePost: mocks.updatePost,
}));

vi.mock(
  "~/features/posts/composer/use-cases/create-post.use-case.server",
  () => ({
    CreatePostUseCase: class {
      execute = mocks.execute;
    },
  })
);

vi.mock("~/features/posts/server", () => ({
  resolveQueueTypeId: mocks.resolveQueueTypeId,
}));

vi.mock("~/features/posts/server/drafts", () => ({
  SHORT_SNAPSHOT_SCHEMA_VERSION: 1,
  createShortDraftVersion: mocks.createShortDraftVersion,
}));

vi.mock("~/features/payments/entitlements/draft-template-cap.server", () => ({
  checkDraftCapacity: mocks.checkDraftCapacity,
}));

vi.mock(
  "~/features/posts/composer/services/newpost-action/hashtag-preset-utils.server",
  () => ({
    getHashtagPresetTags: mocks.getHashtagPresetTags,
  })
);

vi.mock(
  "~/features/posts/composer/services/newpost-action/hashtag-utils.server",
  () => ({
    parseIncludeHashtagsInNoteBodyFromForm: () => false,
  })
);

vi.mock(
  "~/features/posts/composer/services/newpost-action/handlers/text-handlers.server",
  () => ({
    parseAttachmentMeta: () => [],
  })
);

vi.mock(
  "~/features/posts/composer/services/newpost-action/inline-tokens.server",
  () => ({
    prepareComposerTextAndFileUrls: (content: string) => ({
      content,
      fileUrl: [],
    }),
  })
);

vi.mock(
  "~/features/posts/composer/services/newpost-action/contest-embed-response.server",
  () => ({
    isContestEmbedRequest: mocks.isContestEmbedRequest,
  })
);

import {
  handleAutosaveDraft,
  handleSaveDraft,
} from "~/features/posts/composer/services/newpost-action/autosave-draft.server";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("short draft autosave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isContestEmbedRequest.mockReturnValue(false);
    mocks.checkDraftCapacity.mockResolvedValue(null);
    mocks.resolveQueueTypeId.mockResolvedValue("queue-1");
    mocks.getHashtagPresetTags.mockResolvedValue({ tags: "" });
    mocks.updatePost.mockResolvedValue({});
    mocks.execute.mockResolvedValue({ post: { id: "created-draft" } });
    mocks.findPostByIdAndUser.mockResolvedValue({
      content: "hello",
      caption: "hello",
      fileUrl: [],
      queueTypeId: null,
      draftMeta: null,
    });
  });

  it("updates an existing draft and does not create a second row", async () => {
    mocks.findFirstPost.mockResolvedValue({ id: "draft-1" });

    await expect(
      handleAutosaveDraft(
        "user-1",
        form({ draftId: "draft-1", content: "one" })
      )
    ).resolves.toEqual({ draftId: "draft-1", saved: true });
    await expect(
      handleAutosaveDraft(
        "user-1",
        form({ draftId: "draft-1", content: "two" })
      )
    ).resolves.toEqual({ draftId: "draft-1", saved: true });

    expect(mocks.updatePost).toHaveBeenCalledTimes(2);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("creates a draft when the previous row is gone", async () => {
    mocks.findFirstPost.mockResolvedValue(null);

    await expect(
      handleAutosaveDraft(
        "user-1",
        form({ draftId: "deleted-draft", content: "recovered" })
      )
    ).resolves.toEqual({ draftId: "created-draft", saved: true });

    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.updatePost).toHaveBeenCalledWith(
      "created-draft",
      "user-1",
      expect.objectContaining({ draftMeta: { attachmentMeta: [] } })
    );
  });

  it("propagates a failed write and a draft cap", async () => {
    mocks.findFirstPost.mockResolvedValue({ id: "draft-1" });
    mocks.updatePost.mockRejectedValue(new Error("database unavailable"));
    await expect(
      handleAutosaveDraft("user-1", form({ draftId: "draft-1", content: "x" }))
    ).rejects.toThrow("database unavailable");

    mocks.findFirstPost.mockResolvedValue(null);
    mocks.checkDraftCapacity.mockResolvedValue("Draft limit reached");
    await expect(
      handleAutosaveDraft("user-1", form({ content: "new" }))
    ).rejects.toThrow("Draft limit reached");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("stores a version on an explicit save and marks a contest embed", async () => {
    mocks.findFirstPost.mockResolvedValue({ id: "draft-1" });
    await expect(
      handleSaveDraft("user-1", form({ draftId: "draft-1", content: "saved" }))
    ).resolves.toEqual({ ok: true, draftSaved: true, draftId: "draft-1" });
    expect(mocks.createShortDraftVersion).toHaveBeenCalledOnce();

    mocks.isContestEmbedRequest.mockReturnValue(true);
    await expect(
      handleSaveDraft("user-1", form({ draftId: "draft-1", content: "saved" }))
    ).resolves.toMatchObject({
      ok: true,
      embedContext: "contest",
      draftSaved: true,
      draftId: "draft-1",
    });
  });
});
