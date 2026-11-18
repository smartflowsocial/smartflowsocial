import { describe, expect, it } from "vitest";

import {
  deploymentIdentityHeaders,
  readDeploymentIdentity,
  wantsDeploymentJson,
} from "~/features/infra/deployment-identity";

describe("deployment identity", () => {
  it("stays unknown when the image was built without a commit", () => {
    const identity = readDeploymentIdentity({}, "1.0.0-beta.1");
    expect(identity.sourceCommitStatus).toBe("unknown");
    expect(identity.buildTimeStatus).toBe("unknown");
    expect(deploymentIdentityHeaders(identity)["X-Source-Commit"]).toBe(
      "unknown"
    );
  });

  it("reports a commit supplied at image build time", () => {
    const sha = "9b1e08cf9a8cf381b640d26c26277e2b0c5ad169";
    const identity = readDeploymentIdentity(
      { SOURCE_COMMIT: sha.toUpperCase(), BUILD_TIME: "2026-11-18T07:02:25Z" },
      "1.0.0-beta.1"
    );
    expect(identity).toMatchObject({
      sourceCommit: sha,
      sourceCommitStatus: "build",
      buildTime: "2026-11-18T07:02:25Z",
      buildTimeStatus: "build",
    });
  });

  it("does not treat a placeholder as a commit", () => {
    const identity = readDeploymentIdentity(
      { SOURCE_COMMIT: "unknown", BUILD_TIME: "today" },
      "1.0.0-beta.1"
    );
    expect(identity.sourceCommit).toBeNull();
    expect(identity.buildTime).toBeNull();
  });

  it("returns JSON only when the client asks for it", () => {
    expect(wantsDeploymentJson(null)).toBe(false);
    expect(wantsDeploymentJson("*/*")).toBe(false);
    expect(wantsDeploymentJson("application/json")).toBe(true);
    expect(wantsDeploymentJson("text/html, application/json;q=0.9")).toBe(true);
  });
});
