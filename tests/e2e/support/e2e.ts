import { registerCommands } from "./commands";

import "@testing-library/cypress/add-commands";
registerCommands();

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
