import { describe, expect, it } from "vitest";

import {
  autosaveDraftLongformSchema,
  bulkPostSchema,
  bulkPostsActionSchema,
  draftImagePostSchema,
  draftTextPostSchema,
  imagePostSchema,
  longformPostSchema,
  newLongformPostActionSchema,
  newPostActionSchema,
  newPostBaseSchema,
  postActionSchema,
  postOrScheduleImageSchema,
  postOrScheduleTextSchema,
  publishLongformSchema,
  saveAsDraftSchema,
  saveDraftLongformSchema,
  scheduleLongformSchema,
  signAndScheduleSchema,
  textPostSchema,
  uploadImageLongformSchema,
  uploadImagesPreviewSchema,
  uploadPreviewSchema,
} from "~/lib/validation/schemas/posts.schemas";

const POST_ACTIONS = [
  "draft-text",
  "post-text",
  "schedule-text",
  "draft-image",
  "post-image",
  "schedule-image",
  "save-draft",
  "publish",
  "schedule-longform",
  "upload-image",
] as const;

const IMAGE_ACTIONS = [
  "post-image",
  "post-images",
  "post-media",
  "schedule-image",
  "schedule-images",
  "schedule-media",
] as const;

const SIGNED = {
  id: "id-1",
  pubkey: "pk",
  created_at: 1,
  kind: 1,
  content: "hello",
  tags: [["t", "nostr"]],
  sig: "sig",
};
const UNSIGNED = {
  created_at: 1,
  kind: 1,
  content: "hello",
  tags: [["t", "nostr"]],
};

function issues(result: {
  success: boolean;
  error?: { issues: Array<{ message: string }> };
}): string {
  if (result.success || !result.error) {
    throw new Error("expected a schema failure");
  }
  return result.error.issues.map((issue) => issue.message).join("\n");
}

