import { describe, expect, it } from "vitest";

import { releaseVersionError } from "../../../scripts/check-release-version.mjs";

describe("release version check", () => {
  it("accepts a tag that matches package.json", () => {
    expect(
      releaseVersionError({
        packageVersion: "1.0.0-beta.3",
        tag: "v1.0.0-beta.3",
      })
    ).toBeNull();
  });

  it("rejects a tag that still carries the previous package version", () => {
    const error = releaseVersionError({
      packageVersion: "1.0.0-beta.1",
      tag: "v1.0.0-beta.2",
    });
    expect(error).toContain("1.0.0-beta.1");
    expect(error).toContain("v1.0.0-beta.2");
  });

  it("rejects an empty tag", () => {
    expect(
      releaseVersionError({ packageVersion: "1.0.0-beta.1", tag: "" })
    ).toContain("v1.2.3");
  });
});
