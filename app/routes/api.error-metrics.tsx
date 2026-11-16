import type { LoaderFunctionArgs } from "@remix-run/node";

import { requireUserId } from "~/features/auth";
import {
  getErrorMetrics,
  getErrorRate,
  getTopErrorCodes,
  isErrorRateHigh,
} from "~/lib/error-metrics.server";

/**
 * API endpoint to get error metrics
 * GET /api/error-metrics
 *
 * Requires authentication and should be restricted to admins in production
 */
export async function loader({ request }: LoaderFunctionArgs) {
  // Require authentication
  await requireUserId(request);

  // In production, you should add admin check here:
  // await requireAdmin(request);

  const url = new URL(request.url);
  const summary = url.searchParams.get("summary") === "true";
  const topErrors = url.searchParams.get("top");
  const checkRate = url.searchParams.get("checkRate") === "true";

  if (summary) {
    const metrics = getErrorMetrics();
    const errorRate = getErrorRate();
    const rateHigh = isErrorRateHigh(10); // 10 errors per minute threshold

    return Response.json({
      summary: metrics,
      errorRate: {
        perMinute: errorRate,
        isHigh: rateHigh,
        threshold: 10,
      },
    });
  }

  if (topErrors) {
    const limit = parseInt(topErrors, 10) || 10;
    return Response.json({
      topErrors: getTopErrorCodes(limit),
    });
  }

  if (checkRate) {
    const rate = getErrorRate();
    const threshold = 10;
    return Response.json({
      errorRate: rate,
      isHigh: rate > threshold,
      threshold,
    });
  }

  // Return full metrics by default
  return Response.json({
    metrics: getErrorMetrics(),
    errorRate: getErrorRate(),
  });
}
