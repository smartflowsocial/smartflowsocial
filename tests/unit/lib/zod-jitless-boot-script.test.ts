import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { zodJitlessBootScript } from "~/lib/zod-jitless-boot-script";

function runZodProbe(prelude: string): { status: number; stderr: string } {
  const source = `
${prelude}
const calls = [];
const OriginalFunction = globalThis.Function;
globalThis.Function = function(...args) {
  calls.push(args.map((arg) => String(arg)).join(" "));
  return OriginalFunction(...args);
};
const { z } = await import("zod");
z.object({ name: z.string() }).parse({ name: "starter" });
if (calls.length > 0) {
  console.error(JSON.stringify(calls));
  process.exit(2);
}
`;
  try {
    execFileSync(process.execPath, ["--input-type=module", "--eval", source], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stderr: "" };
  } catch (error) {
    const failed = error as { status?: number; stderr?: string };
    return { status: failed.status ?? 1, stderr: failed.stderr ?? "" };
  }
}

describe("zod jitless boot script", () => {
  it("assigns Zod's jitless flag without eval", () => {
    const script = zodJitlessBootScript();
    expect(script).toContain("jitless:true");
    expect(script).not.toMatch(/eval|Function/);
  });

  it("stops Zod from calling Function when an object schema is created", () => {
    const result = runZodProbe(zodJitlessBootScript());
    expect(result.status).toBe(0);
  });

  it("still calls Function when the boot script has not run", () => {
    const result = runZodProbe("");
    expect(result.status).toBe(2);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
