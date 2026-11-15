import { describe, expect, it } from "vitest";

import {
  ownedAccountObjectKey,
  planOwnedObjectDeletion,
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
});
