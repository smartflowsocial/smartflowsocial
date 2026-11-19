import { TEST_NPUB } from "../support/nostr-test-keys";

const COMPOSER_TYPES = ["post", "thread", "poll", "article"] as const;

// The publishing rail is a side column from the `lg` breakpoint (1024px) up.
// Cypress's default 1000×660 viewport stacks that rail under the composer.
const RAIL_VIEWPORT = { width: 1280, height: 900 } as const;
const PUBLISH_RAIL = 'aside[aria-label="Publish"]';

const MODE_ARIA_LABEL = {
  now: "Publish now, immediate",
  schedule: "Schedule for a specific time",
  queue: "Add to queue",
} as const;

function publishModeRadio(ariaLabel: string) {
  return cy.get(
    `${PUBLISH_RAIL} [role="radiogroup"][aria-label="Publishing mode"] button[aria-label="${ariaLabel}"]`,
    { timeout: 20000 }
  );
}

function selectPublishMode(mode: keyof typeof MODE_ARIA_LABEL) {
  const ariaLabel = MODE_ARIA_LABEL[mode];
  // Cypress's mouse sequence can skip the click when the rail re-renders
  // between pointerdown and mouseup. A DOM click still reaches the handler.
  publishModeRadio(ariaLabel).should(($button) => {
    const button = $button.get(0);
    if (button.getAttribute("aria-checked") !== "true") button.click();
    expect(button.getAttribute("aria-checked"), ariaLabel).to.eq("true");
  });
}

function assertPrimaryCta(label: string) {
  cy.get(PUBLISH_RAIL, { timeout: 20000 }).within(() => {
    cy.contains("button", new RegExp(`^${label}$`, "i"), {
      timeout: 20000,
    }).should("be.visible");
  });
}

function assertPublishModes() {
  selectPublishMode("now");
  assertPrimaryCta("Publish now");

  selectPublishMode("schedule");
  assertPrimaryCta("Schedule post");

  selectPublishMode("queue");
  assertPrimaryCta("Add to queue");

  cy.get(PUBLISH_RAIL).within(() => {
    cy.contains("button", /Save (as )?draft/i, { timeout: 20000 }).should(
      "be.visible"
    );
  });
}

describe("Core: Composer matrix", () => {
  beforeEach(() => {
    cy.viewport(RAIL_VIEWPORT.width, RAIL_VIEWPORT.height);
    cy.loginNostr({ npub: TEST_NPUB });
  });

  afterEach(() => {
    cy.cleanupNostrUser({ npub: TEST_NPUB });
  });

  COMPOSER_TYPES.forEach((type) => {
    it(`supports now/schedule/queue modes for ${type}`, () => {
      cy.visitAndCheck(`/dashboard/compose?type=${type}`);
      cy.assertPathname("/dashboard/compose");
      cy.get("main", { timeout: 20000 }).should("be.visible");
      cy.location("search").should("include", `type=${type}`);
      assertPublishModes();
    });
  });

  it("shows schedule datetime field for shortform composer", () => {
    cy.visitAndCheck("/dashboard/compose?type=post");
    selectPublishMode("schedule");
    cy.get(`${PUBLISH_RAIL} input[aria-label="Publish date and time"]`, {
      timeout: 20000,
    }).scrollIntoView();
    cy.get(`${PUBLISH_RAIL} input[aria-label="Publish date and time"]`).should(
      "be.visible"
    );
  });
});
