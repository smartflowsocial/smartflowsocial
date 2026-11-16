import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { getMediaAssetStatus, resolveMediaVariantUrl } from "~/features/upload";
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
    return Response.json({ error: "missing_asset_id" }, { status: 400 });
  }

  const status = await getMediaAssetStatus(assetId);
  if (!status) {
    return Response.json({ error: "media_not_found" }, { status: 404 });
  }
  if (status !== "ready") {
    return Response.json({ error: "media_not_ready", status }, { status: 409 });
  }

  const resolved = await resolveMediaVariantUrl(assetId, variant);
  if (!resolved) {
    return Response.json({ error: "variant_not_found" }, { status: 404 });
  }

  return redirect(resolved, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
