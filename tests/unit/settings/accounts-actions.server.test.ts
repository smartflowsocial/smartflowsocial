import { beforeEach, describe, expect, it, vi } from "vitest";

interface BasicUser {
  npub: string | null;
  isChild: boolean;
  parentNpub: string | null;
}

interface PlanRow {
  name?: string | null;
}

interface SubscriptionRow {
  planId?: string | null;
  Plan?: PlanRow | null;
}

interface LinkResult {
  ok: boolean;
  reason?: string;
}

interface LogContext {
  [key: string]: unknown;
}

interface ActionBody {
  status: number;
  error?: string;
  success?: boolean;
  results?: unknown;
}

const payments = vi.hoisted(() => ({
  getUserSubscription:
    vi.fn<(userId: string) => Promise<SubscriptionRow | null>>(),
  updateUserSubscription:
    vi.fn<
      (userId: string, planId: string, paymentId: string) => Promise<void>
    >(),
}));

const access = vi.hoisted(() => ({
  multiAccountAccess: vi.fn<(accountsIncluded: number) => boolean>(),
}));

const users = vi.hoisted(() => ({
  cancelChildLinkRequest:
    vi.fn<(parentNpub: string, childNpub: string) => Promise<LinkResult>>(),
  getUserBasicInfo: vi.fn<(userId: string) => Promise<BasicUser | null>>(),
  getUserIdByNpub: vi.fn<(npub: string) => Promise<string | null>>(),
  requestChildLink:
    vi.fn<(parentNpub: string, childNpub: string) => Promise<LinkResult>>(),
  searchUsersByProfileName:
    vi.fn<(query: string, excludeNpub?: string) => Promise<unknown[]>>(),
  unlinkChildByParent:
    vi.fn<(parentNpub: string, childNpub: string) => Promise<LinkResult>>(),
  unlinkParent: vi.fn<(childNpub: string) => Promise<LinkResult>>(),
}));

const dashboard = vi.hoisted(() => ({
  handleDashboardAction:
    vi.fn<
      (formData: FormData, userId: string, npub: string) => Promise<unknown>
    >(),
}));

const logs = vi.hoisted(() => ({
  logWarning: vi.fn<(message: string, context?: LogContext) => void>(),
}));

vi.mock("~/features/payments/data", () => payments);
vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => access
);
vi.mock("~/features/user", () => users);
vi.mock("~/features/user/services/dashboard.server", () => dashboard);
vi.mock("~/lib/error-logger.server", () => logs);

import { getCanonicalPlanPolicy } from "~/features/payments/plan-policy";
import { handleAccountsAction } from "~/features/settings/actions/accounts-actions.server";

const PARENT = "11".repeat(32);
const CHILD = "22".repeat(32);
const NOW = 1_700_000_000_000;

function form(entries: Record<string, string> = {}): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(entries)) body.set(key, value);
  return body;
}

