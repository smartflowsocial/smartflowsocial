import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  userExists: true,
  deletionStartedAt: null as Date | null,
  createdMedia: 0,
  createdVariants: 0,
  remembered: [] as string[],
  statements: [] as string[],
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        $queryRaw: async (query: TemplateStringsArray) => {
          state.statements.push(Array.isArray(query) ? query.join(" ") : "");
          if (!state.userExists) return [];
          return [{ deletionStartedAt: state.deletionStartedAt }];
        },
        media: {
          create: async () => {
            state.createdMedia += 1;
            return { id: "media_1" };
          },
        },
        mediaAsset: {
          findUnique: async () =>
            state.userExists ? { userId: "user_1" } : null,
          create: async () => ({ id: "asset_1" }),
        },
        mediaVariant: {
          create: async () => {
            state.createdVariants += 1;
            return { id: "variant_1" };
          },
        },
      }),
  },
}));

vi.mock("~/features/user/data/account-object-cleanup.server", () => ({
  rememberRejectedOwnedObject: async (_userId: string, url: string) => {
    state.remembered.push(url);
  },
}));

import {
  createMedia,
  createMediaVariant,
} from "~/features/upload/repositories/media-data.server";
import { AccountDeletionInProgressError } from "~/features/user/account-object-cleanup";

const URL = "https://cdn.example/clients/user_1/photo.jpg";

describe("media finalization during account deletion", () => {
  beforeEach(() => {
    state.userExists = true;
    state.deletionStartedAt = null;
    state.createdMedia = 0;
    state.createdVariants = 0;
    state.remembered = [];
    state.statements = [];
  });

  it("locks the account before inserting media", async () => {
    await expect(
      createMedia({ userId: "user_1", url: URL, provider: "S3" })
    ).resolves.toEqual({ id: "media_1" });

    expect(state.statements[0]).toContain("FOR UPDATE");
    expect(state.createdMedia).toBe(1);
    expect(state.remembered).toEqual([]);
  });

  it("records the object when finalization loses to account deletion", async () => {
    state.deletionStartedAt = new Date();

    await expect(
      createMedia({ userId: "user_1", url: URL, provider: "S3" })
    ).rejects.toBeInstanceOf(AccountDeletionInProgressError);

    expect(state.createdMedia).toBe(0);
    expect(state.remembered).toEqual([URL]);
  });

  it("records a variant whose asset disappeared with the account", async () => {
    state.userExists = false;

    await expect(
      createMediaVariant({
        assetId: "asset_1",
        variantKind: "original",
        url: URL,
        provider: "S3",
        isPrimary: true,
        status: "pending",
      })
    ).rejects.toBeInstanceOf(AccountDeletionInProgressError);

    expect(state.createdVariants).toBe(0);
    expect(state.remembered).toEqual([URL]);
  });
});
