import { beforeEach, describe, expect, it, vi } from "vitest";

interface BasicUser {
  npub: string | null;
  isChild: boolean;
  parentNpub: string | null;
}

interface SubscriptionRow {
  planId?: string | null;
  Plan?: { name?: string | null } | null;
}

interface ChildRow {
  npub: string;
  nostrProfile: unknown;
}

interface ProfileParams {
  npub: string;
  primalFetchBudgetMs?: number;
}

interface ProfileResult {
  nostrProfile: unknown;
}

interface LogContext {
  [key: string]: unknown;
}

const profile = vi.hoisted(() => ({
  budgetMs: 5000,
  getCompleteProfile:
    vi.fn<(params: ProfileParams) => Promise<ProfileResult>>(),
}));

const payments = vi.hoisted(() => ({
  getUserSubscription:
    vi.fn<(userId: string) => Promise<SubscriptionRow | null>>(),
}));

const access = vi.hoisted(() => ({
  multiAccountAccess: vi.fn<(accountsIncluded: number) => boolean>(),
}));

const users = vi.hoisted(() => ({
  createUser:
    vi.fn<(npub: string, nostrProfile: string) => Promise<{ id: string }>>(),
  getConfirmedChildrenForParent: vi.fn<(npub: string) => Promise<ChildRow[]>>(),
  getUserBasicInfo: vi.fn<(userId: string) => Promise<BasicUser | null>>(),
}));

const logs = vi.hoisted(() => ({
  logError: vi.fn<(error: Error, context?: LogContext) => void>(),
}));

vi.mock("~/features/auth/profile.server", () => ({
  LOGIN_FLOW_PRIMAL_FETCH_BUDGET_MS: profile.budgetMs,
  getCompleteProfile: profile.getCompleteProfile,
}));
vi.mock("~/features/payments/data", () => payments);
vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => access
);
vi.mock("~/features/user", () => users);
vi.mock("~/lib/error-logger.server", () => logs);

import { getCanonicalPlanPolicy } from "~/features/payments/plan-policy";
import {
  handleChildrenApiError,
  loadChildrenData,
} from "~/features/user/services/children-api.server";
import { AppError } from "~/lib/errors";

const PARENT = "11".repeat(32);

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

async function readResponse(
  response: Response
): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: parseJson(await response.text()) };
}

function loggedError(index = 0): {
  error: Error;
  context: LogContext | undefined;
} {
  const call = logs.logError.mock.calls[index];
  if (!call) throw new Error("expected logError");
  return { error: call[0], context: call[1] };
}

function parentUser(overrides: Partial<BasicUser> = {}): BasicUser {
  return {
    npub: PARENT,
    isChild: false,
    parentNpub: null,
    ...overrides,
  };
}

