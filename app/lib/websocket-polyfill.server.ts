import { WebSocket } from "ws";

import { env } from "~/lib/env.server";

/**
 * @getalby/sdk and nostr-tools talk to relays over WebSocket. Node did not
 * provide one when this app started, so production installs the `ws` package
 * on `globalThis` before those libraries load. Browsers and current Node
 * already have WebSocket.
 *
 * Import this module for its side effect before `nostr-tools`.
 */
export function ensureServerWebSocket(): void {
  if (env.NODE_ENV === "development") return;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Node versions differ
  if (globalThis.WebSocket !== undefined) return;

  globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
}

ensureServerWebSocket();
