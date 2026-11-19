import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const query = () => vi.fn<(...args: unknown[]) => Promise<unknown>>();
  return {
    contestCreationDraft: {
      findUnique: query(),
      upsert: query(),
    },
  };
});

vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));

import {
  findContestCreationDraftByUserId,
  upsertContestCreationDraftPayload,
} from "~/features/contest/repositories/contest-creation-draft.server";

describe("contest creation draft repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null when the user has no draft", async () => {
    prismaMock.contestCreationDraft.findUnique.mockResolvedValueOnce(null);
    await expect(
      findContestCreationDraftByUserId("user-1")
    ).resolves.toBeNull();
    expect(prismaMock.contestCreationDraft.findUnique).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
  });

  it("returns the stored draft row", async () => {
    const draft = { userId: "user-1", payload: { step: 2 } };
    prismaMock.contestCreationDraft.findUnique.mockResolvedValueOnce(draft);
    await expect(findContestCreationDraftByUserId("user-1")).resolves.toBe(
      draft
    );
  });

  it("upserts the payload for the user", async () => {
    const payload = { title: "Draft" };
    await upsertContestCreationDraftPayload("user-1", payload);
    expect(prismaMock.contestCreationDraft.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: { userId: "user-1", payload },
      update: { payload },
    });
  });
});
