import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  longFormPost: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  post: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  template: {
    findMany: vi.fn(),
  },
}));

vi.mock("~/lib/prisma.server", () => ({ prisma }));

import {
  findCancelledLongforms,
  findCancelledPosts,
  findDraftLongforms,
  findDraftPosts,
  findFailedLongforms,
  findFailedPosts,
  findLongFormPostByNostrEventId,
  findPostByNostrEventId,
  findPublishedLongforms,
  findPublishedPosts,
  findPublishingLongforms,
  findPublishingPosts,
  findScheduledLongforms,
  findScheduledPosts,
  findTemplatesByQuery,
} from "~/features/search/repositories/global-search-data.server";

const POST_TEXT_SELECT = {
  caption: true,
  content: true,
  createdAt: true,
  currentState: true,
  id: true,
  updatedAt: true,
};

const POST_SCHEDULED_SELECT = {
  caption: true,
  content: true,
  createdAt: true,
  currentState: true,
  id: true,
  scheduledAtUtc: true,
};

const POST_PUBLISHED_SELECT = {
  caption: true,
  content: true,
  createdAt: true,
  currentState: true,
  id: true,
  publishedAt: true,
};

const LONGFORM_TEXT_SELECT = {
  content: true,
  createdAt: true,
  currentState: true,
  id: true,
  summary: true,
  title: true,
  updatedAt: true,
};

const LONGFORM_SCHEDULED_SELECT = {
  content: true,
  createdAt: true,
  currentState: true,
  id: true,
  scheduledAtUtc: true,
  summary: true,
  title: true,
};

const LONGFORM_PUBLISHED_SELECT = {
  content: true,
  createdAt: true,
  currentState: true,
  id: true,
  publishedAt: true,
  summary: true,
  title: true,
};

function postArgs(
  userId: string,
  state: string,
  query: string,
  limit: number,
  orderBy: Record<string, "asc" | "desc">,
  select: Record<string, boolean>
) {
  return {
    orderBy,
    select,
    take: limit,
    where: {
      OR: [
        { caption: { contains: query, mode: "insensitive" } },
        { content: { contains: query, mode: "insensitive" } },
      ],
      currentState: state,
      userId,
    },
  };
}

function longformArgs(
  userId: string,
  state: string,
  query: string,
  limit: number,
  orderBy: Record<string, "asc" | "desc">,
  select: Record<string, boolean>
) {
  return {
    orderBy,
    select,
    take: limit,
    where: {
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { content: { contains: query, mode: "insensitive" } },
        { summary: { contains: query, mode: "insensitive" } },
      ],
      currentState: state,
      userId,
    },
  };
}

const postSpecs = [
  {
    args: (userId: string, query: string, limit: number) =>
      postArgs(
        userId,
        "DRAFT",
        query,
        limit,
        { updatedAt: "desc" },
        POST_TEXT_SELECT
      ),
    invoke: findDraftPosts,
    mock: prisma.post.findMany,
    name: "findDraftPosts",
  },
  {
    args: (userId: string, query: string, limit: number) =>
      postArgs(
        userId,
        "SCHEDULED",
        query,
        limit,
        { scheduledAtUtc: "asc" },
        POST_SCHEDULED_SELECT
      ),
    invoke: findScheduledPosts,
    mock: prisma.post.findMany,
    name: "findScheduledPosts",
  },
  {
    args: (userId: string, query: string, limit: number) =>
      postArgs(
        userId,
        "PUBLISHED",
        query,
        limit,
        { publishedAt: "desc" },
        POST_PUBLISHED_SELECT
      ),
    invoke: findPublishedPosts,
    mock: prisma.post.findMany,
    name: "findPublishedPosts",
  },
  {
    args: (userId: string, query: string, limit: number) =>
      postArgs(
        userId,
        "PUBLISHING",
        query,
        limit,
        { updatedAt: "desc" },
        POST_TEXT_SELECT
      ),
    invoke: findPublishingPosts,
    mock: prisma.post.findMany,
    name: "findPublishingPosts",
  },
  {
    args: (userId: string, query: string, limit: number) =>
      postArgs(
        userId,
        "FAILED",
        query,
        limit,
        { updatedAt: "desc" },
        POST_TEXT_SELECT
      ),
    invoke: findFailedPosts,
    mock: prisma.post.findMany,
    name: "findFailedPosts",
  },
  {
    args: (userId: string, query: string, limit: number) =>
      postArgs(
        userId,
        "CANCELLED",
        query,
        limit,
        { updatedAt: "desc" },
        POST_TEXT_SELECT
      ),
    invoke: findCancelledPosts,
    mock: prisma.post.findMany,
    name: "findCancelledPosts",
  },
];

