import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { devComposeProblems } from "../../scripts/check-dev-compose.mjs";

const composePath = path.resolve(process.cwd(), "docker-compose.yml");
const selfHostComposePath = path.resolve(
  process.cwd(),
  "docker-compose.self-host.yml"
);
const cleanRoomComposePath = path.resolve(
  process.cwd(),
  "docker-compose.clean-room.yml"
);
const dockerignorePath = path.resolve(process.cwd(), ".dockerignore");

describe("development compose", () => {
  it("binds published ports to localhost and avoids latest tags", () => {
    const text = readFileSync(composePath, "utf8");
    expect(devComposeProblems(text)).toEqual([]);
    expect(text).toContain("127.0.0.1:5433:5432");
    expect(text).toContain("127.0.0.1:6379:6379");
    expect(text).toContain("image: postgres:16");
  });

  it("keeps the self-host stack on localhost without a Cloudflare publisher", () => {
    const selfHost = readFileSync(selfHostComposePath, "utf8");
    const cleanRoom = readFileSync(cleanRoomComposePath, "utf8");
    expect(devComposeProblems(selfHost)).toEqual([]);
    expect(devComposeProblems(cleanRoom)).toEqual([]);
    expect(selfHost).toContain("SFS_DEPLOYMENT_MODE: self_hosted");
    expect(selfHost).toContain("NOSTR_PUBLISHER_BACKEND: internal");
    expect(selfHost).toContain("NOSTR_READ_BACKEND: internal");
    expect(selfHost).toContain('SELF_HOSTED: "true"');
    expect(selfHost).toContain("restart: unless-stopped");
    expect(selfHost).toContain("127.0.0.1:3011/metrics");
    expect(selfHost).not.toContain("NOSTR_PUBLISHER_URL");
    expect(selfHost).not.toContain("PRIMAL_CACHING_URL");
    expect(cleanRoom).toContain("127.0.0.1:5434:5432");
    expect(cleanRoom).toContain("127.0.0.1:6380:6379");
  });

  it("keeps secret env files out of the Docker build context", () => {
    const text = readFileSync(dockerignorePath, "utf8");
    expect(text).toMatch(/^\.env$/m);
    expect(text).toMatch(/^\.env\.\*$/m);
    expect(text).toContain("!.example.env");
  });
});
