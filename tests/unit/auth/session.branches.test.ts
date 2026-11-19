import { beforeEach, describe, expect, it, vi } from "vitest";

interface CookieSession {
  get: (key: "sessionId") => unknown;
  set: (key: "sessionId", value: string) => void;
  unset: (key: "sessionId") => void;
}

interface RedirectInit {
  headers: Record<string, string>;
}

interface RedirectResult {
  location: string;
  init?: RedirectInit;
}

interface SessionUser {
  id: string;
  npub: string;
}

interface PubkeyRow {
  pubkey: string;
  revokedAt: Date | null;
  expiresAt: Date;
}

interface UserIdRow {
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date;
}

interface FullRow {
  id: string;
  userId: string;
  pubkey: string;
  revokedAt: Date | null;
  expiresAt: Date;
}

interface StorageOptions {
  cookie: {
    name: string;
    httpOnly: boolean;
    path: string;
    sameSite: "lax";
    secrets: string[];
    secure: boolean;
  };
}

const envState = vi.hoisted(() => ({
  NODE_ENV: "development",
  SESSION_SECRET: "s".repeat(40),
}));

const sessionBag = vi.hoisted(() => {
  const bag: { sessionId: unknown } = { sessionId: undefined };
  return bag;
});

const cookieSession = vi.hoisted(() => {
  const session: CookieSession = {
    get() {
      return sessionBag.sessionId;
    },
    set(_key, value) {
      sessionBag.sessionId = value;
    },
    unset() {
      sessionBag.sessionId = undefined;
    },
  };
  return session;
});

const readCookieSession = vi.hoisted(() =>
  vi.fn<(cookie: string | null) => Promise<CookieSession>>(
    async () => cookieSession
  )
);
const commitSession = vi.hoisted(() =>
  vi.fn<
    (session: CookieSession, options?: { maxAge?: number }) => Promise<string>
  >(async () => "session-cookie")
);
const destroySession = vi.hoisted(() =>
  vi.fn<(session: CookieSession) => Promise<string>>(
    async () => "cleared-cookie"
  )
);
const createCookieSessionStorage = vi.hoisted(() =>
  vi.fn<
    (options: StorageOptions) => {
      getSession: typeof getSession;
      commitSession: typeof commitSession;
      destroySession: typeof destroySession;
    }
  >(() => ({
    getSession: readCookieSession,
    commitSession,
    destroySession,
  }))
);
const redirect = vi.hoisted(() =>
  vi.fn<(location: string, init?: RedirectInit) => RedirectResult>(
    (location, init) => ({ location, init })
  )
);
const getUserById = vi.hoisted(() =>
  vi.fn<(id: string) => Promise<SessionUser | null>>()
);
const safeInternalPath = vi.hoisted(() =>
  vi.fn<(value: unknown) => string>((value) =>
    typeof value === "string" ? value : "/dashboard"
  )
);
const findSessionByIdForPubkey = vi.hoisted(() =>
  vi.fn<(sessionId: string) => Promise<PubkeyRow | null>>()
);
const findSessionByIdForUserId = vi.hoisted(() =>
  vi.fn<(sessionId: string) => Promise<UserIdRow | null>>()
);
const findSessionByIdFull = vi.hoisted(() =>
  vi.fn<(sessionId: string) => Promise<FullRow | null>>()
);
const createSessionRow = vi.hoisted(() =>
  vi.fn<
    (data: { userId: string; pubkey: string; expiresAt: Date }) => Promise<{
      id: string;
    }>
  >()
);
const revokeSessionById = vi.hoisted(() =>
  vi.fn<(sessionId: string) => Promise<void>>()
);

vi.mock("react-router", () => ({
  createCookieSessionStorage,
  redirect,
}));
vi.mock("~/features/auth/repositories/session-data.server", () => ({
  createSession: createSessionRow,
  findSessionByIdForPubkey,
  findSessionByIdForUserId,
  findSessionByIdFull,
  revokeSessionById,
}));
vi.mock("~/features/user", () => ({
  getUserById,
}));
vi.mock("~/lib/env.server", () => ({
  env: {
    get NODE_ENV() {
      return envState.NODE_ENV;
    },
    get SESSION_SECRET() {
      return envState.SESSION_SECRET;
    },
  },
}));
vi.mock("~/lib/safe-internal-path", () => ({
  safeInternalPath,
}));

