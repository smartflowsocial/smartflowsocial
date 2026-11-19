import { beforeEach, describe, expect, it, vi } from "vitest";

const postsApi = vi.hoisted(() => ({
  getPostById: vi.fn(),
}));

const searchData = vi.hoisted(() => ({
  findPostByNostrEventId: vi.fn(),
}));

vi.mock("~/features/posts/server", () => postsApi);
vi.mock(
  "~/features/search/repositories/global-search-data.server",
  () => searchData
);

import { loadScheduleSourcePostForUserEvent } from "~/features/search/services/search-schedule-source.server";

const EVENT_ID = "ab".repeat(32);
const USER_ID = "user-1";

const signedEvent = {
  content: "signed",
  created_at: 10,
  id: "event-id",
  kind: 1,
  pubkey: EVENT_ID,
  sig: "sig",
  tags: [] as string[][],
};

const nostrEvent = {
  content: "note",
  created_at: 10,
  kind: 1,
  tags: [["t", "tag"]] as string[][],
};

describe("loadScheduleSourcePostForUserEvent", () => {
  beforeEach(() => {
    postsApi.getPostById.mockReset();
    searchData.findPostByNostrEventId.mockReset();
  });

  it("maps the user's post, queue, and signed event", async () => {
    searchData.findPostByNostrEventId.mockResolvedValue({ id: "post-1" });
    postsApi.getPostById.mockResolvedValue({
      caption: "Hello",
      currentState: "PUBLISHED",
      id: "post-1",
      nostrEvent,
      queueType: {
        colorToken: "blue",
        description: "daily",
        id: "queue-1",
        isEnabled: true,
        name: "Morning",
        scheduleConfig: null,
        scheduleType: "INTERVAL",
        status: "active",
        userId: USER_ID,
      },
      signedEvent,
      userId: USER_ID,
    });

    const result = await loadScheduleSourcePostForUserEvent(USER_ID, EVENT_ID);

    expect(searchData.findPostByNostrEventId).toHaveBeenCalledWith(
      USER_ID,
      EVENT_ID
    );
    expect(postsApi.getPostById).toHaveBeenCalledWith({
      id: "post-1",
      userId: USER_ID,
    });
    expect(result).toMatchObject({
      caption: "Hello",
      id: "post-1",
      nostrEvent: { content: "note", kind: 1 },
      queueType: {
        color: "#3F6FD8",
        colorToken: "blue",
        id: "queue-1",
        name: "Morning",
        status: "active",
        userId: USER_ID,
      },
      signedEvent: { id: "event-id", sig: "sig" },
      userId: USER_ID,
    });
  });

  it("returns null when no row matches the event id", async () => {
    searchData.findPostByNostrEventId.mockResolvedValue(null);

    await expect(
      loadScheduleSourcePostForUserEvent(USER_ID, EVENT_ID)
    ).resolves.toBeNull();
    expect(postsApi.getPostById).not.toHaveBeenCalled();
  });

  it("returns null when the full post cannot be loaded", async () => {
    searchData.findPostByNostrEventId.mockResolvedValue({ id: "post-1" });
    postsApi.getPostById.mockResolvedValue(null);

    await expect(
      loadScheduleSourcePostForUserEvent(USER_ID, EVENT_ID)
    ).resolves.toBeNull();
    expect(postsApi.getPostById).toHaveBeenCalledWith({
      id: "post-1",
      userId: USER_ID,
    });
  });

  it("returns null for a missing event id and still queries a blank-looking id", async () => {
    await expect(
      loadScheduleSourcePostForUserEvent(USER_ID, undefined)
    ).resolves.toBeNull();
    await expect(
      loadScheduleSourcePostForUserEvent(USER_ID, "")
    ).resolves.toBeNull();
    expect(searchData.findPostByNostrEventId).not.toHaveBeenCalled();

    searchData.findPostByNostrEventId.mockResolvedValue(null);
    await expect(
      loadScheduleSourcePostForUserEvent(USER_ID, "   ")
    ).resolves.toBeNull();
    expect(searchData.findPostByNostrEventId).toHaveBeenCalledWith(
      USER_ID,
      "   "
    );
  });

  it("drops a missing queue and non-object event payloads", async () => {
    searchData.findPostByNostrEventId.mockResolvedValue({ id: "post-1" });
    postsApi.getPostById.mockResolvedValue({
      caption: "Hello",
      id: "post-1",
      nostrEvent: 1,
      queueType: null,
      signedEvent: "raw",
      userId: USER_ID,
    });

    const result = await loadScheduleSourcePostForUserEvent(USER_ID, EVENT_ID);

    expect(result).toMatchObject({
      caption: "Hello",
      id: "post-1",
      nostrEvent: null,
      signedEvent: null,
    });
    expect(result?.queueType).toBeUndefined();
  });

  it("rejects when the event lookup throws", async () => {
    searchData.findPostByNostrEventId.mockRejectedValue(new Error("db down"));

    await expect(
      loadScheduleSourcePostForUserEvent(USER_ID, EVENT_ID)
    ).rejects.toThrow("db down");
    expect(postsApi.getPostById).not.toHaveBeenCalled();
  });

  it("rejects when loading the post throws", async () => {
    searchData.findPostByNostrEventId.mockResolvedValue({ id: "post-1" });
    postsApi.getPostById.mockRejectedValue(new Error("post down"));

    await expect(
      loadScheduleSourcePostForUserEvent(USER_ID, EVENT_ID)
    ).rejects.toThrow("post down");
  });
});