const longformSpecs = [
  {
    args: (userId: string, query: string, limit: number) =>
      longformArgs(
        userId,
        "DRAFT",
        query,
        limit,
        { updatedAt: "desc" },
        LONGFORM_TEXT_SELECT
      ),
    invoke: findDraftLongforms,
    mock: prisma.longFormPost.findMany,
    name: "findDraftLongforms",
  },
  {
    args: (userId: string, query: string, limit: number) =>
      longformArgs(
        userId,
        "SCHEDULED",
        query,
        limit,
        { scheduledAtUtc: "asc" },
        LONGFORM_SCHEDULED_SELECT
      ),
    invoke: findScheduledLongforms,
    mock: prisma.longFormPost.findMany,
    name: "findScheduledLongforms",
  },
  {
    args: (userId: string, query: string, limit: number) =>
      longformArgs(
        userId,
        "PUBLISHED",
        query,
        limit,
        { publishedAt: "desc" },
        LONGFORM_PUBLISHED_SELECT
      ),
    invoke: findPublishedLongforms,
    mock: prisma.longFormPost.findMany,
    name: "findPublishedLongforms",
  },
  {
    args: (userId: string, query: string, limit: number) =>
      longformArgs(
        userId,
        "PUBLISHING",
        query,
        limit,
        { updatedAt: "desc" },
        LONGFORM_TEXT_SELECT
      ),
    invoke: findPublishingLongforms,
    mock: prisma.longFormPost.findMany,
    name: "findPublishingLongforms",
  },
  {
    args: (userId: string, query: string, limit: number) =>
      longformArgs(
        userId,
        "FAILED",
        query,
        limit,
        { updatedAt: "desc" },
        LONGFORM_TEXT_SELECT
      ),
    invoke: findFailedLongforms,
    mock: prisma.longFormPost.findMany,
    name: "findFailedLongforms",
  },
  {
    args: (userId: string, query: string, limit: number) =>
      longformArgs(
        userId,
        "CANCELLED",
        query,
        limit,
        { updatedAt: "desc" },
        LONGFORM_TEXT_SELECT
      ),
    invoke: findCancelledLongforms,
    mock: prisma.longFormPost.findMany,
    name: "findCancelledLongforms",
  },
];

