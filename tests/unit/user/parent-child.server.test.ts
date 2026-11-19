import { beforeEach, describe, expect, it, vi } from "vitest";

interface SearchRow {
  id: string;
  npub: string;
  nostrProfile: unknown;
  isChild: boolean;
  parentNpub: string | null;
  pendingParentRequests: string[];
}

interface ChildAccount {
  id: string;
  npub: string;
  parentNpub: string | null;
  isChild: boolean;
  pendingParentRequests: string[];
}

interface ConfirmedChild {
  id: string;
  npub: string;
  nostrProfile: unknown;
  isChild: boolean;
}

interface PendingChild {
  id: string;
  npub: string;
  nostrProfile: unknown;
}

interface SearchHit {
  id: string;
  npub: string;
  nostrProfile: unknown;
  isChild: boolean;
  parentNpub: string | null;
  pendingParentRequests: string[];
  profileName?: string;
  profileDisplayName?: string;
  profilePicture?: string;
}

interface LogContext {
  [key: string]: unknown;
}

const repo = vi.hoisted(() => ({
  findConfirmedChildrenForParent:
    vi.fn<(parentNpub: string) => Promise<ConfirmedChild[]>>(),
  findPendingChildrenForParent:
    vi.fn<(parentNpub: string) => Promise<PendingChild[]>>(),
  findPendingParentRequestsForChild:
    vi.fn<(childNpub: string) => Promise<string[]>>(),
  findUserByNpubForParentChild:
    vi.fn<(npub: string) => Promise<ChildAccount | null>>(),
  findUsersForParentChildSearch:
    vi.fn<
      (
        excludeNpub: string | undefined,
        trimmed: string,
        take: number
      ) => Promise<SearchRow[]>
    >(),
  updateUserAcceptChildLink:
    vi.fn<
      (
        childNpub: string,
        parentNpub: string,
        pending: string[]
      ) => Promise<void>
    >(),
  updateUserPendingParentRequests:
    vi.fn<(npub: string, pending: string[]) => Promise<void>>(),
  updateUserPendingParentRequestsPush:
    vi.fn<(npub: string, parent: string) => Promise<void>>(),
  updateUserRejectChildLink:
    vi.fn<(childNpub: string, pending: string[]) => Promise<void>>(),
  updateUserUnlinkChild: vi.fn<(childNpub: string) => Promise<void>>(),
}));

const logs = vi.hoisted(() => ({
  logError: vi.fn<(error: Error, context?: LogContext) => void>(),
  logWarning: vi.fn<(message: string, context?: LogContext) => void>(),
}));

const nostr = vi.hoisted(() => ({
  decodeNpub: vi.fn<(value: string) => string | null>(),
}));

vi.mock("~/features/user/repositories/parent-child-data.server", () => repo);
vi.mock("~/lib/error-logger.server", () => logs);
vi.mock("~/lib/nostr-adapter.server", () => ({
  nostrAdapter: { decodeNpub: nostr.decodeNpub },
}));

import {
  cancelChildLinkRequest,
  getConfirmedChildrenForParent,
  getPendingChildrenForParent,
  getPendingParentRequestsForChild,
  requestChildLink,
  respondToChildRequest,
  searchUsersByProfileName,
  unlinkChildByParent,
  unlinkParent,
} from "~/features/user/services/parent-child.server";

const PARENT = "11".repeat(32);
const CHILD = "22".repeat(32);
const OTHER = "33".repeat(32);
const STORED_CHILD = "44".repeat(32);

function searchRow(
  id: string,
  npub: string,
  nostrProfile: unknown,
  extras: Partial<SearchRow> = {}
): SearchRow {
  return {
    id,
    npub,
    nostrProfile,
    isChild: false,
    parentNpub: null,
    pendingParentRequests: [],
    ...extras,
  };
}

function hit(
  id: string,
  npub: string,
  nostrProfile: unknown,
  bits: { name?: string; display?: string; picture?: string },
  extras: Partial<SearchHit> = {}
): SearchHit {
  return {
    id,
    npub,
    nostrProfile,
    isChild: false,
    parentNpub: null,
    pendingParentRequests: [],
    profileName: bits.name,
    profileDisplayName: bits.display,
    profilePicture: bits.picture,
    ...extras,
  };
}

function childAccount(overrides: Partial<ChildAccount> = {}): ChildAccount {
  return {
    id: "child-1",
    npub: CHILD,
    parentNpub: null,
    isChild: false,
    pendingParentRequests: [],
    ...overrides,
  };
}

