import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import { jsonResponse } from "~/lib/http/json-response";

function isDataResult(result: object): result is {
  type: "DataWithResponseInit";
  data: unknown;
  init?: number | ResponseInit | null;
} {
  return (
    "type" in result &&
    result.type === "DataWithResponseInit" &&
    "data" in result
  );
}

/** Turn a loader or action result into a JSON Response for a resource route. */
export function toJsonResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  if (result !== null && typeof result === "object" && isDataResult(result)) {
    const init = result.init;
    const responseInit =
      typeof init === "number" ? { status: init } : (init ?? undefined);
    return jsonResponse(result.data, responseInit);
  }
  return jsonResponse(result ?? null);
}

export function jsonLoader(
  load: (args: LoaderFunctionArgs) => Promise<unknown>
) {
  return async function loader(args: LoaderFunctionArgs) {
    try {
      return toJsonResponse(await load(args));
    } catch (error) {
      if (error instanceof Response) return error;
      const { handleLoaderError } = await import("~/lib/error-handler.server");
      return handleLoaderError(error, {});
    }
  };
}

export function jsonAction(
  act: (args: ActionFunctionArgs) => Promise<unknown>
) {
  return async function action(args: ActionFunctionArgs) {
    return toJsonResponse(await act(args));
  };
}
