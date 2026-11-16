import type { LoaderFunctionArgs } from "react-router";

import { requireUserId } from "~/features/auth/auth.server";
import { loadChildrenData, handleChildrenApiError } from "~/features/user";

export function createLoader(
  dataLoader: (userId: string) => Promise<Response>,
  errorHandler: (error: unknown, requestUrl: string) => Response
) {
  return async ({ request }: LoaderFunctionArgs) => {
    try {
      const userId = await requireUserId(request);
      return await dataLoader(userId);
    } catch (error) {
      return errorHandler(error, request.url);
    }
  };
}

export const loader = createLoader(loadChildrenData, handleChildrenApiError);