function loggedError(): Error {
  const call = logs.logError.mock.calls[0];
  if (!call) throw new Error("expected logError");
  return call[0];
}

describe("parent-child service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    nostr.decodeNpub.mockReturnValue(null);
    repo.findUsersForParentChildSearch.mockResolvedValue([]);
    repo.findUserByNpubForParentChild.mockResolvedValue(null);
    repo.updateUserPendingParentRequestsPush.mockResolvedValue(undefined);
    repo.updateUserPendingParentRequests.mockResolvedValue(undefined);
    repo.findConfirmedChildrenForParent.mockResolvedValue([]);
    repo.findPendingChildrenForParent.mockResolvedValue([]);
    repo.findPendingParentRequestsForChild.mockResolvedValue([]);
    repo.updateUserAcceptChildLink.mockResolvedValue(undefined);
    repo.updateUserRejectChildLink.mockResolvedValue(undefined);
    repo.updateUserUnlinkChild.mockResolvedValue(undefined);
  });

  describe("searchUsersByProfileName", () => {
    it("returns nothing for an empty or whitespace query", async () => {
      await expect(searchUsersByProfileName("")).resolves.toEqual([]);
      await expect(searchUsersByProfileName("   ")).resolves.toEqual([]);
      expect(repo.findUsersForParentChildSearch).not.toHaveBeenCalled();
      expect(nostr.decodeNpub).not.toHaveBeenCalled();
    });

    it("keeps the trimmed text when decode returns null or a non-hex value", async () => {
      nostr.decodeNpub.mockReturnValueOnce(null);
      await searchUsersByProfileName("  Ada  ", PARENT);
      expect(repo.findUsersForParentChildSearch).toHaveBeenLastCalledWith(
        PARENT,
        "Ada",
        200
      );

      nostr.decodeNpub.mockReturnValueOnce("not-a-hex");
      await searchUsersByProfileName("Ada");
      expect(nostr.decodeNpub).toHaveBeenLastCalledWith("Ada");
      expect(repo.findUsersForParentChildSearch).toHaveBeenLastCalledWith(
        undefined,
        "Ada",
        200
      );
    });

    it("does not add a decoded hex that is already the query", async () => {
      const hex = "ab".repeat(32);
      nostr.decodeNpub.mockReturnValue(hex.toUpperCase());
      repo.findUsersForParentChildSearch.mockResolvedValue([
        searchRow("hex", hex, { name: "Ignored" }),
      ]);

      await expect(
        searchUsersByProfileName(`  ${hex.toUpperCase()}  `)
      ).resolves.toEqual([
        hit("hex", hex, { name: "Ignored" }, { name: "Ignored" }),
      ]);
      expect(repo.findUsersForParentChildSearch).toHaveBeenCalledWith(
        undefined,
        hex,
        200
      );
    });

    it("searches the decoded hex and the original term", async () => {
      const hex = "cd".repeat(32);
      nostr.decodeNpub.mockReturnValue(hex);
      const named = searchRow("named", "zzzz", { name: "npub1example" });
      const keyed = searchRow("keyed", hex, null);
      const skipped = searchRow("skipped", "ffff", { name: "Other" });
      repo.findUsersForParentChildSearch.mockResolvedValue([
        named,
        keyed,
        skipped,
      ]);

      await expect(
        searchUsersByProfileName("npub1example", PARENT)
      ).resolves.toEqual([
        hit(
          "named",
          "zzzz",
          { name: "npub1example" },
          { name: "npub1example" }
        ),
        hit("keyed", hex, null, {}),
      ]);
      expect(nostr.decodeNpub).toHaveBeenCalledWith("npub1example");
      expect(repo.findUsersForParentChildSearch).toHaveBeenCalledWith(
        PARENT,
        hex,
        200
      );
    });

    it("maps profile shapes and keeps only name, display name, or npub matches", async () => {
      const objectProfile = {
        name: "Ada Lovelace",
        display_name: "AL",
        picture: "https://a",
      };
      const weirdProfile = { name: 1, display_name: false, picture: null };
      const displayProfile = { display_name: "Ada Display" };
      repo.findUsersForParentChildSearch.mockResolvedValue([
        searchRow(
          "string",
          "ada-string",
          '{"name":"Ada","display_name":"Countess","picture":"https://ada"}',
          {
            isChild: true,
            parentNpub: PARENT,
            pendingParentRequests: [OTHER],
          }
        ),
        searchRow("bad", "ada-bad", "{"),
        searchRow("null-json", "ada-null", "null"),
        searchRow("arr-json", "ada-arr", "[]"),
        searchRow("num-json", "ada-num", "42"),
        searchRow("arr", "ada-arr-val", ["ada"]),
        searchRow("obj", "zzzz-obj", objectProfile),
        searchRow("weird", "ada-weird", weirdProfile),
        searchRow("num", "ada-num-val", 5),
        searchRow("empty", "ada-empty", ""),
        searchRow("disp", "zzzz-disp", displayProfile),
        searchRow("bob", "zzzz", { name: "Bob" }),
      ]);

      await expect(
        searchUsersByProfileName("  ADA  ", PARENT)
      ).resolves.toEqual([
        hit(
          "string",
          "ada-string",
          null,
          { name: "Ada", display: "Countess", picture: "https://ada" },
          {
            isChild: true,
            parentNpub: PARENT,
            pendingParentRequests: [OTHER],
          }
        ),
        hit("bad", "ada-bad", null, {}),
        hit("null-json", "ada-null", null, {}),
        hit("arr-json", "ada-arr", null, {}),
        hit("num-json", "ada-num", null, {}),
        hit("arr", "ada-arr-val", null, {}),
        hit("obj", "zzzz-obj", objectProfile, {
          name: "Ada Lovelace",
          display: "AL",
          picture: "https://a",
        }),
        hit("weird", "ada-weird", weirdProfile, {}),
        hit("num", "ada-num-val", null, {}),
        hit("empty", "ada-empty", null, {}),
        hit("disp", "zzzz-disp", displayProfile, { display: "Ada Display" }),
      ]);
      expect(repo.findUsersForParentChildSearch).toHaveBeenCalledWith(
        PARENT,
        "ADA",
        200
      );
    });

    it("applies the requested limit after filtering", async () => {
      repo.findUsersForParentChildSearch.mockResolvedValue([
        searchRow("1", "ada-1", { name: "Ada" }),
        searchRow("2", "ada-2", { name: "Ada" }),
        searchRow("3", "nope", { name: "Bob" }),
      ]);

      await expect(
        searchUsersByProfileName("ada", undefined, 1)
      ).resolves.toEqual([hit("1", "ada-1", { name: "Ada" }, { name: "Ada" })]);
    });

    it("defaults the limit to 20", async () => {
      repo.findUsersForParentChildSearch.mockResolvedValue(
        Array.from({ length: 21 }, (_unused, index) =>
          searchRow(`id-${index}`, `ada-${index}`, { name: "Ada" })
        )
      );

      const results = await searchUsersByProfileName("Ada");
      expect(results).toHaveLength(20);
      expect(results[0]?.id).toBe("id-0");
      expect(results[19]?.id).toBe("id-19");
    });

    it("propagates repository failures", async () => {
      repo.findUsersForParentChildSearch.mockRejectedValueOnce(
        new Error("db down")
      );
      await expect(searchUsersByProfileName("ada")).rejects.toThrow("db down");

      repo.findUsersForParentChildSearch.mockRejectedValueOnce("db down");
      await expect(searchUsersByProfileName("ada")).rejects.toBe("db down");
    });
  });

  describe("requestChildLink", () => {
    it("rejects an invalid parent or child hex before lookup", async () => {
      await expect(requestChildLink("  zz  ", `  ${CHILD}  `)).resolves.toEqual(
        {
          ok: false,
          reason: "Invalid hex public key provided.",
        }
      );
      expect(logs.logWarning).toHaveBeenCalledWith(
        "[requestChildLink] Invalid hex key(s)",
        { parent: "zz", child: CHILD }
      );

      await expect(requestChildLink(PARENT, "nope")).resolves.toEqual({
        ok: false,
        reason: "Invalid hex public key provided.",
      });
      expect(repo.findUserByNpubForParentChild).not.toHaveBeenCalled();
    });

    it("rejects a parent adding itself", async () => {
      await expect(requestChildLink(`  ${PARENT}  `, PARENT)).resolves.toEqual({
        ok: false,
        reason: "You cannot add yourself as a child.",
      });
      expect(logs.logWarning).toHaveBeenCalledWith(
        "[requestChildLink] Attempt to add self as child",
        { parent: PARENT }
      );
      expect(repo.findUserByNpubForParentChild).not.toHaveBeenCalled();
    });

    it("rejects a missing child", async () => {
      await expect(requestChildLink(PARENT, CHILD)).resolves.toEqual({
        ok: false,
        reason: "Child account not found.",
      });
      expect(repo.findUserByNpubForParentChild).toHaveBeenCalledWith(CHILD);
      expect(loggedError()).toBeInstanceOf(Error);
      expect(loggedError().message).toBe(
        "[requestChildLink] Child account not found in DB"
      );
      expect(logs.logError.mock.calls[0]?.[1]).toEqual({ child: CHILD });
    });

    it("rejects a child that already has a parent", async () => {
      repo.findUserByNpubForParentChild.mockResolvedValue(
        childAccount({ parentNpub: OTHER, npub: STORED_CHILD })
      );

      await expect(requestChildLink(PARENT, CHILD)).resolves.toEqual({
        ok: false,
        reason: "This account is already linked to a parent.",
      });
      expect(logs.logWarning).toHaveBeenCalledWith(
        "[requestChildLink] Child already linked to a parent",
        { parentNpub: OTHER, child: STORED_CHILD }
      );
      expect(repo.updateUserPendingParentRequestsPush).not.toHaveBeenCalled();
    });

    it("returns success when the request is already pending", async () => {
      repo.findUserByNpubForParentChild.mockResolvedValue(
        childAccount({ pendingParentRequests: [PARENT] })
      );

      await expect(requestChildLink(PARENT, CHILD)).resolves.toEqual({
        ok: true,
      });
      expect(repo.updateUserPendingParentRequestsPush).not.toHaveBeenCalled();
    });

    it("pushes a new request onto the stored child npub", async () => {
      repo.findUserByNpubForParentChild.mockResolvedValue(
        childAccount({
          npub: STORED_CHILD,
          pendingParentRequests: [OTHER],
        })
      );

      await expect(
        requestChildLink(` ${PARENT} `, CHILD.toUpperCase())
      ).resolves.toEqual({ ok: true });
      expect(repo.findUserByNpubForParentChild).toHaveBeenCalledWith(
        CHILD.toUpperCase()
      );
      expect(repo.updateUserPendingParentRequestsPush).toHaveBeenCalledWith(
        STORED_CHILD,
        PARENT
      );
    });

    it("propagates lookup failures", async () => {
      repo.findUserByNpubForParentChild.mockRejectedValueOnce(
        new Error("db down")
      );
      await expect(requestChildLink(PARENT, CHILD)).rejects.toThrow("db down");

      repo.findUserByNpubForParentChild.mockRejectedValueOnce("db down");
      await expect(requestChildLink(PARENT, CHILD)).rejects.toBe("db down");
    });
  });

  describe("cancelChildLinkRequest", () => {
    it("rejects invalid hex and a missing child", async () => {
      await expect(cancelChildLinkRequest("zz", CHILD)).resolves.toEqual({
        ok: false,
        reason: "Invalid hex public key provided.",
      });
      await expect(cancelChildLinkRequest(PARENT, "nope")).resolves.toEqual({
        ok: false,
        reason: "Invalid hex public key provided.",
      });
      expect(repo.findUserByNpubForParentChild).not.toHaveBeenCalled();

      await expect(cancelChildLinkRequest(PARENT, CHILD)).resolves.toEqual({
        ok: false,
        reason: "Child account not found.",
      });
      expect(repo.updateUserPendingParentRequests).not.toHaveBeenCalled();
    });

    it("rejects a cancel when that parent is not pending", async () => {
      repo.findUserByNpubForParentChild.mockResolvedValue(
        childAccount({ pendingParentRequests: [OTHER] })
      );

      await expect(cancelChildLinkRequest(PARENT, CHILD)).resolves.toEqual({
        ok: false,
        reason: "No pending request to cancel.",
      });
      expect(repo.updateUserPendingParentRequests).not.toHaveBeenCalled();
    });

    it("removes only the requesting parent", async () => {
      repo.findUserByNpubForParentChild.mockResolvedValue(
        childAccount({ pendingParentRequests: [PARENT, OTHER] })
      );

      await expect(
        cancelChildLinkRequest(PARENT, CHILD.toUpperCase())
      ).resolves.toEqual({ ok: true });
      expect(repo.updateUserPendingParentRequests).toHaveBeenCalledWith(
        CHILD.toUpperCase(),
        [OTHER]
      );
    });

    it("propagates lookup failures", async () => {
      repo.findUserByNpubForParentChild.mockRejectedValueOnce(
        new Error("db down")
      );
      await expect(cancelChildLinkRequest(PARENT, CHILD)).rejects.toThrow(
        "db down"
      );
      repo.findUserByNpubForParentChild.mockRejectedValueOnce("db down");
      await expect(cancelChildLinkRequest(PARENT, CHILD)).rejects.toBe(
        "db down"
      );
    });
  });

  describe("parent and child lookups", () => {
    it("returns confirmed children, pending children, and pending parents", async () => {
      const confirmed: ConfirmedChild[] = [
        { id: "c1", npub: CHILD, nostrProfile: null, isChild: true },
      ];
      const pending: PendingChild[] = [
        { id: "p1", npub: OTHER, nostrProfile: { name: "Pending" } },
      ];
      repo.findConfirmedChildrenForParent.mockResolvedValue(confirmed);
      repo.findPendingChildrenForParent.mockResolvedValue(pending);
      repo.findPendingParentRequestsForChild.mockResolvedValue([PARENT]);

      await expect(getConfirmedChildrenForParent(PARENT)).resolves.toEqual(
        confirmed
      );
      await expect(getPendingChildrenForParent(PARENT)).resolves.toEqual(
        pending
      );
      await expect(getPendingParentRequestsForChild(CHILD)).resolves.toEqual([
        PARENT,
      ]);
      expect(repo.findConfirmedChildrenForParent).toHaveBeenCalledWith(PARENT);
      expect(repo.findPendingChildrenForParent).toHaveBeenCalledWith(PARENT);
      expect(repo.findPendingParentRequestsForChild).toHaveBeenCalledWith(
        CHILD
      );
    });

    it("propagates Error and string failures from each lookup", async () => {
      repo.findConfirmedChildrenForParent.mockRejectedValueOnce(
        new Error("confirmed")
      );
      await expect(getConfirmedChildrenForParent(PARENT)).rejects.toThrow(
        "confirmed"
      );
      repo.findConfirmedChildrenForParent.mockRejectedValueOnce("confirmed");
      await expect(getConfirmedChildrenForParent(PARENT)).rejects.toBe(
        "confirmed"
      );

      repo.findPendingChildrenForParent.mockRejectedValueOnce(
        new Error("pending")
      );
      await expect(getPendingChildrenForParent(PARENT)).rejects.toThrow(
        "pending"
      );
      repo.findPendingChildrenForParent.mockRejectedValueOnce("pending");
      await expect(getPendingChildrenForParent(PARENT)).rejects.toBe("pending");

      repo.findPendingParentRequestsForChild.mockRejectedValueOnce(
        new Error("requests")
      );
      await expect(getPendingParentRequestsForChild(CHILD)).rejects.toThrow(
        "requests"
      );
      repo.findPendingParentRequestsForChild.mockRejectedValueOnce("requests");
      await expect(getPendingParentRequestsForChild(CHILD)).rejects.toBe(
        "requests"
      );
    });
  });

  describe("respondToChildRequest", () => {
    it("rejects a missing child or a parent that is not pending", async () => {
      await expect(respondToChildRequest(CHILD, PARENT, true)).resolves.toEqual(
        { ok: false, reason: "Child not found" }
      );

      repo.findUserByNpubForParentChild.mockResolvedValue(
        childAccount({ pendingParentRequests: [OTHER] })
      );
      await expect(
        respondToChildRequest(CHILD, PARENT, false)
      ).resolves.toEqual({
        ok: false,
        reason: "No pending request from this parent",
      });
      expect(repo.updateUserAcceptChildLink).not.toHaveBeenCalled();
      expect(repo.updateUserRejectChildLink).not.toHaveBeenCalled();
    });

    it("rejects acceptance when the child already has a parent", async () => {
      repo.findUserByNpubForParentChild.mockResolvedValue(
        childAccount({
          parentNpub: OTHER,
          pendingParentRequests: [PARENT],
        })
      );

      await expect(respondToChildRequest(CHILD, PARENT, true)).resolves.toEqual(
        {
          ok: false,
          reason: "Already linked to a parent.",
        }
      );
      expect(repo.updateUserAcceptChildLink).not.toHaveBeenCalled();
    });

    it("accepts a pending request and clears that parent", async () => {
      repo.findUserByNpubForParentChild.mockResolvedValue(
        childAccount({ pendingParentRequests: [PARENT, OTHER] })
      );

      await expect(respondToChildRequest(CHILD, PARENT, true)).resolves.toEqual(
        { ok: true }
      );
      expect(repo.updateUserAcceptChildLink).toHaveBeenCalledWith(
        CHILD,
        PARENT,
        [OTHER]
      );
      expect(repo.updateUserRejectChildLink).not.toHaveBeenCalled();
    });

    it("rejects a pending request without linking", async () => {
      repo.findUserByNpubForParentChild.mockResolvedValue(
        childAccount({ pendingParentRequests: [PARENT, OTHER] })
      );

      await expect(
        respondToChildRequest(CHILD, PARENT, false)
      ).resolves.toEqual({ ok: true });
      expect(repo.updateUserRejectChildLink).toHaveBeenCalledWith(CHILD, [
        OTHER,
      ]);
      expect(repo.updateUserAcceptChildLink).not.toHaveBeenCalled();
    });

    it("propagates lookup failures", async () => {
      repo.findUserByNpubForParentChild.mockRejectedValueOnce(
        new Error("db down")
      );
      await expect(respondToChildRequest(CHILD, PARENT, true)).rejects.toThrow(
        "db down"
      );
      repo.findUserByNpubForParentChild.mockRejectedValueOnce("db down");
      await expect(respondToChildRequest(CHILD, PARENT, true)).rejects.toBe(
        "db down"
      );
    });
  });

  describe("unlinkParent and unlinkChildByParent", () => {
    it("rejects unlink when the child is missing or not linked", async () => {
      await expect(unlinkParent(CHILD)).resolves.toEqual({
        ok: false,
        reason: "Child not found",
      });

      repo.findUserByNpubForParentChild.mockResolvedValue(
        childAccount({ parentNpub: null, isChild: true })
      );
      await expect(unlinkParent(CHILD)).resolves.toEqual({
        ok: false,
        reason: "This account is not linked to a parent.",
      });

      repo.findUserByNpubForParentChild.mockResolvedValue(
        childAccount({ parentNpub: PARENT, isChild: false })
      );
      await expect(unlinkParent(CHILD)).resolves.toEqual({
        ok: false,
        reason: "This account is not linked to a parent.",
      });
      expect(repo.updateUserUnlinkChild).not.toHaveBeenCalled();
    });

    it("unlinks a child that has a parent", async () => {
      repo.findUserByNpubForParentChild.mockResolvedValue(
        childAccount({ parentNpub: PARENT, isChild: true })
      );

      await expect(unlinkParent(CHILD)).resolves.toEqual({ ok: true });
      expect(repo.updateUserUnlinkChild).toHaveBeenCalledWith(CHILD);
    });

    it("rejects a parent who does not own the child", async () => {
      await expect(unlinkChildByParent(PARENT, CHILD)).resolves.toEqual({
        ok: false,
        reason: "Child not found",
      });

      repo.findUserByNpubForParentChild.mockResolvedValue(
        childAccount({ parentNpub: OTHER })
      );
      await expect(unlinkChildByParent(PARENT, CHILD)).resolves.toEqual({
        ok: false,
        reason: "Not authorized to unlink this child.",
      });
      expect(repo.updateUserUnlinkChild).not.toHaveBeenCalled();
    });

    it("lets the linked parent unlink the child", async () => {
      repo.findUserByNpubForParentChild.mockResolvedValue(
        childAccount({ parentNpub: PARENT, isChild: true })
      );

      await expect(unlinkChildByParent(PARENT, CHILD)).resolves.toEqual({
        ok: true,
      });
      expect(repo.updateUserUnlinkChild).toHaveBeenCalledWith(CHILD);
    });

    it("propagates lookup failures", async () => {
      repo.findUserByNpubForParentChild.mockRejectedValueOnce(
        new Error("parent unlink")
      );
      await expect(unlinkParent(CHILD)).rejects.toThrow("parent unlink");
      repo.findUserByNpubForParentChild.mockRejectedValueOnce("parent unlink");
      await expect(unlinkParent(CHILD)).rejects.toBe("parent unlink");

      repo.findUserByNpubForParentChild.mockRejectedValueOnce(
        new Error("child unlink")
      );
      await expect(unlinkChildByParent(PARENT, CHILD)).rejects.toThrow(
        "child unlink"
      );
      repo.findUserByNpubForParentChild.mockRejectedValueOnce("child unlink");
      await expect(unlinkChildByParent(PARENT, CHILD)).rejects.toBe(
        "child unlink"
      );
    });
  });
});
