import { describe, expect, it } from "vitest";

import {
  classifyOwnedObjectDeletionError,
  isSafeAccountObjectKey,
  ownedAccountObjectKey,
  ownedObjectDeletionBackoffMs,
  ownedObjectDeletionIdempotencyKey,
  OWNED_OBJECT_DELETION_FAILED_AFTER_ATTEMPTS,
  planOwnedObjectDeletion,
  transitionOwnedObjectDeletion,
} from "~/features/user/account-object-cleanup";

const USER = "user_123";
const OTHER = "user_999";
const BUCKET = "smartflow-media";
const REGION = "auto";
const OWNED = `https://${BUCKET}.s3.${REGION}.amazonaws.com/clients/${USER}/photo.jpg`;

describe("account object cleanup", () => {
  it("keeps a key only when it is under that account prefix in this bucket", () => {
    expect(
      ownedAccountObjectKey({
        url: OWNED,
        userId: USER,
        bucket: BUCKET,
        region: REGION,
      })
    ).toBe(`clients/${USER}/photo.jpg`);
    expect(
      ownedAccountObjectKey({
        url: `https://${BUCKET}.s3.${REGION}.amazonaws.com/clients/${OTHER}/photo.jpg`,
        userId: USER,
        bucket: BUCKET,
        region: REGION,
      })
    ).toBeNull();
    expect(
      ownedAccountObjectKey({
        url: `https://blossom.example/sha256`,
        userId: USER,
        bucket: BUCKET,
        region: REGION,
      })
    ).toBeNull();
  });

  it("rejects a path that escapes the account prefix", () => {
    expect(
      ownedAccountObjectKey({
        url: `https://${BUCKET}.s3.${REGION}.amazonaws.com/clients/${USER}/%2e%2e/secret.jpg`,
        userId: USER,
        bucket: BUCKET,
        region: REGION,
      })
    ).toBeNull();
  });

  it("accepts the configured CDN host and refuses a different bucket", () => {
    expect(
      ownedAccountObjectKey({
        url: `https://cdn.example/${`clients/${USER}/photo.jpg`}`,
        userId: USER,
        bucket: BUCKET,
        region: REGION,
        cdnBase: "https://cdn.example",
      })
    ).toBe(`clients/${USER}/photo.jpg`);
    expect(
      ownedAccountObjectKey({
        url: "https://other.s3.auto.amazonaws.com/clients/user_123/photo.jpg",
        userId: USER,
        bucket: BUCKET,
        region: REGION,
      })
    ).toBeNull();
  });

  it("deletes an unshared owned object and keeps a shared or foreign URL", () => {
    const shared = `https://cdn.example/clients/${USER}/shared.jpg`;
    const plan = planOwnedObjectDeletion({
      userId: USER,
      bucket: BUCKET,
      region: REGION,
      cdnBase: "https://cdn.example",
      urls: [OWNED, shared, "https://blossom.example/abcdef1234567890"],
      sharedUrls: new Set([shared]),
    });
    expect(plan.deleteKeys).toEqual([`clients/${USER}/photo.jpg`]);
    expect(plan.skippedShared).toEqual([`clients/${USER}/shared.jpg`]);
    expect(plan.skippedForeign).toBe(1);
  });

  it("rejects a foreign prefix, a short account id escape, and a manipulated key", () => {
    expect(isSafeAccountObjectKey(USER, `clients/${USER}/photo.jpg`)).toBe(
      true
    );
    expect(isSafeAccountObjectKey(USER, `clients/${OTHER}/photo.jpg`)).toBe(
      false
    );
    expect(isSafeAccountObjectKey(USER, `clients/${USER}/../secret.jpg`)).toBe(
      false
    );
    expect(isSafeAccountObjectKey(USER, `clients/${USER}//photo.jpg`)).toBe(
      false
    );
    expect(isSafeAccountObjectKey("bad id", `clients/bad id/photo.jpg`)).toBe(
      false
    );
  });

  it("uses a stable idempotency key and a bounded backoff", () => {
    const key = `clients/${USER}/photo.jpg`;
    expect(ownedObjectDeletionIdempotencyKey(USER, key)).toBe(
      ownedObjectDeletionIdempotencyKey(USER, key)
    );
    expect(ownedObjectDeletionIdempotencyKey(USER, key)).not.toBe(
      ownedObjectDeletionIdempotencyKey(OTHER, key)
    );
    expect(ownedObjectDeletionBackoffMs(1)).toBe(30_000);
    expect(ownedObjectDeletionBackoffMs(20)).toBe(6 * 60 * 60 * 1000);
  });

  it("keeps retrying after the fast-attempt budget and classifies storage errors without their message", () => {
    const now = new Date("2026-11-17T12:00:00.000Z");
    const pending = transitionOwnedObjectDeletion({
      attempts: 0,
      now,
      outcome: "retryable_error",
      errorCode: "NetworkingError",
    });
    expect(pending.status).toBe("PENDING");
    expect(pending.attempts).toBe(1);
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());

    const failed = transitionOwnedObjectDeletion({
      attempts: OWNED_OBJECT_DELETION_FAILED_AFTER_ATTEMPTS - 1,
      now,
      outcome: "retryable_error",
      errorCode: "AccessDenied",
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.completedAt).toBeNull();
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());

    const error = new Error("delete failed for clients/user_123/secret.jpg");
    error.name = "AccessDenied";
    expect(classifyOwnedObjectDeletionError(error)).toBe("AccessDenied");
    expect(classifyOwnedObjectDeletionError(new Error("no name"))).toBe(
      "storage_error"
    );
  });
});
