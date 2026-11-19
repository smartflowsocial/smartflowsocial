import { registerCommands } from "./commands";

import "@testing-library/cypress/add-commands";
registerCommands();

// Cypress inserts a blank text node into <head> while the document loads.
// React 19 hydrates <head> and throws when that text node sits where a
// <link> belongs. A normal browser does not insert it. Removing the blank
// nodes keeps that Cypress artifact from hiding a real hydration mismatch.
Cypress.on("window:before:load", (win) => {
  const dropBlankHeadText = () => {
    for (const node of Array.from(win.document.head.childNodes)) {
      if (
        node.nodeType === win.Node.TEXT_NODE &&
        !(node.textContent ?? "").trim()
      ) {
        node.remove();
      }
    }
  };
  dropBlankHeadText();
  const observer = new win.MutationObserver(dropBlankHeadText);
  observer.observe(win.document.head, { childList: true });
  win.addEventListener(
    "DOMContentLoaded",
    () => {
      dropBlankHeadText();
      observer.disconnect();
    },
    { once: true }
  );
});

Cypress.on("uncaught:exception", (err) => {
  if (
    Cypress.expose("ALLOW_HYDRATION_EXCEPTIONS") !== true &&
    Cypress.expose("ALLOW_HYDRATION_EXCEPTIONS") !== "true"
  ) {
    return;
  }

  // Opt-in only. Release validation and the E2E workflows leave this unset
  // or false so a React hydration error fails the run. Set
  // ALLOW_HYDRATION_EXCEPTIONS=true for one local spec that still needs it.
  if (
    /hydrat/i.test(err.message) ||
    /Minified React error #418|#423/.test(err.message)
  ) {
    return false;
  }
});
