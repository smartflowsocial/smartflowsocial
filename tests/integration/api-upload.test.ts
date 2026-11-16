/**
 * Integration tests for upload API route
 *
 * Tests the API endpoint in app/routes/api.upload.tsx
 */

import { RouterContextProvider } from "react-router";
import { describe, it, expect, vi, beforeEach } from "vitest";
// Mock dependencies
vi.mock("~/features/auth/auth.server", () => ({
  requireUserId: vi.fn(),
}));

vi.mock("~/features/user", () => ({
  loadUploadProviderSettings: vi.fn(),
}));

vi.mock("~/lib/env.server", () => ({
  env: {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
    SESSION_SECRET: "12345678901234567890123456789012",
    NOSTR_PUBLISHER_URL: "https://publisher.example.com",
    REDIS_URL: "redis://localhost:6379",
    STORAGE_REGION: "us-east-1",
    STORAGE_BUCKET: "test-bucket",
    STORAGE_ACCESS_KEY: "test-access-key",
    STORAGE_SECRET: "test-secret",
  },
}));

vi.mock("~/features/upload/s3.server", () => ({
  createUploadHandler: vi.fn(() => vi.fn()),
}));

vi.mock("@remix-run/form-data-parser", () => ({
  parseFormData: vi.fn(async () => {
    const formData = new FormData();
    formData.append("file", "https://example.com/uploaded-file.jpg");
    return formData;
  }),
}));

import { asRouteResponse } from "../utils/action-test-helpers";
import { TEST_USER_ID } from "../utils/test-helpers";

import { requireUserId } from "~/features/auth/auth.server";
import { loadUploadProviderSettings } from "~/features/user";
import { action, loader } from "~/routes/api.upload";

