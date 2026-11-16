import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect } from "react-router";

import { getMediaAssetStatus, resolveMediaVariantUrl } from "~/features/upload";
import { jsonResponse } from "~/lib/http/json-response";
import { buildSeoMeta, siteOriginFromMatches } from "~/lib/seo";

export const meta: MetaFunction = ({ matches }) =>
  buildSeoMeta(
    { page: "Media", robots: "noindex, nofollow" },
    { siteOrigin: siteOriginFromMatches(matches) }
  );

export async function loader({ params }: LoaderFunctionArgs) {
  const assetId = params["assetId"] ?? "";
  const variant = params["variant"] ?? "original";
  if (!assetId) {
    return jsonResponse({ error: "missing_asset_id" }, { status: 400 });
  }

  const status = await getMediaAssetStatus(assetId);
  if (!status) {
    return jsonResponse({ error: "media_not_found" }, { status: 404 });
  }
  if (status !== "ready") {
    return jsonResponse({ error: "media_not_ready", status }, { status: 409 });
  }

  const resolved = await resolveMediaVariantUrl(assetId, variant);
  if (!resolved) {
    return jsonResponse({ error: "variant_not_found" }, { status: 404 });
  }

  return redirect(resolved, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
