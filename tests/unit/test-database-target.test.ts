import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { datasourceUrlForPrismaCommand } from "~/lib/prisma-command-url";
import {
  evaluateTestDatabase,
  explicitTestDatabaseUrl,
} from "~/lib/test-database-target";

const LOCAL_TEST =
  "postgresql://postgres:postgres@127.0.0.1:5432/smartflow_test";
const LOCAL_APP = "postgresql://postgres:postgres@127.0.0.1:5433/postgres";
const REMOTE_APP = "postgresql://app:secret@db.example.com:5432/smartflow";
const REMOTE_TEST =
  "postgresql://tester:secret@db.example.com:5432/smartflow_test";

describe("test database target", () => {
  it("requires TEST_DATABASE_URL and does not read DATABASE_URL as the target", () => {
    const decision = evaluateTestDatabase({
      testDatabaseUrl: undefined,
      appDatabaseUrl: REMOTE_APP,
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe("missing");
    expect(decision.message).toContain("does not fall back");
    expect(explicitTestDatabaseUrl({ DATABASE_URL: REMOTE_APP })).toBeNull();
  });

  it("rejects a malformed URL without printing it", () => {
    const decision = evaluateTestDatabase({
      testDatabaseUrl: "mysql://root:super-secret@localhost/app",
      appDatabaseUrl: undefined,
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe("malformed");
    expect(decision.message).not.toContain("super-secret");
  });

  it("rejects the same remote database even when the password differs", () => {
    const decision = evaluateTestDatabase({
      testDatabaseUrl:
        "postgresql://other:different@db.example.com:5432/smartflow",
      appDatabaseUrl: REMOTE_APP,
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe("identical");
    expect(decision.message).not.toContain("secret");
  });

  it("rejects an ambiguous database name and the Postgres maintenance database", () => {
    const ambiguous = evaluateTestDatabase({
      testDatabaseUrl:
        "postgresql://postgres:postgres@127.0.0.1:5432/smartflow",
      appDatabaseUrl: undefined,
    });
    const system = evaluateTestDatabase({
      testDatabaseUrl: LOCAL_APP,
      appDatabaseUrl: undefined,
    });
    expect(ambiguous.ok).toBe(false);
    expect(system.ok).toBe(false);
    if (ambiguous.ok || system.ok) return;
    expect(ambiguous.code).toBe("unsafe");
    expect(system.code).toBe("unsafe");
  });

  it("allows the disposable loopback database CI already uses, even when both URLs match", () => {
    const decision = evaluateTestDatabase({
      testDatabaseUrl: LOCAL_TEST,
      appDatabaseUrl: LOCAL_TEST,
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.disposableLoopback).toBe(true);
  });

  it("allows a remote test database only when it is not the application database", () => {
    const decision = evaluateTestDatabase({
      testDatabaseUrl: REMOTE_TEST,
      appDatabaseUrl: REMOTE_APP,
    });
    expect(decision.ok).toBe(true);
    const same = evaluateTestDatabase({
      testDatabaseUrl: REMOTE_TEST,
      appDatabaseUrl:
        "postgresql://app:other@db.example.com:5432/smartflow_test",
    });
    expect(same.ok).toBe(false);
    if (same.ok) return;
    expect(same.code).toBe("identical");
  });

  it("throws when a configured test URL is unsafe", () => {
    expect(() =>
      explicitTestDatabaseUrl({
        TEST_DATABASE_URL: REMOTE_APP,
        DATABASE_URL: LOCAL_APP,
      })
    ).toThrow(/not a clearly disposable test database/);
  });

  it("keeps test:db:setup free of the production fallback and data-loss flag", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["test:db:setup"]).not.toContain("accept-data-loss");
    expect(pkg.scripts["test:db:setup"]).not.toContain("DATABASE_URL");
    expect(pkg.scripts["test:db:reset"]).toContain("test-db-reset");
  });
});

describe("prisma command URL", () => {
  it("uses DATABASE_URL for migrate and refuses the generate placeholder", () => {
    expect(
      datasourceUrlForPrismaCommand({ DATABASE_URL: LOCAL_TEST }, [
        "node",
        "prisma",
        "migrate",
        "deploy",
      ])
    ).toBe(LOCAL_TEST);
    expect(() =>
      datasourceUrlForPrismaCommand({}, ["node", "prisma", "db", "push"])
    ).toThrow(/DATABASE_URL is required/);
  });

  it("keeps a non-connecting placeholder for generate", () => {
    const url = datasourceUrlForPrismaCommand({}, [
      "node",
      "prisma",
      "generate",
    ]);
    expect(url).toContain("prisma_generate_placeholder");
    expect(url).not.toContain("/postgres");
  });
});