describe("API: Upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(TEST_USER_ID);
    (loadUploadProviderSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: "S3",
    });
  });

  describe("Action Handler", () => {
    describe("Successful Requests", () => {
      it("should upload file and return URL", async () => {
        const request = new Request("http://localhost:3000/api/upload", {
          method: "POST",
          headers: {
            "Content-Type":
              "multipart/form-data; boundary=----WebKitFormBoundary",
          },
          body: new FormData(),
        });

        const actionParams: {
          request: Request;
          params: Record<string, string>;
          context: RouterContextProvider;
          url: URL;
          pattern: string;
        } = {
          request,
          params: {},
          context: new RouterContextProvider(),
          url: new URL(request.url),
          pattern: "*",
        };
        const response = await action(actionParams);
        const responseObj = await asRouteResponse(response);
        const dataRaw: unknown = await responseObj.json();
        const data =
          dataRaw && typeof dataRaw === "object" && !Array.isArray(dataRaw)
            ? (dataRaw as {
                success?: unknown;
                fileUrl?: unknown;
                error?: unknown;
              })
            : {};

        expect(requireUserId).toHaveBeenCalledWith(request);
        expect(data).toEqual({
          success: true,
          data: {
            fileUrl: "https://example.com/uploaded-file.jpg",
          },
        });
      });
    });

    describe("Error Handling", () => {
      it("should block S3 endpoint for custom Blossom provider", async () => {
        (
          loadUploadProviderSettings as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          provider: "BLOSSOM_CUSTOM",
        });

        const request = new Request("http://localhost:3000/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });

        const response = await action({
          request,
          params: {},
          context: new RouterContextProvider(),
          url: new URL(request.url),
          pattern: "*",
        });
        const responseObj = await asRouteResponse(response);
        const dataRaw: unknown = await responseObj.json();
        const data =
          dataRaw && typeof dataRaw === "object" && !Array.isArray(dataRaw)
            ? (dataRaw as { error?: unknown; success?: unknown })
            : {};

        expect(responseObj.status).toBe(400);
        const errorText = JSON.stringify(data);
        expect(errorText.includes("Blossom")).toBe(true);
      });

      it("should require authentication", async () => {
        (requireUserId as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error("Authentication required")
        );

        const request = new Request("http://localhost:3000/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });

        // requireUserId throws a Response (redirect), not an Error
        const response = await action({
          request,
          params: {},
          context: new RouterContextProvider(),
          url: new URL(request.url),
          pattern: "*",
        });
        const responseObj = await asRouteResponse(response);
        expect(responseObj.status).toBeGreaterThanOrEqual(400);
      });

      it("should return validation error for non-multipart content type", async () => {
        const request = new Request("http://localhost:3000/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        });

        const actionParams: {
          request: Request;
          params: Record<string, string>;
          context: RouterContextProvider;
          url: URL;
          pattern: string;
        } = {
          request,
          params: {},
          context: new RouterContextProvider(),
          url: new URL(request.url),
          pattern: "*",
        };
        const response = await action(actionParams);
        const responseObj = await asRouteResponse(response);
        const dataRaw: unknown = await responseObj.json();
        const data =
          dataRaw && typeof dataRaw === "object" && !Array.isArray(dataRaw)
            ? (dataRaw as {
                success?: unknown;
                fileUrl?: unknown;
                error?: unknown;
              })
            : {};

        expect(responseObj.status).toBe(400);
        const success =
          typeof data.success === "boolean"
            ? data.success
            : data.success === 0 || data.success === false;
        expect(success).toBe(false);
        expect(data.error).toBeDefined();
      });

      it("should handle multipart parsing errors", async () => {
        const { parseFormData } = await import("@remix-run/form-data-parser");
        (parseFormData as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error("Parse error")
        );

        const request = new Request("http://localhost:3000/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });

        const actionParams: {
          request: Request;
          params: Record<string, string>;
          context: RouterContextProvider;
          url: URL;
          pattern: string;
        } = {
          request,
          params: {},
          context: new RouterContextProvider(),
          url: new URL(request.url),
          pattern: "*",
        };
        const response = await action(actionParams);
        const responseObj = await asRouteResponse(response);
        const dataRaw: unknown = await responseObj.json();
        const data =
          dataRaw && typeof dataRaw === "object" && !Array.isArray(dataRaw)
            ? (dataRaw as {
                success?: unknown;
                fileUrl?: unknown;
                error?: unknown;
              })
            : {};

        expect(responseObj.status).toBe(400);
        expect(data.success).toBe(false);
      });

      it("should return validation error when no file provided", async () => {
        const { parseFormData } = await import("@remix-run/form-data-parser");
        (parseFormData as ReturnType<typeof vi.fn>).mockResolvedValue(
          new FormData()
        );

        const request = new Request("http://localhost:3000/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });

        const actionParams: {
          request: Request;
          params: Record<string, string>;
          context: RouterContextProvider;
          url: URL;
          pattern: string;
        } = {
          request,
          params: {},
          context: new RouterContextProvider(),
          url: new URL(request.url),
          pattern: "*",
        };
        const response = await action(actionParams);
        const responseObj = await asRouteResponse(response);
        const dataRaw: unknown = await responseObj.json();
        const data =
          dataRaw && typeof dataRaw === "object" && !Array.isArray(dataRaw)
            ? (dataRaw as {
                success?: unknown;
                fileUrl?: unknown;
                error?: unknown;
              })
            : {};

        expect(responseObj.status).toBe(400);
        expect(data.success).toBe(false);
      });

      it("should return validation error when file upload fails (no URL)", async () => {
        const { parseFormData } = await import("@remix-run/form-data-parser");
        const formData = new FormData();
        formData.append("file", "not-a-url");
        (parseFormData as ReturnType<typeof vi.fn>).mockResolvedValue(formData);

        const request = new Request("http://localhost:3000/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });

        const actionParams: {
          request: Request;
          params: Record<string, string>;
          context: RouterContextProvider;
          url: URL;
          pattern: string;
        } = {
          request,
          params: {},
          context: new RouterContextProvider(),
          url: new URL(request.url),
          pattern: "*",
        };
        const response = await action(actionParams);
        const responseObj = await asRouteResponse(response);
        const dataRaw: unknown = await responseObj.json();
        const data =
          dataRaw && typeof dataRaw === "object" && !Array.isArray(dataRaw)
            ? (dataRaw as {
                success?: unknown;
                fileUrl?: unknown;
                error?: unknown;
              })
            : {};

        expect(responseObj.status).toBe(400);
        expect(data.success).toBe(false);
      });
    });
  });

  describe("Loader Handler", () => {
    it("should return API description", async () => {
      const _request = new Request("http://localhost:3000/api/upload", {
        method: "GET",
      });

      const loaderFn = loader;
      const response = await loaderFn();
      const dataRaw: unknown = await response.json();
      const data =
        dataRaw && typeof dataRaw === "object" && !Array.isArray(dataRaw)
          ? (dataRaw as { message?: unknown })
          : {};

      expect(data).toEqual({ message: "General File Upload API" });
    });
  });
});
