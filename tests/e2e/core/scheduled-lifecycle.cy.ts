import { runSupportScript } from "../support/commands";
import { TEST_NPUB } from "../support/nostr-test-keys";

function seedScheduledPost(caption: string): Cypress.Chainable<string> {
  return runSupportScript(
    "tests/e2e/support/create-scheduled-post.ts",
    [TEST_NPUB, caption],
    { failOnNonZeroExit: false }
  ).then(({ stdout }) => {
    const postId = stdout
      .match(/<postId>\s*([^<]+)\s*<\/postId>/s)?.[1]
      ?.trim();
    expect(postId, "seeded scheduled postId").to.be.a("string").and.not.empty;
    return postId as string;
  });
}

describe("Core: Scheduled lifecycle", () => {
  beforeEach(() => {
    cy.loginNostr({ npub: TEST_NPUB });
  });

  afterEach(() => {
    cy.cleanupNostrUser({ npub: TEST_NPUB });
  });

  it("opens edit flow from scheduled actions", () => {
    const caption = `e2e-edit-${Date.now().toString().slice(-6)}`;

    seedScheduledPost(caption).then((postId) => {
      cy.visitAndCheck(
        `/dashboard/compose?type=post&mode=edit_scheduled&id=${encodeURIComponent(postId)}`
      );
      cy.assertPathname("/dashboard/compose");
      cy.location("search").should("include", "mode=edit_scheduled");
      cy.location("search").should("include", `id=${postId}`);
    });
  });

  it("shows reschedule action entry point for scheduled post", () => {
    const caption = `e2e-res-${Date.now().toString().slice(-6)}`;

    seedScheduledPost(caption).then(() => {
      cy.visitAndCheck("/dashboard/scheduled");
      cy.contains("tr", caption, { timeout: 20000 }).within(() => {
        cy.get('button[aria-label="Actions"]').should("be.visible");
      });
    });
  });

  it("moves scheduled post to drafts", () => {
    const caption = `e2e-draft-${Date.now().toString().slice(-6)}`;

    seedScheduledPost(caption).then((postId) => {
      cy.request({
        method: "POST",
        url: "/dashboard/scheduled",
        form: true,
        body: {
          _action: "moveToDraft",
          postId,
          type: "post",
        },
      })
        .its("status")
        .should("be.oneOf", [200, 302]);

      cy.visitAndCheck("/dashboard/drafts");
      cy.contains(caption, { timeout: 20000 }).should("be.visible");
    });
  });

  it("deletes scheduled post from actions", () => {
    const caption = `e2e-del-${Date.now().toString().slice(-6)}`;

    seedScheduledPost(caption).then((postId) => {
      cy.request({
        method: "POST",
        url: "/dashboard/scheduled",
        form: true,
        body: {
          _action: "delete",
          postId,
        },
      })
        .its("status")
        .should("be.oneOf", [200, 302]);

      cy.visitAndCheck("/dashboard/scheduled");
      cy.contains("tr", caption, { timeout: 20000 }).should("not.exist");
    });
  });
});
