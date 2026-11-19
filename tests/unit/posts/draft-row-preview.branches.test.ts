import { describe, expect, it } from "vitest";

import {
  buildDraftRowPreview,
  draftTypeLabel,
} from "~/features/posts/drafts/utils/draft-row-preview";

describe("draft row preview branches", () => {
  it("summarizes polls from meta, content, and empty labels", () => {
    expect(
      buildDraftRowPreview({
        id: "poll-1",
        postType: "POLL",
        content: "unused",
        fileUrl: ["https://cdn.example/a.png"],
        draftMeta: {
          pollQuestion: "  Favorite color?  ",
          pollOptionLabels: [" Red ", " ", 1, "Blue"],
        },
      })
    ).toEqual({
      title: "Favorite color?",
      subtitle: "2 options",
      mediaLine: null,
    });

    expect(
      buildDraftRowPreview({
        id: "poll-2",
        postType: "POLL",
        content: "Fallback question",
        draftMeta: { pollQuestion: "   ", pollOptionLabels: ["Only"] },
      })
    ).toEqual({
      title: "Fallback question",
      subtitle: "1 option",
      mediaLine: null,
    });

    const empty = buildDraftRowPreview({
      id: "poll-3",
      postType: "POLL",
      content: "   ",
      draftMeta: { pollOptionLabels: [" ", 2] },
    });
    expect(empty).toEqual({
      title: "Poll",
      subtitle: "Poll draft",
      mediaLine: null,
    });

    const numeric = {
      id: "poll-4",
      postType: "POLL",
      content: "text",
      draftMeta: { pollQuestion: 4 },
    };
    Reflect.set(numeric, "content", 4);
    expect(buildDraftRowPreview(numeric).title).toBe("Poll");
    expect(
      buildDraftRowPreview({
        id: "poll-5",
        postType: "POLL",
        draftMeta: "not-an-object",
      }).subtitle
    ).toBe("Poll draft");
  });

  it("truncates a long poll question and keeps a short one", () => {
    const exact = "q".repeat(100);
    expect(
      buildDraftRowPreview({
        id: "poll-exact",
        postType: "POLL",
        draftMeta: { pollQuestion: exact, pollOptionLabels: [] },
      }).title
    ).toBe(exact);

    const long = buildDraftRowPreview({
      id: "poll-long",
      postType: "POLL",
      draftMeta: { pollQuestion: `${"q".repeat(120)}\nsecond` },
    });
    expect(long.title).toHaveLength(100);
    expect(long.title.endsWith("…")).toBe(true);
    expect(long.subtitle).toBe("Poll draft");
  });

  it("summarizes threads with and without a title or first line", () => {
    expect(
      buildDraftRowPreview({
        id: "thread-1",
        postKind: "THREAD",
        draftMeta: {
          threadTitle: "  Launch notes  ",
          threadSegments: [{ content: "  First line  \nsecond" }],
        },
      })
    ).toEqual({
      title: "Launch notes",
      subtitle: "1 posts · starts with: First line  ",
      mediaLine: null,
    });

    expect(
      buildDraftRowPreview({
        id: "thread-2",
        draftMeta: {
          threadTitle: "   ",
          threadSegments: [{}, "segment", { content: 5 }],
        },
      })
    ).toEqual({
      title: "Untitled thread",
      subtitle: "3 posts",
      mediaLine: null,
    });

    expect(
      buildDraftRowPreview({
        id: "thread-3",
        postKind: "THREAD",
        draftMeta: { threadSegments: [{ content: "   " }] },
      }).subtitle
    ).toBe("1 post");

    expect(
      buildDraftRowPreview({
        id: "thread-4",
        postKind: "THREAD",
        draftMeta: null,
      })
    ).toEqual({
      title: "Untitled thread",
      subtitle: "Thread draft",
      mediaLine: null,
    });

    expect(
      buildDraftRowPreview({
        id: "thread-5",
        postKind: "THREAD",
        draftMeta: { threadTitle: 9, threadSegments: "nope" },
      }).subtitle
    ).toBe("Thread draft");

    const snippet = "s".repeat(80);
    expect(
      buildDraftRowPreview({
        id: "thread-6",
        postKind: "THREAD",
        draftMeta: { threadSegments: [{ content: snippet }] },
      }).subtitle
    ).toBe(`1 posts · starts with: ${snippet}`);

    const truncated = buildDraftRowPreview({
      id: "thread-7",
      postKind: "THREAD",
      draftMeta: { threadSegments: [{ content: "s".repeat(81) }] },
    });
    expect(truncated.subtitle.endsWith("…")).toBe(true);
    expect(truncated.subtitle).toContain("1 posts · starts with: ");
  });

  it("builds plain, media, and empty post previews", () => {
    expect(
      buildDraftRowPreview({
        id: "post-1",
        caption: "first\nsecond",
        content: "Body line\nmore",
        fileUrl: ["https://cdn.example/a.png"],
      })
    ).toEqual({
      title: "first\nsecond",
      subtitle: "Body line",
      mediaLine: "1 image",
    });

    expect(
      buildDraftRowPreview({
        id: "post-2",
        caption: "Same",
        content: "Same",
      })
    ).toEqual({ title: "Same", subtitle: "", mediaLine: "Text only" });

    const longBody = "b".repeat(101);
    expect(
      buildDraftRowPreview({
        id: "post-3",
        content: `${longBody}\nnext`,
      }).title
    ).toBe(`${"b".repeat(99)}…`);

    expect(
      buildDraftRowPreview({
        id: "post-4",
        content: "b".repeat(100),
      }).title
    ).toBe("b".repeat(100));

    expect(
      buildDraftRowPreview({
        id: "post-5",
        caption: "c".repeat(140),
        content: "other",
      }).title
    ).toBe("c".repeat(140));

    expect(
      buildDraftRowPreview({
        id: "post-6",
        caption: "   ",
        content: "   ",
        fileUrl: [],
      })
    ).toEqual({
      title: "Untitled post",
      subtitle: "No content yet",
      mediaLine: null,
    });

    expect(
      buildDraftRowPreview({
        id: "post-7",
        fileUrl: ["https://cdn.example/a.png", "https://cdn.example/b.png"],
      })
    ).toEqual({
      title: "Untitled post",
      subtitle: "",
      mediaLine: "2 images",
    });

    expect(
      buildDraftRowPreview({
        id: "post-8",
        caption: "Caption",
        fileUrl: ['["https://cdn.example/a.png","https://cdn.example/b.png"]'],
      }).mediaLine
    ).toBe("2 images");

    expect(
      buildDraftRowPreview({
        id: "post-9",
        caption: "Caption",
        fileUrl: ['{"url":"https://cdn.example/a.png"}'],
      }).mediaLine
    ).toBe("1 image");
    expect(
      buildDraftRowPreview({
        id: "post-9b",
        caption: "Caption",
        fileUrl: ["[]"],
      }).mediaLine
    ).toBe("Text only");

    expect(
      buildDraftRowPreview({
        id: "post-10",
        caption: "Caption",
        fileUrl: ["[broken"],
      }).mediaLine
    ).toBe("1 image");

    expect(buildDraftRowPreview({ id: "post-11" }).mediaLine).toBeNull();
  });

  it("labels poll, thread, repost, and plain drafts in that order", () => {
    expect(draftTypeLabel({ postType: "POLL", postKind: "REPOST" })).toBe(
      "Poll"
    );
    expect(
      draftTypeLabel({
        postKind: "REPOST",
        draftMeta: { threadSegments: [{ content: "x" }] },
      })
    ).toBe("Thread");
    expect(draftTypeLabel({ postKind: "THREAD" })).toBe("Thread");
    expect(draftTypeLabel({ postKind: "REPOST" })).toBe("Repost");
    expect(draftTypeLabel({ postType: "TEXT" })).toBe("Post");
  });
});
