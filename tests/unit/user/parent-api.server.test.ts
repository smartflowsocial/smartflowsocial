import { beforeEach, describe, expect, it, vi } from "vitest";

interface BasicUser {
  npub: string | null;
  isChild: boolean;
  parentNpub: string | null;
}

interface ParentRow {
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

const users = vi.hoisted(() => ({
  createUser:
    vi.fn<(npub: string, nostrProfile: string) => Promise<{ id: string }>>(),
  getUserBasicInfo: vi.fn<(userId: string) => Promise<BasicUser | null>>(),
  getUserByNpubWithProfile:
    vi.fn<(npub: string) => Promise<ParentRow | null>>(),
}));

const logs = vi.hoisted(() => ({
  logError: vi.fn<(error: Error, context?: LogContext) => void>(),
}));

vi.mock("~/features/auth/profile.server", () => ({
  LOGIN_FLOW_PRIMAL_FETCH_BUDGET_MS: profile.budgetMs,
  getCompleteProfile: profile.getCompleteProfile,
}));
vi.mock("~/features/user", () => users);
vi.mock("~/lib/error-logger.server", () => logs);

import {
  handleParentApiError,
  loadParentData,
} from "~/features/user/services/parent-api.server";
import { AppError } from "~/lib/errors";

const CHILD = "22".repeat(32);
const PARENT = "11".repeat(32);

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

async function readResponse(
  response: Response
): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: parseJson(await response.text()) };
}

function childUser(overrides: Partial<BasicUser> = {}): BasicUser {
  return {
    npub: CHILD,
    isChild: true,
    parentNpub: PARENT,
    ...overrides,
  };
}

function loggedError(): { error: Error; context: LogContext | undefined } {
  const call = logs.logError.mock.calls[0];
  if (!call) throw new Error("expected logError");
  return { error: call[0], context: call[1] };
}

