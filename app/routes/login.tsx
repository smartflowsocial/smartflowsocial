import { redirect } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { buildSeoMeta, siteOriginFromMatches } from "~/lib/seo";

export const meta: MetaFunction = ({ matches }) =>
  buildSeoMeta(
    {
      page: "Login",
      description: "Log in to SmartFlowSocial.",
      robots: "noindex, nofollow",
    },
    { siteOrigin: siteOriginFromMatches(matches) }
  );

/**
 * Legacy /login route: redirect to app root so login lives at app.smartflow.social.
 * Preserves query params (e.g. ?expectedPubkey= for account switcher).
 */
export const loader = async ({ url }: LoaderFunctionArgs) => {
  const search = url.search ? url.search : "";
  return redirect(`/${search}`, {
    status: 302,
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
};
