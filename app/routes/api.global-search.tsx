import { type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";

import { requireUserId } from "~/features/auth/auth.server";
import { performGlobalSearch } from "~/features/search";
import { jsonResponse } from "~/lib/http/json-response";

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const trimmedQuery = query.trim();
  const context = url.searchParams.get("context") ?? undefined;

  // Require at least 2 characters to search (matches client-side requirement)
  if (!trimmedQuery || trimmedQuery.length < 2) {
    return jsonResponse({ results: [], total: 0 });
  }

  const results = await performGlobalSearch(userId, trimmedQuery, 5, context);
  return jsonResponse(results);
}

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  const formData = await request.formData();
  const queryValue = formData.get("q");
  const query = typeof queryValue === "string" ? queryValue : "";
  const trimmedQuery = query.trim();

  // Require at least 2 characters to search (matches client-side requirement)
  if (!trimmedQuery || trimmedQuery.length < 2) {
    return jsonResponse({ results: [], total: 0 });
  }

  const context =
    typeof formData.get("context") === "string"
      ? (formData.get("context") as string)
      : undefined;
  const results = await performGlobalSearch(userId, trimmedQuery, 5, context);
  return jsonResponse(results);
}
