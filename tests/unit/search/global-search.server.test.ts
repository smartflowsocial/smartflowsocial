import { beforeEach, describe, expect, it, vi } from "vitest";

const searchData = vi.hoisted(() => ({
  findCancelledLongforms: vi.fn(),
  findCancelledPosts: vi.fn(),
  findDraftLongforms: vi.fn(),
  findDraftPosts: vi.fn(),
  findFailedLongforms: vi.fn(),
  findFailedPosts: vi.fn(),
  findLongFormPostByNostrEventId: vi.fn(),
  findPostByNostrEventId: vi.fn(),
  findPublishedLongforms: vi.fn(),
  findPublishedPosts: vi.fn(),
  findPublishingLongforms: vi.fn(),
  findPublishingPosts: vi.fn(),
  findScheduledLongforms: vi.fn(),
  findScheduledPosts: vi.fn(),
  findTemplatesByQuery: vi.fn(),
}));

const payments = vi.hoisted(() => ({
  getUserSubscription: vi.fn(),
}));

const searchAction = vi.hoisted(() => ({
  decodeSearchInput: vi.fn(),
  handleSearchEvent: vi.fn(),
}));

vi.mock("~/features/payments/data", () => payments);
vi.mock(
  "~/features/search/repositories/global-search-data.server",
  () => searchData
);
vi.mock("~/features/search/services/search-action.server", () => searchAction);

import { performGlobalSearch } from "~/features/search/services/global-search.server";

const USER_ID = "user-1";
const EVENT_HEX = "ab".repeat(32);
const CREATED = new Date("2024-01-01T00:00:00.000Z");
const UPDATED = new Date("2024-01-02T00:00:00.000Z");
const SCHEDULED_AT = new Date("2024-01-03T00:00:00.000Z");
const PUBLISHED_AT = new Date("2024-01-04T00:00:00.000Z");
const CREATED_ISO = CREATED.toISOString();
const UPDATED_ISO = UPDATED.toISOString();
const SCHEDULED_ISO = SCHEDULED_AT.toISOString();
const PUBLISHED_ISO = PUBLISHED_AT.toISOString();

const LIST_FINDERS = [
  "findCancelledLongforms",
  "findCancelledPosts",
  "findDraftLongforms",
  "findDraftPosts",
  "findFailedLongforms",
  "findFailedPosts",
  "findPublishedLongforms",
  "findPublishedPosts",
  "findPublishingLongforms",
  "findPublishingPosts",
  "findScheduledLongforms",
  "findScheduledPosts",
  "findTemplatesByQuery",
] as const;

const CONTENT_KEYS = [
  "draft:draft-post",
  "draft:draft-long",
  "scheduled:scheduled-post",
  "scheduled:scheduled-long",
  "publishing:publishing-post",
  "publishing:publishing-long",
  "published:published-post",
  "published:published-long",
  "failed:failed-post",
  "failed:failed-long",
  "cancelled:cancelled-post",
  "cancelled:cancelled-long",
  "template:template-1",
];

function resultKeys(results: Array<{ id: string; type: string }>): string[] {
  return results.map((item) => `${item.type}:${item.id}`);
}

function withPriority(priority: string): string[] {
  const feature = "feature:/dashboard/drafts";
  const head = CONTENT_KEYS.filter((item) => item.startsWith(`${priority}:`));
  const rest = CONTENT_KEYS.filter((item) => !item.startsWith(`${priority}:`));
  return [feature, ...head, ...rest];
}

function useFullSubscription(): void {
  payments.getUserSubscription.mockResolvedValue({
    Plan: { id: "plan-1", name: "Pro" },
    planId: "pro",
    status: "active",
  });
}

