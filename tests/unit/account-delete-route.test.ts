import { RouterContextProvider } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_DELETE_CONFIRMATION,
  ACCOUNT_DELETE_RELAY_ACK,
} from "~/features/user/account-data.constants";
import { action } from "~/routes/dashboard.account.delete";

const mocks = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  logout: vi.fn(),
  plan: vi.fn(),
  deleteAccount: vi.fn(),
  process: vi.fn(),
}));

vi.mock("~/lib/csrf.server", () => ({
  withCSRFProtection: (fn: (args: ActionFunctionArgs) => Promise<unknown>) =>
    fn,
}));

vi.mock("~/lib/error-logger.server", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("~/features/auth/auth.server", () => ({
  requireUserId: (...args: unknown[]) => mocks.requireUserId(...args),
  logout: (...args: unknown[]) => mocks.logout(...args),
}));

vi.mock("~/features/user/data/account-object-cleanup.server", () => ({
  planUnsharedOwnedObjects: (...args: unknown[]) => mocks.plan(...args),
  processDueOwnedObjectDeletions: (...args: unknown[]) =>
    mocks.process(...args),
}));

vi.mock("~/features/user/data/account-data.server", () => ({
  deletionRequestIsConfirmed: (input: {
    confirm: string | null;
    acknowledgeRelays: string | null;
  }) =>
    input.confirm === ACCOUNT_DELETE_CONFIRMATION &&
    input.acknowledgeRelays === ACCOUNT_DELETE_RELAY_ACK,
  deleteAccountData: (...args: unknown[]) => mocks.deleteAccount(...args),
}));

const OWNED = "clients/user_1/photo.jpg";

function args(method = "POST"): ActionFunctionArgs {
  const body = new FormData();
  body.set("confirm", ACCOUNT_DELETE_CONFIRMATION);
  body.set("acknowledgeRelays", ACCOUNT_DELETE_RELAY_ACK);
  return {
    request: new Request("http://localhost/dashboard/account/delete", {
      method,
      body,
    }),
    params: {},
    context: new RouterContextProvider(),
    url: new URL("http://localhost:3000/"),
    pattern: "*",
  };
}

describe("account deletion route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserId.mockResolvedValue("user_1");
    mocks.logout.mockResolvedValue(new Response(null, { status: 302 }));
    mocks.plan.mockResolvedValue({
      deleteKeys: [OWNED],
      skippedShared: [],
      skippedForeign: 0,
      deleted: 0,
      failed: [],
    });
    mocks.deleteAccount.mockResolvedValue(true);
    mocks.process.mockResolvedValue({
      succeeded: 1,
      retrying: 0,
      failed: 0,
      rejected: 0,
    });
  });

  it("queues owned keys before attempting storage deletion", async () => {
    const response = await action(args());

    expect(response.status).toBe(302);
    expect(mocks.deleteAccount).toHaveBeenCalledWith("user_1", {
      ownedObjectKeys: [OWNED],
    });
    expect(mocks.process).toHaveBeenCalledWith({ accountId: "user_1" });
    expect(mocks.deleteAccount.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.process.mock.invocationCallOrder[0] ?? 0
    );
  });

  it("does not delete the account when media inspection fails", async () => {
    mocks.plan.mockRejectedValue(new Error("database unavailable"));

    const response = await action(args());

    expect(response.status).toBe(500);
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it("leaves the account in place when the deletion transaction fails", async () => {
    mocks.deleteAccount.mockRejectedValue(new Error("db down"));

    const response = await action(args());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Could not delete the account. Nothing was removed.",
    });
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it("still signs the user out when storage deletion must be retried", async () => {
    mocks.process.mockResolvedValue({
      succeeded: 0,
      retrying: 1,
      failed: 0,
      rejected: 0,
    });

    const response = await action(args());

    expect(response.status).toBe(302);
    expect(mocks.deleteAccount).toHaveBeenCalledOnce();
  });
});
