import { runSupportScript } from "../support/commands";
import { TEST_NPUB } from "../support/nostr-test-keys";

function seedAttachedChain(
  mode: "offset" | "fixed",
  parentUnix: number,
  childArg: number
): Cypress.Chainable<{ parentId: string; childId: string }> {
  return runSupportScript(
    "tests/e2e/support/create-attached-followup-chain.ts",
    [TEST_NPUB, mode, String(parentUnix), String(childArg)],
    { failOnNonZeroExit: false }
  ).then(({ stdout }) => {
    const parentId = stdout
      .match(/<parentId>\s*([^<]+)\s*<\/parentId>/s)?.[1]
      ?.trim();
    const childId = stdout
      .match(/<childId>\s*([^<]+)\s*<\/childId>/s)?.[1]
      ?.trim();
    expect(parentId, "seeded parentId").to.be.a("string").and.not.empty;
    expect(childId, "seeded childId").to.be.a("string").and.not.empty;
    return { parentId: parentId as string, childId: childId as string };
  });
}

function getScheduledUnix(postId: string): Cypress.Chainable<number> {
  return runSupportScript(
    "tests/e2e/support/get-post-schedule.ts",
    [TEST_NPUB, postId],
    { failOnNonZeroExit: false }
  ).then(({ stdout }) => {
    const raw = stdout
      .match(/<scheduledAtUnix>\s*([^<]+)\s*<\/scheduledAtUnix>/s)?.[1]
      ?.trim();
    const unix = Number(raw);
    expect(Number.isFinite(unix), "scheduledAtUnix is finite").to.eq(true);
    return unix;
  });
}

describe("Core: Follow-up chain integrity", () => {
  beforeEach(() => {
    cy.loginNostr({ npub: TEST_NPUB });
  });

  afterEach(() => {
    cy.cleanupNostrUser({ npub: TEST_NPUB });
  });

  it("preserves offset child relation after parent reschedule", () => {
    const nowUnix = Math.floor(Date.now() / 1000);
    const initialParentUnix = nowUnix + 3600;
    const offsetSeconds = 2 * 3600;
    const nextParentUnix = initialParentUnix + 3600;

    seedAttachedChain("offset", initialParentUnix, offsetSeconds).then(
      ({ parentId, childId }) => {
        cy.request({
          method: "POST",
          url: "/dashboard/calendar",
          form: true,
          failOnStatusCode: false,
          body: {
            action: "reschedule",
            postId: parentId,
            newTime: String(nextParentUnix),
            overrideQueue: "false",
          },
        }).then((response) => {
          expect(response.status).to.be.oneOf([200, 302]);
        });

        getScheduledUnix(parentId).then((parentUnix) => {
          getScheduledUnix(childId).then((childUnix) => {
            expect(parentUnix).to.eq(nextParentUnix);
            expect(childUnix).to.eq(nextParentUnix + offsetSeconds);
          });
        });
      }
    );
  });

  it("clamps fixed-time child to not precede parent after parent reschedule", () => {
    const nowUnix = Math.floor(Date.now() / 1000);
    const initialParentUnix = nowUnix + 3600;
    const initialChildUnix = initialParentUnix + 600;
    const nextParentUnix = initialParentUnix + 3 * 3600;

    seedAttachedChain("fixed", initialParentUnix, initialChildUnix).then(
      ({ parentId, childId }) => {
        cy.request({
          method: "POST",
          url: "/dashboard/calendar",
          form: true,
          failOnStatusCode: false,
          body: {
            action: "reschedule",
            postId: parentId,
            newTime: String(nextParentUnix),
            overrideQueue: "false",
          },
        }).then((response) => {
          expect(response.status).to.be.oneOf([200, 302]);
        });

        getScheduledUnix(parentId).then((parentUnix) => {
          getScheduledUnix(childId).then((childUnix) => {
            expect(parentUnix).to.eq(nextParentUnix);
            expect(childUnix).to.be.gte(parentUnix);
          });
        });
      }
    );
  });
});
