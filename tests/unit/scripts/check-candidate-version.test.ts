import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CANDIDATE_VERSION,
  PUBLISHED_BETA_2_AT,
  PUBLISHED_BETA_2_SHA,
  PUBLISHED_RC_AT,
  PUBLISHED_RC_SHA,
  validateWorkingTreeVersions,
} from "../../../scripts/check-candidate-version.mjs";

const HEAD = "d".repeat(40);

function component(
  name: string,
  role: string,
  releaseSha: string | null = null
) {
  return {
    name,
    repository: `smartflowsocial/${name}`,
    role,
    branch: "main",
    releaseSha,
    releaseShaStatus: releaseSha ? "git-tag" : "unknown",
    validationStatus: releaseSha ? "checks-passed" : "unknown",
    productionSha: null,
    productionShaStatus: "unknown",
    stagingSha: null,
    stagingShaStatus: "unknown",
  };
}

function candidate() {
  return {
    version: CANDIDATE_VERSION,
    status: "published-prerelease",
    tag: `v${CANDIDATE_VERSION}`,
    tagPublished: true,
    publishedAt: PUBLISHED_RC_AT as string | null,
    applicationReleaseSha: PUBLISHED_RC_SHA as string | null,
    productionDeployed: false,
    components: [
      {
        ...component("app", "required", PUBLISHED_RC_SHA),
        repository: "smartflowsocial/smartflowsocial",
      },
      {
        ...component("blastr", "optional"),
        repository: "smartflowsocial/smartflowsocial-blastr",
      },
    ],
  };
}

function beta2() {
  return {
    version: "1.0.0-beta.2",
    status: "published-prerelease",
    tag: "v1.0.0-beta.2",
    tagPublished: true,
    publishedAt: PUBLISHED_BETA_2_AT,
    applicationReleaseSha: PUBLISHED_BETA_2_SHA,
    productionDeployed: false,
    components: [
      {
        ...component("app", "required", PUBLISHED_BETA_2_SHA),
        repository: "smartflowsocial/smartflowsocial",
      },
      {
        ...component("publisher", "optional"),
        repository: "smartflowsocial/smartflowsocial-publisher",
      },
    ],
  };
}

describe("working tree versions", () => {
  it("accepts the published rc.1 tag beside the published beta.2 tag", () => {
    expect(
      validateWorkingTreeVersions({
        packageJson: { version: CANDIDATE_VERSION, private: true },
        candidate: candidate(),
        beta2: beta2(),
        headSha: HEAD,
        beta2TagSha: PUBLISHED_BETA_2_SHA,
      })
    ).toEqual([]);
  });

  it("accepts an unreleased candidate that has no release SHA", () => {
    const record = candidate();
    record.status = "unreleased";
    record.tagPublished = false;
    record.publishedAt = null;
    record.applicationReleaseSha = null;
    const unreleasedApp = record.components[0];
    if (!unreleasedApp) throw new Error("app component missing");
    unreleasedApp.releaseSha = null;
    unreleasedApp.releaseShaStatus = "unknown";
    unreleasedApp.validationStatus = "not-validated";
    expect(
      validateWorkingTreeVersions({
        packageJson: { version: CANDIDATE_VERSION, private: true },
        candidate: record,
        beta2: beta2(),
        headSha: HEAD,
        beta2TagSha: PUBLISHED_BETA_2_SHA,
      })
    ).toEqual([]);
  });

  it("rejects a package.json that still says beta.1", () => {
    const errors = validateWorkingTreeVersions({
      packageJson: { version: "1.0.0-beta.1", private: true },
      candidate: candidate(),
      beta2: beta2(),
      headSha: HEAD,
      beta2TagSha: PUBLISHED_BETA_2_SHA,
    });
    expect(errors.join("\n")).toMatch(/1\.0\.0-beta\.1/);
  });

  it("rejects a candidate that already names a SHA or the retired publisher", () => {
    const record = candidate();
    record.applicationReleaseSha = HEAD;
    const publishedApp = record.components[0];
    if (!publishedApp) throw new Error("app component missing");
    publishedApp.releaseSha = HEAD;
    record.components.push({
      ...component("publisher", "optional"),
      repository: "smartflowsocial/smartflowsocial-publisher",
    });
    const errors = validateWorkingTreeVersions({
      packageJson: { version: CANDIDATE_VERSION, private: true },
      candidate: record,
      beta2: beta2(),
      headSha: HEAD,
      beta2TagSha: PUBLISHED_BETA_2_SHA,
    });
    expect(errors.join("\n")).toMatch(/commit that contains this record/);
    expect(errors.join("\n")).toMatch(/must not list publisher/);
  });

  it("matches the files in this checkout", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      version: string;
      private: boolean;
    };
    const candidateRecord = JSON.parse(
      readFileSync("docs/releases/v1.0.0-rc.1.manifest.json", "utf8")
    ) as { version: string };
    const beta2Record = JSON.parse(
      readFileSync("docs/releases/v1.0.0-beta.2.manifest.json", "utf8")
    ) as { applicationReleaseSha: string; productionDeployed: boolean };
    expect(packageJson.version).toBe(CANDIDATE_VERSION);
    expect(candidateRecord.version).toBe(packageJson.version);
    expect(beta2Record.applicationReleaseSha).toBe(PUBLISHED_BETA_2_SHA);
    expect(beta2Record.productionDeployed).toBe(false);
  });
});
