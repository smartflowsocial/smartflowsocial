import { beforeEach, describe, expect, it, vi } from "vitest";

interface BasicUser {
  npub: string | null;
  isChild: boolean;
  parentNpub: string | null;
}

interface MutedList {
  npubs: string[];
  lastSynced: string;
}

interface TemplateResult {
  success: boolean;
  error?: string;
}

interface ActionBody {
  status: number;
  error?: string;
  success?: boolean;
  filterMuted?: boolean;
  hidePostsFromLowTrustUsers?: boolean;
  defaultZapAmountSats?: number;
  mutedList?: MutedList;
}

const templates = vi.hoisted(() => ({
  createReplyTemplate:
    vi.fn<
      (userId: string, slug: string, body: string) => Promise<TemplateResult>
    >(),
  deleteReplyTemplate:
    vi.fn<(userId: string, id: string) => Promise<TemplateResult>>(),
  updateReplyTemplate:
    vi.fn<
      (
        userId: string,
        id: string,
        slug: string,
        body: string
      ) => Promise<TemplateResult>
    >(),
}));

const muted = vi.hoisted(() => ({
  fetchMutedList: vi.fn<(npub: string) => Promise<MutedList | null>>(),
}));

const users = vi.hoisted(() => ({
  getUserBasicInfo: vi.fn<(userId: string) => Promise<BasicUser | null>>(),
  updateUserDefaultZapAmountSats:
    vi.fn<(userId: string, amount: number) => Promise<void>>(),
  updateUserFilterMuted:
    vi.fn<(userId: string, filterMuted: boolean) => Promise<void>>(),
  updateUserHideLowTrust:
    vi.fn<(userId: string, hide: boolean) => Promise<void>>(),
  updateUserMutedList:
    vi.fn<(userId: string, mutedList: MutedList) => Promise<void>>(),
}));

vi.mock(
  "~/features/engagement/engagement-reply-templates.server",
  () => templates
);
vi.mock("~/features/engagement/mutedList.server", () => muted);
vi.mock("~/features/user", () => ({
  getUserBasicInfo: users.getUserBasicInfo,
  updateUserDefaultZapAmountSats: users.updateUserDefaultZapAmountSats,
  updateUserFilterMuted: users.updateUserFilterMuted,
  updateUserHidePostsFromLowTrustUsers: users.updateUserHideLowTrust,
  updateUserMutedList: users.updateUserMutedList,
}));

import {
  replyTemplateCreateAction,
  replyTemplateDeleteAction,
  replyTemplateUpdateAction,
  syncMutedListAction,
  toggleFilterMutedAction,
  toggleHideLowTrustAction,
  updateDefaultZapAmountAction,
} from "~/features/settings/actions/engagement-actions-handlers.server";

const PARENT = "11".repeat(32);
const MUTED: MutedList = {
  npubs: ["abc"],
  lastSynced: "2026-01-01T00:00:00.000Z",
};

function form(entries: Record<string, string> = {}): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(entries)) body.set(key, value);
  return body;
}

