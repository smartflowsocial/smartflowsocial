import { describe, expect, it } from "vitest";

import {
  bulkAssignQueueDraftsSchema,
  bulkDeleteLongFormPostsSchema,
  bulkDeleteMixedSchema,
  bulkDeletePostsSchema,
  bulkDuplicateDraftsSchema,
  bulkQuoteSchema,
  bulkRepostSchema,
  bulkScheduledRepostSchema,
  bulkSignAndResumeSchema,
  calendarRescheduleLongformSchema,
  calendarRescheduleSchema,
  convertDraftToTemplateSchema,
  dashboardActionSchema,
  deleteLongFormPostSchema,
  deletePostSchema,
  deleteRecyclablePostSchema,
  draftEditActionSchema,
  draftEditResumeSchema,
  draftEditUpdateSchema,
  draftsActionSchema,
  duplicateDraftPostSchema,
  longformQuoteSchema,
  longformRepostSchema,
  moveToDraftSchema,
  postActionSchema,
  postedActionSchema,
  quoteSchema,
  recyclableActionSchema,
  recyclePostSchema,
  repostConditionsSchema,
  repostSchema,
  scheduleQuoteSchema,
  scheduleRepostSchema,
  scheduledActionSchema,
  searchActionSchema,
  updateRunwaySettingsSchema,
  updateScheduleOverviewTargetSchema,
} from "~/lib/validation/schemas/posts-actions.schemas";

const SIGNED = JSON.stringify({
  id: "evt",
  pubkey: "pk",
  created_at: 1,
  kind: 1,
  content: "hello",
  tags: [["t", "nostr"]],
  sig: "sig",
});

const NOSTR = JSON.stringify({
  created_at: 1,
  kind: 1,
  content: "hello",
  tags: [],
});

