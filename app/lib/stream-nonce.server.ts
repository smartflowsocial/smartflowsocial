import type { RenderToPipeableStreamOptions } from "react-dom/server";

/**
 * Attach the request CSP nonce to a `renderToPipeableStream` call.
 *
 * `<ServerRouter nonce>` covers the scripts React Router renders. React still
 * writes its own inline scripts for shell timing and suspense reveal, and
 * those only receive a nonce from this option. A string nonce applies to
 * scripts and not styles, so `style-src` can keep `'unsafe-inline'`.
 */
export function withStreamNonce(
  nonce: string | undefined,
  options: RenderToPipeableStreamOptions
): RenderToPipeableStreamOptions {
  if (!nonce) return options;
  return { ...options, nonce };
}
