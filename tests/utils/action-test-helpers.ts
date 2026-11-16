/**
 * Action handler test helpers
 *
 * Provides reusable mocks and builders for action handler tests
 * to reduce duplication in large test files like newlongform-action.test.ts
 */

import { vi } from "vitest";

/**
 * Create a mock FormData store for Remix upload handler tests
 * This allows tests to set FormData before creating Request objects
 */
export class FormDataStore {
  private readonly store = new Map<string, FormData>();

  set(url: string, formData: FormData): void {
    this.store.set(url, formData);
  }

  get(url: string): FormData | undefined {
    return this.store.get(url);
  }

  delete(url: string): void {
    this.store.delete(url);
  }

  clear(): void {
    this.store.clear();
  }
}

interface MockFormRequest {
  url?: string;
  formData?: () => Promise<FormData>;
}

/**
 * Form body used by tests that mock `parseFormData`.
 * Prefers a FormData stored under the request URL, then the request body.
 */
export async function readMockMultipartFormData(
  store: {
    get(url: string): FormData | undefined;
    delete(url: string): unknown;
  },
  request: MockFormRequest
): Promise<FormData> {
  const url = typeof request.url === "string" ? request.url : "";
  const storedFormData = store.get(url);
  if (storedFormData) {
    store.delete(url);
    return storedFormData;
  }

  try {
    if (typeof request.formData === "function") {
      return await request.formData();
    }
  } catch {
    // Request body was not form data.
  }
  return new FormData();
}

/**
 * Create mock use case classes
 */
export function createMockUseCase(executeFn: ReturnType<typeof vi.fn>) {
  return class {
    execute = executeFn;
  };
}

/**
 * Setup default use case mocks
 */
export interface UseCaseMocks {
  createLongFormPost?: ReturnType<typeof vi.fn>;
  publishLongFormNow?: ReturnType<typeof vi.fn>;
  scheduleLongFormPost?: ReturnType<typeof vi.fn>;
  createPost?: ReturnType<typeof vi.fn>;
  publishNow?: ReturnType<typeof vi.fn>;
  schedulePost?: ReturnType<typeof vi.fn>;
}

export function setupUseCaseMocks(mocks: UseCaseMocks = {}) {
  const {
    createLongFormPost = vi.fn().mockResolvedValue({
      post: { id: "longform-123", title: "Test Post", isPublished: false },
      needsScheduling: false,
    }),
    publishLongFormNow = vi.fn().mockResolvedValue(undefined),
    scheduleLongFormPost = vi.fn().mockResolvedValue(undefined),
    createPost = vi.fn().mockResolvedValue({ post: { id: "post-123" } }),
    publishNow = vi.fn().mockResolvedValue(undefined),
    schedulePost = vi.fn().mockResolvedValue(undefined),
  } = mocks;

  return {
    createLongFormPost,
    publishLongFormNow,
    scheduleLongFormPost,
    createPost,
    publishNow,
    schedulePost,
  };
}

/**
 * Setup default user mocks for action handlers
 */
export function setupActionUserMocks(
  overrides: {
    getUserById?: ReturnType<typeof vi.fn>;
    getQueueTypes?: ReturnType<typeof vi.fn>;
    getHashTagPresetById?: ReturnType<typeof vi.fn>;
    getQueueTypeByNameForUser?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const {
    getUserById,
    getQueueTypes,
    getHashTagPresetById,
    getQueueTypeByNameForUser,
  } = overrides;

  // Default implementations if not provided
  if (getUserById && !getUserById.mock.calls.length) {
    getUserById.mockResolvedValue({
      id: "user-123",
      userRelays: ["wss://relay1.com", "wss://relay2.com"],
      showHashTagsinPosts: true,
    });
  }

  if (getQueueTypes && !getQueueTypes.mock.calls.length) {
    getQueueTypes.mockResolvedValue([
      { id: "queue-1", name: "posts" },
      { id: "unassigned", name: "Unassigned" },
    ]);
  }

  if (
    getQueueTypeByNameForUser &&
    !getQueueTypeByNameForUser.mock.calls.length
  ) {
    getQueueTypeByNameForUser.mockResolvedValue({
      id: "queue-1",
      name: "posts",
    });
  }

  return {
    getUserById,
    getQueueTypes,
    getHashTagPresetById,
    getQueueTypeByNameForUser,
  };
}

/**
 * Common action test scenarios
 */
export const actionScenarios = {
  /**
   * Setup for image upload action
   */
  imageUpload: {
    formData: (imageUrl: string) => {
      const formData = new FormData();
      formData.append("_action", "upload-image");
      formData.append("imageFile", imageUrl);
      return formData;
    },
  },

  /**
   * Setup for save draft action
   */
  saveDraft: {
    formData: (title: string, content: string) => {
      const formData = new FormData();
      formData.append("_action", "save-draft");
      formData.append("title", title);
      formData.append("content", content);
      return formData;
    },
  },

  /**
   * Setup for publish action
   */
  publish: {
    formData: (
      title: string,
      content: string,
      signedEvent: string,
      nostrEvent: string
    ) => {
      const formData = new FormData();
      formData.append("_action", "publish");
      formData.append("title", title);
      formData.append("content", content);
      formData.append("signedEvent", signedEvent);
      formData.append("nostrEvent", nostrEvent);
      return formData;
    },
  },

  /**
   * Setup for schedule action
   */
  schedule: {
    formData: (title: string, content: string, scheduledFor: string) => {
      const formData = new FormData();
      formData.append("_action", "schedule-longform");
      formData.append("title", title);
      formData.append("content", content);
      formData.append("scheduledFor", scheduledFor);
      return formData;
    },
  },
};

/**
 * Loaders and actions may return a Response, a single-fetch `data()` result,
 * or a plain object. Tests still assert on status and JSON.
 */
async function unwrapDeferred(result: unknown): Promise<unknown> {
  if (
    result instanceof Response ||
    result == null ||
    typeof result !== "object"
  ) {
    return result;
  }
  if (
    "type" in result &&
    (result as { type?: unknown }).type === "DataWithResponseInit" &&
    "data" in result
  ) {
    return {
      ...result,
      data: await unwrapDeferred((result as { data: unknown }).data),
    };
  }
  const keys = Object.keys(result);
  if (keys.length === 1) {
    const value = (result as Record<string, unknown>)[keys[0] ?? ""];
    if (value instanceof Promise) return await value;
  }
  return result;
}

export async function asRouteResponse(result: unknown): Promise<Response> {
  result = await unwrapDeferred(result);
  if (result instanceof Response) return result;
  if (
    result !== null &&
    typeof result === "object" &&
    "type" in result &&
    (result as { type?: unknown }).type === "DataWithResponseInit" &&
    "data" in result
  ) {
    const init = (result as { init?: number | ResponseInit | null }).init;
    const responseInit =
      typeof init === "number" ? { status: init } : (init ?? undefined);
    return Response.json((result as { data: unknown }).data, responseInit);
  }
  return Response.json(result ?? null);
}
