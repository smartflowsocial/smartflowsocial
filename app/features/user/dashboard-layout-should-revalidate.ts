/**
 * Dashboard layout revalidation.
 *
 * Same-URL fetcher traffic stays cached so posting inside a page does not
 * reload the whole shell. An explicit `useRevalidator().revalidate()` has no
 * form and must reload, so a confirmed Bitcoin payment clears the expired
 * subscription banner without a navigation.
 */
export function dashboardLayoutShouldRevalidate(args: {
  currentUrl: URL;
  nextUrl: URL;
  formAction?: string | null;
  formMethod?: string | null;
  defaultShouldRevalidate: boolean;
}): boolean {
  const isDashboardAction =
    typeof args.formAction === "string" &&
    args.formAction.includes("/dashboard");

  if (isDashboardAction) {
    return true;
  }

  if (
    args.currentUrl.pathname === args.nextUrl.pathname &&
    args.currentUrl.search === args.nextUrl.search
  ) {
    return args.defaultShouldRevalidate && !args.formAction && !args.formMethod;
  }

  return args.defaultShouldRevalidate;
}
