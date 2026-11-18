import { describe, expect, it } from "vitest";

import {
  APP_REQUIRED_CHECKS,
  evaluateRequiredChecks,
  releaseInputErrors,
} from "../../scripts/release-checks.mjs";

interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  completed_at: string | null;
}

function run(
  name: string,
  conclusion: string,
  completedAt: string,
  status = "completed"
): CheckRun {
  return { name, status, conclusion, completed_at: completedAt };
}

const candidate = "a".repeat(40);
const publisher = "b".repeat(40);

describe("release check evaluation", () => {
  it("passes when the latest required run succeeded", () => {
    const runs = APP_REQUIRED_CHECKS.flatMap((name, index) => [
      run(name, "failure", `2026-11-18T07:0${index}:00Z`),
      run(name, "success", `2026-11-18T08:0${index}:00Z`),
    ]);
    expect(evaluateRequiredChecks(runs, APP_REQUIRED_CHECKS)).toEqual([]);
  });

  it("fails a pending required check even when an older run succeeded", () => {
    const runs = [
      run("Tests & Coverage", "success", "2026-11-18T07:01:00Z"),
      {
        name: "Tests & Coverage",
        status: "in_progress",
        conclusion: null,
        completed_at: null,
      },
    ];
    expect(evaluateRequiredChecks(runs, ["Tests & Coverage"])).toEqual([
      { name: "Tests & Coverage", result: "pending" },
    ]);
  });

  it("fails a skipped required check", () => {
    expect(
      evaluateRequiredChecks(
        [run("E2E Smoke", "skipped", "2026-11-18T07:00:00Z")],
        ["E2E Smoke"]
      )
    ).toEqual([{ name: "E2E Smoke", result: "skipped" }]);
  });

  it("does not treat a skipped optional check as a required failure", () => {
    const runs = [
      run("E2E Smoke", "success", "2026-11-18T07:00:00Z"),
      run("E2E Core (full, optional)", "skipped", "2026-11-18T07:00:01Z"),
    ];
    expect(evaluateRequiredChecks(runs, ["E2E Smoke"])).toEqual([]);
  });

  it("fails when a required check never ran", () => {
    expect(evaluateRequiredChecks([], ["Gitleaks"])).toEqual([
      { name: "Gitleaks", result: "missing" },
    ]);
  });

  it("rejects a different checkout and a missing publisher SHA", () => {
    expect(
      releaseInputErrors({
        candidateSha: candidate,
        publisherSha: "",
        ownerApproval: "approve-release",
        headSha: publisher,
        expectHead: true,
      }).join("\n")
    ).toMatch(/publisher_sha/);
    expect(
      releaseInputErrors({
        candidateSha: candidate,
        publisherSha: publisher,
        ownerApproval: "yes",
        headSha: candidate,
        expectHead: true,
      }).join("\n")
    ).toMatch(/approve-release/);
    expect(
      releaseInputErrors({
        candidateSha: candidate,
        publisherSha: publisher,
        ownerApproval: "approve-release",
        headSha: publisher,
        expectHead: true,
      }).join("\n")
    ).toMatch(/checked out/);
  });
});