describe("posts schema missed branches", () => {
  it.each(POST_ACTIONS)("accepts post action %s", (action) => {
    expect(postActionSchema.parse(action)).toBe(action);
  });

  it("rejects an unknown post action and enforces text boundaries", () => {
    expect(issues(postActionSchema.safeParse("nope"))).toContain(
      "Invalid option"
    );
    expect(
      textPostSchema.parse({
        _action: "schedule-text",
        content: "x".repeat(5000),
        scheduledFor: null,
        queueTypeId: null,
        isRecyclable: true,
        useHashtagPresets: true,
        hashTagPresetId: null,
      })
    ).toMatchObject({
      content: "x".repeat(5000),
      scheduledFor: null,
      isRecyclable: true,
      useHashtagPresets: true,
      hashTagPresetId: null,
    });
    expect(
      issues(textPostSchema.safeParse({ _action: "post-text", content: "" }))
    ).toContain("Post content cannot be empty");
    expect(
      issues(
        textPostSchema.safeParse({
          _action: "post-text",
          content: "x".repeat(5001),
        })
      )
    ).toContain("Content too long");
  });

  it("allows an empty image caption and rejects a long one", () => {
    expect(
      imagePostSchema.parse({ _action: "post-image", caption: "" }).caption
    ).toBe("");
    expect(imagePostSchema.parse({ _action: "draft-image" }).queueType).toBe(
      "unassigned"
    );
    expect(
      issues(
        imagePostSchema.safeParse({
          _action: "post-image",
          caption: "x".repeat(5001),
        })
      )
    ).toContain("Caption too long");
  });

  it("checks longform title and content boundaries", () => {
    expect(
      longformPostSchema.parse({ _action: "publish", content: "body" })
        .queueType
    ).toBe("Unassigned");
    expect(
      issues(
        longformPostSchema.safeParse({
          _action: "save-draft",
          title: "",
          content: "body",
        })
      )
    ).toContain("Title is required");
    expect(
      issues(
        longformPostSchema.safeParse({
          _action: "save-draft",
          title: "x".repeat(201),
          content: "body",
        })
      )
    ).toContain("Title too long");
    expect(
      issues(
        longformPostSchema.safeParse({
          _action: "save-draft",
          content: "x".repeat(50001),
        })
      )
    ).toContain("Content too long");
  });

  it("checks bulk content boundaries and optional queue fields", () => {
    expect(
      bulkPostSchema.parse({
        posts: [
          {
            content: "ok",
            scheduledFor: null,
            queueTypeId: null,
          },
        ],
      }).posts[0]
    ).toEqual({ content: "ok", scheduledFor: null, queueTypeId: null });
    expect(bulkPostSchema.parse({ posts: [] }).posts).toEqual([]);
    expect(
      issues(bulkPostSchema.safeParse({ posts: [{ content: "" }] }))
    ).toContain("Post content cannot be empty");
    expect(
      issues(
        bulkPostSchema.safeParse({ posts: [{ content: "x".repeat(5001) }] })
      )
    ).toContain("Content too long");
  });

  it("coerces new-post booleans and applies defaults", () => {
    expect(newPostBaseSchema.parse({ _action: "draft-text" })).toMatchObject({
      caption: "",
      scheduledFor: null,
      queueType: "unassigned",
      queueTypeId: null,
      isRecyclable: false,
      useHashtagPresets: false,
      hashTagPresetId: null,
    });
    expect(
      newPostBaseSchema.parse({
        _action: "draft-text",
        isRecyclable: "false",
        useHashtagPresets: "",
        includeHashtagsInNoteBody: "false",
      })
    ).toMatchObject({
      isRecyclable: true,
      useHashtagPresets: false,
      includeHashtagsInNoteBody: true,
    });
    expect(
      newPostBaseSchema.parse({
        _action: "draft-text",
        isRecyclable: "",
        includeHashtagsInNoteBody: false,
      }).includeHashtagsInNoteBody
    ).toBe(false);
  });

  it.each(["upload-images-preview", "upload-media-preview"] as const)(
    "accepts upload preview %s",
    (action) => {
      expect(uploadPreviewSchema.parse({ _action: action })._action).toBe(
        action
      );
    }
  );

  it("rejects an unknown upload preview action", () => {
    expect(
      issues(uploadPreviewSchema.safeParse({ _action: "upload" }))
    ).toContain("Invalid option");
  });

  it("defaults draft and scheduled text content to an empty string", () => {
    expect(draftTextPostSchema.parse({ _action: "draft-text" }).content).toBe(
      ""
    );
    expect(
      postOrScheduleTextSchema.parse({ _action: "post-text" })._action
    ).toBe("post-text");
    expect(
      postOrScheduleTextSchema.parse({ _action: "schedule-text" }).content
    ).toBe("");
  });

  it.each(["draft-image", "draft-images", "draft-media"] as const)(
    "accepts draft image action %s",
    (action) => {
      expect(draftImagePostSchema.parse({ _action: action })._action).toBe(
        action
      );
    }
  );

  it.each(IMAGE_ACTIONS)("accepts image publish action %s", (action) => {
    expect(postOrScheduleImageSchema.parse({ _action: action })._action).toBe(
      action
    );
    expect(newPostActionSchema.parse({ _action: action })._action).toBe(action);
  });

  it("accepts the text members of the new-post union and rejects an unknown one", () => {
    expect(newPostActionSchema.parse({ _action: "draft-text" })._action).toBe(
      "draft-text"
    );
    expect(
      newPostActionSchema.parse({ _action: "schedule-text", content: "x" })
        ._action
    ).toBe("schedule-text");
    expect(
      issues(
        newPostActionSchema.safeParse({ _action: "publish", content: "x" })
      )
    ).toContain("Invalid discriminator value");
  });

  it.each([
    [
      "save-draft",
      { _action: "save-draft", content: "" },
      "Content is required",
    ],
    [
      "autosave-draft",
      { _action: "autosave-draft", content: "" },
      "Content is required",
    ],
    ["publish", { _action: "publish", content: "" }, "Content is required"],
    [
      "schedule-longform",
      { _action: "schedule-longform", content: "body", scheduledFor: "" },
      "Scheduled time is required",
    ],
  ] as const)("rejects an empty %s payload", (_label, input, message) => {
    expect(issues(newLongformPostActionSchema.safeParse(input))).toContain(
      message
    );
  });

  it("accepts every longform action member", () => {
    expect(
      saveDraftLongformSchema.parse({
        _action: "save-draft",
        content: "a",
        title: "t",
      }).title
    ).toBe("t");
    expect(
      autosaveDraftLongformSchema.parse({
        _action: "autosave-draft",
        content: "a",
      })._action
    ).toBe("autosave-draft");
    expect(
      publishLongformSchema.parse({ _action: "publish", content: "a" })._action
    ).toBe("publish");
    expect(
      scheduleLongformSchema.parse({
        _action: "schedule-longform",
        content: "a",
        scheduledFor: "2024-01-01T00:00:00.000Z",
      }).scheduledFor
    ).toBe("2024-01-01T00:00:00.000Z");
    expect(
      uploadImageLongformSchema.parse({ _action: "upload-image" })._action
    ).toBe("upload-image");
    expect(
      newLongformPostActionSchema.parse({ _action: "upload-image" })._action
    ).toBe("upload-image");
  });

  it("parses upload providers and rejects empty or non-array results", () => {
    const providers = [
      "S3",
      "BLOSSOM_PRIMAL",
      "BLOSSOM_BLOSSTR",
      "BLOSSOM_SFS",
      "BLOSSOM_CUSTOM",
    ] as const;
    const parsed = uploadImagesPreviewSchema.parse({
      uploadResults: JSON.stringify(
        providers.map((provider) => ({
          success: true,
          file: {
            url: `https://cdn.example/${provider}`,
            provider,
          },
        }))
      ),
      scheduledDates: ["2024-01-01"],
      queueTypes: ["queue"],
    });
    expect(parsed.uploadResults.map((result) => result.file?.provider)).toEqual(
      [...providers]
    );
    expect(
      issues(
        uploadImagesPreviewSchema.safeParse({
          uploadResults: "not-json",
          scheduledDates: [],
          queueTypes: [],
        })
      )
    ).toContain("At least one upload result is required");
    expect(
      issues(
        uploadImagesPreviewSchema.safeParse({
          uploadResults: "{}",
          scheduledDates: [],
          queueTypes: [],
        })
      )
    ).toContain("At least one upload result is required");
    expect(
      issues(
        uploadImagesPreviewSchema.safeParse({
          uploadResults: "[]",
          scheduledDates: [],
          queueTypes: [],
        })
      )
    ).toContain("At least one upload result is required");
    expect(
      issues(
        uploadImagesPreviewSchema.safeParse({
          uploadResults: JSON.stringify([{ file: { provider: "NOPE" } }]),
          scheduledDates: [],
          queueTypes: [],
        })
      )
    ).toContain("Invalid option");
  });

  it("covers the remaining sign-and-schedule transform arms", () => {
    const parsed = signAndScheduleSchema.parse({
      signedEvents: [JSON.stringify(SIGNED)],
      nostrEvent: [JSON.stringify(UNSIGNED)],
      caption: [
        JSON.stringify(["a", "b"]),
        JSON.stringify("text"),
        JSON.stringify(null),
        JSON.stringify(3),
        "raw caption",
        "{",
      ],
      fileUrl: [
        JSON.stringify(["https://a.example", 2, "https://b.example"]),
        JSON.stringify("https://only.example"),
        JSON.stringify("  "),
        JSON.stringify(""),
        "https://raw.example",
        "",
        "{",
      ],
      queueType: ["queue"],
      isRecyclable: ["true", "TRUE", "false", "yes"],
    });

    expect(parsed.caption).toEqual([
      "a b",
      "text",
      "",
      "3",
      "raw caption",
      "{",
    ]);
    expect(parsed.fileUrl).toEqual([
      ["https://a.example", "https://b.example"],
      ["https://only.example"],
      [],
      [],
      ["https://raw.example"],
      [],
      ["{"],
    ]);
    expect(parsed.isRecyclable).toEqual([true, true, false, false]);
    expect(parsed.originalPostId).toEqual([]);
    expect(parsed.repostSchedules).toEqual([]);
    expect(parsed.quoteSchedules).toEqual([]);
    expect(parsed.nominalScheduledFor).toEqual([]);
  });

  it.each([
    ["[]", JSON.stringify(UNSIGNED), "Invalid signed event format"],
    ["{", JSON.stringify(UNSIGNED), "Invalid signed event format"],
    [
      JSON.stringify([SIGNED]),
      JSON.stringify(UNSIGNED),
      "Invalid signed event format",
    ],
    [JSON.stringify(SIGNED), "[]", "Invalid nostr event format"],
    [JSON.stringify(SIGNED), "{", "Invalid nostr event format"],
  ])("rejects a bad signed or nostr payload", (signed, nostr, message) => {
    expect(() =>
      signAndScheduleSchema.parse({
        signedEvents: [signed],
        nostrEvent: [nostr],
        caption: ["caption"],
        fileUrl: ["https://cdn.example/a.jpg"],
        queueType: ["queue"],
        isRecyclable: ["false"],
      })
    ).toThrow(message);
  });

  it("rejects an empty sign-and-schedule batch", () => {
    expect(
      issues(
        signAndScheduleSchema.safeParse({
          signedEvents: [],
          nostrEvent: [JSON.stringify(UNSIGNED)],
          caption: [],
          fileUrl: [],
          queueType: [],
          isRecyclable: [],
        })
      )
    ).toContain("At least one post is required");
  });

  it("covers save-as-draft file URL fallbacks", () => {
    expect(
      saveAsDraftSchema.parse({
        fileUrl: [
          JSON.stringify(["https://a.example", 1]),
          JSON.stringify("https://b.example"),
          JSON.stringify(""),
          "https://raw.example",
          "",
          "{",
        ],
        caption: ["a"],
        queueType: ["queue"],
        scheduledFor: [""],
      }).fileUrl
    ).toEqual([
      ["https://a.example"],
      ["https://b.example"],
      [],
      ["https://raw.example"],
      [],
      ["{"],
    ]);
    expect(
      issues(
        saveAsDraftSchema.safeParse({
          fileUrl: [],
          caption: [],
          queueType: [],
          scheduledFor: [],
        })
      )
    ).toContain("At least one post is required");
  });

  it("accepts the sign-and-schedule member of the bulk union", () => {
    const parsed = bulkPostsActionSchema.parse({
      _action: "sign_and_schedule",
      signedEvents: [JSON.stringify(SIGNED)],
      nostrEvent: [JSON.stringify(UNSIGNED)],
      caption: ["caption"],
      fileUrl: [JSON.stringify("https://cdn.example/a.jpg")],
      queueType: ["queue"],
      isRecyclable: ["false"],
      originalPostId: ["origin"],
      repostSchedules: ["repost"],
      quoteSchedules: ["quote"],
      nominalScheduledFor: ["1700000000"],
    });
    expect(parsed._action).toBe("sign_and_schedule");
    if (parsed._action !== "sign_and_schedule") {
      throw new Error("expected sign_and_schedule");
    }
    expect(parsed.originalPostId).toEqual(["origin"]);
    expect(parsed.repostSchedules).toEqual(["repost"]);
    expect(parsed.quoteSchedules).toEqual(["quote"]);
    expect(parsed.nominalScheduledFor).toEqual(["1700000000"]);
    expect(
      issues(bulkPostsActionSchema.safeParse({ _action: "other" }))
    ).toContain("Invalid discriminator value");
  });
});
