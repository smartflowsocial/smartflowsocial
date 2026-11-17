/* eslint-disable testing-library/prefer-screen-queries -- Cypress specs use cy commands, not RTL render queries. */
import { runSupportScript } from "../support/commands";
import { TEST_NPUB } from "../support/nostr-test-keys";

function seedPostedPost(caption: string): Cypress.Chainable<string> {
  return runSupportScript(
    "tests/e2e/support/create-posted-post.ts",
    [TEST_NPUB, caption],
    { failOnNonZeroExit: false }
  ).then(({ stdout }) => {
    const postId = stdout
      .match(/<postId>\s*([^<]+)\s*<\/postId>/s)?.[1]
      ?.trim();
    expect(postId, "seeded posted postId").to.be.a("string").and.not.empty;
    return postId as string;
  });
}

describe("Core: Published lifecycle", () => {
  beforeEach(() => {
    cy.loginNostr({ npub: TEST_NPUB });
  });

  afterEach(() => {
    cy.cleanupNostrUser({ npub: TEST_NPUB });
  });

  it("loads published page and shows seeded posted row", () => {
    const caption = `e2e-pub-${Date.now().toString().slice(-6)}`;
    seedPostedPost(caption).then(() => {
      cy.visitAndCheck("/dashboard/published");
      cy.assertPathname("/dashboard/published");
      cy.getByTestId("published-type-segments").should("be.visible");
      cy.contains(caption, { timeout: 20000 }).should("be.visible");
    });
  });

  it("deletes posted row via published action endpoint", () => {
    const caption = `e2e-del-pub-${Date.now().toString().slice(-6)}`;
    seedPostedPost(caption).then((postId) => {
      cy.request({
        method: "POST",
        url: "/dashboard/published",
        form: true,
        body: {
          _action: "delete",
          postId,
        },
      })
        .its("status")
        .should("be.oneOf", [200, 302]);

      cy.visitAndCheck("/dashboard/published");
      cy.contains(caption).should("not.exist");
    });
  });
});
/* eslint-enable testing-library/prefer-screen-queries */
