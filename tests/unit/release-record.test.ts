import { describe, expect, it } from "vitest";

import {
  PUBLISHED_BETA_SHA,
  validatePublishedBetaManifest,
} from "../../scripts/release-manifest.mjs";
import {
  emptyReleaseRecord,
  validateReleaseRecord,
} from "../../scripts/release-record.mjs";

const HEAD = "a".repeat(40);

interface ReleaseComponent {
  name: string;
  repository: string;
  role: string;
  releaseSha: string | null;
  releaseShaStatus: string;
  validationStatus: string;
  productionSha: string | null;
  productionShaStatus: string;
  stagingSha: string | null;
  stagingShaStatus: string;
}

interface PublishedManifest {
  version: string;
  status: string;
  tag: string;
  tagPublished: boolean;
  publishedAt: string;
  applicationReleaseSha: string | null;
  productionDeployed: boolean;
  components: ReleaseComponent[];
}

function publishedManifest(): PublishedManifest {
  return {
    version: "1.0.0-beta.1",
    status: "published-prerelease",
    tag: "v1.0.0-beta.1",
    tagPublished: true,
    publishedAt: "2026-11-18T07:02:25Z",
    applicationReleaseSha: PUBLISHED_BETA_SHA,
    productionDeployed: false,
    components: [
      {
        name: "app",
        repository: "smartflowsocial/smartflowsocial",
        role: "required",
        releaseSha: PUBLISHED_BETA_SHA,
        releaseShaStatus: "git-tag",
        validationStatus: "checks-finished-after-publication",
        productionSha: null,
        productionShaStatus: "unknown",
        stagingSha: null,
        stagingShaStatus: "unknown",
      },
      {
        name: "publisher",
        repository: "smartflowsocial/smartflowsocial-publisher",
        role: "required-for-relay-delivery",
        releaseSha: null,
        releaseShaStatus: "unknown",
        validationStatus: "unknown",
        productionSha: null,
        productionShaStatus: "unknown",
        stagingSha: null,
        stagingShaStatus: "unknown",
      },
      {
        name: "blossom",
        repository: "smartflowsocial/smartflowsocial-blossom",
        role: "optional",
        releaseSha: null,
        releaseShaStatus: "unknown",
        validationStatus: "unknown",
        productionSha: null,
        productionShaStatus: "unknown",
        stagingSha: null,
        stagingShaStatus: "unknown",
      },
      {
        name: "blastr",
        repository: "smartflowsocial/smartflowsocial-blastr",
        role: "optional",
        releaseSha: null,
        releaseShaStatus: "unknown",
        validationStatus: "unknown",
        productionSha: null,
        productionShaStatus: "unknown",
        stagingSha: null,
        stagingShaStatus: "unknown",
      },
      {
        name: "cache-worker",
        repository: "smartflowsocial/smartflowsocial-cache-worker",
        role: "optional",
        releaseSha: null,
        releaseShaStatus: "unknown",
        validationStatus: "unknown",
        productionSha: null,
        productionShaStatus: "unknown",
        stagingSha: null,
        stagingShaStatus: "unknown",
      },
    ],
  };
}

const packageJson = { version: "1.0.0-beta.1", private: true };

function componentAt(
  manifest: PublishedManifest,
  index: number
): ReleaseComponent {
  const component = manifest.components[index];
  if (!component) throw new Error(`missing component ${index}`);
  return component;
}

describe("published beta manifest", () => {
  it("accepts a later package.json version beside the historical manifest", () => {
    expect(
      validatePublishedBetaManifest(
        publishedManifest(),
        { version: "1.0.0-rc.1", private: true },
        {
          headSha: HEAD,
          tagSha: PUBLISHED_BETA_SHA,
        }
      )
    ).toEqual([]);
  });

  it("accepts the published tag when this commit is a later correction", () => {
    expect(
      validatePublishedBetaManifest(publishedManifest(), packageJson, {
        headSha: HEAD,
        tagSha: PUBLISHED_BETA_SHA,
      })
    ).toEqual([]);
  });

  it("rejects a manifest that still says the tag is unpublished", () => {
    const manifest = publishedManifest();
    manifest.tagPublished = false;
    manifest.status = "prerelease-candidate";
    manifest.applicationReleaseSha = null;
    const app = componentAt(manifest, 0);
    app.releaseSha = null;
    app.releaseShaStatus = "unknown";
    app.validationStatus = "unknown";
    const errors = validatePublishedBetaManifest(manifest, packageJson, {
      headSha: HEAD,
      tagSha: PUBLISHED_BETA_SHA,
    });
    expect(errors.join("\n")).toMatch(/tagPublished must be true/);
  });

  it("rejects a release SHA that is the commit containing the record", () => {
    const manifest = publishedManifest();
    const errors = validatePublishedBetaManifest(manifest, packageJson, {
      headSha: PUBLISHED_BETA_SHA,
      tagSha: PUBLISHED_BETA_SHA,
    });
    expect(errors.join("\n")).toMatch(/commit that contains this record/);
  });

  it("rejects an invented companion release SHA", () => {
    const manifest = publishedManifest();
    const publisher = componentAt(manifest, 1);
    publisher.releaseSha = "b".repeat(40);
    publisher.releaseShaStatus = "validated-commit";
    publisher.validationStatus = "checks-passed";
    const errors = validatePublishedBetaManifest(manifest, packageJson, {
      headSha: HEAD,
      tagSha: PUBLISHED_BETA_SHA,
    });
    expect(errors.join("\n")).toMatch(/publisher was not recorded/);
  });

  it("rejects a production SHA copied from a CI run", () => {
    const manifest = publishedManifest();
    const app = componentAt(manifest, 0);
    app.productionSha = "c".repeat(40);
    app.productionShaStatus = "verified-from-running-service";
    const errors = validatePublishedBetaManifest(manifest, packageJson, {
      headSha: HEAD,
      tagSha: PUBLISHED_BETA_SHA,
    });
    expect(errors.join("\n")).toMatch(/productionDeployed is false/);
  });
});

describe("future release records", () => {
  it("starts unpublished and without a self-referential SHA", () => {
    const record = emptyReleaseRecord("1.0.0-beta.2");
    expect(
      validateReleaseRecord(record, {
        headSha: HEAD,
        required: ["app"],
      })
    ).toEqual([]);
    expect(record.applicationReleaseSha).toBeNull();
    expect(record.productionDeployed).toBe(false);
  });

  it("refuses to mark validation passed when the component SHA is unknown", () => {
    const record = emptyReleaseRecord("1.0.0-beta.2");
    const companion = record.components[1];
    if (!companion) throw new Error("missing companion");
    companion.validationStatus = "checks-passed";
    const errors = validateReleaseRecord(record, {
      headSha: HEAD,
      required: ["app"],
    });
    expect(errors.join("\n")).toMatch(
      /cannot be validated without a releaseSha/
    );
  });
});
