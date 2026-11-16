import type { LoaderFunctionArgs } from "react-router";

import { requireUserId } from "~/features/auth/auth.server";
import { getPostDataForModal } from "~/features/posts/server";
import { jsonResponse } from "~/lib/http/json-response";

/**
 * API route to fetch a single post by ID
 * GET /api/posts/:id
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const userId = await requireUserId(request);
    const postId = params["id"];

    if (!postId) {
      return jsonResponse({ error: "Post ID is required" }, { status: 400 });
    }

    const result = await getPostDataForModal(postId, userId);

    if (!result) {
      return jsonResponse({ error: "Post not found" }, { status: 404 });
    }

    return jsonResponse(result);
  } catch (error) {
    // If error is a Response (e.g., redirect from requireUserId), return it
    if (error instanceof Response) {
      return error;
    }
    // Use dynamic import to avoid bundling issues
    const { handleLoaderError } = await import("~/lib/error-handler.server");
    return handleLoaderError(error, {});
  }
}