import {
  createUserSession,
  getSession,
  getSessionId,
  getSessionPubkey,
  getUser,
  getUserId,
  logout,
  requireSession,
  requireUser,
  requireUserId,
} from "~/features/auth/session.server";

const DAY_MS = 24 * 60 * 60 * 1000;
const USER: SessionUser = { id: "user-1", npub: "npub1example" };

function requestWithCookie(cookie: string | null): Request {
  const headers = new Headers();
  if (cookie !== null) headers.set("Cookie", cookie);
  return new Request("https://app.example/dashboard", { headers });
}

function future(): Date {
  return new Date(Date.now() + DAY_MS);
}

function past(): Date {
  return new Date(Date.now() - DAY_MS);
}

function fullRow(overrides?: Partial<FullRow>): FullRow {
  return {
    id: "db-session",
    userId: USER.id,
    pubkey: USER.npub,
    revokedAt: null,
    expiresAt: future(),
    ...overrides,
  };
}

async function loadSessionModule(): Promise<void> {
  vi.resetModules();
  await import("~/features/auth/session.server");
}

describe("session.server", () => {
  beforeEach(async () => {
    envState.NODE_ENV = "development";
    envState.SESSION_SECRET = "s".repeat(40);
    sessionBag.sessionId = undefined;
    readCookieSession.mockReset();
    readCookieSession.mockResolvedValue(cookieSession);
    commitSession.mockReset();
    commitSession.mockResolvedValue("session-cookie");
    destroySession.mockReset();
    destroySession.mockResolvedValue("cleared-cookie");
    redirect.mockReset();
    redirect.mockImplementation((location, init) => ({ location, init }));
    getUserById.mockReset();
    safeInternalPath.mockReset();
    safeInternalPath.mockImplementation((value) =>
      typeof value === "string" ? value : "/dashboard"
    );
    findSessionByIdForPubkey.mockReset();
    findSessionByIdForUserId.mockReset();
    findSessionByIdFull.mockReset();
    createSessionRow.mockReset();
    createSessionRow.mockResolvedValue({ id: "db-session" });
    revokeSessionById.mockReset();
    revokeSessionById.mockResolvedValue(undefined);
    createCookieSessionStorage.mockClear();
    await loadSessionModule();
  });

  it("builds a lax cookie and marks it secure only in production", async () => {
    const developmentCall = createCookieSessionStorage.mock.calls.at(-1)?.[0];
    expect(developmentCall).toEqual({
      cookie: {
        name: "__session",
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secrets: ["s".repeat(40)],
        secure: false,
      },
    });

    envState.NODE_ENV = "production";
    await loadSessionModule();
    expect(createCookieSessionStorage.mock.calls.at(-1)?.[0]).toEqual({
      cookie: {
        name: "__session",
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secrets: ["s".repeat(40)],
        secure: true,
      },
    });
  });

  it("refuses to load when SESSION_SECRET is empty", async () => {
    envState.SESSION_SECRET = "";
    vi.resetModules();
    await expect(import("~/features/auth/session.server")).rejects.toThrow(
      "SESSION_SECRET must be set"
    );
  });

  it("reads a session id from the cookie and ignores blank or non-string values", async () => {
    const request = requestWithCookie("sid=abc");
    sessionBag.sessionId = "abc";
    await expect(getSessionId(request)).resolves.toBe("abc");
    expect(readCookieSession).toHaveBeenCalledWith("sid=abc");

    sessionBag.sessionId = "";
    await expect(getSessionId(request)).resolves.toBeUndefined();
    sessionBag.sessionId = "   ";
    await expect(getSessionId(request)).resolves.toBe("   ");
    sessionBag.sessionId = 12;
    await expect(getSessionId(request)).resolves.toBeUndefined();

    readCookieSession.mockClear();
    await expect(getSession(requestWithCookie(null))).resolves.toBe(
      cookieSession
    );
    expect(readCookieSession.mock.calls).toEqual([[null]]);
  });

  it.each([
    ["missing id", undefined, null, undefined],
    ["missing row", "sid", null, undefined],
    ["revoked row", "sid", fullRow({ revokedAt: past() }), undefined],
    ["expired row", "sid", fullRow({ expiresAt: past() }), undefined],
    ["live row", "sid", fullRow(), "npub1example"],
  ] as const)(
    "getSessionPubkey handles a %s",
    async (_label, sessionId, row, expected) => {
      sessionBag.sessionId = sessionId;
      findSessionByIdForPubkey.mockResolvedValue(row);
      await expect(
        getSessionPubkey(requestWithCookie("sid=abc"))
      ).resolves.toBe(expected);
      if (sessionId === "sid") {
        expect(findSessionByIdForPubkey).toHaveBeenCalledWith("sid");
      } else {
        expect(findSessionByIdForPubkey).not.toHaveBeenCalled();
      }
    }
  );

  it("getUserId mirrors the pubkey session checks and returns the user id", async () => {
    sessionBag.sessionId = "sid";
    findSessionByIdForUserId.mockResolvedValueOnce(null);
    await expect(getUserId(requestWithCookie("a"))).resolves.toBeUndefined();

    findSessionByIdForUserId.mockResolvedValueOnce(
      fullRow({ revokedAt: new Date() })
    );
    await expect(getUserId(requestWithCookie("a"))).resolves.toBeUndefined();

    findSessionByIdForUserId.mockResolvedValueOnce(
      fullRow({ expiresAt: past() })
    );
    await expect(getUserId(requestWithCookie("a"))).resolves.toBeUndefined();

    findSessionByIdForUserId.mockResolvedValueOnce(fullRow());
    await expect(getUserId(requestWithCookie("a"))).resolves.toBe(USER.id);
    expect(findSessionByIdForUserId).toHaveBeenLastCalledWith("sid");

    sessionBag.sessionId = "";
    await expect(getUserId(requestWithCookie("a"))).resolves.toBeUndefined();
  });

  it("returns the user, null when signed out, or logs out a stale user id", async () => {
    sessionBag.sessionId = undefined;
    await expect(getUser(requestWithCookie("a"))).resolves.toBeNull();
    expect(getUserById).not.toHaveBeenCalled();

    sessionBag.sessionId = "sid";
    findSessionByIdForUserId.mockResolvedValue(fullRow());
    getUserById.mockResolvedValueOnce(USER);
    await expect(getUser(requestWithCookie("a"))).resolves.toBe(USER);
    expect(getUserById).toHaveBeenCalledWith(USER.id);

    getUserById.mockResolvedValueOnce(null);
    await expect(getUser(requestWithCookie("a"))).rejects.toEqual({
      location: "/",
      init: { headers: { "Set-Cookie": "cleared-cookie" } },
    });
    expect(revokeSessionById).toHaveBeenCalledWith("sid");
  });

  it("requireSession redirects for every invalid session and returns a live one", async () => {
    const request = requestWithCookie("sid=abc");
    sessionBag.sessionId = "";
    await expect(requireSession(request)).rejects.toEqual({
      location: "/login",
      init: undefined,
    });

    sessionBag.sessionId = "sid";
    findSessionByIdFull.mockResolvedValueOnce(null);
    await expect(requireSession(request)).rejects.toEqual({
      location: "/login",
      init: undefined,
    });
    findSessionByIdFull.mockResolvedValueOnce(fullRow({ revokedAt: past() }));
    await expect(requireSession(request)).rejects.toEqual({
      location: "/login",
      init: undefined,
    });
    findSessionByIdFull.mockResolvedValueOnce(fullRow({ expiresAt: past() }));
    await expect(requireSession(request)).rejects.toEqual({
      location: "/login",
      init: undefined,
    });

    const live = fullRow({ id: "row-id" });
    findSessionByIdFull.mockResolvedValueOnce(live);
    await expect(requireSession(request)).resolves.toEqual({
      userId: USER.id,
      pubkey: USER.npub,
      sessionId: "row-id",
    });
    expect(findSessionByIdFull).toHaveBeenCalledWith("sid");
  });

  it("requireUserId and requireUser delegate to the session and user lookup", async () => {
    sessionBag.sessionId = "sid";
    findSessionByIdFull.mockResolvedValue(fullRow());
    await expect(requireUserId(requestWithCookie("a"))).resolves.toBe(USER.id);

    getUserById.mockResolvedValueOnce(USER);
    await expect(requireUser(requestWithCookie("a"))).resolves.toBe(USER);

    getUserById.mockResolvedValueOnce(null);
    await expect(requireUser(requestWithCookie("a"))).rejects.toMatchObject({
      location: "/",
    });
    expect(revokeSessionById).toHaveBeenCalledWith("sid");
  });

  it("creates a remembered session for seven days and a short session without maxAge", async () => {
    const request = requestWithCookie("sid=old");
    sessionBag.sessionId = "old";
    getUserById.mockResolvedValue(USER);
    safeInternalPath.mockReturnValue("/dashboard/posts");

    const before = Date.now();
    const remembered = await createUserSession({
      request,
      userId: USER.id,
      remember: true,
      redirectTo: "/next",
    });
    const after = Date.now();

    expect(safeInternalPath).toHaveBeenCalledWith("/next");
    expect(getUserById).toHaveBeenCalledWith(USER.id);
    const created = createSessionRow.mock.calls[0]?.[0];
    if (!created) throw new Error("session row was not created");
    expect(created.userId).toBe(USER.id);
    expect(created.pubkey).toBe(USER.npub);
    expect(created.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 7 * DAY_MS
    );
    expect(created.expiresAt.getTime()).toBeLessThanOrEqual(after + 7 * DAY_MS);
    expect(sessionBag.sessionId).toBe("db-session");
    expect(commitSession).toHaveBeenCalledWith(cookieSession, {
      maxAge: 60 * 60 * 24 * 7,
    });
    expect(remembered).toEqual({
      location: "/dashboard/posts",
      init: { headers: { "Set-Cookie": "session-cookie" } },
    });

    const shortBefore = Date.now();
    await createUserSession({
      request,
      userId: USER.id,
      remember: false,
      redirectTo: "/today",
    });
    const shortAfter = Date.now();
    const short = createSessionRow.mock.calls[1]?.[0];
    if (!short) throw new Error("short session row was not created");
    expect(short.expiresAt.getTime()).toBeGreaterThanOrEqual(
      shortBefore + DAY_MS
    );
    expect(short.expiresAt.getTime()).toBeLessThanOrEqual(shortAfter + DAY_MS);
    expect(commitSession).toHaveBeenLastCalledWith(cookieSession, {
      maxAge: undefined,
    });
  });

  it("logs out instead of creating a session when the user no longer exists", async () => {
    sessionBag.sessionId = "stale";
    getUserById.mockResolvedValue(null);

    await expect(
      createUserSession({
        request: requestWithCookie("sid=stale"),
        userId: "missing",
        remember: false,
        redirectTo: "/next",
      })
    ).rejects.toMatchObject({ location: "/" });
    expect(createSessionRow).not.toHaveBeenCalled();
    expect(revokeSessionById).toHaveBeenCalledWith("stale");
    expect(sessionBag.sessionId).toBeUndefined();
  });

  it("revokes a live session on logout and skips revoke when there is no id", async () => {
    sessionBag.sessionId = "sid";
    const cleared = await logout(requestWithCookie("sid=abc"));
    expect(revokeSessionById).toHaveBeenCalledWith("sid");
    expect(sessionBag.sessionId).toBeUndefined();
    expect(destroySession).toHaveBeenCalledWith(cookieSession);
    expect(cleared).toEqual({
      location: "/",
      init: { headers: { "Set-Cookie": "cleared-cookie" } },
    });

    revokeSessionById.mockClear();
    sessionBag.sessionId = "";
    await logout(requestWithCookie("sid=abc"));
    expect(revokeSessionById).not.toHaveBeenCalled();
  });
});
