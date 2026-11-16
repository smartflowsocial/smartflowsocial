/**
 * Not a Remix route. Moved out of app/routes so it is not served.
 *
 * Example: Refactored Upload Route with Centralized Error Handling
 *
 * This shows how to refactor an existing route to use the new error handling system.
 * Compare this with the original api.upload.tsx to see the improvements.
 */

import { parseFormData } from "@remix-run/form-data-parser";
import { json, type ActionFunctionArgs } from "react-router";

import { requireUserId } from "~/features/auth/auth.server";
import { createUploadHandler } from "~/features/upload/s3.server";
import { MAX_FILE_SIZE } from "~/features/upload/validation.server";
import {
  withActionErrorHandling,
  createSuccessResponse,
  assert,
} from "~/lib/error-handler.server";
import { ValidationError, ExternalServiceError } from "~/lib/errors";

/**
 * Refactored version using error handling wrapper
 */
export const action = withActionErrorHandling(
  async ({ request }: ActionFunctionArgs) => {
    // Ensure user is authenticated (requireUserId throws redirect, which is fine)
    const userId = await requireUserId(request);

    // Validate content type
    const contentType = request.headers.get("content-type") ?? "";
    assert(
      contentType.includes("multipart/form-data"),
      "Request must be multipart/form-data",
      { contentType }
    );

    // Parse the multipart form data
    let formData: FormData;
    try {
      formData = await parseFormData(
        request,
        { maxFileSize: MAX_FILE_SIZE },
        createUploadHandler(userId)
      );
    } catch (error) {
      throw new ExternalServiceError(
        "Failed to parse multipart form data",
        400,
        {
          originalError: error instanceof Error ? error.message : String(error),
        }
      );
    }

    // Validate file exists
    const file = formData.get("file");
    assert(file !== null, "No file provided", {
      formDataKeys: Array.from(formData.keys()),
    });

    // Validate file was processed correctly
    assert(
      typeof file === "string" && file.startsWith("https://"),
      "File upload failed - no URL returned",
      {
        fileType: typeof file,
        fileValue:
          typeof file === "string" ? file.substring(0, 50) : "not a string",
      }
    );

    // Return success response
    return createSuccessResponse({ fileUrl: file });
  }
);

/**
 * Alternative: Manual error handling (if you need more control)
 */
export async function actionManual({ request }: ActionFunctionArgs) {
  try {
    const userId = await requireUserId(request);

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      throw new ValidationError("Request must be multipart/form-data", {
        contentType,
      });
    }

    let formData: FormData;
    try {
      formData = await parseFormData(
        request,
        { maxFileSize: MAX_FILE_SIZE },
        createUploadHandler(userId)
      );
    } catch (error) {
      throw new ExternalServiceError(
        "Failed to parse multipart form data",
        400,
        {
          originalError: error instanceof Error ? error.message : String(error),
        }
      );
    }

    const file = formData.get("file");
    if (!file) {
      throw new ValidationError("No file provided", {
        formDataKeys: Array.from(formData.keys()),
      });
    }

    if (typeof file !== "string" || !file.startsWith("https://")) {
      throw new ExternalServiceError(
        "File upload failed - no URL returned",
        500,
        {
          fileType: typeof file,
        }
      );
    }

    return json(createSuccessResponse({ fileUrl: file }));
  } catch (error) {
    // Use centralized error handler
    const { handleActionError } = await import("~/lib/error-handler.server");
    return handleActionError(error);
  }
}

// Handle preflight requests for CORS
export async function loader() {
  return json({ message: "General File Upload API" });
}