function installPopulated(): void {
  searchData.findDraftPosts.mockResolvedValue([
    {
      caption: "Draft caption",
      content: "Draft content",
      createdAt: CREATED,
      currentState: "DRAFT",
      id: "draft-post",
      updatedAt: UPDATED,
    },
  ]);
  searchData.findDraftLongforms.mockResolvedValue([
    {
      content: "Long draft",
      createdAt: CREATED,
      currentState: "DRAFT",
      id: "draft-long",
      summary: "Summary",
      title: "",
      updatedAt: UPDATED,
    },
  ]);
  searchData.findScheduledPosts.mockResolvedValue([
    {
      caption: "Scheduled caption",
      content: "Scheduled content",
      createdAt: CREATED,
      currentState: "SCHEDULED",
      id: "scheduled-post",
      scheduledAtUtc: SCHEDULED_AT,
    },
  ]);
  searchData.findScheduledLongforms.mockResolvedValue([
    {
      content: "Scheduled long",
      createdAt: CREATED,
      currentState: "SCHEDULED",
      id: "scheduled-long",
      scheduledAtUtc: SCHEDULED_AT,
      summary: "Scheduled summary",
      title: "Scheduled title",
    },
  ]);
  searchData.findPublishingPosts.mockResolvedValue([
    {
      caption: "Publishing caption",
      content: "Publishing content",
      createdAt: CREATED,
      currentState: "PUBLISHING",
      id: "publishing-post",
      updatedAt: UPDATED,
    },
  ]);
  searchData.findPublishingLongforms.mockResolvedValue([
    {
      content: "Publishing long",
      createdAt: CREATED,
      currentState: "PUBLISHING",
      id: "publishing-long",
      summary: "Publishing summary",
      title: "Publishing title",
      updatedAt: UPDATED,
    },
  ]);
  searchData.findPublishedPosts.mockResolvedValue([
    {
      caption: "Published caption",
      content: "Published content",
      createdAt: CREATED,
      currentState: "PUBLISHED",
      id: "published-post",
      publishedAt: PUBLISHED_AT,
    },
  ]);
  searchData.findPublishedLongforms.mockResolvedValue([
    {
      content: "Published long",
      createdAt: CREATED,
      currentState: "PUBLISHED",
      id: "published-long",
      publishedAt: PUBLISHED_AT,
      summary: "Published summary",
      title: "Published title",
    },
  ]);
  searchData.findFailedPosts.mockResolvedValue([
    {
      caption: "Failed caption",
      content: "Failed content",
      createdAt: CREATED,
      currentState: "FAILED",
      id: "failed-post",
      updatedAt: UPDATED,
    },
  ]);
  searchData.findFailedLongforms.mockResolvedValue([
    {
      content: "Failed long",
      createdAt: CREATED,
      currentState: "FAILED",
      id: "failed-long",
      summary: "Failed summary",
      title: "Failed title",
      updatedAt: UPDATED,
    },
  ]);
  searchData.findCancelledPosts.mockResolvedValue([
    {
      caption: "Cancelled caption",
      content: "Cancelled content",
      createdAt: CREATED,
      currentState: "CANCELLED",
      id: "cancelled-post",
      updatedAt: UPDATED,
    },
  ]);
  searchData.findCancelledLongforms.mockResolvedValue([
    {
      content: "Cancelled long",
      createdAt: CREATED,
      currentState: "CANCELLED",
      id: "cancelled-long",
      summary: "Cancelled summary",
      title: "Cancelled title",
      updatedAt: UPDATED,
    },
  ]);
  searchData.findTemplatesByQuery.mockResolvedValue([
    {
      createdAt: CREATED,
      id: "template-1",
      name: "Template name",
      updatedAt: UPDATED,
    },
  ]);
}

function installNullRows(): void {
  searchData.findDraftPosts.mockResolvedValue([
    {
      caption: null,
      content: null,
      createdAt: CREATED,
      currentState: "DRAFT",
      id: "draft-post",
      updatedAt: UPDATED,
    },
  ]);
  searchData.findDraftLongforms.mockResolvedValue([
    {
      content: null,
      createdAt: CREATED,
      currentState: "DRAFT",
      id: "draft-long",
      summary: null,
      title: null,
      updatedAt: UPDATED,
    },
  ]);
  searchData.findScheduledPosts.mockResolvedValue([
    {
      caption: null,
      content: null,
      createdAt: CREATED,
      currentState: "SCHEDULED",
      id: "scheduled-post",
      scheduledAtUtc: null,
    },
  ]);
  searchData.findScheduledLongforms.mockResolvedValue([
    {
      content: null,
      createdAt: CREATED,
      currentState: "SCHEDULED",
      id: "scheduled-long",
      scheduledAtUtc: null,
      summary: null,
      title: null,
    },
  ]);
  searchData.findPublishedPosts.mockResolvedValue([
    {
      caption: null,
      content: null,
      createdAt: CREATED,
      currentState: "PUBLISHED",
      id: "published-post",
      publishedAt: null,
    },
  ]);
  searchData.findPublishedLongforms.mockResolvedValue([
    {
      content: null,
      createdAt: CREATED,
      currentState: "PUBLISHED",
      id: "published-long",
      publishedAt: null,
      summary: null,
      title: null,
    },
  ]);
  searchData.findTemplatesByQuery.mockResolvedValue([
    {
      createdAt: CREATED,
      id: "template-1",
      name: null,
      updatedAt: UPDATED,
    },
  ]);
}

