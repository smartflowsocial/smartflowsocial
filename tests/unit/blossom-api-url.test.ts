import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BlossomApiNotConfiguredError,
  resolveBlossomApiBase,
} from "~/features/upload/blossom-api-url";

describe("Blossom API base", () => {
  it("fails closed when the operator did not configure a server", () => {
    expect(() => resolveBlossomApiBase(undefined)).toThrow(
      BlossomApiNotConfiguredError
    );
    expect(() => resolveBlossomApiBase("  ")).toThrow(/is not set/);
    try {
      resolveBlossomApiBase(undefined);
    } catch (error) {
      expect(error instanceof Error ? error.message : "").not.toMatch(
        /smartflow\.social/
      );
    }
  });

  it("uses an explicitly configured hosted or custom server", () => {
    expect(resolveBlossomApiBase("https://blossom-api.smartflow.social")).toBe(
      "https://blossom-api.smartflow.social"
    );
    expect(
      resolveBlossomApiBase("https://blossom-api.smartflow.social/upload/")
    ).toBe("https://blossom-api.smartflow.social");
    expect(resolveBlossomApiBase("https://blossom.example.test/upload")).toBe(
      "https://blossom.example.test"
    );
    expect(resolveBlossomApiBase("http://127.0.0.1:8788")).toBe(
      "http://127.0.0.1:8788"
    );
  });

  it("rejects credentials in the URL", () => {
    expect(() =>
      resolveBlossomApiBase("https://user:secret@blossom.example.test")
    ).toThrow(/credentials/);
  });

  it("does not assign a hosted Blossom URL in the self-host template", () => {
    const assigned = readFileSync("example.env", "utf8")
      .split("\n")
      .filter((line) => /^\s*BLOSSOM_SFS_API_URL\s*=/.test(line));
    expect(assigned).toEqual([]);
  });
});
