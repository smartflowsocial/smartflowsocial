/**
 * TanStack Query infinite query integration with Remix loaders
 * Allows using Remix loader data with React Query's useInfiniteQuery for infinite scroll
 */

import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";

import { pathnameToRemixDataRouteId } from "~/lib/query/remix-data-route-id";
import { fetchRemixLoader } from "~/lib/remix/single-fetch";

function loaderPathname(url: string): string {
  try {
    const base =
      typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost";
    return new URL(url, base).pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

// PageData is a flexible type that allows any data structure
// Some loaders have pagination, others don't - we make it optional
interface PageData {
  pagination?: {
    currentPage?: number;
    totalPages?: number;
    total?: number;
    pages?: number;
  };
  [key: string]: unknown; // Allow any additional properties
}

/**
 * Hook to use Remix loader data with TanStack Query's infinite query
 * Useful for infinite scroll implementations
 *
 * @example
 * ```tsx
 * import { getNextPageParamFromPaginationTotals } from "~/lib/query/infinite-remix-pagination";
 * const loaderData = useLoaderData();
 * const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteRemixQuery({
 *   queryKey: ["recyclables"],
 *   initialData: loaderData,
 *   getNextPageParam: (lastPage, allPages) =>
 *     getNextPageParamFromPaginationTotals(lastPage, allPages),
 * });
 * ```
 */
export function useInfiniteRemixQuery<TData extends PageData = PageData>({
  queryKey,
  initialData,
  getNextPageParam,
  enabled = true,
  staleTime,
  buildUrl,
  maxPages,
  refetchInterval,
  refetchIntervalInBackground,
}: {
  queryKey: readonly unknown[] | unknown[];
  initialData: TData;
  getNextPageParam: (lastPage: TData, allPages: TData[]) => number | undefined;
  enabled?: boolean;
  staleTime?: number;
  buildUrl?: (pageParam: number) => string;
  maxPages?: number;
  refetchInterval?: number | false;
  refetchIntervalInBackground?: boolean;
}) {
  // NOTE: We use fetch() directly instead of fetcher.load() because fetcher.load()
  // doesn't work reliably in Promise contexts (the fetcher state doesn't update properly)
  // const fetcher = useFetcher<TData>(); // Not needed anymore - using fetch() directly

  // Wrap getNextPageParam to respect maxPages limit when set (undefined/Infinity = no cap)
  const capped = typeof maxPages === "number" && Number.isFinite(maxPages);
  const wrappedGetNextPageParam = (
    lastPage: TData,
    allPages: TData[]
  ): number | undefined => {
    if (capped && allPages.length >= maxPages) {
      return undefined;
    }
    return getNextPageParam(lastPage, allPages);
  };

  // Mark initial data as fresh *now* so TanStack Query respects staleTime.
  // Without this, initialData is treated as updated at epoch 0 (always stale),
  // causing immediate refetches that race with fetchNextPage and reset pages.
  const [mountedAt] = useState(() => Date.now());

  return useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam = 1 }) => {
      // Build URL with page parameter
      let url = buildUrl
        ? buildUrl(pageParam)
        : (() => {
            if (typeof window === "undefined") {
              return `?page=${pageParam}`;
            }
            const location = window.location;
            const search = location.search;
            const pathname = location.pathname;
            const cleanSearch =
              search.split("&page=")[0]?.split("?page=")[0] ?? "";
            const separator = search.includes("?") ? "&" : "?";
            return `${pathname}${cleanSearch}${separator}page=${String(pageParam)}`;
          })();

      if (!url) {
        return Promise.reject(new Error("No URL provided"));
      }

      // Single fetch returns turbo-stream at pathname.data. `_loader=json` makes
      // the loader return plain data instead of defer(). The route id selects
      // that loader via `_routes`.
      const routeId = pathnameToRemixDataRouteId(loaderPathname(url));
      const result = await fetchRemixLoader<TData>(url, routeId);
      if (!result.ok || result.data == null) {
        throw new Error(`HTTP error! status: ${result.status}`);
      }
      return result.data;
    },
    initialPageParam: 1,
    getNextPageParam: wrappedGetNextPageParam,
    initialData: {
      pages: [initialData],
      pageParams: [1],
    },
    initialDataUpdatedAt: mountedAt,
    enabled,
    staleTime,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    ...(capped ? { maxPages } : {}),
    refetchInterval,
    refetchIntervalInBackground,
  });
}
