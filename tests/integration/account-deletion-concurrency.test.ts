/**
 * Account deletion and upload finalization against Postgres.
 * Requires the disposable test database from tests/setup.ts.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createMedia,
  createMediaAsset,
  createMediaVariant,
} from "~/features/upload/repositories/media-data.server";
import {
  AccountDeletionInProgressError,
  StorageCleanupUnavailableError,
} from "~/features/user/account-object-cleanup";
import { deleteAccountData } from "~/features/user/data/account-data.server";
import {
  enqueueOwnedObjectDeletions,
  processDueOwnedObjectDeletions,
} from "~/features/user/data/account-object-cleanup.server";
import { lockAccountForWrite } from "~/features/user/data/account-write-lock.server";
import { prisma } from "~/lib/prisma.server";
import { explicitTestDatabaseUrl } from "~/lib/test-database-target";

const TEST_DATABASE_URL = explicitTestDatabaseUrl(process.env);
const SHOULD_SKIP_DB_TESTS = process.env["SKIP_DATABASE_TESTS"] === "true";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function delay(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

function ownedUrl(userId: string): string {
  return `https://cdn.example/clients/${userId}/photo.jpg`;
}

function ownedKey(userId: string): string {
  return `clients/${userId}/photo.jpg`;
}

describe.skipIf(!TEST_DATABASE_URL || SHOULD_SKIP_DB_TESTS)(
  "account deletion concurrency",
  () => {
    const userIds: string[] = [];

    afterEach(async () => {
      if (userIds.length === 0) return;
      const ids = userIds.splice(0);
      await prisma.ownedObjectDeletion.deleteMany({
        where: { accountId: { in: ids } },
      });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    });

    async function createUser() {
      const user = await prisma.user.create({
        data: {
          npub: `deletion-${crypto.randomUUID()}`,
          isEnabled: true,
        },
      });
      userIds.push(user.id);
      return user;
    }

    it("keeps the upload out of the database when deletion holds the user lock", async () => {
      const user = await createUser();
      const release = deferred();
      const locked = deferred();
      const deletion = prisma.$transaction(
        async (tx) => {
          await lockAccountForWrite(tx, user.id);
          await tx.user.update({
            where: { id: user.id },
            data: { deletionStartedAt: new Date() },
          });
          locked.resolve();
          await release.promise;
          await tx.user.delete({ where: { id: user.id } });
        },
        { timeout: 20_000 }
      );

      try {
        await locked.promise;
        let settled = false;
        const upload = createMedia({
          userId: user.id,
          url: ownedUrl(user.id),
          provider: "S3",
        }).then(
          (row) => {
            settled = true;
            return row;
          },
          (error: unknown) => {
            settled = true;
            throw error;
          }
        );
        await delay(200);
        expect(settled).toBe(false);
        release.resolve();
        await deletion;
        await expect(upload).rejects.toBeInstanceOf(
          AccountDeletionInProgressError
        );
      } finally {
        release.resolve();
      }

      expect(await prisma.media.count({ where: { userId: user.id } })).toBe(0);
      const outbox = await prisma.ownedObjectDeletion.findMany({
        where: { accountId: user.id },
      });
      expect(outbox.map((row) => row.objectKey)).toEqual([ownedKey(user.id)]);
    });

    it("waits for an upload lock before deleting the account", async () => {
      const user = await createUser();
      const release = deferred();
      let locked = false;
      const upload = prisma.$transaction(
        async (tx) => {
          await lockAccountForWrite(tx, user.id);
          locked = true;
          await release.promise;
          return tx.media.create({
            data: {
              userId: user.id,
              url: ownedUrl(user.id),
              provider: "S3",
            },
          });
        },
        { timeout: 20_000 }
      );

      try {
        await delay(50);
        expect(locked).toBe(true);
        const deletion = deleteAccountData(user.id);
        await delay(200);
        const during = await prisma.user.findUnique({
          where: { id: user.id },
          select: { deletionStartedAt: true },
        });
        expect(during?.deletionStartedAt).toBeNull();
        release.resolve();
        await upload;
        expect(await deletion).toBe(true);
      } finally {
        release.resolve();
      }

      expect(await prisma.media.count({ where: { userId: user.id } })).toBe(0);
      const outbox = await prisma.ownedObjectDeletion.findMany({
        where: { accountId: user.id },
      });
      expect(outbox.map((row) => row.objectKey)).toContain(ownedKey(user.id));
    });

    it("rejects a media asset created while deletion holds the lock", async () => {
      const user = await createUser();
      const release = deferred();
      const locked = deferred();
      const deletion = prisma.$transaction(
        async (tx) => {
          await lockAccountForWrite(tx, user.id);
          locked.resolve();
          await release.promise;
          await tx.user.delete({ where: { id: user.id } });
        },
        { timeout: 20_000 }
      );
      try {
        await locked.promise;
        const asset = createMediaAsset({
          userId: user.id,
          status: "uploaded",
          sourceMimeType: "image/jpeg",
          sourceBytes: 12,
          sha256: null,
          sourceProvider: "S3",
        });
        await delay(200);
        release.resolve();
        await deletion;
        await expect(asset).rejects.toBeInstanceOf(
          AccountDeletionInProgressError
        );
      } finally {
        release.resolve();
      }
      expect(
        await prisma.mediaAsset.count({ where: { userId: user.id } })
      ).toBe(0);
    });

    it("records a variant whose parent account is already gone", async () => {
      const user = await createUser();
      const asset = await createMediaAsset({
        userId: user.id,
        status: "uploaded",
        sourceMimeType: "image/jpeg",
        sourceBytes: 12,
        sha256: "a".repeat(64),
        sourceProvider: "S3",
      });
      expect(await deleteAccountData(user.id)).toBe(true);
      await expect(
        createMediaVariant({
          assetId: asset.id,
          variantKind: "original",
          url: ownedUrl(user.id),
          provider: "S3",
          isPrimary: true,
          status: "pending",
        })
      ).rejects.toBeInstanceOf(AccountDeletionInProgressError);
      const outbox = await prisma.ownedObjectDeletion.findMany({
        where: { accountId: user.id },
      });
      expect(outbox.map((row) => row.objectKey)).toEqual([ownedKey(user.id)]);
    });

    it("rolls back a deletion that fails before commit", async () => {
      const user = await createUser();
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: { deletionStartedAt: new Date() },
          });
          await enqueueOwnedObjectDeletions(tx, user.id, [ownedKey(user.id)]);
          throw new Error("process interrupted");
        })
      ).rejects.toThrow(/process interrupted/);

      const fresh = await prisma.user.findUnique({
        where: { id: user.id },
        select: { deletionStartedAt: true },
      });
      expect(fresh?.deletionStartedAt).toBeNull();
      expect(
        await prisma.ownedObjectDeletion.count({
          where: { accountId: user.id },
        })
      ).toBe(0);
      const media = await createMedia({
        userId: user.id,
        url: ownedUrl(user.id),
        provider: "S3",
      });
      expect(media.id).toEqual(expect.any(String));
    });

    it("retries an owned object after the deletion process stops", async () => {
      const user = await createUser();
      await prisma.media.create({
        data: {
          userId: user.id,
          url: ownedUrl(user.id),
          provider: "S3",
        },
      });
      expect(await deleteAccountData(user.id)).toBe(true);
      const deleted: string[] = [];
      const failed = await processDueOwnedObjectDeletions({
        accountId: user.id,
        deleter: () => Promise.reject(new Error("storage down")),
      });
      expect(failed.retrying).toBe(1);
      expect(
        await prisma.ownedObjectDeletion.count({
          where: { accountId: user.id, status: "PENDING" },
        })
      ).toBe(1);

      const recovered = await processDueOwnedObjectDeletions({
        accountId: user.id,
        now: new Date(Date.now() + 60 * 60 * 1000),
        deleter: async (objectKey) => {
          deleted.push(objectKey);
        },
      });
      expect(recovered.succeeded).toBe(1);
      expect(deleted).toEqual([ownedKey(user.id)]);
      expect(
        await prisma.ownedObjectDeletion.count({
          where: { accountId: user.id },
        })
      ).toBe(0);
    });

    it("does not queue an object another account still references", async () => {
      const owner = await createUser();
      const other = await createUser();
      const url = ownedUrl(owner.id);
      await prisma.media.create({
        data: { userId: owner.id, url, provider: "S3" },
      });
      await prisma.media.create({
        data: { userId: other.id, url, provider: "S3" },
      });
      expect(await deleteAccountData(owner.id)).toBe(true);
      expect(
        await prisma.ownedObjectDeletion.count({
          where: { accountId: owner.id },
        })
      ).toBe(0);
      expect(
        await prisma.media.count({ where: { userId: other.id, url } })
      ).toBe(1);
    });

    it("keeps one outbox row when deletion is requested twice", async () => {
      const user = await createUser();
      await prisma.media.create({
        data: {
          userId: user.id,
          url: ownedUrl(user.id),
          provider: "S3",
        },
      });
      expect(await deleteAccountData(user.id)).toBe(true);
      expect(await deleteAccountData(user.id)).toBe(false);
      expect(
        await prisma.ownedObjectDeletion.count({
          where: { accountId: user.id, objectKey: ownedKey(user.id) },
        })
      ).toBe(1);
    });

    it("keeps the account when owned storage cannot be identified", async () => {
      const user = await createUser();
      await prisma.media.create({
        data: {
          userId: user.id,
          url: "https://bucket.s3.us-east-1.amazonaws.com/not-an-owned-key",
          provider: "S3",
        },
      });
      await expect(deleteAccountData(user.id)).rejects.toBeInstanceOf(
        StorageCleanupUnavailableError
      );
      const fresh = await prisma.user.findUnique({
        where: { id: user.id },
        select: { deletionStartedAt: true },
      });
      expect(fresh?.deletionStartedAt).toBeNull();
      expect(
        await prisma.ownedObjectDeletion.count({
          where: { accountId: user.id },
        })
      ).toBe(0);
    });
  }
);
