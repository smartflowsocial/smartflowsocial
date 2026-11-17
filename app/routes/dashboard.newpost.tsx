import {
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";

import { requireUserId } from "~/features/auth/auth.server";
import { NewPostPage } from "~/features/posts/composer";
import { handleNewPostAction } from "~/features/posts/server/composer";
import { withCSRFProtection } from "~/lib/csrf.server";

export async function loader({ url }: LoaderFunctionArgs) {
  return redirect(`/dashboard/compose${url.search}`);
}

export const action = withCSRFProtection(
  async ({ request }: ActionFunctionArgs) => {
    try {
      const userId = await requireUserId(request);
      return await handleNewPostAction(userId, request);
    } catch (error) {
      const { handleActionError } = await import("~/lib/error-handler.server");
      return handleActionError(error);
    }
  }
);

export default NewPostPage;
