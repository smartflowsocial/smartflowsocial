import { Suspense } from "react";
import {
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
  data,
} from "react-router";
import { Await, useLoaderData } from "react-router";

import { DeferredRouteAwaitError } from "~/components/deferred-route/DeferredRouteAwaitError";
import { requireUserId } from "~/features/auth/auth.server";
import {
  TemplatesPage,
  handleTemplatesAction,
  TemplatesPageSkeleton,
} from "~/features/templates";
import { withCSRFProtection } from "~/lib/csrf.server";
import { DeferredRouteLoaderProvider } from "~/lib/remix/deferred-route-loader-context";
import type { TemplatesLoaderData } from "~/lib/validation/schemas/loader-responses.schemas";

import { loadTemplatesValidated } from "./dashboard.templates.loader.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);

  return {
    templates: loadTemplatesValidated(userId),
  };
}

export const action = withCSRFProtection(
  async ({ request }: ActionFunctionArgs) => {
    try {
      const userId = await requireUserId(request);
      const formData = await request.formData();
      const result = await handleTemplatesAction(formData, userId);

      if (result instanceof Response) {
        return result;
      }

      if (typeof result === "object" && "error" in result && result.error) {
        return data(result, { status: 400 });
      }

      return result;
    } catch (error) {
      const { handleActionError } = await import("~/lib/error-handler.server");
      return handleActionError(error);
    }
  }
);

interface TemplatesDeferredLoaderData {
  templates: Promise<TemplatesLoaderData>;
}

function TemplatesFeedRoute() {
  const { templates } = useLoaderData<TemplatesDeferredLoaderData>();

  return (
    <Suspense fallback={<TemplatesPageSkeleton />}>
      <Await
        resolve={templates}
        errorElement={
          <DeferredRouteAwaitError retryTo="/dashboard/templates" />
        }
      >
        {(data) => (
          <DeferredRouteLoaderProvider value={data}>
            <TemplatesPage />
          </DeferredRouteLoaderProvider>
        )}
      </Await>
    </Suspense>
  );
}

export default TemplatesFeedRoute;