describe("global search data", () => {
  beforeEach(() => {
    prisma.post.findMany.mockReset();
    prisma.post.findFirst.mockReset();
    prisma.longFormPost.findMany.mockReset();
    prisma.longFormPost.findFirst.mockReset();
    prisma.template.findMany.mockReset();
  });

  for (const spec of [...postSpecs, ...longformSpecs]) {
    describe(spec.name, () => {
      it("returns matching rows and queries prisma", async () => {
        const row = { id: `${spec.name}-1` };
        spec.mock.mockResolvedValue([row]);

        await expect(spec.invoke("user-1", "Hello", 4)).resolves.toEqual([row]);
        expect(spec.mock).toHaveBeenCalledTimes(1);
        expect(spec.mock).toHaveBeenCalledWith(spec.args("user-1", "Hello", 4));
      });

      it("returns an empty list", async () => {
        spec.mock.mockResolvedValue([]);

        await expect(spec.invoke("user-1", "Hello", 4)).resolves.toEqual([]);
        expect(spec.mock).toHaveBeenCalledWith(spec.args("user-1", "Hello", 4));
      });

      it("forwards an empty query and a zero limit", async () => {
        spec.mock.mockResolvedValue([]);

        await expect(spec.invoke("", "", 0)).resolves.toEqual([]);
        expect(spec.mock).toHaveBeenCalledWith(spec.args("", "", 0));
      });

      it("rejects when prisma throws", async () => {
        spec.mock.mockRejectedValue(new Error("db down"));

        await expect(spec.invoke("user-1", "Hello", 4)).rejects.toThrow(
          "db down"
        );
      });
    });
  }

  describe("findTemplatesByQuery", () => {
    function templateArgs(userId: string, query: string, limit: number) {
      return {
        orderBy: { updatedAt: "desc" },
        select: {
          createdAt: true,
          id: true,
          name: true,
          updatedAt: true,
        },
        take: limit,
        where: {
          name: { contains: query, mode: "insensitive" },
          userId,
        },
      };
    }

    it("returns matching templates", async () => {
      const row = { id: "template-1", name: "Launch" };
      prisma.template.findMany.mockResolvedValue([row]);

      await expect(
        findTemplatesByQuery("user-1", "Launch", 3)
      ).resolves.toEqual([row]);
      expect(prisma.template.findMany).toHaveBeenCalledWith(
        templateArgs("user-1", "Launch", 3)
      );
    });

    it("returns an empty list", async () => {
      prisma.template.findMany.mockResolvedValue([]);

      await expect(
        findTemplatesByQuery("user-1", "missing", 3)
      ).resolves.toEqual([]);
    });

    it("forwards an empty query and a zero limit", async () => {
      prisma.template.findMany.mockResolvedValue([]);

      await findTemplatesByQuery("", "", 0);
      expect(prisma.template.findMany).toHaveBeenCalledWith(
        templateArgs("", "", 0)
      );
    });

    it("rejects when prisma throws", async () => {
      prisma.template.findMany.mockRejectedValue(new Error("db down"));

      await expect(findTemplatesByQuery("user-1", "Launch", 3)).rejects.toThrow(
        "db down"
      );
    });
  });

  describe("findPostByNostrEventId", () => {
    function postByEventArgs(userId: string, eventIdHex: string) {
      return {
        select: {
          caption: true,
          content: true,
          createdAt: true,
          currentState: true,
          id: true,
          publishedAt: true,
          scheduledAtUtc: true,
          updatedAt: true,
        },
        where: { nostrEventId: eventIdHex, userId },
      };
    }

    it("returns the matching post", async () => {
      const row = { id: "post-1", currentState: "PUBLISHED" };
      prisma.post.findFirst.mockResolvedValue(row);

      await expect(
        findPostByNostrEventId("user-1", "ab".repeat(32))
      ).resolves.toEqual(row);
      expect(prisma.post.findFirst).toHaveBeenCalledWith(
        postByEventArgs("user-1", "ab".repeat(32))
      );
    });

    it("returns null when nothing matches", async () => {
      prisma.post.findFirst.mockResolvedValue(null);

      await expect(
        findPostByNostrEventId("user-1", "ab".repeat(32))
      ).resolves.toBeNull();
    });

    it("forwards an empty user id and event id", async () => {
      prisma.post.findFirst.mockResolvedValue(null);

      await findPostByNostrEventId("", "");
      expect(prisma.post.findFirst).toHaveBeenCalledWith(
        postByEventArgs("", "")
      );
    });

    it("rejects when prisma throws", async () => {
      prisma.post.findFirst.mockRejectedValue(new Error("db down"));

      await expect(
        findPostByNostrEventId("user-1", "ab".repeat(32))
      ).rejects.toThrow("db down");
    });
  });

  describe("findLongFormPostByNostrEventId", () => {
    function longformByEventArgs(userId: string, eventIdHex: string) {
      return {
        select: {
          content: true,
          createdAt: true,
          currentState: true,
          id: true,
          publishedAt: true,
          scheduledAtUtc: true,
          summary: true,
          title: true,
          updatedAt: true,
        },
        where: { nostrEventId: eventIdHex, userId },
      };
    }

    it("returns the matching longform", async () => {
      const row = { id: "long-1", currentState: "DRAFT" };
      prisma.longFormPost.findFirst.mockResolvedValue(row);

      await expect(
        findLongFormPostByNostrEventId("user-1", "cd".repeat(32))
      ).resolves.toEqual(row);
      expect(prisma.longFormPost.findFirst).toHaveBeenCalledWith(
        longformByEventArgs("user-1", "cd".repeat(32))
      );
    });

    it("returns null when nothing matches", async () => {
      prisma.longFormPost.findFirst.mockResolvedValue(null);

      await expect(
        findLongFormPostByNostrEventId("user-1", "cd".repeat(32))
      ).resolves.toBeNull();
    });

    it("forwards an empty user id and event id", async () => {
      prisma.longFormPost.findFirst.mockResolvedValue(null);

      await findLongFormPostByNostrEventId("", "");
      expect(prisma.longFormPost.findFirst).toHaveBeenCalledWith(
        longformByEventArgs("", "")
      );
    });

    it("rejects when prisma throws", async () => {
      prisma.longFormPost.findFirst.mockRejectedValue(new Error("db down"));

      await expect(
        findLongFormPostByNostrEventId("user-1", "cd".repeat(32))
      ).rejects.toThrow("db down");
    });
  });
});
