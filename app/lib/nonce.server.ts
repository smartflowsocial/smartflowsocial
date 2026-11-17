import type { LoaderFunctionArgs } from "react-router";

import { nonceContext } from "#nonce-context";

export function readRequestNonce(
  context: LoaderFunctionArgs["context"]
): string | undefined {
  const nonce = context.get(nonceContext);
  return typeof nonce === "string" ? nonce : undefined;
}
