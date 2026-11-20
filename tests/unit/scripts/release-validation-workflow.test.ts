import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("release validation compose checkout", () => {
  const caller = readFileSync(
    ".github/workflows/release-validation.yml",
    "utf8"
  );
  const compose = readFileSync(
    ".github/workflows/self-host-compose.yml",
    "utf8"
  );

  it("sends candidate_sha into the reusable compose workflow", () => {
    expect(caller).toContain("uses: ./.github/workflows/self-host-compose.yml");
    expect(caller).toContain("candidate_sha: ${{ inputs.candidate_sha }}");
  });

  it("checks out that commit instead of the dispatch ref", () => {
    expect(compose).toContain(
      "ref: ${{ inputs.candidate_sha != '' && inputs.candidate_sha || github.sha }}"
    );
    expect(compose).toContain(
      "SOURCE_COMMIT: ${{ inputs.candidate_sha != '' && inputs.candidate_sha || github.sha }}"
    );
    expect(compose).toContain("body.sourceCommit!==expected");
  });
});
