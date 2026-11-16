import { createContext, type RouterContext } from "react-router";

const nonceKey = Symbol.for("smartflow.nonceContext");

const processGlobals = globalThis as typeof globalThis & {
  [nonceKey]?: RouterContext<string | null>;
};

/**
 * One context key for the Express process and the Vite server build.
 * Those two module graphs would otherwise each call createContext(), and
 * context.get() throws when the keys differ. `null` is the unset default so
 * a request without a nonce does not 500.
 */
export const nonceContext: RouterContext<string | null> =
  processGlobals[nonceKey] ??
  (processGlobals[nonceKey] = createContext<string | null>(null));
