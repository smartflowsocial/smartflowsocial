/**
 * TanStack Query integration with React Router loaders.
 * The hook name is still `useRemixQuery`.
 *
 * Note: This is a simplified version. For complex use cases, use useFetcher directly
 * or create custom hooks that combine loader data with TanStack Query.
 */

import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "react-router";

/**
 * Hook to use React Router loader data with TanStack Query
 * Useful when you want to refetch loader data on the client side
 *
 * @example
 * ```tsx
 * const loaderData = useLoaderData<unknown>();
 * const { data, refetch } = useRemixQuery({
 *   queryKey: ['dashboard-data'],
 *   initialData: loaderData,
 * });
 * ```
 */
export function useRemixQuery<TData = unknown>({
  queryKey,
  initialData,
  enabled = true,
  staleTime,
}: {
  queryKey: string[];
  initialData: TData;
  enabled?: boolean;
  staleTime?: number;
}) {
  const fetcher = useFetcher<TData>();

  return useQuery<TData>({
    queryKey,
    queryFn: async () => {
      // Use fetcher to refetch data
      const url = window.location.pathname + window.location.search;
      void fetcher.load(url);
      // Wait for fetcher to complete
      return new Promise<TData>((resolve) => {
        const checkFetcher = () => {
          if (fetcher.state === "idle") {
            resolve((fetcher.data ?? initialData) as TData);
          } else {
            setTimeout(checkFetcher, 50);
          }
        };
        checkFetcher();
      });
    },
    initialData,
    enabled,
    staleTime,
  });
}
