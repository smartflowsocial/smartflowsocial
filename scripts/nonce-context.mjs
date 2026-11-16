import { createContext } from "react-router";

// One module instance shared by the Express server and the route server build.
// A bundled copy would be a different context key, and get() would throw.
/** @type {import("react-router").RouterContext<string | null>} */
export const nonceContext = createContext(null);
