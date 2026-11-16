/**
 * Auth Feature Public API
 *
 * This module exports the public API for authentication-related operations.
 * Internal implementation details are kept in components/ directory.
 *
 * Usage:
 *   import { NostrAuthButton } from "~/features/auth";
 *   import { requireUserId } from "~/features/auth/auth.server";
 *
 * Do NOT import from internal paths like:
 *   import { ... } from "./components/..."  // ❌ Bad
 */

export { default as NostrAuthButton } from "./components/NostrAuthButton";
export { default as LoginPage } from "./components/LoginPage";
export { RemoteSignerReconnectController } from "./components/RemoteSignerReconnectController";
export { RemoteSignerReconnectDialog } from "./components/RemoteSignerReconnectController";
export type { ReconnectState } from "./reconnect-state.client";
export {
  RemoteSignerSessionList,
  type RemoteSignerSessionListProps,
  type RemoteSignerSessionItem,
} from "./components/RemoteSignerSessionList";