function formWithFile(key: string): FormData {
  const body = new FormData();
  body.set(key, new File(["x"], `${key}.txt`, { type: "text/plain" }));
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

function isMutedList(value: unknown): value is MutedList {
  if (!isRecord(value) || !Array.isArray(value["npubs"])) return false;
  return (
    value["npubs"].every((npub) => typeof npub === "string") &&
    typeof value["lastSynced"] === "string"
  );
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
  if (typeof payload["filterMuted"] === "boolean") {
    body.filterMuted = payload["filterMuted"];
  }
  if (typeof payload["hidePostsFromLowTrustUsers"] === "boolean") {
    body.hidePostsFromLowTrustUsers = payload["hidePostsFromLowTrustUsers"];
  }
  if (typeof payload["defaultZapAmountSats"] === "number") {
    body.defaultZapAmountSats = payload["defaultZapAmountSats"];
  }
  if (isMutedList(payload["mutedList"])) body.mutedList = payload["mutedList"];
  return body;
}

describe("engagement action handlers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    users.getUserBasicInfo.mockResolvedValue({
      npub: PARENT,
      isChild: false,
      parentNpub: null,
    });
    muted.fetchMutedList.mockResolvedValue(MUTED);
    users.updateUserMutedList.mockResolvedValue(undefined);
    users.updateUserFilterMuted.mockResolvedValue(undefined);
    users.updateUserHideLowTrust.mockResolvedValue(undefined);
    users.updateUserDefaultZapAmountSats.mockResolvedValue(undefined);
    templates.createReplyTemplate.mockResolvedValue({ success: true });
    templates.deleteReplyTemplate.mockResolvedValue({ success: true });
    templates.updateReplyTemplate.mockResolvedValue({ success: true });
  });

  describe("syncMutedListAction", () => {
    it("returns 404 when the user or npub is missing", async () => {
      users.getUserBasicInfo.mockResolvedValueOnce(null);
      const missing = await readAction(await syncMutedListAction("user-1"));
      expect(missing).toEqual({ status: 404, error: "User not found" });

      users.getUserBasicInfo.mockResolvedValueOnce({
        npub: null,
        isChild: false,
        parentNpub: null,
      });
      const noNpub = await readAction(await syncMutedListAction("user-1"));
      expect(noNpub).toEqual({ status: 404, error: "User not found" });
      expect(muted.fetchMutedList).not.toHaveBeenCalled();
    });

    it("returns 500 when Nostr has no muted list", async () => {
      muted.fetchMutedList.mockResolvedValue(null);
      const body = await readAction(await syncMutedListAction("user-1"));
      expect(body).toEqual({
        status: 500,
        error: "Failed to fetch muted list from Nostr",
      });
      expect(muted.fetchMutedList).toHaveBeenCalledWith(PARENT);
      expect(users.updateUserMutedList).not.toHaveBeenCalled();
    });

    it("stores the fetched muted list", async () => {
      const body = await readAction(await syncMutedListAction("user-1"));
      expect(body).toEqual({ status: 200, success: true, mutedList: MUTED });
      expect(users.updateUserMutedList).toHaveBeenCalledWith("user-1", MUTED);
    });

    it("propagates a thrown Error or string", async () => {
      muted.fetchMutedList.mockRejectedValueOnce(new Error("relay down"));
      await expect(syncMutedListAction("user-1")).rejects.toThrow("relay down");
      muted.fetchMutedList.mockRejectedValueOnce("relay down");
      await expect(syncMutedListAction("user-1")).rejects.toBe("relay down");
    });
  });

  describe("toggleFilterMutedAction", () => {
    it("stores false for a string other than the coerced true token", async () => {
      const yes = await readAction(
        await toggleFilterMutedAction("user-1", form({ filterMuted: "yes" }))
      );
      expect(yes).toEqual({ status: 200, success: true, filterMuted: false });
      expect(users.updateUserFilterMuted).toHaveBeenCalledWith("user-1", false);

      const empty = await readAction(
        await toggleFilterMutedAction("user-1", form({ filterMuted: "" }))
      );
      expect(empty).toEqual({ status: 200, success: true, filterMuted: false });
    });

    it("rejects missing, unreadable, and boolean-coerced values", async () => {
      const missing = await readAction(
        await toggleFilterMutedAction("user-1", form())
      );
      expect(missing.status).toBe(400);
      expect(missing.error).toContain("filterMuted");

      const broken = await readAction(
        await toggleFilterMutedAction("user-1", brokenForm())
      );
      expect(broken).toEqual({ status: 400, error: "Validation failed" });

      const coerced = await readAction(
        await toggleFilterMutedAction("user-1", form({ filterMuted: "true" }))
      );
      expect(coerced.status).toBe(400);
      expect(users.updateUserFilterMuted).not.toHaveBeenCalled();

      const off = await readAction(
        await toggleFilterMutedAction("user-1", form({ filterMuted: "false" }))
      );
      expect(off.status).toBe(400);
    });
  });

  describe("toggleHideLowTrustAction", () => {
    it("stores false for a non-true string and rejects coerced booleans", async () => {
      const yes = await readAction(
        await toggleHideLowTrustAction(
          "user-1",
          form({ hidePostsFromLowTrustUsers: "yes" })
        )
      );
      expect(yes).toEqual({
        status: 200,
        success: true,
        hidePostsFromLowTrustUsers: false,
      });
      expect(users.updateUserHideLowTrust).toHaveBeenCalledWith(
        "user-1",
        false
      );

      const missing = await readAction(
        await toggleHideLowTrustAction("user-1", form())
      );
      expect(missing.status).toBe(400);
      expect(missing.error).toContain("hidePostsFromLowTrustUsers");

      const coerced = await readAction(
        await toggleHideLowTrustAction(
          "user-1",
          form({ hidePostsFromLowTrustUsers: "true" })
        )
      );
      expect(coerced.status).toBe(400);
      expect(users.updateUserHideLowTrust).toHaveBeenCalledTimes(1);
    });
  });

  describe("reply templates", () => {
    it("creates a trimmed slug and allows an empty body string", async () => {
      const body = await readAction(
        await replyTemplateCreateAction(
          "user-1",
          form({ slug: "  Hello World  ", body: "  Hi  " })
        )
      );
      expect(body).toEqual({ status: 200, success: true });
      expect(templates.createReplyTemplate).toHaveBeenCalledWith(
        "user-1",
        "Hello World",
        "  Hi  "
      );

      await replyTemplateCreateAction("user-1", form({ slug: "0", body: "" }));
      expect(templates.createReplyTemplate).toHaveBeenLastCalledWith(
        "user-1",
        "0",
        ""
      );

      await replyTemplateCreateAction(
        "user-1",
        form({ slug: "true", body: "Hi" })
      );
      expect(templates.createReplyTemplate).toHaveBeenLastCalledWith(
        "user-1",
        "true",
        "Hi"
      );
    });

    it("rejects a missing, blank, or non-string slug or body", async () => {
      const missingSlug = await readAction(
        await replyTemplateCreateAction("user-1", form({ body: "Hi" }))
      );
      expect(missingSlug).toEqual({ status: 400, error: "Slug is required" });

      const blankSlug = await readAction(
        await replyTemplateCreateAction(
          "user-1",
          form({ slug: "   ", body: "Hi" })
        )
      );
      expect(blankSlug).toEqual({ status: 400, error: "Slug is required" });

      const fileSlug = formWithFile("slug");
      fileSlug.set("body", "Hi");
      const slugFile = await readAction(
        await replyTemplateCreateAction("user-1", fileSlug)
      );
      expect(slugFile).toEqual({ status: 400, error: "Slug is required" });

      const fileBody = formWithFile("body");
      fileBody.set("slug", "hello");
      const bodyFile = await readAction(
        await replyTemplateCreateAction("user-1", fileBody)
      );
      expect(bodyFile).toEqual({ status: 400, error: "Body is required" });

      const missingBody = await readAction(
        await replyTemplateCreateAction("user-1", form({ slug: "hello" }))
      );
      expect(missingBody).toEqual({ status: 400, error: "Body is required" });
      expect(templates.createReplyTemplate).not.toHaveBeenCalled();
    });

    it("returns the create error or the fallback message", async () => {
      templates.createReplyTemplate.mockResolvedValueOnce({
        success: false,
        error: "duplicate",
      });
      const named = await readAction(
        await replyTemplateCreateAction(
          "user-1",
          form({ slug: "hello", body: "Hi" })
        )
      );
      expect(named).toEqual({ status: 400, error: "duplicate" });

      templates.createReplyTemplate.mockResolvedValueOnce({ success: false });
      const fallback = await readAction(
        await replyTemplateCreateAction(
          "user-1",
          form({ slug: "hello", body: "Hi" })
        )
      );
      expect(fallback).toEqual({ status: 400, error: "Failed to create" });
    });

    it("deletes a template and rejects a missing id", async () => {
      const body = await readAction(
        await replyTemplateDeleteAction("user-1", form({ id: "tmpl-1" }))
      );
      expect(body).toEqual({ status: 200, success: true });
      expect(templates.deleteReplyTemplate).toHaveBeenCalledWith(
        "user-1",
        "tmpl-1"
      );

      const missing = await readAction(
        await replyTemplateDeleteAction("user-1", form())
      );
      expect(missing).toEqual({
        status: 400,
        error: "Template id is required",
      });
      const blank = await readAction(
        await replyTemplateDeleteAction("user-1", form({ id: "" }))
      );
      expect(blank).toEqual({ status: 400, error: "Template id is required" });
      const fileId = await readAction(
        await replyTemplateDeleteAction("user-1", formWithFile("id"))
      );
      expect(fileId).toEqual({ status: 400, error: "Template id is required" });

      templates.deleteReplyTemplate.mockResolvedValueOnce({
        success: false,
        error: "Not found",
      });
      const named = await readAction(
        await replyTemplateDeleteAction("user-1", form({ id: "tmpl-1" }))
      );
      expect(named).toEqual({ status: 400, error: "Not found" });

      templates.deleteReplyTemplate.mockResolvedValueOnce({ success: false });
      const fallback = await readAction(
        await replyTemplateDeleteAction("user-1", form({ id: "tmpl-1" }))
      );
      expect(fallback).toEqual({ status: 400, error: "Failed to delete" });
    });

    it("updates a trimmed slug and rejects each missing field", async () => {
      const body = await readAction(
        await replyTemplateUpdateAction(
          "user-1",
          form({ id: "tmpl-1", slug: "  Hello  ", body: "Hi" })
        )
      );
      expect(body).toEqual({ status: 200, success: true });
      expect(templates.updateReplyTemplate).toHaveBeenCalledWith(
        "user-1",
        "tmpl-1",
        "Hello",
        "Hi"
      );

      const missingId = await readAction(
        await replyTemplateUpdateAction(
          "user-1",
          form({ slug: "hello", body: "Hi" })
        )
      );
      expect(missingId).toEqual({
        status: 400,
        error: "Template id is required",
      });
      const blankId = await readAction(
        await replyTemplateUpdateAction(
          "user-1",
          form({ id: "", slug: "hello", body: "Hi" })
        )
      );
      expect(blankId).toEqual({
        status: 400,
        error: "Template id is required",
      });
      const blankSlug = await readAction(
        await replyTemplateUpdateAction(
          "user-1",
          form({ id: "tmpl-1", slug: " ", body: "Hi" })
        )
      );
      expect(blankSlug).toEqual({ status: 400, error: "Slug is required" });
      const fileBody = form({ id: "tmpl-1", slug: "hello" });
      fileBody.set("body", new File(["x"], "body.txt", { type: "text/plain" }));
      const bodyFile = await readAction(
        await replyTemplateUpdateAction("user-1", fileBody)
      );
      expect(bodyFile).toEqual({ status: 400, error: "Body is required" });

      templates.updateReplyTemplate.mockResolvedValueOnce({
        success: false,
        error: "duplicate",
      });
      const named = await readAction(
        await replyTemplateUpdateAction(
          "user-1",
          form({ id: "tmpl-1", slug: "hello", body: "Hi" })
        )
      );
      expect(named).toEqual({ status: 400, error: "duplicate" });

      templates.updateReplyTemplate.mockResolvedValueOnce({ success: false });
      const fallback = await readAction(
        await replyTemplateUpdateAction(
          "user-1",
          form({ id: "tmpl-1", slug: "hello", body: "Hi" })
        )
      );
      expect(fallback).toEqual({ status: 400, error: "Failed to update" });
    });
  });

  describe("updateDefaultZapAmountAction", () => {
    it("stores the bounded integer amount", async () => {
      const small = await readAction(
        await updateDefaultZapAmountAction(
          "user-1",
          form({ defaultZapAmountSats: "1" })
        )
      );
      expect(small).toEqual({
        status: 200,
        success: true,
        defaultZapAmountSats: 1,
      });
      expect(users.updateUserDefaultZapAmountSats).toHaveBeenCalledWith(
        "user-1",
        1
      );

      const large = await readAction(
        await updateDefaultZapAmountAction(
          "user-1",
          form({ defaultZapAmountSats: "1000000" })
        )
      );
      expect(large).toEqual({
        status: 200,
        success: true,
        defaultZapAmountSats: 1_000_000,
      });
      expect(users.updateUserDefaultZapAmountSats).toHaveBeenLastCalledWith(
        "user-1",
        1_000_000
      );
    });

    it("rejects missing, unreadable, and out-of-range amounts", async () => {
      const missing = await readAction(
        await updateDefaultZapAmountAction("user-1", form())
      );
      expect(missing.status).toBe(400);
      expect(missing.error).toContain("defaultZapAmountSats");

      const broken = await readAction(
        await updateDefaultZapAmountAction("user-1", brokenForm())
      );
      expect(broken).toEqual({ status: 400, error: "Validation failed" });

      for (const amount of ["0", "1000001", "1.5", "abc"]) {
        const body = await readAction(
          await updateDefaultZapAmountAction(
            "user-1",
            form({ defaultZapAmountSats: amount })
          )
        );
        expect(body.status).toBe(400);
      }
      expect(users.updateUserDefaultZapAmountSats).not.toHaveBeenCalled();
    });

    it("propagates a thrown Error or string", async () => {
      users.updateUserDefaultZapAmountSats.mockRejectedValueOnce(
        new Error("write failed")
      );
      await expect(
        updateDefaultZapAmountAction(
          "user-1",
          form({ defaultZapAmountSats: "21" })
        )
      ).rejects.toThrow("write failed");

      users.updateUserDefaultZapAmountSats.mockRejectedValueOnce(
        "write failed"
      );
      await expect(
        updateDefaultZapAmountAction(
          "user-1",
          form({ defaultZapAmountSats: "21" })
        )
      ).rejects.toBe("write failed");
    });
  });
});