describe("posts action schemas", () => {
  it("accepts known post actions and rejects unknown ones", () => {
    expect(postActionSchema.parse("delete")).toBe("delete");
    expect(postActionSchema.parse("bulkDeleteMixed")).toBe("bulkDeleteMixed");
    expect(() => postActionSchema.parse("nope")).toThrow();
  });

  it("requires a post id for single deletes and duplicates", () => {
    expect(deletePostSchema.parse({ _action: "delete", postId: "p1" })).toEqual(
      {
        _action: "delete",
        postId: "p1",
      }
    );
    expect(() =>
      deletePostSchema.parse({ _action: "delete", postId: "" })
    ).toThrow("Post ID is required");
    expect(
      deleteLongFormPostSchema.parse({
        _action: "deleteLongForm",
        postId: "lf1",
      }).postId
    ).toBe("lf1");
    expect(
      duplicateDraftPostSchema.parse({
        _action: "duplicateDraftPost",
        postId: "p1",
      }).postId
    ).toBe("p1");
    expect(
      convertDraftToTemplateSchema.parse({
        _action: "convertDraftToTemplate",
        postId: "p1",
        templateName: null,
      }).templateName
    ).toBeNull();
    expect(repostSchema.parse({ _action: "repost", postId: "p1" }).postId).toBe(
      "p1"
    );
    expect(quoteSchema.parse({ _action: "quote", postId: "p1" }).postId).toBe(
      "p1"
    );
    expect(
      longformRepostSchema.parse({
        _action: "longformRepost",
        longformPostId: "a1",
      }).longformPostId
    ).toBe("a1");
    expect(() =>
      longformRepostSchema.parse({
        _action: "longformRepost",
        longformPostId: "",
      })
    ).toThrow("Article ID is required");
    expect(
      longformQuoteSchema.parse({ _action: "longformQuote", postId: "a1" })
        .postId
    ).toBe("a1");
  });

  it("parses id lists and drops non-strings, invalid JSON, and non-arrays", () => {
    const schemas: Array<{
      action: string;
      parse: (value: unknown) => { postIds: string[] };
    }> = [
      {
        action: "bulkDelete",
        parse: (value) => bulkDeletePostsSchema.parse(value),
      },
      {
        action: "bulkDeleteLongForm",
        parse: (value) => bulkDeleteLongFormPostsSchema.parse(value),
      },
      {
        action: "bulkDuplicateDrafts",
        parse: (value) => bulkDuplicateDraftsSchema.parse(value),
      },
      { action: "bulkRepost", parse: (value) => bulkRepostSchema.parse(value) },
      {
        action: "bulkScheduledRepost",
        parse: (value) => bulkScheduledRepostSchema.parse(value),
      },
      { action: "bulkQuote", parse: (value) => bulkQuoteSchema.parse(value) },
    ];
    for (const schema of schemas) {
      const action = schema.parse({
        _action: schema.action,
        postIds: JSON.stringify(["p1", 2, "p2"]),
      });
      expect(action.postIds).toEqual(["p1", "p2"]);
      expect(() =>
        schema.parse({
          _action: schema.action,
          postIds: "not-json",
        })
      ).toThrow("At least one post ID is required");
      expect(() =>
        schema.parse({
          _action: schema.action,
          postIds: JSON.stringify({ id: "p1" }),
        })
      ).toThrow("At least one post ID is required");
    }
  });

  it("parses mixed delete items and rejects an empty payload", () => {
    expect(
      bulkDeleteMixedSchema.parse({
        _action: "bulkDeleteMixed",
        itemData: JSON.stringify([
          { id: "p1", type: "post" },
          { id: "a1", type: "longform" },
        ]),
      }).itemData
    ).toEqual([
      { id: "p1", type: "post" },
      { id: "a1", type: "longform" },
    ]);
    expect(() =>
      bulkDeleteMixedSchema.parse({
        _action: "bulkDeleteMixed",
        itemData: "[]",
      })
    ).toThrow("At least one item is required");
    expect(() =>
      bulkDeleteMixedSchema.parse({
        _action: "bulkDeleteMixed",
        itemData: "{",
      })
    ).toThrow("At least one item is required");
    expect(() =>
      bulkDeleteMixedSchema.parse({
        _action: "bulkDeleteMixed",
        itemData: JSON.stringify([{ id: "", type: "note" }]),
      })
    ).toThrow();
  });

  it("parses queue assignment and bulk sign-and-resume payloads", () => {
    expect(
      bulkAssignQueueDraftsSchema.parse({
        _action: "bulkAssignQueue",
        postIds: JSON.stringify(["p1"]),
        queueType: "main",
        queueTypeId: null,
      }).queueType
    ).toBe("main");
    expect(() =>
      bulkAssignQueueDraftsSchema.parse({
        _action: "bulkAssignQueue",
        postIds: JSON.stringify([""]),
        queueType: "main",
      })
    ).toThrow();

    const resumed = bulkSignAndResumeSchema.parse({
      _action: "bulkSignAndResume",
      postIds: ["p1"],
      contents: ["body"],
      captions: ["cap"],
      queueTypes: ["main"],
      queueTypeIds: ["q1"],
      scheduledFors: ["1710000000"],
      signedEvents: [SIGNED],
      nostrEvents: [NOSTR],
    });
    expect(resumed.signedEvents[0]?.id).toBe("evt");
    expect(resumed.nostrEvents[0]?.kind).toBe(1);
    expect(() =>
      bulkSignAndResumeSchema.parse({
        _action: "bulkSignAndResume",
        postIds: ["p1"],
        contents: [],
        captions: [],
        queueTypes: [],
        queueTypeIds: [],
        scheduledFors: [],
        signedEvents: ["{"],
        nostrEvents: [NOSTR],
      })
    ).toThrow("Invalid signed event format");
    expect(() =>
      bulkSignAndResumeSchema.parse({
        _action: "bulkSignAndResume",
        postIds: [],
        contents: [],
        captions: [],
        queueTypes: [],
        queueTypeIds: [],
        scheduledFors: [],
        signedEvents: [SIGNED],
        nostrEvents: ["{"],
      })
    ).toThrow("Invalid nostr event format");
  });

  it("coerces calendar override flags and keeps optional signed events", () => {
    expect(
      calendarRescheduleSchema.parse({
        action: "reschedule",
        postId: "p1",
        newTime: "1710000000",
        overrideQueue: "true",
        signedEvent: SIGNED,
        nostrEvent: null,
      }).overrideQueue
    ).toBe(true);
    expect(
      calendarRescheduleSchema.parse({
        action: "reschedule",
        postId: "p1",
        newTime: "1710000000",
        overrideQueue: false,
      }).overrideQueue
    ).toBe(false);
    expect(
      calendarRescheduleSchema.parse({
        action: "reschedule",
        postId: "p1",
        newTime: "1710000000",
      }).overrideQueue
    ).toBe(false);
    expect(() =>
      calendarRescheduleSchema.parse({
        action: "reschedule",
        postId: "",
        newTime: "",
      })
    ).toThrow();
    expect(
      calendarRescheduleLongformSchema.parse({
        action: "rescheduleLongform",
        postId: "a1",
        newTime: "1710000000",
        signedEvent: null,
        nostrEvent: NOSTR,
      }).postId
    ).toBe("a1");
  });

  it("defaults runway thresholds and rejects an overview target outside 0-10", () => {
    expect(
      updateRunwaySettingsSchema.parse({
        _action: "updateRunwaySettings",
        queueNames: ["main"],
        mode: "last-post",
      })
    ).toMatchObject({ redThresholdDays: 3, orangeThresholdDays: 7 });
    expect(
      updateRunwaySettingsSchema.parse({
        _action: "updateRunwaySettings",
        queueNames: [],
        mode: "first-queue-empty",
        redThresholdDays: "1",
        orangeThresholdDays: "4",
      })
    ).toMatchObject({ redThresholdDays: 1, orangeThresholdDays: 4 });
    expect(() =>
      updateRunwaySettingsSchema.parse({
        _action: "updateRunwaySettings",
        queueNames: [],
        mode: "other",
      })
    ).toThrow();
    expect(
      updateScheduleOverviewTargetSchema.parse({
        _action: "updateScheduleOverviewTarget",
        targetPostsPerDay: "3",
      }).targetPostsPerDay
    ).toBe(3);
    expect(() =>
      updateScheduleOverviewTargetSchema.parse({
        _action: "updateScheduleOverviewTarget",
        targetPostsPerDay: 11,
      })
    ).toThrow();
  });

  it("requires exactly one repost or quote source", () => {
    const base = {
      scheduledFor: "1710000000",
      signedEvent: SIGNED,
      minReactions: "2",
      minZaps: "0",
    };
    expect(
      scheduleRepostSchema.parse({
        _action: "scheduleRepost",
        ...base,
        postId: "p1",
      }).minReactions
    ).toBe(2);
    expect(
      scheduleRepostSchema.parse({
        _action: "scheduleRepost",
        scheduledFor: "1710000000",
        signedEvent: SIGNED,
        sourceSignedEvent: SIGNED,
      }).sourceSignedEvent
    ).toBe(SIGNED);
    expect(() =>
      scheduleRepostSchema.parse({
        _action: "scheduleRepost",
        scheduledFor: "1710000000",
        signedEvent: SIGNED,
      })
    ).toThrow("Provide exactly one of postId or sourceSignedEvent");
    expect(() =>
      scheduleRepostSchema.parse({
        _action: "scheduleRepost",
        scheduledFor: "1710000000",
        signedEvent: SIGNED,
        postId: "p1",
        sourceSignedEvent: SIGNED,
      })
    ).toThrow("Provide exactly one of postId or sourceSignedEvent");
    expect(() =>
      scheduleRepostSchema.parse({
        _action: "scheduleRepost",
        scheduledFor: "",
        signedEvent: "",
        postId: "   ",
        sourceSignedEvent: "   ",
      })
    ).toThrow();

    expect(
      scheduleQuoteSchema.parse({
        _action: "scheduleQuote",
        scheduledFor: "1710000000",
        signedEvent: SIGNED,
        postId: "p1",
        quoteCaption: "note",
      }).quoteCaption
    ).toBe("note");
    expect(() =>
      scheduleQuoteSchema.parse({
        _action: "scheduleQuote",
        scheduledFor: "1710000000",
        signedEvent: SIGNED,
        postId: "p1",
        sourceSignedEvent: SIGNED,
      })
    ).toThrow("Provide exactly one of postId or sourceSignedEvent");
  });

  it("parses optional repost conditions and move-to-draft types", () => {
    expect(repostConditionsSchema.parse({}).minReactions).toBeUndefined();
    expect(repostConditionsSchema.parse({ minSats: "5" }).minSats).toBe(5);
    expect(() => repostConditionsSchema.parse({ minComments: -1 })).toThrow();
    expect(
      moveToDraftSchema.parse({
        _action: "moveToDraft",
        postId: "p1",
        type: "longform",
      }).type
    ).toBe("longform");
    expect(() =>
      moveToDraftSchema.parse({
        _action: "moveToDraft",
        postId: "p1",
        type: "note",
      })
    ).toThrow();
  });

  it("parses draft edit update and resume, including bad event JSON", () => {
    expect(
      draftEditUpdateSchema.parse({
        _action: "update",
        content: "body",
        caption: "",
        queueType: null,
        useHashtagPresets: "true",
      }).useHashtagPresets
    ).toBe(true);

    const resumed = draftEditResumeSchema.parse({
      _action: "resume",
      content: "body",
      caption: "cap",
      scheduledFor: "1710000000",
      signedEvent: SIGNED,
      nostrEvent: NOSTR,
      alsoScheduleRepost: "on",
      alsoScheduleQuote: "yes",
      repostSchedules: "[]",
      quoteSchedules: "[]",
    });
    expect(resumed.signedEvent.sig).toBe("sig");
    expect(resumed.alsoScheduleRepost).toBe(true);
    expect(resumed.alsoScheduleQuote).toBe(false);

    expect(
      draftEditResumeSchema.parse({
        _action: "resume",
        content: "",
        caption: "",
        scheduledFor: "1710000000",
        signedEvent: SIGNED,
        nostrEvent: NOSTR,
        alsoScheduleRepost: "true",
        alsoScheduleQuote: "true",
      }).alsoScheduleQuote
    ).toBe(true);

    expect(() =>
      draftEditResumeSchema.parse({
        _action: "resume",
        content: "",
        caption: "",
        scheduledFor: "1710000000",
        signedEvent: "{",
        nostrEvent: NOSTR,
      })
    ).toThrow("Invalid signed event format");
    expect(() =>
      draftEditResumeSchema.parse({
        _action: "resume",
        content: "",
        caption: "",
        scheduledFor: "",
        signedEvent: SIGNED,
        nostrEvent: "{",
      })
    ).toThrow();
  });

  it("routes dashboard, scheduled, drafts, posted, search, and recyclable unions", () => {
    expect(
      dashboardActionSchema.parse({ _action: "delete", postId: "p1" })._action
    ).toBe("delete");
    expect(
      scheduledActionSchema.parse({
        _action: "moveToDraft",
        postId: "p1",
        type: "post",
      })._action
    ).toBe("moveToDraft");
    expect(
      draftsActionSchema.parse({
        _action: "duplicateDraftPost",
        postId: "p1",
      })._action
    ).toBe("duplicateDraftPost");
    expect(
      draftEditActionSchema.parse({
        _action: "update",
        content: "c",
        caption: "",
      })._action
    ).toBe("update");
    expect(
      postedActionSchema.parse({
        _action: "longformQuote",
        postId: "a1",
      })._action
    ).toBe("longformQuote");
    expect(
      searchActionSchema.parse({
        _action: "searchEvent",
        eventInput: "note1",
      })._action
    ).toBe("searchEvent");
    expect(() =>
      searchActionSchema.parse({ _action: "searchEvent", eventInput: "" })
    ).toThrow("Event ID is required");
    expect(
      deleteRecyclablePostSchema.parse({ _action: "delete", postId: "p1" })
        .postId
    ).toBe("p1");
    expect(
      recyclePostSchema.parse({
        _action: "recycle",
        postId: "p1",
        scheduledFor: "1710000000",
        queueTypeId: null,
        queueType: "main",
      }).queueType
    ).toBe("main");
    expect(
      recyclableActionSchema.parse({ _action: "recycle", postId: "p1" })._action
    ).toBe("recycle");
    expect(() =>
      dashboardActionSchema.parse({ _action: "missing", postId: "p1" })
    ).toThrow();
  });
});