function ownPost(state: string) {
  return {
    caption: "cap",
    content: "body",
    createdAt: CREATED,
    currentState: state,
    id: `post-${state}`,
    publishedAt: PUBLISHED_AT,
    scheduledAtUtc: SCHEDULED_AT,
    updatedAt: UPDATED,
  };
}

function ownLongform(state: string) {
  return {
    content: "Body",
    createdAt: CREATED,
    currentState: state,
    id: `long-${state}`,
    publishedAt: PUBLISHED_AT,
    scheduledAtUtc: SCHEDULED_AT,
    summary: "Sum",
    title: "Title",
    updatedAt: UPDATED,
  };
}

const OWN_POST_CASES = [
  ["PUBLISHED", "published", "/dashboard/published?postId=ID"],
  ["SCHEDULED", "scheduled", "/dashboard/scheduled?postId=ID"],
  ["PUBLISHING", "publishing", "/dashboard/scheduled?postId=ID"],
  ["DRAFT", "draft", "/dashboard/drafts/edit/ID"],
  ["FAILED", "failed", "/dashboard/scheduled"],
  ["CANCELLED", "cancelled", "/dashboard/scheduled"],
  ["ARCHIVED", "published", "/dashboard/published?postId=ID"],
] as const;

const OWN_LONGFORM_CASES = [
  ["PUBLISHED", "published", "/dashboard/published?postId=ID&tab=longform"],
  ["SCHEDULED", "scheduled", "/dashboard/scheduled?postId=ID"],
  ["PUBLISHING", "publishing", "/dashboard/scheduled?postId=ID"],
  ["DRAFT", "draft", "/dashboard/drafts/longform/edit/ID"],
  ["FAILED", "failed", "/dashboard/scheduled"],
  ["CANCELLED", "cancelled", "/dashboard/scheduled"],
  ["ARCHIVED", "published", "/dashboard/published?postId=ID&tab=longform"],
] as const;

