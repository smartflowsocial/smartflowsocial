/**
 * Shared setup for longform action tests
 *
 * Provides common mocks and utilities for longform action handler tests
 */

import { vi } from "vitest";

import { readMockMultipartFormData } from "../../utils/action-test-helpers";

// Mock global fetch
global.fetch = vi.fn();

// Mock Prisma - use vi.hoisted to allow top-level variables in mocks
const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma2 = {
    $use: vi.fn(),
    post: {
      count: vi.fn().mockResolvedValue(0),
    },
    longFormPost: {
      count: vi.fn().mockResolvedValue(0),
    },
    queueType: {
      findFirst: vi.fn(),
    },
    subscription: {
      findUnique: vi.fn().mockResolvedValue({
        planId: "creator",
        status: "ACTIVE",
        currentPeriodEnd: new Date(Date.now() + 86400000),
        Plan: { id: "creator", name: "Creator" },
      }),
    },
  };
  return { mockPrisma: mockPrisma2 };
});

export { mockPrisma };

vi.mock("~/lib/prisma.server", () => ({
  prisma: mockPrisma,
}));

// Mock dependencies (longform.server: createLongFormEvent, generateArticleIdentifier only)
vi.mock("~/features/posts/longform.server", () => ({
  createLongFormEvent: vi.fn(),
  generateArticleIdentifier: vi.fn((t: string) =>
    t.toLowerCase().replace(/\s+/g, "-").substring(0, 64)
  ),
}));

vi.mock("~/features/upload/s3.server", () => ({
  createUploadHandler: vi.fn(() => vi.fn()),
  uploadBufferToS3: vi.fn(),
}));

vi.mock("~/lib/markdown-sanitizer.server", () => ({
  sanitizeMarkdown: vi.fn((content: string) => `Sanitized: ${content}`),
  generateSummary: vi.fn((content: string) => {
    const contentStr = typeof content === "string" ? content : String(content);
    return `Summary of ${contentStr.substring(0, 50)}`;
  }),
}));

// Mock use cases
export const mockCreateLongFormPostExecute = vi.fn();
export const mockPublishLongFormNowExecute = vi.fn();
export const mockScheduleLongFormPostExecute = vi.fn();

vi.mock("~/features/posts/server", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- importOriginal type
    ...(actual ?? {}),
    CreateLongFormPostUseCase: class {
      execute = mockCreateLongFormPostExecute;
    },
    PublishLongFormNowUseCase: class {
      execute = mockPublishLongFormNowExecute;
    },
    ScheduleLongFormPostUseCase: class {
      execute = mockScheduleLongFormPostExecute;
    },
    createLongformDraftVersion: vi.fn().mockResolvedValue(undefined),
  };
});

// newlongform-action imports use cases from these paths, not from ~/features/posts/server
vi.mock(
  "~/features/posts/longform/use-cases/create-longform-post.use-case.server",
  () => ({
    CreateLongFormPostUseCase: class {
      execute = mockCreateLongFormPostExecute;
    },
  })
);
vi.mock(
  "~/features/posts/longform/use-cases/publish-longform-now.use-case.server",
  () => ({
    PublishLongFormNowUseCase: class {
      execute = mockPublishLongFormNowExecute;
    },
  })
);
vi.mock(
  "~/features/posts/longform/use-cases/schedule-longform-post.use-case.server",
  () => ({
    ScheduleLongFormPostUseCase: class {
      execute = mockScheduleLongFormPostExecute;
    },
  })
);

vi.mock("~/lib/correlation-context.server", () => ({
  extractCorrelationId: vi.fn(() => "test-correlation-id"),
}));

vi.mock("~/features/posts/services/queue-type-resolver.server", () => ({
  resolveQueueTypeId: vi.fn((userId, queueTypeId, queueType) => {
    if (queueTypeId) return Promise.resolve(queueTypeId);
    if (queueType === "posts") return Promise.resolve("queue-1");
    if (queueType === "Unassigned" || !queueType) return Promise.resolve(null);
    return Promise.resolve(null);
  }),
}));

vi.mock("~/features/relays/relay-resolution.server", async (importOriginal) => {
  // import() type position is disallowed by consistent-type-imports; module shape is only for spread.
  const actual = await importOriginal<
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vitest importOriginal requires module type
    typeof import("~/features/relays/relay-resolution.server")
  >();
  const relays = ["wss://relay.example.com"];
  return {
    ...actual,
    resolveExecutionRelays: vi.fn().mockResolvedValue(relays),
    resolveExecutionRelaysFromForm: vi.fn().mockResolvedValue(relays),
  };
});

vi.mock("~/features/posts/drafts/services/draft-version.server", () => ({
  createLongformDraftVersion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/features/user", () => ({
  getUserById: vi.fn(),
  getQueueTypes: vi.fn(),
  getHashTagPresetById: vi.fn(),
  getQueueTypeByNameForUser: vi.fn(),
}));

// Store FormData objects for mock access
export const formDataStore = new Map<string, FormData>();

vi.mock("@remix-run/form-data-parser", () => ({
  parseFormData: vi.fn(
    async (request: { url?: string; formData?: () => Promise<FormData> }) =>
      readMockMultipartFormData(formDataStore, request)
  ),
}));