function brokenForm(): FormData {
  const body = new FormData();
  Object.defineProperty(body, "keys", {
    value: () => {
      throw new Error("unreadable form");
    },
  });
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

function parentUser(overrides: Partial<BasicUser> = {}): BasicUser {
  return {
    npub: PARENT,
    isChild: false,
    parentNpub: null,
    ...overrides,
  };
}

async function readAction(result: unknown): Promise<ActionBody> {
  if (result instanceof Response) {
    const payload = parseJson(await result.text());
    return {
      status: result.status,
      ...(isRecord(payload) ? pick(payload) : {}),
    };
  }
  if (
    isRecord(result) &&
    result["type"] === "DataWithResponseInit" &&
    "data" in result
  ) {
    const init = result["init"];
    const status =
      isRecord(init) && typeof init["status"] === "number"
        ? init["status"]
        : 200;
    const payload = result["data"];
    return {
      status,
      ...(isRecord(payload) ? pick(payload) : {}),
    };
  }
  if (isRecord(result)) return { status: 200, ...pick(result) };
  return { status: 0 };
}

function pick(payload: Record<string, unknown>): Omit<ActionBody, "status"> {
  const body: Omit<ActionBody, "status"> = {};
  if (typeof payload["error"] === "string") body.error = payload["error"];
  if (typeof payload["success"] === "boolean") {
    body.success = payload["success"];
  }
  if ("results" in payload) body.results = payload["results"];
  return body;
}

describe("handleAccountsAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    users.getUserBasicInfo.mockResolvedValue(parentUser());
    payments.getUserSubscription.mockResolvedValue({
      planId: "creator",
      Plan: { name: "Creator" },
    });
    access.multiAccountAccess.mockReturnValue(true);
    users.searchUsersByProfileName.mockResolvedValue([]);
    users.requestChildLink.mockResolvedValue({ ok: true });
    users.cancelChildLinkRequest.mockResolvedValue({ ok: true });
    users.unlinkParent.mockResolvedValue({ ok: true });
    users.unlinkChildByParent.mockResolvedValue({ ok: true });
    users.getUserIdByNpub.mockResolvedValue("child-id");
    payments.updateUserSubscription.mockResolvedValue(undefined);
    dashboard.handleDashboardAction.mockResolvedValue({
      success: true,
      handled: true,
    });
  });

  it("returns null for an unknown action and logs only an invalid plan", async () => {
    payments.getUserSubscription.mockResolvedValueOnce({
      planId: "nope",
      Plan: { name: "Creator" },
    });
    await expect(
      handleAccountsAction("user-1", "pause", form())
    ).resolves.toBeNull();
    expect(logs.logWarning).toHaveBeenCalledWith(
      "Invalid subscription plan in accounts action",
      { userId: "user-1", planId: "nope", planName: "Creator" }
    );
    expect(access.multiAccountAccess).toHaveBeenCalledWith(
      getCanonicalPlanPolicy("free").accountsIncluded
    );

    payments.getUserSubscription.mockResolvedValueOnce({
      planId: "",
      Plan: { name: "Weird Plan" },
    });
    await handleAccountsAction("user-1", "pause", form());
    expect(logs.logWarning).toHaveBeenLastCalledWith(
      "Invalid subscription plan in accounts action",
      { userId: "user-1", planId: null, planName: "Weird Plan" }
    );

    payments.getUserSubscription.mockResolvedValueOnce(null);
    await handleAccountsAction("user-1", "pause", form());
    payments.getUserSubscription.mockResolvedValueOnce({
      planId: "CREATOR",
      Plan: { name: "Ignored" },
    });
    await handleAccountsAction("user-1", "pause", form());
    expect(logs.logWarning).toHaveBeenCalledTimes(2);
    expect(access.multiAccountAccess).toHaveBeenLastCalledWith(
      getCanonicalPlanPolicy("creator").accountsIncluded
    );
    expect(users.getUserBasicInfo).toHaveBeenCalledWith("user-1");
    expect(payments.getUserSubscription).toHaveBeenCalledWith("user-1");
  });

  it("blocks linked-account actions when the plan does not include them", async () => {
    access.multiAccountAccess.mockReturnValue(false);
    for (const action of [
      "search_accounts",
      "request_child",
      "cancel_child_request",
      "unlink_child",
    ]) {
      const body = await readAction(
        await handleAccountsAction("user-1", action, form())
      );
      expect(body.status).toBe(403);
      expect(body.error).toBe(
        "Accounts management requires a plan with multi-account access."
      );
    }
    expect(users.searchUsersByProfileName).not.toHaveBeenCalled();
    expect(users.requestChildLink).not.toHaveBeenCalled();
    expect(users.cancelChildLinkRequest).not.toHaveBeenCalled();
    expect(users.unlinkChildByParent).not.toHaveBeenCalled();
  });

  it("still accepts a child response and parent unlink without multi-account access", async () => {
    access.multiAccountAccess.mockReturnValue(false);
    users.getUserBasicInfo.mockResolvedValue(
      parentUser({ npub: CHILD, isChild: true, parentNpub: PARENT })
    );
    const responseForm = form({ parentNpub: PARENT });

    await expect(
      handleAccountsAction("user-1", "respond_child_request", responseForm)
    ).resolves.toEqual({ success: true, handled: true });
    expect(dashboard.handleDashboardAction).toHaveBeenCalledWith(
      responseForm,
      "user-1",
      CHILD
    );

    const now = vi.spyOn(Date, "now").mockReturnValue(NOW);
    try {
      const body = await readAction(
        await handleAccountsAction("user-1", "unlink_parent", form())
      );
      expect(body).toEqual({ status: 200, success: true });
    } finally {
      now.mockRestore();
    }
    expect(users.unlinkParent).toHaveBeenCalledWith(CHILD);
  });

  describe("search_accounts", () => {
    it("returns matches for the signed-in parent", async () => {
      users.searchUsersByProfileName.mockResolvedValue([{ npub: CHILD }]);
      const body = await readAction(
        await handleAccountsAction(
          "user-1",
          "search_accounts",
          form({ q: "alice" })
        )
      );
      expect(body).toEqual({
        status: 200,
        results: [{ npub: CHILD }],
      });
      expect(users.searchUsersByProfileName).toHaveBeenCalledWith(
        "alice",
        PARENT
      );
    });

    it("searches with an empty query and without an npub", async () => {
      await handleAccountsAction("user-1", "search_accounts", form());
      expect(users.searchUsersByProfileName).toHaveBeenCalledWith("", PARENT);

      users.getUserBasicInfo.mockResolvedValueOnce(null);
      await handleAccountsAction(
        "user-1",
        "search_accounts",
        form({ q: "ada" })
      );
      expect(users.searchUsersByProfileName).toHaveBeenLastCalledWith(
        "ada",
        undefined
      );

      users.getUserBasicInfo.mockResolvedValueOnce(parentUser({ npub: null }));
      await handleAccountsAction(
        "user-1",
        "search_accounts",
        form({ q: "ada" })
      );
      expect(users.searchUsersByProfileName).toHaveBeenLastCalledWith(
        "ada",
        undefined
      );
    });

    it("rejects child accounts and unreadable forms", async () => {
      users.getUserBasicInfo.mockResolvedValue(parentUser({ isChild: true }));
      const forbidden = await readAction(
        await handleAccountsAction(
          "user-1",
          "search_accounts",
          form({ q: "a" })
        )
      );
      expect(forbidden).toEqual({
        status: 403,
        error: "Child accounts cannot search or manage child accounts.",
      });

      users.getUserBasicInfo.mockResolvedValue(parentUser());
      const broken = await readAction(
        await handleAccountsAction("user-1", "search_accounts", brokenForm())
      );
      expect(broken).toEqual({ status: 400, error: "Validation failed" });
      expect(users.searchUsersByProfileName).not.toHaveBeenCalled();
    });
  });

  describe("request_child", () => {
    it("links a child for the parent npub", async () => {
      const body = await readAction(
        await handleAccountsAction(
          "user-1",
          "request_child",
          form({ childNpub: CHILD })
        )
      );
      expect(body).toEqual({ status: 200, success: true });
      expect(users.requestChildLink).toHaveBeenCalledWith(PARENT, CHILD);
    });

    it("uses an empty parent npub when the account has none", async () => {
      users.getUserBasicInfo.mockResolvedValue(parentUser({ npub: null }));
      await handleAccountsAction(
        "user-1",
        "request_child",
        form({ childNpub: CHILD })
      );
      expect(users.requestChildLink).toHaveBeenCalledWith("", CHILD);
    });

    it("returns validation, child-account, and link failures", async () => {
      const invalid = await readAction(
        await handleAccountsAction(
          "user-1",
          "request_child",
          form({ childNpub: "abc" })
        )
      );
      expect(invalid.status).toBe(400);
      expect(invalid.error).toBe(
        "childNpub: Invalid hex pubkey format (must be 64 hex characters)"
      );

      const broken = await readAction(
        await handleAccountsAction("user-1", "request_child", brokenForm())
      );
      expect(broken).toEqual({ status: 400, error: "Validation failed" });

      users.getUserBasicInfo.mockResolvedValueOnce(
        parentUser({ isChild: true })
      );
      const forbidden = await readAction(
        await handleAccountsAction(
          "user-1",
          "request_child",
          form({ childNpub: CHILD })
        )
      );
      expect(forbidden).toEqual({
        status: 403,
        error: "Child accounts cannot link child accounts.",
      });

      users.requestChildLink.mockResolvedValueOnce({
        ok: false,
        reason: "Child account not found.",
      });
      const failed = await readAction(
        await handleAccountsAction(
          "user-1",
          "request_child",
          form({ childNpub: CHILD })
        )
      );
      expect(failed).toEqual({
        status: 400,
        error: "Child account not found.",
      });
    });
  });

  describe("cancel_child_request", () => {
    it("cancels a pending request", async () => {
      const body = await readAction(
        await handleAccountsAction(
          "user-1",
          "cancel_child_request",
          form({ childNpub: CHILD })
        )
      );
      expect(body).toEqual({ status: 200, success: true });
      expect(users.cancelChildLinkRequest).toHaveBeenCalledWith(PARENT, CHILD);
    });

    it("uses an empty parent npub when the account has none", async () => {
      users.getUserBasicInfo.mockResolvedValue(null);
      await handleAccountsAction(
        "user-1",
        "cancel_child_request",
        form({ childNpub: CHILD })
      );
      expect(users.cancelChildLinkRequest).toHaveBeenCalledWith("", CHILD);
    });

    it("returns validation, child-account, and cancel failures", async () => {
      const invalid = await readAction(
        await handleAccountsAction(
          "user-1",
          "cancel_child_request",
          form({ childNpub: "abc" })
        )
      );
      expect(invalid.status).toBe(400);
      expect(invalid.error).toContain("childNpub");

      users.getUserBasicInfo.mockResolvedValueOnce(
        parentUser({ isChild: true })
      );
      const forbidden = await readAction(
        await handleAccountsAction(
          "user-1",
          "cancel_child_request",
          form({ childNpub: CHILD })
        )
      );
      expect(forbidden).toEqual({
        status: 403,
        error: "Child accounts cannot manage child requests.",
      });

      users.cancelChildLinkRequest.mockResolvedValueOnce({
        ok: false,
        reason: "No pending request to cancel.",
      });
      const failed = await readAction(
        await handleAccountsAction(
          "user-1",
          "cancel_child_request",
          form({ childNpub: CHILD })
        )
      );
      expect(failed).toEqual({
        status: 400,
        error: "No pending request to cancel.",
      });
    });
  });

  describe("respond_child_request", () => {
    it("requires an npub and otherwise delegates to the dashboard", async () => {
      users.getUserBasicInfo.mockResolvedValueOnce(null);
      const missing = await readAction(
        await handleAccountsAction("user-1", "respond_child_request", form())
      );
      expect(missing).toEqual({ status: 400, error: "User npub not found" });

      users.getUserBasicInfo.mockResolvedValueOnce(parentUser({ npub: "" }));
      const empty = await readAction(
        await handleAccountsAction("user-1", "respond_child_request", form())
      );
      expect(empty).toEqual({ status: 400, error: "User npub not found" });
      expect(dashboard.handleDashboardAction).not.toHaveBeenCalled();

      const responseForm = form({ parentNpub: PARENT });
      await expect(
        handleAccountsAction("user-1", "respond_child_request", responseForm)
      ).resolves.toEqual({ success: true, handled: true });
      expect(dashboard.handleDashboardAction).toHaveBeenCalledWith(
        responseForm,
        "user-1",
        PARENT
      );
    });
  });

  describe("unlink_parent", () => {
    it("rejects an account that is not a child or has no npub", async () => {
      const notChild = await readAction(
        await handleAccountsAction("user-1", "unlink_parent", form())
      );
      expect(notChild).toEqual({
        status: 400,
        error: "This account is not a child account.",
      });

      users.getUserBasicInfo.mockResolvedValueOnce(null);
      const missing = await readAction(
        await handleAccountsAction("user-1", "unlink_parent", form())
      );
      expect(missing).toEqual({
        status: 400,
        error: "This account is not a child account.",
      });

      users.getUserBasicInfo.mockResolvedValueOnce(
        parentUser({ isChild: true, npub: null })
      );
      const noNpub = await readAction(
        await handleAccountsAction("user-1", "unlink_parent", form())
      );
      expect(noNpub).toEqual({ status: 400, error: "User npub not found" });
      expect(users.unlinkParent).not.toHaveBeenCalled();
    });

    it("returns the unlink failure", async () => {
      users.getUserBasicInfo.mockResolvedValue(
        parentUser({ npub: CHILD, isChild: true, parentNpub: PARENT })
      );
      users.unlinkParent.mockResolvedValue({
        ok: false,
        reason: "This account is not linked to a parent.",
      });

      const body = await readAction(
        await handleAccountsAction("user-1", "unlink_parent", form())
      );
      expect(body).toEqual({
        status: 400,
        error: "This account is not linked to a parent.",
      });
      expect(payments.updateUserSubscription).not.toHaveBeenCalled();
    });

    it("demotes the child after a successful unlink", async () => {
      users.getUserBasicInfo.mockResolvedValue(
        parentUser({ npub: CHILD, isChild: true, parentNpub: PARENT })
      );
      const now = vi.spyOn(Date, "now").mockReturnValue(NOW);
      try {
        const body = await readAction(
          await handleAccountsAction("user-1", "unlink_parent", form())
        );
        expect(body).toEqual({ status: 200, success: true });
      } finally {
        now.mockRestore();
      }
      expect(users.unlinkParent).toHaveBeenCalledWith(CHILD);
      expect(payments.updateUserSubscription).toHaveBeenCalledWith(
        "user-1",
        "free",
        `free_child_unlink_${NOW}_user-1`
      );
    });

    it("logs a thrown Error or string and still succeeds", async () => {
      users.getUserBasicInfo.mockResolvedValue(
        parentUser({ npub: CHILD, isChild: true, parentNpub: PARENT })
      );
      payments.updateUserSubscription.mockRejectedValueOnce(
        new Error("plan missing")
      );
      const errorResult = await readAction(
        await handleAccountsAction("user-1", "unlink_parent", form())
      );
      expect(errorResult).toEqual({ status: 200, success: true });
      expect(logs.logWarning).toHaveBeenCalledWith(
        "Failed to demote child to free after unlink",
        { userId: "user-1", error: "plan missing" }
      );

      payments.updateUserSubscription.mockRejectedValueOnce("nope");
      const stringResult = await readAction(
        await handleAccountsAction("user-1", "unlink_parent", form())
      );
      expect(stringResult).toEqual({ status: 200, success: true });
      expect(logs.logWarning).toHaveBeenLastCalledWith(
        "Failed to demote child to free after unlink",
        { userId: "user-1", error: "nope" }
      );
    });
  });

  describe("unlink_child", () => {
    it("rejects invalid input and non-parent accounts", async () => {
      const invalid = await readAction(
        await handleAccountsAction(
          "user-1",
          "unlink_child",
          form({ childNpub: "abc" })
        )
      );
      expect(invalid.status).toBe(400);
      expect(invalid.error).toContain("childNpub");

      const broken = await readAction(
        await handleAccountsAction("user-1", "unlink_child", brokenForm())
      );
      expect(broken).toEqual({ status: 400, error: "Validation failed" });

      users.getUserBasicInfo.mockResolvedValueOnce(parentUser({ npub: null }));
      const noNpub = await readAction(
        await handleAccountsAction(
          "user-1",
          "unlink_child",
          form({ childNpub: CHILD })
        )
      );
      expect(noNpub).toEqual({
        status: 403,
        error: "Only a parent account can unlink a child.",
      });

      users.getUserBasicInfo.mockResolvedValueOnce(
        parentUser({ isChild: true, npub: CHILD })
      );
      const child = await readAction(
        await handleAccountsAction(
          "user-1",
          "unlink_child",
          form({ childNpub: CHILD })
        )
      );
      expect(child).toEqual({
        status: 403,
        error: "Only a parent account can unlink a child.",
      });
      expect(users.unlinkChildByParent).not.toHaveBeenCalled();
    });

    it("returns the unlink failure", async () => {
      users.unlinkChildByParent.mockResolvedValue({
        ok: false,
        reason: "Not authorized to unlink this child.",
      });
      const body = await readAction(
        await handleAccountsAction(
          "user-1",
          "unlink_child",
          form({ childNpub: CHILD })
        )
      );
      expect(body).toEqual({
        status: 400,
        error: "Not authorized to unlink this child.",
      });
      expect(users.getUserIdByNpub).not.toHaveBeenCalled();
    });

    it("demotes the child when the id exists and skips a missing id", async () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(NOW);
      try {
        const body = await readAction(
          await handleAccountsAction(
            "user-1",
            "unlink_child",
            form({ childNpub: CHILD })
          )
        );
        expect(body).toEqual({ status: 200, success: true });
        expect(users.unlinkChildByParent).toHaveBeenCalledWith(PARENT, CHILD);
        expect(users.getUserIdByNpub).toHaveBeenCalledWith(CHILD);
        expect(payments.updateUserSubscription).toHaveBeenCalledWith(
          "child-id",
          "free",
          `free_child_unlink_${NOW}_child-id`
        );

        users.getUserIdByNpub.mockResolvedValueOnce(null);
        await handleAccountsAction(
          "user-1",
          "unlink_child",
          form({ childNpub: CHILD })
        );
        expect(payments.updateUserSubscription).toHaveBeenCalledTimes(1);
      } finally {
        now.mockRestore();
      }
    });

    it("logs a thrown Error or string from demotion and still succeeds", async () => {
      payments.updateUserSubscription.mockRejectedValueOnce(
        new Error("plan missing")
      );
      const errorResult = await readAction(
        await handleAccountsAction(
          "user-1",
          "unlink_child",
          form({ childNpub: CHILD })
        )
      );
      expect(errorResult).toEqual({ status: 200, success: true });
      expect(logs.logWarning).toHaveBeenCalledWith(
        "Failed to demote unlinked child to free",
        { childNpub: CHILD, error: "plan missing" }
      );

      payments.updateUserSubscription.mockRejectedValueOnce("nope");
      const stringResult = await readAction(
        await handleAccountsAction(
          "user-1",
          "unlink_child",
          form({ childNpub: CHILD })
        )
      );
      expect(stringResult).toEqual({ status: 200, success: true });
      expect(logs.logWarning).toHaveBeenLastCalledWith(
        "Failed to demote unlinked child to free",
        { childNpub: CHILD, error: "nope" }
      );
    });
  });

  it("propagates user and subscription lookup failures", async () => {
    users.getUserBasicInfo.mockRejectedValueOnce(new Error("user down"));
    await expect(
      handleAccountsAction("user-1", "search_accounts", form())
    ).rejects.toThrow("user down");

    payments.getUserSubscription.mockRejectedValueOnce("subscription down");
    await expect(
      handleAccountsAction("user-1", "search_accounts", form())
    ).rejects.toBe("subscription down");
  });
});
