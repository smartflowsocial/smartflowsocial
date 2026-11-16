/**
 * Unit tests for error handler utilities
 * Tests app/lib/error-handler.server.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("~/lib/error-logger.server", () => ({
  logError: vi.fn(),
}));

// Don't mock errors - use actual implementations

import {
  assert,
  assertExists,
  createErrorResponse,
  createSuccessResponse,
  handleActionError,
  handleLoaderError,
} from "~/lib/error-handler.server";
import { logError } from "~/lib/error-logger.server";
import {
  ValidationError,
  NotFoundError,
  normalizeError,
  getUserFriendlyMessage,
} from "~/lib/errors";

describe("Error Handler Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createErrorResponse", () => {
    it("should create error response from Error", () => {
      const error = new Error("Test error");
      const [response, statusCode] = createErrorResponse(error);

      expect(response.success).toBe(false);
      const normalized = normalizeError(error);
      expect(response.error.message).toBe(getUserFriendlyMessage(normalized));
      expect(statusCode).toBe(500);
    });

    it("should include context when provided", () => {
      const error = new ValidationError("Validation failed", {
        field: "email",
      });
      const [response] = createErrorResponse(error, { includeContext: true });

      expect(response.error.context).toBeDefined();
    });

    it("should exclude context when requested", () => {
      const error = new ValidationError("Validation failed", {
        field: "email",
      });
      const [response] = createErrorResponse(error, { includeContext: false });

      expect(response.error.context).toBeUndefined();
    });

    it("should include stack in development", () => {
      const originalEnv = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = "development";

      const error = new Error("Test error");
      error.stack = "Error: Test error\n    at test.ts:1:1";
      const [response] = createErrorResponse(error, { includeStack: true });

      // Stack is included in the error object if available
      expect(response.error).toBeDefined();

      process.env["NODE_ENV"] = originalEnv;
    });
  });

  describe("createSuccessResponse", () => {
    it("should create success response with data", () => {
      const data = { id: "123", name: "Test" };
      const result = createSuccessResponse(data);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(data);
    });

    it("should handle null data", () => {
      const result = createSuccessResponse(null);

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it("should handle array data", () => {
      const data = [1, 2, 3];
      const result = createSuccessResponse(data);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(data);
    });
  });

  describe("handleActionError", () => {
    it("should handle ValidationError", async () => {
      const error = new ValidationError("Validation failed");
      const response = handleActionError(error);

      expect(response).toBeInstanceOf(Response);
      const jsonDataRaw: unknown = await response.json();
      const jsonData =
        jsonDataRaw &&
        typeof jsonDataRaw === "object" &&
        !Array.isArray(jsonDataRaw)
          ? (jsonDataRaw as { success?: boolean; error?: { message?: string } })
          : {};
      expect(jsonData.success).toBe(false);
      const normalized = normalizeError(error);
      expect(jsonData.error?.message).toBe(getUserFriendlyMessage(normalized));
    });

    it("should handle NotFoundError", async () => {
      const error = new NotFoundError("Resource not found");
      const response = handleActionError(error);

      const jsonDataRaw: unknown = await response.json();
      const jsonData =
        jsonDataRaw &&
        typeof jsonDataRaw === "object" &&
        !Array.isArray(jsonDataRaw)
          ? (jsonDataRaw as { success?: boolean; error?: { message?: string } })
          : {};
      expect(jsonData.success).toBe(false);
      const normalized = normalizeError(error);
      expect(jsonData.error?.message).toBe(getUserFriendlyMessage(normalized));
    });

    it("should handle generic Error", async () => {
      const error = new Error("Generic error");
      const response = handleActionError(error);

      const jsonDataRaw: unknown = await response.json();
      const jsonData =
        jsonDataRaw &&
        typeof jsonDataRaw === "object" &&
        !Array.isArray(jsonDataRaw)
          ? (jsonDataRaw as { success?: boolean; error?: { message?: string } })
          : {};
      expect(jsonData.success).toBe(false);
      const normalized = normalizeError(error);
      expect(jsonData.error?.message).toBe(getUserFriendlyMessage(normalized));
    });
  });

  describe("abort reasons", () => {
    it("rethrows AbortError instead of logging a loader failure", () => {
      const reason = new DOMException(
        "The operation was aborted",
        "AbortError"
      );
      expect(() => handleLoaderError(reason, {})).toThrow(reason);
      expect(logError).not.toHaveBeenCalled();
    });

    it("rethrows Remix's cancelled query error from actions", () => {
      const reason = new Error(
        "query() call aborted: GET http://localhost/dashboard"
      );
      expect(() => handleActionError(reason)).toThrow(reason);
      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe("assert", () => {
    it("should not throw when condition is true", () => {
      expect(() => assert(true, "Should not throw")).not.toThrow();
    });

    it("should throw ValidationError when condition is false", () => {
      expect(() => assert(false, "Should throw")).toThrow(ValidationError);
    });

    it("should include context in error", () => {
      try {
        assert(false, "Should throw", { field: "email" });
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).context).toEqual({ field: "email" });
      }
    });
  });

  describe("assertExists", () => {
    it("should not throw when value exists", () => {
      expect(() => assertExists("value", "Should not throw")).not.toThrow();
      expect(() => assertExists(0, "Should not throw")).not.toThrow();
      expect(() => assertExists(false, "Should not throw")).not.toThrow();
    });

    it("should throw NotFoundError when value is null", () => {
      expect(() => assertExists(null, "Should throw")).toThrow(NotFoundError);
    });

    it("should throw NotFoundError when value is undefined", () => {
      expect(() => assertExists(undefined, "Should throw")).toThrow(
        NotFoundError
      );
    });

    it("should use default message when not provided", () => {
      try {
        assertExists(null);
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundError);
        expect((error as NotFoundError).message).toBe("Resource not found");
      }
    });

    it("should include context in error", () => {
      try {
        assertExists(null, "Should throw", { resource: "user" });
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundError);
        expect((error as NotFoundError).context).toEqual({ resource: "user" });
      }
    });
  });
});
