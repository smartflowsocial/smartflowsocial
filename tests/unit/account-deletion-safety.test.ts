import { describe, expect, it } from "vitest";

import {
  AccountDeletionInProgressError,
  StorageCleanupUnavailableError,
  accountAcceptsContentWrite,
  planAccountObjectCleanup,
} from "~/features/user/account-object-cleanup";
import { loadUnsharedOwnedObjectKeys } from "~/features/user/data/account-object-cleanup.server";
import { readAccountWriteLock } from "~/features/user/data/account-write-lock.server";

const USER = "user_1";
const OWNED_URL = `https://cdn.example/clients/${USER}/photo.jpg`;
const OWNED_KEY = `clients/${USER}/photo.jpg`;
const SHARED_URL = `https://cdn.example/clients/${USER}/shared.jpg`;
const BLOSSOM_URL = "https://blossom.example/abcdef1234567890abcdef";
const AMBIGUOUS_URL = "https://media.s3.us-east-1.amazonaws.com/opaque-object";

function reader(input: {
  media?: string[];
  variants?: string[];
  shared?: boolean;
  shareCheckFails?: boolean;
}) {
  const fail = () => {
    throw new Error("database unavailable");
  };
  return {
    media: {
      findMany: async () => (input.media ?? []).map((url) => ({ url })),
      findFirst: async () => {
        if (input.shareCheckFails) fail();
        return input.shared ? { id: "other" } : null;
      },
    },
    mediaVariant: {
      findMany: async () => (input.variants ?? []).map((url) => ({ url })),
      findFirst: async () => {
        if (input.shareCheckFails) fail();
        return null;
      },
    },
    post: {
      findFirst: async () => {
        if (input.shareCheckFails) fail();
        return null;
      },
    },
    longFormPost: {
      findFirst: async () => {
        if (input.shareCheckFails) fail();
        return null;
      },
    },
  };
}

describe("owned object planning without storage configuration", () => {
  it("keeps an owned key embedded in the URL", () => {
    const plan = planAccountObjectCleanup({
      userId: USER,
      urls: [OWNED_URL],
      sharedUrls: new Set(),
    });

    expect(plan.storageUnavailable).toBe(false);
    expect(plan.deleteKeys).toEqual([OWNED_KEY]);
  });

  it("does not block an account with no owned objects", () => {
    const plan = planAccountObjectCleanup({
      userId: USER,
      urls: [BLOSSOM_URL],
      sharedUrls: new Set(),
    });

    expect(plan.storageUnavailable).toBe(false);
    expect(plan.deleteKeys).toEqual([]);
    expect(plan.skippedForeign).toBe(1);
  });

  it("fails closed when an object-storage URL cannot be named", () => {
    const plan = planAccountObjectCleanup({
      userId: USER,
      urls: [AMBIGUOUS_URL],
      sharedUrls: new Set(),
    });

    expect(plan.storageUnavailable).toBe(true);
    expect(plan.deleteKeys).toEqual([]);
  });

  it("does not queue a shared or foreign object", () => {
    const plan = planAccountObjectCleanup({
      userId: USER,
      urls: [
        SHARED_URL,
        BLOSSOM_URL,
        "https://cdn.example/clients/user_2/secret.jpg",
      ],
      sharedUrls: new Set([SHARED_URL]),
    });

    expect(plan.deleteKeys).toEqual([]);
    expect(plan.skippedShared).toEqual([`clients/${USER}/shared.jpg`]);
  });
});

describe("loadUnsharedOwnedObjectKeys", () => {
  const missingConfig = { bucket: "", region: "", cdnBase: "" };

  it("returns no keys when the account has no media", async () => {
    const plan = await loadUnsharedOwnedObjectKeys(
      reader({}) as never,
      USER,
      missingConfig
    );
    expect(plan.deleteKeys).toEqual([]);
  });

  it("persists an owned key when storage settings are missing", async () => {
    const plan = await loadUnsharedOwnedObjectKeys(
      reader({ media: [OWNED_URL], variants: [SHARED_URL] }) as never,
      USER,
      missingConfig
    );
    expect(plan.deleteKeys).toEqual([OWNED_KEY, `clients/${USER}/shared.jpg`]);
  });

  it("throws before deletion when an owned object cannot be named", async () => {
    await expect(
      loadUnsharedOwnedObjectKeys(
        reader({ media: [AMBIGUOUS_URL] }) as never,
        USER,
        missingConfig
      )
    ).rejects.toBeInstanceOf(StorageCleanupUnavailableError);
  });

  it("leaves a shared object and a third-party object out of the plan", async () => {
    const plan = await loadUnsharedOwnedObjectKeys(
      reader({
        media: [
          `https://media.s3.us-east-1.amazonaws.com/clients/${USER}/shared.jpg`,
          BLOSSOM_URL,
        ],
        shared: true,
      }) as never,
      USER,
      { bucket: "media", region: "us-east-1" }
    );
    expect(plan.deleteKeys).toEqual([]);
    expect(plan.skippedShared).toEqual([`clients/${USER}/shared.jpg`]);
  });

  it("stops planning when a shared-object check fails", async () => {
    await expect(
      loadUnsharedOwnedObjectKeys(
        reader({ media: [OWNED_URL], shareCheckFails: true }) as never,
        USER,
        missingConfig
      )
    ).rejects.toThrow("database unavailable");
  });
});