describe("performGlobalSearch", () => {
  beforeEach(() => {
    for (const name of LIST_FINDERS) {
      searchData[name].mockReset();
      searchData[name].mockResolvedValue([]);
    }
    searchData.findPostByNostrEventId.mockReset();
    searchData.findPostByNostrEventId.mockResolvedValue(null);
    searchData.findLongFormPostByNostrEventId.mockReset();
    searchData.findLongFormPostByNostrEventId.mockResolvedValue(null);
    payments.getUserSubscription.mockReset();
    payments.getUserSubscription.mockResolvedValue(null);
    searchAction.decodeSearchInput.mockReset();
    searchAction.decodeSearchInput.mockImplementation((value: unknown) => ({
      eventId: typeof value === "string" ? value : "",
      type: "event_id",
    }));
    searchAction.handleSearchEvent.mockReset();
    searchAction.handleSearchEvent.mockRejectedValue(
      new Error("external down")
    );
  });

  it("returns an empty response for an empty or blank query", async () => {
    await expect(performGlobalSearch(USER_ID, "")).resolves.toEqual({
      results: [],
      total: 0,
    });
    await expect(performGlobalSearch(USER_ID, " \n\t ")).resolves.toEqual({
      results: [],
      total: 0,
    });
    expect(searchData.findDraftPosts).not.toHaveBeenCalled();
    expect(payments.getUserSubscription).not.toHaveBeenCalled();
    expect(searchAction.handleSearchEvent).not.toHaveBeenCalled();
  });

  it("returns every local result kind with post and longform fields", async () => {
    installPopulated();

    const response = await performGlobalSearch(USER_ID, "needle");

    expect(response.total).toBe(response.results.length);
    expect(response.results).toEqual([
      {
        caption: "Draft caption",
        content: "Draft content",
        createdAt: CREATED_ISO,
        id: "draft-post",
        isLongform: false,
        status: "DRAFT",
        type: "draft",
        updatedAt: UPDATED_ISO,
        url: "/dashboard/drafts/edit/draft-post",
      },
      {
        content: "Long draft",
        createdAt: CREATED_ISO,
        id: "draft-long",
        isLongform: true,
        status: "DRAFT",
        summary: "Summary",
        title: "",
        type: "draft",
        updatedAt: UPDATED_ISO,
        url: "/dashboard/drafts/longform/edit/draft-long",
      },
      {
        caption: "Scheduled caption",
        content: "Scheduled content",
        createdAt: CREATED_ISO,
        id: "scheduled-post",
        isLongform: false,
        scheduledAt: SCHEDULED_ISO,
        status: "SCHEDULED",
        type: "scheduled",
        url: "/dashboard/scheduled",
      },
      {
        content: "Scheduled long",
        createdAt: CREATED_ISO,
        id: "scheduled-long",
        isLongform: true,
        scheduledAt: SCHEDULED_ISO,
        status: "SCHEDULED",
        summary: "Scheduled summary",
        title: "Scheduled title",
        type: "scheduled",
        url: "/dashboard/scheduled",
      },
      {
        caption: "Publishing caption",
        content: "Publishing content",
        createdAt: CREATED_ISO,
        id: "publishing-post",
        isLongform: false,
        status: "PUBLISHING",
        type: "publishing",
        updatedAt: UPDATED_ISO,
        url: "/dashboard/scheduled",
      },
      {
        content: "Publishing long",
        createdAt: CREATED_ISO,
        id: "publishing-long",
        isLongform: true,
        status: "PUBLISHING",
        summary: "Publishing summary",
        title: "Publishing title",
        type: "publishing",
        updatedAt: UPDATED_ISO,
        url: "/dashboard/scheduled",
      },
      {
        caption: "Published caption",
        content: "Published content",
        createdAt: CREATED_ISO,
        id: "published-post",
        isLongform: false,
        publishedAt: PUBLISHED_ISO,
        status: "PUBLISHED",
        type: "published",
        url: "/dashboard/published",
      },
      {
        content: "Published long",
        createdAt: CREATED_ISO,
        id: "published-long",
        isLongform: true,
        publishedAt: PUBLISHED_ISO,
        status: "PUBLISHED",
        summary: "Published summary",
        title: "Published title",
        type: "published",
        url: "/dashboard/published",
      },
      {
        caption: "Failed caption",
        content: "Failed content",
        createdAt: CREATED_ISO,
        id: "failed-post",
        isLongform: false,
        status: "FAILED",
        type: "failed",
        updatedAt: UPDATED_ISO,
        url: "/dashboard/scheduled",
      },
      {
        content: "Failed long",
        createdAt: CREATED_ISO,
        id: "failed-long",
        isLongform: true,
        status: "FAILED",
        summary: "Failed summary",
        title: "Failed title",
        type: "failed",
        updatedAt: UPDATED_ISO,
        url: "/dashboard/scheduled",
      },
      {
        caption: "Cancelled caption",
        content: "Cancelled content",
        createdAt: CREATED_ISO,
        id: "cancelled-post",
        isLongform: false,
        status: "CANCELLED",
        type: "cancelled",
        updatedAt: UPDATED_ISO,
        url: "/dashboard/scheduled",
      },
      {
        content: "Cancelled long",
        createdAt: CREATED_ISO,
        id: "cancelled-long",
        isLongform: true,
        status: "CANCELLED",
        summary: "Cancelled summary",
        title: "Cancelled title",
        type: "cancelled",
        updatedAt: UPDATED_ISO,
        url: "/dashboard/scheduled",
      },
      {
        createdAt: CREATED_ISO,
        id: "template-1",
        status: "template",
        title: "Template name",
        type: "template",
        updatedAt: UPDATED_ISO,
        url: "/dashboard/templates/edit/template-1",
      },
    ]);
    for (const name of LIST_FINDERS) {
      expect(searchData[name]).toHaveBeenCalledWith(USER_ID, "needle", 5);
    }
    expect(payments.getUserSubscription).toHaveBeenCalledWith(USER_ID);
    expect(searchAction.decodeSearchInput).not.toHaveBeenCalled();
    expect(searchData.findPostByNostrEventId).not.toHaveBeenCalled();
  });

  it("maps null text and missing dates to undefined", async () => {
    installNullRows();

    const response = await performGlobalSearch(USER_ID, "needle");
    const draft = response.results.find((item) => item.id === "draft-post");
    const draftLong = response.results.find((item) => item.id === "draft-long");
    const scheduled = response.results.find(
      (item) => item.id === "scheduled-post"
    );
    const scheduledLong = response.results.find(
      (item) => item.id === "scheduled-long"
    );
    const published = response.results.find(
      (item) => item.id === "published-post"
    );
    const publishedLong = response.results.find(
      (item) => item.id === "published-long"
    );
    const template = response.results.find((item) => item.id === "template-1");

    expect(draft).toMatchObject({
      id: "draft-post",
      status: "DRAFT",
      type: "draft",
      url: "/dashboard/drafts/edit/draft-post",
    });
    expect(draft?.caption).toBeUndefined();
    expect(draft?.content).toBeUndefined();
    expect(draftLong?.title).toBeUndefined();
    expect(draftLong?.summary).toBeUndefined();
    expect(draftLong?.content).toBeUndefined();
    expect(draftLong?.isLongform).toBe(true);
    expect(scheduled?.scheduledAt).toBeUndefined();
    expect(scheduled?.caption).toBeUndefined();
    expect(scheduledLong?.scheduledAt).toBeUndefined();
    expect(scheduledLong?.title).toBeUndefined();
    expect(published?.publishedAt).toBeUndefined();
    expect(publishedLong?.publishedAt).toBeUndefined();
    expect(publishedLong?.title).toBeUndefined();
    expect(template).toMatchObject({
      id: "template-1",
      status: "template",
      type: "template",
      url: "/dashboard/templates/edit/template-1",
    });
    expect(template?.title).toBeUndefined();
  });

  it("limits each type after posts are listed ahead of longforms", async () => {
    const post = (id: string) => ({
      caption: id,
      content: id,
      createdAt: CREATED,
      currentState: "DRAFT",
      id,
      updatedAt: UPDATED,
    });
    const longform = (id: string) => ({
      content: id,
      createdAt: CREATED,
      currentState: "DRAFT",
      id,
      summary: id,
      title: id,
      updatedAt: UPDATED,
    });
    searchData.findDraftPosts.mockResolvedValue([
      post("p1"),
      post("p2"),
      post("p3"),
    ]);
    searchData.findDraftLongforms.mockResolvedValue([
      longform("l1"),
      longform("l2"),
      longform("l3"),
    ]);

    const response = await performGlobalSearch(USER_ID, "needle", 2);

    expect(response.results.map((item) => item.id)).toEqual(["p1", "p2"]);
    expect(searchData.findDraftPosts).toHaveBeenCalledWith(
      USER_ID,
      "needle",
      2
    );
    expect(searchData.findDraftLongforms).toHaveBeenCalledWith(
      USER_ID,
      "needle",
      2
    );
  });

  it("uses a per-type limit of 5 when none is passed", async () => {
    await performGlobalSearch(USER_ID, "needle");

    expect(searchData.findPublishedPosts).toHaveBeenCalledWith(
      USER_ID,
      "needle",
      5
    );
    expect(searchData.findTemplatesByQuery).toHaveBeenCalledWith(
      USER_ID,
      "needle",
      5
    );
  });

  it("returns no rows when the per-type limit is zero, but still returns features", async () => {
    useFullSubscription();
    searchData.findDraftPosts.mockResolvedValue([
      {
        caption: "Draft caption",
        content: "Draft content",
        createdAt: CREATED,
        currentState: "DRAFT",
        id: "draft-post",
        updatedAt: UPDATED,
      },
    ]);

    const response = await performGlobalSearch(USER_ID, "drafts", 0);

    expect(response.results.map((item) => item.type)).toEqual(["feature"]);
    expect(response.results[0]).toMatchObject({
      id: "/dashboard/drafts",
      status: "feature",
      title: "Drafts",
      type: "feature",
      url: "/dashboard/drafts",
    });
    expect(searchData.findDraftPosts).toHaveBeenCalledWith(
      USER_ID,
      "drafts",
      0
    );
  });

  it("returns an empty list when nothing matches and the user has no plan", async () => {
    const response = await performGlobalSearch(USER_ID, "zzzz-no-match");

    expect(response).toEqual({ results: [], total: 0 });
    expect(payments.getUserSubscription).toHaveBeenCalledWith(USER_ID);
  });

  it("hides features when the subscription has no plan id", async () => {
    payments.getUserSubscription.mockResolvedValue({
      Plan: { id: "plan-1", name: "Pro" },
      planId: "",
      status: "active",
    });

    const response = await performGlobalSearch(USER_ID, "drafts");

    expect(response.results).toEqual([]);
  });

  it("returns features when the plan id is set and the plan row is missing", async () => {
    payments.getUserSubscription.mockResolvedValue({
      Plan: null,
      planId: "pro",
      status: "active",
    });

    const response = await performGlobalSearch(USER_ID, "drafts");

    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.title).toBe("Drafts");
  });

  it("orders label matches ahead of keyword matches", async () => {
    useFullSubscription();

    const response = await performGlobalSearch(USER_ID, "  schedule  ");

    expect(response.results.map((item) => item.title)).toEqual([
      "Scheduled",
      "Broadcasts",
      "Bulk Posts",
      "Calendar",
    ]);
    expect(response.results[0]).toMatchObject({
      id: "/dashboard/scheduled",
      status: "feature",
      type: "feature",
      url: "/dashboard/scheduled",
    });
    expect(response.results[0]?.createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
    expect(searchData.findDraftPosts).toHaveBeenCalledWith(
      USER_ID,
      "schedule",
      5
    );
    expect(response.total).toBe(4);
  });

  it("returns at most ten features, label matches first", async () => {
    useFullSubscription();

    const response = await performGlobalSearch(USER_ID, "E");

    expect(response.results.map((item) => item.title)).toEqual([
      "Calendar",
      "Composer",
      "Contests",
      "Engagement Feed",
      "Giveaways",
      "Published",
      "Scheduled",
      "Settings",
      "Templates",
      "Broadcasts",
    ]);
    expect(response.results[1]).toMatchObject({
      id: "/dashboard/compose?type=post",
      url: "/dashboard/compose?type=post",
    });
    expect(searchData.findScheduledPosts).toHaveBeenCalledWith(USER_ID, "E", 5);
  });

  it("puts the priority context immediately after features", async () => {
    useFullSubscription();
    installPopulated();

    const draftFirst = await performGlobalSearch(USER_ID, "drafts", 5, "draft");
    const scheduledFirst = await performGlobalSearch(
      USER_ID,
      "drafts",
      5,
      "scheduled"
    );
    const publishedFirst = await performGlobalSearch(
      USER_ID,
      "drafts",
      5,
      "published"
    );
    const templateFirst = await performGlobalSearch(
      USER_ID,
      "drafts",
      5,
      "template"
    );
    const ignored = await performGlobalSearch(
      USER_ID,
      "drafts",
      5,
      "publishing"
    );

    expect(resultKeys(draftFirst.results)).toEqual(withPriority("draft"));
    expect(resultKeys(scheduledFirst.results)).toEqual(
      withPriority("scheduled")
    );
    expect(resultKeys(publishedFirst.results)).toEqual(
      withPriority("published")
    );
    expect(resultKeys(templateFirst.results)).toEqual(withPriority("template"));
    expect(resultKeys(ignored.results)).toEqual([
      "feature:/dashboard/drafts",
      ...CONTENT_KEYS,
    ]);
  });

  it("keeps the default order for a null priority", async () => {
    useFullSubscription();
    installPopulated();

    const response = await performGlobalSearch(USER_ID, "drafts", 5, null);

    expect(resultKeys(response.results)).toEqual([
      "feature:/dashboard/drafts",
      ...CONTENT_KEYS,
    ]);
  });

  it.each(OWN_POST_CASES)(
    "maps an own %s post found by event id",
    async (state, type, urlTemplate) => {
      const row = ownPost(state);
      searchData.findPostByNostrEventId.mockResolvedValue(row);

      const response = await performGlobalSearch(USER_ID, EVENT_HEX);

      expect(response.results).toEqual([
        {
          caption: "cap",
          content: "body",
          createdAt: CREATED_ISO,
          id: row.id,
          isLongform: false,
          publishedAt: PUBLISHED_ISO,
          scheduledAt: SCHEDULED_ISO,
          status: state,
          type,
          updatedAt: UPDATED_ISO,
          url: urlTemplate.replace("ID", row.id),
        },
      ]);
      expect(searchData.findPostByNostrEventId).toHaveBeenCalledWith(
        USER_ID,
        EVENT_HEX
      );
      expect(searchData.findLongFormPostByNostrEventId).toHaveBeenCalledWith(
        USER_ID,
        EVENT_HEX
      );
      expect(searchAction.handleSearchEvent).toHaveBeenCalledWith(EVENT_HEX);
    }
  );

  it.each(OWN_LONGFORM_CASES)(
    "maps an own %s longform found by event id",
    async (state, type, urlTemplate) => {
      const row = ownLongform(state);
      searchData.findLongFormPostByNostrEventId.mockResolvedValue(row);

      const response = await performGlobalSearch(USER_ID, EVENT_HEX);

      expect(response.results).toEqual([
        {
          content: "Body",
          createdAt: CREATED_ISO,
          id: row.id,
          isLongform: true,
          publishedAt: PUBLISHED_ISO,
          scheduledAt: SCHEDULED_ISO,
          status: state,
          summary: "Sum",
          title: "Title",
          type,
          updatedAt: UPDATED_ISO,
          url: urlTemplate.replace("ID", row.id),
        },
      ]);
    }
  );

  it("maps null fields on an own post and longform", async () => {
    searchData.findPostByNostrEventId.mockResolvedValue({
      caption: null,
      content: null,
      createdAt: CREATED,
      currentState: "PUBLISHED",
      id: "post-1",
      publishedAt: null,
      scheduledAtUtc: null,
      updatedAt: UPDATED,
    });
    searchData.findLongFormPostByNostrEventId.mockResolvedValue({
      content: null,
      createdAt: CREATED,
      currentState: "DRAFT",
      id: "long-1",
      publishedAt: null,
      scheduledAtUtc: null,
      summary: null,
      title: null,
      updatedAt: UPDATED,
    });

    const response = await performGlobalSearch(USER_ID, EVENT_HEX);
    const post = response.results.find((item) => item.id === "post-1");
    const longform = response.results.find((item) => item.id === "long-1");

    expect(post).toMatchObject({
      isLongform: false,
      type: "published",
      url: "/dashboard/published?postId=post-1",
    });
    expect(post?.caption).toBeUndefined();
    expect(post?.content).toBeUndefined();
    expect(post?.publishedAt).toBeUndefined();
    expect(post?.scheduledAt).toBeUndefined();
    expect(longform).toMatchObject({
      isLongform: true,
      type: "draft",
      url: "/dashboard/drafts/longform/edit/long-1",
    });
    expect(longform?.title).toBeUndefined();
    expect(longform?.summary).toBeUndefined();
    expect(longform?.publishedAt).toBeUndefined();
    expect(longform?.scheduledAt).toBeUndefined();
  });

  it("appends an external event after local results", async () => {
    installPopulated();
    searchAction.handleSearchEvent.mockResolvedValue({
      event: {
        content: "outside",
        created_at: 1_700_000_000,
        id: "external-1",
      },
    });

    const response = await performGlobalSearch(
      USER_ID,
      EVENT_HEX,
      5,
      "template"
    );

    expect(resultKeys(response.results)).toEqual([
      ...CONTENT_KEYS.filter((item) => item.startsWith("template:")),
      ...CONTENT_KEYS.filter((item) => !item.startsWith("template:")),
      "external:external-1",
    ]);
    expect(response.results.at(-1)).toEqual({
      content: "outside",
      createdAt: new Date(1_700_000_000 * 1000).toISOString(),
      id: "external-1",
      status: "external",
      type: "external",
      url: `/dashboard/search/posts?q=${encodeURIComponent(EVENT_HEX)}`,
    });
    expect(searchAction.handleSearchEvent).toHaveBeenCalledWith(EVENT_HEX);
    expect(searchData.findDraftPosts).toHaveBeenCalledWith(
      USER_ID,
      EVENT_HEX,
      5
    );
  });

  it("places own notes ahead of the external event", async () => {
    searchData.findPostByNostrEventId.mockResolvedValue(ownPost("PUBLISHED"));
    searchData.findLongFormPostByNostrEventId.mockResolvedValue(
      ownLongform("DRAFT")
    );
    searchAction.handleSearchEvent.mockResolvedValue({
      event: {
        content: "outside",
        created_at: 10,
        id: "external-1",
      },
    });

    const response = await performGlobalSearch(USER_ID, EVENT_HEX);

    expect(resultKeys(response.results)).toEqual([
      "published:post-PUBLISHED",
      "draft:long-DRAFT",
      "external:external-1",
    ]);
  });

  it("keeps local results when external lookup fails", async () => {
    searchData.findDraftPosts.mockResolvedValue([
      {
        caption: "Draft caption",
        content: "Draft content",
        createdAt: CREATED,
        currentState: "DRAFT",
        id: "draft-post",
        updatedAt: UPDATED,
      },
    ]);
    searchAction.decodeSearchInput.mockImplementation(() => {
      throw new Error("Invalid nevent1 format");
    });

    const response = await performGlobalSearch(USER_ID, EVENT_HEX);

    expect(response.results.map((item) => item.type)).toEqual(["draft"]);
    expect(searchData.findPostByNostrEventId).not.toHaveBeenCalled();
    expect(searchAction.handleSearchEvent).toHaveBeenCalledWith(EVENT_HEX);
  });

  it("skips the own-post lookup when decode does not return an event id", async () => {
    searchAction.decodeSearchInput.mockReturnValue({
      identifier: "slug",
      kind: 30023,
      pubkey: "pk",
      type: "naddr",
    });
    searchAction.handleSearchEvent.mockResolvedValue({
      event: { content: "article", created_at: 10, id: "external-1" },
    });
    const naddr = "naddr1qqqqqqqqqqqqqqqqqq";

    const response = await performGlobalSearch(USER_ID, naddr);

    expect(searchData.findPostByNostrEventId).not.toHaveBeenCalled();
    expect(searchData.findLongFormPostByNostrEventId).not.toHaveBeenCalled();
    expect(searchAction.handleSearchEvent).toHaveBeenCalledWith(naddr);
    expect(response.results.map((item) => item.type)).toEqual(["external"]);
  });

  it("decodes an identifier embedded in a url before the own-post lookup", async () => {
    const note = "note1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
    const raw = `look https://primal.net/e/${note} please`;
    searchAction.decodeSearchInput.mockReturnValue({
      eventId: EVENT_HEX,
      type: "event_id",
    });

    await performGlobalSearch(USER_ID, raw);

    expect(searchAction.decodeSearchInput).toHaveBeenCalledWith(note);
    expect(searchAction.handleSearchEvent).toHaveBeenCalledWith(note);
    expect(searchData.findPostByNostrEventId).toHaveBeenCalledWith(
      USER_ID,
      EVENT_HEX
    );
    expect(searchData.findDraftPosts).toHaveBeenCalledWith(USER_ID, raw, 5);
  });

  it("rejects when a content query throws", async () => {
    searchData.findCancelledPosts.mockRejectedValue(new Error("db down"));

    await expect(performGlobalSearch(USER_ID, "needle")).rejects.toThrow(
      "db down"
    );
  });

  it("rejects when the subscription lookup throws", async () => {
    payments.getUserSubscription.mockRejectedValue(new Error("billing down"));

    await expect(performGlobalSearch(USER_ID, "needle")).rejects.toThrow(
      "billing down"
    );
  });

  it("rejects when the own-post lookup throws", async () => {
    searchData.findPostByNostrEventId.mockRejectedValue(new Error("db down"));

    await expect(performGlobalSearch(USER_ID, EVENT_HEX)).rejects.toThrow(
      "db down"
    );
  });
});
