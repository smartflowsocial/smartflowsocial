import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { devComposeProblems } from "../../scripts/check-dev-compose.mjs";

const composePath = path.resolve(process.cwd(), "docker-compose.yml");
const dockerignorePath = path.resolve(process.cwd(), ".dockerignore");

describe("development compose", () => {
  it("binds published ports to localhost and avoids latest tags", () => {
    const text = readFileSync(composePath, "utf8");
    expect(devComposeProblems(text)).toEqual([]);
    expect(text).toContain("127.0.0.1:5433:5432");
    expect(text).toContain("127.0.0.1:6379:6379");
    expect(text).toContain("image: postgres:16");
  });

  it("keeps secret env files out of the Docker build context", () => {
    const text = readFileSync(dockerignorePath, "utf8");
    expect(text).toMatch(/^\.env$/m);
    expect(text).toMatch(/^\.env\.\*$/m);
    expect(text).toContain("!.example.env");
  });
});
