import { beforeEach, describe, expect, it, vi } from "vitest";

const templates = vi.hoisted(() => ({
  getTemplateById: vi.fn(),
  getTemplatePrefill: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));
const posts = vi.hoisted(() => ({
  updatePost: vi.fn(),
  updateLongFormPost: vi.fn(),
  loadNewPostData: vi.fn(),
  loadNewLongFormData: vi.fn(),
}));
const composer = vi.hoisted(() => ({
  parseAttachmentMeta: vi.fn(),
  getHashtagPresetTags: vi.fn(),
  prepareComposerTextAndFileUrls: vi.fn(),
  resolveQueueTypeId: vi.fn(),
}));
const user = vi.hoisted(() => ({
  getQueueTypeByNameForUser: vi.fn(),
}));
const markdown = vi.hoisted(() => ({
  sanitizeMarkdown: vi.fn((value: string) => value.trim()),
  generateSummary: vi.fn(() => "generated summary"),
}));

vi.mock("~/features/templates/services/template-data.server", () => templates);
vi.mock("~/features/posts/server", () => ({
  updatePost: posts.updatePost,
  updateLongFormPost: posts.updateLongFormPost,
}));
vi.mock("~/features/posts/server/composer", () => ({
  loadNewPostData: posts.loadNewPostData,
}));
vi.mock("~/features/posts/server/longform", () => ({
  loadNewLongFormData: posts.loadNewLongFormData,
}));
vi.mock(
  "~/features/posts/composer/services/newpost-action/handlers/text-handlers.server",
  () => ({ parseAttachmentMeta: composer.parseAttachmentMeta })
);
vi.mock(
  "~/features/posts/composer/services/newpost-action/hashtag-preset-utils.server",
  () => ({ getHashtagPresetTags: composer.getHashtagPresetTags })
);
vi.mock(
  "~/features/posts/composer/services/newpost-action/inline-tokens.server",
  () => ({
    prepareComposerTextAndFileUrls: composer.prepareComposerTextAndFileUrls,
  })
);
vi.mock("~/features/posts/services/queue-type-resolver.server", () => ({
  resolveQueueTypeId: composer.resolveQueueTypeId,
}));
vi.mock("~/features/user", () => user);
vi.mock("~/lib/markdown-sanitizer.server", () => markdown);

import {
  handleTemplateEditAction,
  loadTemplateEditData,
} from "~/features/templates/services/template-edit.server";
import { ValidationError } from "~/lib/errors";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

describe("template edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    composer.parseAttachmentMeta.mockReturnValue([]);
    composer.prepareComposerTextAndFileUrls.mockReturnValue({
      content: "composed",
      fileUrl: ["https://cdn.example/a.png"],
    });
    composer.getHashtagPresetTags.mockResolvedValue({ tags: "#nostr" });
    composer.resolveQueueTypeId.mockResolvedValue("queue-1");
    templates.updateTemplate.mockResolvedValue({ id: "tpl-1" });
    templates.deleteTemplate.mockResolvedValue({ id: "tpl-1" });
    posts.updatePost.mockResolvedValue({ id: "post-1" });
    posts.updateLongFormPost.mockResolvedValue({ id: "lf-1" });
  });

  it("loads post and longform edit context and rejects missing templates", async () => {
    await expect(loadTemplateEditData("", "user-1")).rejects.toBeInstanceOf(
      ValidationError
    );

    templates.getTemplateById.mockResolvedValueOnce(null);
    await expect(loadTemplateEditData("tpl-1", "user-1")).rejects.toThrow(
      "Template not found"
    );

    templates.getTemplateById.mockResolvedValueOnce({
      id: "tpl-1",
      templateType: "POST",
      post: { id: "post-1" },
      longFormPost: null,
    });
    templates.getTemplatePrefill.mockResolvedValueOnce(null);
    posts.loadNewPostData.mockResolvedValueOnce({ queues: [] });
    const postEdit = await loadTemplateEditData("tpl-1", "user-1");
    expect(postEdit.prefill).toBeNull();
    expect(postEdit.postContext).toEqual({ queues: [] });
    expect(posts.loadNewPostData).toHaveBeenCalledWith("user-1", null, "tpl-1");

    templates.getTemplateById.mockResolvedValueOnce({
      id: "tpl-1",
      templateType: "LONGFORM",
      post: null,
      longFormPost: { id: "lf-1" },
    });
    templates.getTemplatePrefill.mockResolvedValueOnce({ title: "Draft" });
    posts.loadNewLongFormData.mockResolvedValueOnce({ title: "Draft" });
    const longformEdit = await loadTemplateEditData("tpl-1", "user-1");
    expect(longformEdit.longformContext).toEqual({ title: "Draft" });
    expect(longformEdit.postContext).toBeNull();
  });

  it("renames, deletes, and rejects an invalid action", async () => {
    await expect(
      handleTemplateEditAction(form({}), "tpl-1", "user-1")
    ).resolves.toBeInstanceOf(Response);
    await expect(
      handleTemplateEditAction(form({ _action: "updateName" }), "", "user-1")
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      handleTemplateEditAction(
        form({ _action: "updateName", name: "Renamed" }),
        "tpl-1",
        "user-1"
      )
    ).resolves.toEqual({ success: true });
    expect(templates.updateTemplate).toHaveBeenCalledWith({
      id: "tpl-1",
      userId: "user-1",
      name: "Renamed",
    });

    await expect(
      handleTemplateEditAction(form({ _action: "delete" }), "tpl-1", "user-1")
    ).resolves.toEqual({ success: true });
    await expect(
      handleTemplateEditAction(
        form({ _action: "deleteTemplate" }),
        "tpl-1",
        "user-1"
      )
    ).resolves.toEqual({
      success: true,
      redirectTo: "/dashboard/templates",
    });
  });

  it("updates a post template, including hashtags, tags, and a renamed template", async () => {
    templates.getTemplateById.mockResolvedValueOnce({
      post: { id: "other" },
    });
    const missing = await handleTemplateEditAction(
      form({
        _action: "updateTemplatePost",
        templateId: "tpl-1",
        postId: "post-1",
        content: "hello",
      }),
      "tpl-1",
      "user-1"
    );
    expect(missing).toMatchObject({
      init: { status: 404 },
    });

    templates.getTemplateById.mockResolvedValueOnce({
      post: { id: "post-1" },
    });
    composer.getHashtagPresetTags.mockResolvedValueOnce({ tags: "" });
    await expect(
      handleTemplateEditAction(
        form({
          _action: "updateTemplatePost",
          templateId: "tpl-1",
          postId: "post-1",
          content: "hello",
          name: "  Named  ",
          tags: "alpha beta",
          queueType: "main",
          queueTypeId: "queue-1",
          hashTagPresetId: "preset-1",
        }),
        "tpl-1",
        "user-1"
      )
    ).resolves.toEqual({ success: true });
    expect(posts.updatePost).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "post-1",
        data: {
          content: "composed",
          caption: "composed",
          fileUrl: ["https://cdn.example/a.png"],
          queueTypeId: "queue-1",
          tags: ["alpha", "beta"],
          hashTagPresetId: "preset-1",
        },
      })
    );
    expect(templates.updateTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Named" })
    );
  });

  it("appends hashtags when a preset returns tags", async () => {
    templates.getTemplateById.mockResolvedValueOnce({
      post: { id: "post-1" },
    });
    await handleTemplateEditAction(
      form({
        _action: "updateTemplatePost",
        templateId: "tpl-1",
        postId: "post-1",
        content: "hello",
      }),
      "tpl-1",
      "user-1"
    );
    expect(posts.updatePost).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          content: "composed\n#nostr",
          caption: "composed\n#nostr",
          fileUrl: ["https://cdn.example/a.png"],
          queueTypeId: "queue-1",
          tags: [],
          hashTagPresetId: undefined,
        },
      })
    );
  });

  it("updates a longform template across queue, title, summary, and name branches", async () => {
    templates.getTemplateById.mockResolvedValueOnce({
      longFormPost: { id: "other" },
    });
    const missing = await handleTemplateEditAction(
      form({
        _action: "updateTemplateLongform",
        templateId: "tpl-1",
        longFormPostId: "lf-1",
      }),
      "tpl-1",
      "user-1"
    );
    expect(missing).toMatchObject({ init: { status: 404 } });

    templates.getTemplateById.mockResolvedValueOnce({
      longFormPost: { id: "lf-1" },
    });
    user.getQueueTypeByNameForUser.mockResolvedValueOnce(null);
    await handleTemplateEditAction(
      form({
        _action: "updateTemplateLongform",
        templateId: "tpl-1",
        longFormPostId: "lf-1",
        queueType: "main",
        title: "   ",
        content: " # hello ",
        customTags: " one, ,two ",
        image: "https://cdn.example/cover.png",
        name: "  Essay  ",
      }),
      "tpl-1",
      "user-1"
    );
    expect(posts.updateLongFormPost).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Untitled",
        summary: "generated summary",
        tags: ["one", "two"],
        queueTypeId: null,
        image: "https://cdn.example/cover.png",
      })
    );
    expect(templates.updateTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Essay" })
    );

    templates.getTemplateById.mockResolvedValueOnce({
      longFormPost: { id: "lf-1" },
    });
    user.getQueueTypeByNameForUser.mockResolvedValueOnce({ id: "queue-9" });
    await handleTemplateEditAction(
      form({
        _action: "updateTemplateLongform",
        templateId: "tpl-1",
        longFormPostId: "lf-1",
        queueType: "weekly",
        title: " Hello ",
        summary: " given ",
        content: "body",
      }),
      "tpl-1",
      "user-1"
    );
    expect(posts.updateLongFormPost).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Hello",
        summary: "given",
        queueTypeId: "queue-9",
      })
    );
  });
});
