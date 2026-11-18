import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findMedia: vi.fn(),
  findVariant: vi.fn(),
  findPost: vi.fn(),
  findArticle: vi.fn(),
  createMany: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: {
    media: { findFirst: db.findMedia },
    mediaVariant: { findFirst: db.findVariant },
    post: { findFirst: db.findPost },
    longFormPost: { findFirst: db.findArticle },
    ownedObjectDeletion: { createMany: db.createMany },
  },
}));

vi.mock("~/lib/error-logger.server", () => ({
  logError: db.logError,
  logInfo: vi.fn(),
}));

vi.mock("~/lib/env.server", () => ({
  env: {},
}));

vi.mock("~/features/upload/s3.server", () => ({
  createS3Client: vi.fn(),
}));

import { RejectedUploadCleanupUnrecordedError } from "~/features/user/account-object-cleanup";
import { rememberRejectedOwnedObject } from "~/features/user/data/account-object-cleanup.server";

const USER_ID = "user_1";
const OWNED_URL = "https://cdn.example/clients/user_1/photo.jpg";
const OWNED_KEY = "clients/user_1/photo.jpg";

describe("rejected upload compensation", () => {
  beforeEach(() => {
    db.findMedia.mockReset();
    db.findVariant.mockReset();
    db.findPost.mockReset();
    db.findArticle.mockReset();
    db.createMany.mockReset();
    db.logError.mockReset();
    db.findMedia.mockResolvedValue(null);
    db.findVariant.mockResolvedValue(null);
    db.findPost.mockResolvedValue(null);
    db.findArticle.mockResolvedValue(null);
    db.createMany.mockResolvedValue({ count: 1 });
  });

  it("records an unshared owned object in the outbox", async () => {
    const deleter = vi.fn();
    await rememberRejectedOwnedObject(USER_ID, OWNED_URL, { deleter });
    expect(db.createMany).toHaveBeenCalledOnce();
    expect(deleter).not.toHaveBeenCalled();
  });

  it("deletes immediately when the outbox write fails", async () => {
    db.createMany.mockRejectedValue(new Error("database unavailable"));
    const deleter = vi.fn().mockResolvedValue(undefined);
    await rememberRejectedOwnedObject(USER_ID, OWNED_URL, { deleter });
    expect(deleter).toHaveBeenCalledWith(OWNED_KEY);
  });

  it("throws when the outbox and the immediate delete both fail", async () => {
    db.createMany.mockRejectedValue(new Error("database unavailable"));
    const failure = new Error("super-secret-access-key");
    failure.name = "StorageNotConfigured";
    const deleter = vi.fn().mockRejectedValue(failure);
    await expect(
      rememberRejectedOwnedObject(USER_ID, OWNED_URL, { deleter })
    ).rejects.toBeInstanceOf(RejectedUploadCleanupUnrecordedError);
    expect(deleter).toHaveBeenCalledWith(OWNED_KEY);
    expect(JSON.stringify(db.logError.mock.calls)).not.toContain(
      "super-secret-access-key"
    );
    expect(JSON.stringify(db.logError.mock.calls)).not.toContain("photo.jpg");
  });

  it("does not delete an object another account references", async () => {
    db.findMedia.mockResolvedValue({ id: "shared" });
    const deleter = vi.fn();
    await rememberRejectedOwnedObject(USER_ID, OWNED_URL, { deleter });
    expect(db.createMany).not.toHaveBeenCalled();
    expect(deleter).not.toHaveBeenCalled();
  });

  it("does not delete when the shared-object check fails", async () => {
    db.findMedia.mockRejectedValue(new Error("database unavailable"));
    const deleter = vi.fn();
    await expect(
      rememberRejectedOwnedObject(USER_ID, OWNED_URL, { deleter })
    ).rejects.toBeInstanceOf(RejectedUploadCleanupUnrecordedError);
    expect(deleter).not.toHaveBeenCalled();
    expect(db.createMany).not.toHaveBeenCalled();
  });

  it("leaves a third-party URL alone", async () => {
    await rememberRejectedOwnedObject(
      USER_ID,
      "https://blossom.example/not-our-object"
    );
    expect(db.createMany).not.toHaveBeenCalled();
  });

  it("surfaces an object-storage URL that has no owned key", async () => {
    await expect(
      rememberRejectedOwnedObject(
        USER_ID,
        "https://bucket.s3.us-east-1.amazonaws.com/foreign"
      )
    ).rejects.toBeInstanceOf(RejectedUploadCleanupUnrecordedError);
    expect(db.createMany).not.toHaveBeenCalled();
  });
});
