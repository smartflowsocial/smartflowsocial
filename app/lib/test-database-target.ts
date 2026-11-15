/**
 * Decides whether a URL is safe for destructive test-database commands.
 * This module does not open a connection.
 */

export type TestDatabaseDecision =
  | {
      ok: true;
      url: string;
      disposableLoopback: boolean;
      target: string;
    }
  | {
      ok: false;
      code: "missing" | "malformed" | "identical" | "unsafe";
      message: string;
    };

const SYSTEM_DATABASES = new Set([
  "postgres",
  "template0",
  "template1",
  "template2",
  "rdsadmin",
  "cloudsqladmin",
]);

export interface DatabaseTarget {
  host: string;
  port: number;
  database: string;
}

export function parseDatabaseTarget(value: string): DatabaseTarget | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!database || database.includes("/") || database.includes("\0"))
    return null;
  const port = parsed.port ? Number(parsed.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port, database };
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  return /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

export function isDisposableTestDatabaseName(name: string): boolean {
  return /(?:^|_)(?:test|tests|testing)(?:_|$)/i.test(name);
}

export function describeTarget(target: DatabaseTarget): string {
  return `${target.host}:${target.port}/${target.database}`;
}

export function evaluateTestDatabase(input: {
  testDatabaseUrl: string | undefined;
  appDatabaseUrl: string | undefined;
}): TestDatabaseDecision {
  const raw = input.testDatabaseUrl?.trim() ?? "";
  if (!raw) {
    return {
      ok: false,
      code: "missing",
      message:
        "TEST_DATABASE_URL is required. This command does not fall back to DATABASE_URL.",
    };
  }

  const target = parseDatabaseTarget(raw);
  if (!target) {
    return {
      ok: false,
      code: "malformed",
      message:
        "TEST_DATABASE_URL must be a postgresql URL with a host and a database name. The value was not printed.",
    };
  }

  const appRaw = input.appDatabaseUrl?.trim() ?? "";
  let appTarget: DatabaseTarget | null = null;
  if (appRaw) {
    appTarget = parseDatabaseTarget(appRaw);
    if (!appTarget) {
      return {
        ok: false,
        code: "unsafe",
        message:
          "DATABASE_URL is set but is not a postgresql URL, so the test target cannot be proven different from it. The values were not printed.",
      };
    }
  }

  const disposableName = isDisposableTestDatabaseName(target.database);
  const system = SYSTEM_DATABASES.has(target.database.toLowerCase());
  const loopback = isLoopbackHost(target.host);
  const sameTarget =
    appTarget !== null &&
    appTarget.host === target.host &&
    appTarget.port === target.port &&
    appTarget.database === target.database;
  const disposableLoopback = loopback && disposableName && !system;

  if (system || !disposableName) {
    return {
      ok: false,
      code: sameTarget ? "identical" : "unsafe",
      message: sameTarget
        ? `TEST_DATABASE_URL and DATABASE_URL both select ${describeTarget(target)}. Refusing to use the application database.`
        : `TEST_DATABASE_URL selects ${describeTarget(target)}, which is not a clearly disposable test database. Use a database name that contains test, tests, or testing as its own word, and never postgres, template0, or template1.`,
    };
  }

  if (sameTarget && !disposableLoopback) {
    return {
      ok: false,
      code: "identical",
      message: `TEST_DATABASE_URL and DATABASE_URL both select ${describeTarget(target)}. A remote or shared database cannot be both the app database and the test database.`,
    };
  }

  return {
    ok: true,
    url: raw,
    disposableLoopback,
    target: describeTarget(target),
  };
}

/** Missing URL returns null so a suite can skip. Any other problem throws. */
export function explicitTestDatabaseUrl(
  env: Record<string, string | undefined>
): string | null {
  const decision = evaluateTestDatabase({
    testDatabaseUrl: env["TEST_DATABASE_URL"],
    appDatabaseUrl: env["DATABASE_URL"],
  });
  if (decision.ok) return decision.url;
  if (decision.code === "missing") return null;
  throw new Error(decision.message);
}

export function requireTestDatabaseUrl(
  env: Record<string, string | undefined>
): Extract<TestDatabaseDecision, { ok: true }> {
  const decision = evaluateTestDatabase({
    testDatabaseUrl: env["TEST_DATABASE_URL"],
    appDatabaseUrl: env["DATABASE_URL"],
  });
  if (!decision.ok) {
    throw new Error(decision.message);
  }
  return decision;
}
