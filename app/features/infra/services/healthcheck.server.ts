/**
 * Healthcheck service layer
 * Handles application health checks
 */

import { currentDeployment } from "~/features/payments/entitlements/deployment-mode.server";
import { countUsers } from "~/features/user";
import { env } from "~/lib/env.server";
import { logError } from "~/lib/error-logger.server";
import {
  DatabaseError,
  ExternalServiceError,
  ValidationError,
} from "~/lib/errors";

import packageJson from "../../../../package.json";
import {
  deploymentIdentityHeaders,
  readDeploymentIdentity,
  wantsDeploymentJson,
} from "../deployment-identity";

/**
 * Perform health check
 * Verifies database connectivity and that this process answers on its listen port.
 * Headers name the build commit when the image was given one. They do not
 * prove that a GitHub Actions run is the process currently serving traffic.
 */
export async function performHealthCheck(
  host: string | null,
  accept: string | null = null
) {
  if (!host) {
    throw new ValidationError("Missing host header");
  }

  // Probe this process on its listen port. The request Host can be a published
  // port or a public name, and fetching that address from inside the container
  // fails or can be pointed at another service.
  const configuredPort = env.PORT?.trim() ?? "";
  const port = /^\d+$/.test(configuredPort) ? configuredPort : "3000";
  await Promise.all([
    countUsers(),
    (async () => {
      const r = await fetch(`http://127.0.0.1:${port}/`, { method: "HEAD" });
      if (!r.ok) return Promise.reject(r);
    })(),
  ]);

  const identity = readDeploymentIdentity(process.env, packageJson.version);
  const headers = deploymentIdentityHeaders(identity);
  if (wantsDeploymentJson(accept)) {
    return Response.json(
      {
        status: "ok",
        deploymentMode: currentDeployment().mode,
        publisherBackend: "internal",
        nostrReadBackend: "internal",
        version: identity.version,
        sourceCommit: identity.sourceCommit,
        sourceCommitStatus: identity.sourceCommitStatus,
        buildTime: identity.buildTime,
        buildTimeStatus: identity.buildTimeStatus,
      },
      { headers }
    );
  }
  return new Response("OK", { headers });
}

/**
 * Handle health check errors
 */
export function handleHealthCheckError(error: unknown, requestUrl: string) {
  // Determine error type
  const normalizedError =
    error instanceof Error && error.message.includes("database")
      ? new DatabaseError("Health check failed: Database connection error", {
          originalError: error instanceof Error ? error.message : String(error),
        })
      : new ExternalServiceError("Health check failed", 503, {
          service: "HealthCheck",
          originalError: error instanceof Error ? error.message : String(error),
        });

  logError(normalizedError, { path: requestUrl });
  return new Response("ERROR", { status: 500 });
}
