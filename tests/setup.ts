/**
 * Vitest setup file
 * This file runs before all tests and configures the test environment
 */

import { createRequire } from "node:module";

import "dotenv/config";
import "@testing-library/jest-dom/vitest";
// eslint-disable-next-line testing-library/no-manual-cleanup -- vitest is not configured with globals: true, so RTL's auto-cleanup never runs; we wire it through the global afterEach below.
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { evaluateTestDatabase } from "~/lib/test-database-target";

const requireModule = createRequire(import.meta.url);
if (typeof globalThis.WebSocket === "undefined") {
  type WebSocketConstructor = new (
    url: string | URL,
    protocols?: string | string[]
  ) => unknown;
  const wsModule = requireModule("ws") as {
    WebSocket?: WebSocketConstructor;
    default?: WebSocketConstructor;
  };
  const webSocketCtor =
    typeof wsModule.WebSocket === "function"
      ? wsModule.WebSocket
      : typeof wsModule.default === "function"
        ? wsModule.default
        : undefined;
  if (webSocketCtor) {
    (globalThis as unknown as { WebSocket: WebSocketConstructor }).WebSocket =
      webSocketCtor;
  }
}

// Clean up after each test
afterEach(() => {
  // @testing-library/react's auto-cleanup only fires when the test runner
  // exposes a global `afterEach` hook at module load (e.g. with
  // `vitest --globals`). We don't enable globals, so unmount + DOM teardown
  // has to be requested explicitly here. Without this, multiple `render()`
  // calls across separate tests in the same jsdom environment leak nodes
  // and break `screen.getByX` queries with "found multiple elements".
  cleanup();
  vi.clearAllMocks();
});

// Mock environment variables if needed

process.env["NODE_ENV"] = process.env["NODE_ENV"] || "test";

// Set required environment variables for tests
// These are needed by modules that check env vars at import time
const DISPOSABLE_TEST_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/smartflow_test";

// Never copy DATABASE_URL into TEST_DATABASE_URL. An application database,
// including a production URL already exported in the shell, is not a test target.
// After the test URL is accepted, this process uses that URL for DATABASE_URL too,
// so a unit test that opens Prisma cannot reach the application database.
const configuredTestUrl = process.env["TEST_DATABASE_URL"]?.trim();
const testDatabaseCandidate =
  configuredTestUrl && configuredTestUrl.length > 0
    ? configuredTestUrl
    : DISPOSABLE_TEST_DATABASE_URL;
const testDatabaseDecision = evaluateTestDatabase({
  testDatabaseUrl: testDatabaseCandidate,
  appDatabaseUrl: process.env["DATABASE_URL"],
});
if (!testDatabaseDecision.ok) {
  throw new Error(testDatabaseDecision.message);
}
process.env["TEST_DATABASE_URL"] = testDatabaseDecision.url;
process.env["DATABASE_URL"] = testDatabaseDecision.url;

// The default test URL is disposable and local. SKIP_DATABASE_TESTS=true still
// skips database suites.
process.env["SKIP_DATABASE_TESTS"] ??= "false";

process.env["SESSION_SECRET"] ??=
  "test-session-secret-very-long-and-secure-32-chars-minimum";

// Required by centralized env validation
process.env["NOSTR_PUBLISHER_URL"] ??= "http://localhost:3001/publish";
process.env["REDIS_URL"] ??= "redis://localhost:6379";

// Suppress console errors in tests (optional - remove if you want to see them)
// global.console = {
//   ...console,
//   error: vi.fn(),
//   warn: vi.fn(),
// };
