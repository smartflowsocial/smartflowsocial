/**
 * Opens the production build in a browser.
 *
 * The dev server allows unsafe-inline and unsafe-eval, so this spec is not part
 * of the default Cypress run. The release workflow starts `pnpm start` and then
 * runs this file. A nonce in the HTML is not enough: the sign-in controls render
 * only after hydration, and a CSP violation fails the test.
 */
describe("production CSP", () => {
  function headerText(value: string | string[] | undefined): string {
    if (value == null) return "";
    return Array.isArray(value) ? value.join(" ") : value;
  }

  function directive(csp: string, name: string) {
    return (
      csp
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${name} `) || part === name) ?? ""
    );
  }

  it("serves a per-request script nonce without unsafe script sources", () => {
    cy.request("/").then((first) => {
      cy.request("/").then((second) => {
        const firstPolicy = headerText(
          first.headers["content-security-policy"]
        );
        const secondPolicy = headerText(
          second.headers["content-security-policy"]
        );
        const firstScript = directive(firstPolicy, "script-src");
        const secondScript = directive(secondPolicy, "script-src");
        expect(firstScript, firstPolicy).to.include("'nonce-");
        expect(secondScript, secondPolicy).to.include("'nonce-");
        expect(firstScript).not.to.include("unsafe-inline");
        expect(firstScript).not.to.include("unsafe-eval");
        expect(secondScript).not.to.include("unsafe-inline");
        expect(secondScript).not.to.include("unsafe-eval");
        const firstNonce = /'nonce-([^']+)'/.exec(firstScript)?.[1];
        const secondNonce = /'nonce-([^']+)'/.exec(secondScript)?.[1];
        expect(firstNonce).to.be.a("string");
        expect(secondNonce).to.not.equal(firstNonce);
        const connect = directive(firstPolicy, "connect-src");
        expect(connect).not.to.match(/localhost|127\.0\.0\.1/);
      });
    });
  });

  it("hydrates sign-in without a CSP violation", () => {
    const violations: string[] = [];
    cy.visit("/", {
      onBeforeLoad(win) {
        win.document.addEventListener("securitypolicyviolation", (event) => {
          violations.push(`${event.violatedDirective} ${event.blockedURI}`);
        });
      },
    });

    cy.contains("Preparing sign-in", { timeout: 20000 }).should("not.exist");
    cy.contains("button", "Browser Extension").should("be.visible");
    cy.contains("button", "Remote Signer").focus();
    cy.contains(
      "Best for Amber, nsecBunker, and other NIP-46 remote signers."
    ).should("be.visible");
    cy.then(() => {
      expect(violations, violations.join("\n")).to.deep.equal([]);
    });
  });
});
