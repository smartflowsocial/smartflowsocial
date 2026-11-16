import { createContext } from "react-router";

const nonceKey = Symbol.for("smartflow.nonceContext");

// Dev serves this module twice: Node loads it for Express, and Vite bundles
// another copy for the server build. The symbol keeps those copies on one key.
// A second key makes context.get() throw.
/** @type {import("react-router").RouterContext<string | null>} */
export const nonceContext =
  globalThis[nonceKey] ?? (globalThis[nonceKey] = createContext(null));