describe("parent API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    users.getUserBasicInfo.mockResolvedValue(childUser());
    users.getUserByNpubWithProfile.mockResolvedValue({
      npub: PARENT,
      nostrProfile: {
        name: "Pat",
        display_name: "Pat N",
        picture: "https://pat",
      },
    });
    users.createUser.mockResolvedValue({ id: "created" });
    profile.getCompleteProfile.mockResolvedValue({ nostrProfile: null });
  });

  describe("loadParentData", () => {
    it("returns null unless the account is a child with a parent", async () => {
      users.getUserBasicInfo.mockResolvedValueOnce(null);
      await expect(
        readResponse(await loadParentData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: { parent: null },
      });

      users.getUserBasicInfo.mockResolvedValueOnce(
        childUser({ isChild: false })
      );
      await expect(
        readResponse(await loadParentData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: { parent: null },
      });

      users.getUserBasicInfo.mockResolvedValueOnce(
        childUser({ parentNpub: null })
      );
      await expect(
        readResponse(await loadParentData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: { parent: null },
      });

      users.getUserBasicInfo.mockResolvedValueOnce(
        childUser({ parentNpub: "" })
      );
      await expect(
        readResponse(await loadParentData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: { parent: null },
      });
      expect(users.getUserByNpubWithProfile).not.toHaveBeenCalled();
    });

    it("returns null when the parent row is missing", async () => {
      users.getUserByNpubWithProfile.mockResolvedValue(null);

      await expect(
        readResponse(await loadParentData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: { parent: null },
      });
      expect(users.getUserByNpubWithProfile).toHaveBeenCalledWith(PARENT);
      expect(profile.getCompleteProfile).not.toHaveBeenCalled();
    });

    it("uses a stored object profile and drops non-string fields", async () => {
      users.getUserByNpubWithProfile.mockResolvedValue({
        npub: PARENT,
        nostrProfile: {
          name: 1,
          display_name: "Dee",
          picture: "https://p",
        },
      });

      await expect(
        readResponse(await loadParentData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: {
          parent: {
            npub: PARENT,
            displayName: "Dee",
            picture: "https://p",
          },
        },
      });
      expect(profile.getCompleteProfile).not.toHaveBeenCalled();
      expect(users.createUser).not.toHaveBeenCalled();
    });

    it("parses a stored JSON profile without refreshing it", async () => {
      users.getUserByNpubWithProfile.mockResolvedValue({
        npub: PARENT,
        nostrProfile:
          '{"name":"Ada","display_name":12,"picture":"https://pic"}',
      });

      await expect(
        readResponse(await loadParentData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: {
          parent: {
            npub: PARENT,
            name: "Ada",
            picture: "https://pic",
          },
        },
      });
      expect(profile.getCompleteProfile).not.toHaveBeenCalled();
    });

    it("stores a fresh profile when the saved one is empty", async () => {
      const fresh = {
        name: "Sam",
        display_name: "Sam",
        picture: "https://s",
      };
      users.getUserByNpubWithProfile.mockResolvedValue({
        npub: PARENT,
        nostrProfile: {},
      });
      profile.getCompleteProfile.mockResolvedValue({ nostrProfile: fresh });

      await expect(
        readResponse(await loadParentData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: {
          parent: {
            npub: PARENT,
            name: "Sam",
            displayName: "Sam",
            picture: "https://s",
          },
        },
      });
      expect(profile.getCompleteProfile).toHaveBeenCalledWith({
        npub: PARENT,
        primalFetchBudgetMs: profile.budgetMs,
      });
      expect(users.createUser).toHaveBeenCalledWith(
        PARENT,
        JSON.stringify(fresh)
      );
    });

    it("parses a fresh JSON string and ignores non-string fields", async () => {
      const fresh = '{"name":1,"display_name":"Sam","picture":false}';
      users.getUserByNpubWithProfile.mockResolvedValue({
        npub: PARENT,
        nostrProfile: null,
      });
      profile.getCompleteProfile.mockResolvedValue({ nostrProfile: fresh });

      await expect(
        readResponse(await loadParentData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: {
          parent: {
            npub: PARENT,
            displayName: "Sam",
          },
        },
      });
      expect(users.createUser).toHaveBeenCalledWith(
        PARENT,
        JSON.stringify(fresh)
      );
    });

    it("keeps an empty fresh profile and still reads the stored value", async () => {
      users.getUserByNpubWithProfile.mockResolvedValue({
        npub: PARENT,
        nostrProfile: { name: "   " },
      });
      profile.getCompleteProfile.mockResolvedValue({
        nostrProfile: { name: " ", picture: null, display_name: "" },
      });

      await expect(
        readResponse(await loadParentData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: { parent: { npub: PARENT, name: "   " } },
      });
      expect(users.createUser).not.toHaveBeenCalled();
    });

    it("treats blank JSON, arrays, and scalars as empty profiles", async () => {
      for (const nostrProfile of ["[]", "null", "42", "{", ["x"], 4]) {
        users.getUserByNpubWithProfile.mockResolvedValue({
          npub: PARENT,
          nostrProfile,
        });
        profile.getCompleteProfile.mockResolvedValue({ nostrProfile: {} });
        users.createUser.mockClear();

        await expect(
          readResponse(await loadParentData("user-1"))
        ).resolves.toEqual({
          status: 200,
          body: { parent: { npub: PARENT } },
        });
        expect(users.createUser).not.toHaveBeenCalled();
      }
      expect(profile.getCompleteProfile).toHaveBeenCalledTimes(6);
    });

    it("logs a thrown Error or string and keeps the stored profile", async () => {
      users.getUserByNpubWithProfile.mockResolvedValue({
        npub: PARENT,
        nostrProfile: "{",
      });
      profile.getCompleteProfile.mockRejectedValueOnce(
        new Error("refresh failed")
      );

      await expect(
        readResponse(await loadParentData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: { parent: { npub: PARENT } },
      });
      expect(loggedError().error).toBeInstanceOf(AppError);
      expect(loggedError().error.message).toBe("refresh failed");
      expect(loggedError().context).toEqual({
        message: "Failed to refresh parent nostr profile",
        npub: PARENT,
      });

      profile.getCompleteProfile.mockRejectedValueOnce("refresh string");
      await expect(
        readResponse(await loadParentData("user-1"))
      ).resolves.toEqual({
        status: 200,
        body: { parent: { npub: PARENT } },
      });
      const stringLog = logs.logError.mock.calls[1];
      if (!stringLog) throw new Error("expected string log");
      expect(stringLog[0]).toBeInstanceOf(AppError);
      expect(stringLog[0].message).toBe("An unexpected error occurred");
      if (stringLog[0] instanceof AppError) {
        expect(stringLog[0].code).toBe("UNKNOWN_ERROR");
        expect(stringLog[0].context).toEqual({
          originalError: "refresh string",
        });
      }
      expect(stringLog[1]).toEqual({
        message: "Failed to refresh parent nostr profile",
        npub: PARENT,
      });
      expect(users.createUser).not.toHaveBeenCalled();
    });

    it("propagates lookup failures", async () => {
      users.getUserBasicInfo.mockRejectedValueOnce(new Error("user down"));
      await expect(loadParentData("user-1")).rejects.toThrow("user down");

      users.getUserBasicInfo.mockResolvedValue(childUser());
      users.getUserByNpubWithProfile.mockRejectedValueOnce("parent down");
      await expect(loadParentData("user-1")).rejects.toBe("parent down");
    });
  });

  describe("handleParentApiError", () => {
    it("rethrows a Response and logs other failures as a null parent", async () => {
      const response = new Response(null, { status: 302 });
      let thrown: unknown;
      try {
        handleParentApiError(response, "/parent");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(response);
      expect(logs.logError).not.toHaveBeenCalled();

      await expect(
        readResponse(handleParentApiError(new Error("boom"), "/parent"))
      ).resolves.toEqual({ status: 200, body: { parent: null } });
      expect(loggedError().error.message).toBe("boom");
      expect(loggedError().context).toEqual({ path: "/parent" });

      await expect(
        readResponse(handleParentApiError("plain", "/parent"))
      ).resolves.toEqual({ status: 200, body: { parent: null } });
      const stringLog = logs.logError.mock.calls[1];
      if (!stringLog) throw new Error("expected string log");
      expect(stringLog[0]).toBeInstanceOf(AppError);
      if (stringLog[0] instanceof AppError) {
        expect(stringLog[0].context).toEqual({ originalError: "plain" });
      }
      expect(stringLog[1]).toEqual({ path: "/parent" });
    });
  });
});
