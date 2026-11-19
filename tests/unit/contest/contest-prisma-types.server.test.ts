import { describe, expect, it } from "vitest";

import { Prisma } from "~/features/contest/data/contest-prisma-types.server";

describe("contest prisma types", () => {
  it("re-exports the Prisma namespace used by contest writes", () => {
    expect(Prisma.JsonNull).toBeDefined();
    expect(Prisma.DbNull).not.toBe(Prisma.JsonNull);
  });
});
