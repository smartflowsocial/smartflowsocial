import { Suspense } from "react";
import { type LoaderFunctionArgs, data } from "react-router";
import { Await, useLoaderData } from "react-router";

import { DeferredRouteAwaitError } from "~/components/deferred-route/DeferredRouteAwaitError";
import {
  AdminAccessDenied,
  AdminOperationsPageInner,
  AdminOperationsPageSkeleton,
} from "~/features/admin";
import { adminOperationsAction } from "~/features/admin/admin-operations-action.server";
import {
  defaultRangeForAdminPath,
  parseRangePreset,
} from "~/features/admin/metrics/date-range";
import { getAdminOperationsPageData } from "~/features/admin/repositories/admin-operations-queries.server";
import type { AdminOperationsPageDTO } from "~/features/admin/repositories/admin-operations-queries.server";
import { requireUser } from "~/features/auth/auth.server";
import { isReferralAdmin } from "~/features/referral/referral-admin.server";
import { DeferredRouteLoaderProvider } from "~/lib/remix/deferred-route-loader-context";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  if (!isReferralAdmin(user.npub)) {
    return data({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(request.url);
  const preset = parseRangePreset(
    url.searchParams.get("range"),
    defaultRangeForAdminPath(url.pathname)
  );

  return {
    operations: getAdminOperationsPageData(preset),
  };
}

export const action = adminOperationsAction;

type AdminOperationsLoaderResult =
  | { error: string }
  | { operations: Promise<AdminOperationsPageDTO> };

export default function AdminOperationsPage() {
  const raw = useLoaderData<AdminOperationsLoaderResult>();
  if ("error" in raw) {
    return <AdminAccessDenied />;
  }
  const { operations } = raw;

  return (
    <Suspense fallback={<AdminOperationsPageSkeleton />}>
      <Await
        resolve={operations}
        errorElement={
          <DeferredRouteAwaitError retryTo="/dashboard/admin/operations" />
        }
      >
        {(loaded) => (
          <DeferredRouteLoaderProvider value={loaded}>
            <AdminOperationsPageInner />
          </DeferredRouteLoaderProvider>
        )}
      </Await>
    </Suspense>
  );
}