describe("account write lock", () => {
  it("asks the database to lock the user row", async () => {
    let sql = "";
    const client = {
      $queryRaw: async (query: TemplateStringsArray) => {
        sql = Array.isArray(query) ? query.join(" ") : "";
        return [{ deletionStartedAt: null }];
      },
    };
    const row = await readAccountWriteLock(
      client as Parameters<typeof readAccountWriteLock>[0],
      USER
    );

    expect(row).toEqual({ deletionStartedAt: null });
    expect(sql).toContain('FROM "User"');
    expect(sql).toContain("FOR UPDATE");
    expect(accountAcceptsContentWrite(row)).toBe(true);
    expect(accountAcceptsContentWrite({ deletionStartedAt: new Date() })).toBe(
      false
    );
    expect(accountAcceptsContentWrite(null)).toBe(false);
  });
});

function createMutex() {
  let tail = Promise.resolve();
  return function exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = tail.then(run, run);
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}

describe("upload finalization racing account deletion", () => {
  function createStore() {
    const exclusive = createMutex();
    const media: string[] = [];
    const outbox: string[] = [];
    const row: { deletionStartedAt: Date | null; deleted: boolean } = {
      deletionStartedAt: null,
      deleted: false,
    };

    function queue(urls: readonly string[]) {
      const plan = planAccountObjectCleanup({
        userId: USER,
        urls,
        sharedUrls: new Set(),
      });
      if (plan.storageUnavailable) {
        throw new StorageCleanupUnavailableError();
      }
      for (const key of plan.deleteKeys) {
        if (!outbox.includes(key)) outbox.push(key);
      }
    }

    return {
      media,
      outbox,
      row,
      upload(url: string, pause?: () => Promise<void>) {
        return exclusive(async () => {
          await pause?.();
          const current = row.deleted
            ? null
            : { deletionStartedAt: row.deletionStartedAt };
          if (!accountAcceptsContentWrite(current)) {
            queue([url]);
            throw new AccountDeletionInProgressError();
          }
          media.push(url);
          return "stored" as const;
        });
      },
      deleteAccount(pause?: () => Promise<void>) {
        return exclusive(async () => {
          await pause?.();
          const current = row.deleted
            ? null
            : { deletionStartedAt: row.deletionStartedAt };
          if (!accountAcceptsContentWrite(current)) return false;
          row.deletionStartedAt = new Date();
          queue(media);
          row.deleted = true;
          media.splice(0, media.length);
          return true;
        });
      },
    };
  }

  it("keeps the object whether the upload or the deletion acquires the lock first", async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const store = createStore();
      const results = await Promise.allSettled([
        store.upload(OWNED_URL),
        store.deleteAccount(),
      ]);

      expect(store.row.deleted).toBe(true);
      expect(store.outbox).toEqual([OWNED_KEY]);
      expect(results).toHaveLength(2);
    }
  });

  it("rejects a finalization that starts after deletion holds the lock", async () => {
    const store = createStore();
    let releaseHold: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let entered: () => void = () => undefined;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const deletion = store.deleteAccount(async () => {
      entered();
      await hold;
    });
    await inside;
    const upload = store.upload(OWNED_URL);
    releaseHold();
    await deletion;

    await expect(upload).rejects.toBeInstanceOf(AccountDeletionInProgressError);
    expect(store.outbox).toEqual([OWNED_KEY]);
    expect(store.media).toEqual([]);
  });

  it("queues an upload that commits before deletion reads the account", async () => {
    const store = createStore();
    let releaseHold: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let entered: () => void = () => undefined;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const upload = store.upload(OWNED_URL, async () => {
      entered();
      await hold;
    });
    await inside;
    const deletion = store.deleteAccount();
    releaseHold();
    await upload;
    await expect(deletion).resolves.toBe(true);

    expect(store.outbox).toEqual([OWNED_KEY]);
  });
});