describe("children API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    users.getUserBasicInfo.mockResolvedValue(parentUser());
    payments.getUserSubscription.mockResolvedValue({
      planId: "creator",
      Plan: { name: "Creator" },
    });
    access.multiAccountAccess.mockReturnValue(true);
    users.getConfirmedChildrenForParent.mockResolvedValue([]);
    users.createUser.mockResolvedValue({ id: "created" });
    profile.getCompleteProfile.mockResolvedValue({ nostrProfile: null });
  });

  describe("loadChildrenData", () => {
    it("returns no children when the user or npub is missing", async () => {
      users.getUserBasicInfo.mockResolvedValueOnce(null);
      await expect(
        readResponse(await loadChildrenData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: { children: [] },
      });

      users.getUserBasicInfo.mockResolvedValueOnce(parentUser({ npub: null }));
      await expect(
        readResponse(await loadChildrenData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: { children: [] },
      });
      expect(payments.getUserSubscription).not.toHaveBeenCalled();
      expect(users.getConfirmedChildrenForParent).not.toHaveBeenCalled();
    });

    it("returns no children for a linked child account", async () => {
      users.getUserBasicInfo.mockResolvedValue(
        parentUser({ isChild: true, parentNpub: PARENT })
      );

      await expect(
        readResponse(await loadChildrenData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: { children: [] },
      });
      expect(payments.getUserSubscription).not.toHaveBeenCalled();
    });

    it("logs an invalid plan id and still uses the free policy", async () => {
      payments.getUserSubscription.mockResolvedValue({
        planId: "nope",
        Plan: { name: "Creator" },
      });

      await expect(
        readResponse(await loadChildrenData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: { children: [] },
      });
      const logged = loggedError();
      expect(logged.error).toBeInstanceOf(Error);
      expect(logged.error.message).toBe(
        "Invalid subscription plan for children access"
      );
      expect(logged.context).toEqual({
        userId: "user-1",
        planId: "nope",
        planName: "creator",
      });
      expect(access.multiAccountAccess).toHaveBeenCalledWith(
        getCanonicalPlanPolicy("free").accountsIncluded
      );
      expect(users.getConfirmedChildrenForParent).toHaveBeenCalledWith(PARENT);
    });

    it("logs an invalid plan name when the plan id is empty", async () => {
      payments.getUserSubscription.mockResolvedValue({
        planId: "",
        Plan: { name: "Weird Plan" },
      });

      await loadChildrenData("user-1");
      expect(loggedError().context).toEqual({
        userId: "user-1",
        planId: null,
        planName: "weird plan",
      });
    });

    it("does not log a missing subscription or a known plan", async () => {
      payments.getUserSubscription.mockResolvedValueOnce(null);
      await loadChildrenData("user-1");

      payments.getUserSubscription.mockResolvedValueOnce({
        planId: "CREATOR",
        Plan: { name: "Ignored" },
      });
      await loadChildrenData("user-1");

      payments.getUserSubscription.mockResolvedValueOnce({
        planId: "",
        Plan: { name: "Creator" },
      });
      await loadChildrenData("user-1");

      expect(logs.logError).not.toHaveBeenCalled();
      expect(access.multiAccountAccess).toHaveBeenNthCalledWith(
        1,
        getCanonicalPlanPolicy("free").accountsIncluded
      );
      expect(access.multiAccountAccess).toHaveBeenNthCalledWith(
        2,
        getCanonicalPlanPolicy("creator").accountsIncluded
      );
      expect(access.multiAccountAccess).toHaveBeenNthCalledWith(
        3,
        getCanonicalPlanPolicy("creator").accountsIncluded
      );
    });

    it("returns no children when the plan cannot link accounts", async () => {
      access.multiAccountAccess.mockReturnValue(false);

      await expect(
        readResponse(await loadChildrenData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: { children: [] },
      });
      expect(access.multiAccountAccess).toHaveBeenCalledWith(
        getCanonicalPlanPolicy("creator").accountsIncluded
      );
      expect(users.getConfirmedChildrenForParent).not.toHaveBeenCalled();
    });

    it("refreshes non-empty profiles and keeps the latest fields", async () => {
      const ada = {
        name: "Ada",
        display_name: "Ada L",
        picture: "https://ada",
      };
      const pictureOnly = {
        picture: "https://pic",
        name: "",
        display_name: "",
      };
      const nameOnly = { name: "Only" };
      const displayOnly = { display_name: "Shown" };
      const jsonProfile =
        '{"name":"Json","display_name":"Jay","picture":"https://j"}';
      const fresh: Record<string, unknown> = {
        "child-ada": ada,
        "child-pic": pictureOnly,
        "child-name": nameOnly,
        "child-display": displayOnly,
        "child-json": jsonProfile,
      };
      users.getConfirmedChildrenForParent.mockResolvedValue([
        { npub: "child-ada", nostrProfile: null },
        { npub: "child-pic", nostrProfile: null },
        { npub: "child-name", nostrProfile: null },
        { npub: "child-display", nostrProfile: null },
        { npub: "child-json", nostrProfile: null },
      ]);
      profile.getCompleteProfile.mockImplementation((params) =>
        Promise.resolve({ nostrProfile: fresh[params.npub] })
      );

      await expect(
        readResponse(await loadChildrenData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: {
          children: [
            {
              npub: "child-ada",
              name: "Ada",
              displayName: "Ada L",
              picture: "https://ada",
            },
            {
              npub: "child-pic",
              name: "",
              displayName: "",
              picture: "https://pic",
            },
            { npub: "child-name", name: "Only" },
            { npub: "child-display", displayName: "Shown" },
            {
              npub: "child-json",
              name: "Json",
              displayName: "Jay",
              picture: "https://j",
            },
          ],
        },
      });
      expect(profile.getCompleteProfile).toHaveBeenNthCalledWith(1, {
        npub: "child-ada",
        primalFetchBudgetMs: profile.budgetMs,
      });
      expect(users.createUser).toHaveBeenCalledTimes(5);
      expect(users.createUser).toHaveBeenNthCalledWith(
        1,
        "child-ada",
        JSON.stringify(ada)
      );
      expect(users.createUser).toHaveBeenNthCalledWith(
        5,
        "child-json",
        JSON.stringify(jsonProfile)
      );
      expect(users.getConfirmedChildrenForParent).toHaveBeenCalledWith(PARENT);
    });

    it("keeps the stored profile when the fresh profile is blank", async () => {
      const stored = {
        name: "Kept",
        display_name: "K",
        picture: "https://k",
      };
      users.getConfirmedChildrenForParent.mockResolvedValue([
        { npub: "child-keep", nostrProfile: stored },
      ]);
      profile.getCompleteProfile.mockResolvedValue({
        nostrProfile: { name: " ", picture: "", display_name: null },
      });

      await expect(
        readResponse(await loadChildrenData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: {
          children: [
            {
              npub: "child-keep",
              name: "Kept",
              displayName: "K",
              picture: "https://k",
            },
          ],
        },
      });
      expect(users.createUser).not.toHaveBeenCalled();
    });

    it("logs a thrown Error or string and keeps the stored profile", async () => {
      users.getConfirmedChildrenForParent.mockResolvedValue([
        { npub: "child-error", nostrProfile: { name: "Err" } },
        { npub: "child-string-error", nostrProfile: { name: "Str" } },
      ]);
      profile.getCompleteProfile.mockImplementation((params) => {
        if (params.npub === "child-error") {
          return Promise.reject(new Error("refresh failed"));
        }
        if (params.npub === "child-string-error") {
          return Promise.reject("refresh string");
        }
        return Promise.resolve({ nostrProfile: null });
      });

      await expect(
        readResponse(await loadChildrenData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: {
          children: [
            { npub: "child-error", name: "Err" },
            { npub: "child-string-error", name: "Str" },
          ],
        },
      });
      const errorLog = loggedError(0);
      const stringLog = loggedError(1);
      expect(errorLog.error).toBeInstanceOf(AppError);
      expect(errorLog.error.message).toBe("refresh failed");
      expect(errorLog.context).toEqual({
        message: "Failed to refresh child nostr profile",
        npub: "child-error",
      });
      expect(stringLog.error).toBeInstanceOf(AppError);
      expect(stringLog.error.message).toBe("An unexpected error occurred");
      if (stringLog.error instanceof AppError) {
        expect(stringLog.error.code).toBe("UNKNOWN_ERROR");
        expect(stringLog.error.context).toEqual({
          originalError: "refresh string",
        });
      }
      expect(stringLog.context).toEqual({
        message: "Failed to refresh child nostr profile",
        npub: "child-string-error",
      });
      expect(users.createUser).not.toHaveBeenCalled();
    });

    it("returns empty bits for invalid, array, and non-object stored profiles", async () => {
      users.getConfirmedChildrenForParent.mockResolvedValue([
        { npub: "child-bad", nostrProfile: "{" },
        { npub: "child-array", nostrProfile: ["x"] },
        { npub: "child-number", nostrProfile: 4 },
      ]);
      profile.getCompleteProfile.mockResolvedValue({ nostrProfile: {} });

      await expect(
        readResponse(await loadChildrenData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: {
          children: [
            { npub: "child-bad" },
            { npub: "child-array" },
            { npub: "child-number" },
          ],
        },
      });
      expect(users.createUser).not.toHaveBeenCalled();
      expect(profile.getCompleteProfile).toHaveBeenCalledTimes(3);
    });

    it("propagates lookup failures", async () => {
      users.getUserBasicInfo.mockRejectedValueOnce(new Error("user down"));
      await expect(loadChildrenData("user-1")).rejects.toThrow("user down");

      users.getUserBasicInfo.mockResolvedValue(parentUser());
      payments.getUserSubscription.mockRejectedValueOnce("subscription down");
      await expect(loadChildrenData("user-1")).rejects.toBe(
        "subscription down"
      );
    });
  });

  describe("handleChildrenApiError", () => {
    it("rethrows a Response and logs other failures as an empty list", async () => {
      const response = new Response(null, { status: 302 });
      let thrown: unknown;
      try {
        handleChildrenApiError(response, "/children");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(response);
      expect(logs.logError).not.toHaveBeenCalled();

      await expect(
        readResponse(handleChildrenApiError(new Error("boom"), "/children"))
      ).resolves.toEqual({ status: 200, body: { children: [] } });
      expect(loggedError().error).toBeInstanceOf(AppError);
      expect(loggedError().error.message).toBe("boom");
      expect(loggedError().context).toEqual({ path: "/children" });

      await expect(
        readResponse(handleChildrenApiError("plain", "/children"))
      ).resolves.toEqual({ status: 200, body: { children: [] } });
      const stringLog = loggedError(1);
      expect(stringLog.error).toBeInstanceOf(AppError);
      expect(stringLog.error.message).toBe("An unexpected error occurred");
      if (stringLog.error instanceof AppError) {
        expect(stringLog.error.context).toEqual({ originalError: "plain" });
      }
      expect(stringLog.context).toEqual({ path: "/children" });
    });
  });
});
