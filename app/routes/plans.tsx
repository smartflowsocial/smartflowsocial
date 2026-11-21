import {
  redirect,
  data,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";
import type { ActionFunctionArgs, MetaFunction } from "react-router";

import {
  PlansPage,
  handlePlansAction,
  loadPlansData,
} from "~/features/payments";
import { withCSRFProtection } from "~/lib/csrf.server";
import {
  buildSeoMeta,
  SEO_PLANS_DESCRIPTION,
  siteOriginFromMatches,
} from "~/lib/seo";

export const meta: MetaFunction = ({ matches }) => {
  const siteOrigin = siteOriginFromMatches(matches);
  return buildSeoMeta(
    {
      page: "Pricing",
      description: SEO_PLANS_DESCRIPTION,
      robots: "index, follow",
      canonicalPath: "/plans",
      ogType: "website",
      includeAuthor: true,
    },
    { siteOrigin }
  );
};

export const action = withCSRFProtection(
  async ({ request }: ActionFunctionArgs) => {
    const formData = await request.formData();
    const result = await handlePlansAction(formData, request);

    // Type narrowing: check if result is a Response
    if (result instanceof Response) {
      return result;
    }

    // Type narrowing: check if result has redirect property

    /* eslint-disable @typescript-eslint/no-unnecessary-condition -- Runtime type guard for Remix serialized data */
    if (
      typeof result === "object" &&
      result !== null &&
      "redirect" in result &&
      result.redirect
    ) {
      /* eslint-enable @typescript-eslint/no-unnecessary-condition */
      return redirect(result.redirect);
    }

    // Type narrowing: check if result has error property

    /* eslint-disable @typescript-eslint/no-unnecessary-condition -- Runtime type guard for Remix serialized data */
    if (
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      result.error
    ) {
      /* eslint-enable @typescript-eslint/no-unnecessary-condition */
      const status =
        "status" in result && typeof result.status === "number"
          ? result.status
          : 400;
      // The plans page renders `error` itself. A 5xx HTTP status is what the
      // edge proxy replaces with an empty 504, which unmounts checkout.
      const httpStatus = status >= 500 ? 200 : status;
      return data(result, { status: httpStatus });
    }

    return result;
  }
);

export const loader = async ({ request }: { request: Request }) => {
  return await loadPlansData(request);
};

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const timedOut = status === 502 || status === 503 || status === 504;

  return (
    <main className="bg-canvas mx-auto flex min-h-[70vh] w-full max-w-2xl flex-col items-center justify-center px-4 py-24 text-center">
      <h1 className="text-text text-6xl font-semibold">{status}</h1>
      <p className="text-text mt-4 text-lg">
        {timedOut
          ? "Creating the Lightning invoice took too long. Nothing was charged."
          : "An unexpected error occurred"}
      </p>
      <a
        href="/plans"
        className="focus-ring bg-action-primary text-action-primary-foreground hover:bg-action-primary/90 mt-10 rounded-md px-6 py-3 text-base font-semibold"
      >
        Back to pricing
      </a>
    </main>
  );
}

export default PlansPage;
