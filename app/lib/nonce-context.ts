import { createContext } from "react-router";

/** CSP nonce for the current request. Set by the Express load context. */
export const nonceContext = createContext<string | undefined>(undefined);
