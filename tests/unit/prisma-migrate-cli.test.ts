import { describe, expect, it } from "vitest";

import {
  prismaMigrateDeployCommand,
  reportableMigrationStderr,
} from "~/lib/prisma-migrate-cli";

describe("prisma migrate startup output", () => {
  it("runs the local Prisma CLI instead of npx", () => {
    expect(prismaMigrateDeployCommand("/usr/bin/node")).toBe(
      "'/usr/bin/node' ./node_modules/prisma/build/index.js migrate deploy"
    );
  });

  it("drops the production npm warning and Prisma's config notice", () => {
    const stderr = [
      "npm warn config production Use `--omit=dev` instead.",
      "Loaded Prisma config from prisma.config.ts.",
      "Prisma schema loaded from prisma/schema.prisma.",
      "",
    ].join("\n");
    expect(reportableMigrationStderr(stderr)).toBe("");
  });

  it("ignores the same notice when Prisma colors it", () => {
    const colored = `${String.fromCharCode(27)}[2mLoaded Prisma config from prisma.config.ts.${String.fromCharCode(27)}[0m`;
    expect(reportableMigrationStderr(colored)).toBe("");
  });

  it("keeps a real migration error", () => {
    const stderr = [
      "Loaded Prisma config from prisma.config.ts.",
      "Error: P3009 migrate found failed migrations",
    ].join("\n");
    expect(reportableMigrationStderr(stderr)).toBe(
      "Error: P3009 migrate found failed migrations"
    );
  });
});
