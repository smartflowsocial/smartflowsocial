export interface JsonRouteResult<T> {
  status: number;
  ok: boolean;
  data: T | null;
}

/** GET a JSON resource route. Dates arrive as strings, which loader schemas already accept. */
export async function fetchJson<T = unknown>(
  input: string,
  init?: RequestInit
): Promise<JsonRouteResult<T>> {
  const response = await fetch(input, {
    ...init,
    method: "GET",
    credentials: init?.credentials ?? "same-origin",
  });
  if (response.status === 204 || response.status === 205) {
    return { status: response.status, ok: response.ok, data: null };
  }
  const data = (await response.json()) as T;
  return { status: response.status, ok: response.ok, data };
}

/** Read a JSON action body. Redirects and non-JSON bodies are null. */
export async function readJsonActionData(response: Response): Promise<unknown> {
  if (response.status >= 300 && response.status < 400) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** `/dashboard/...` JSON twins live under `/api/dashboard/...`. */
export function toDashboardJsonUrl(input: string): string {
  const base =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const url = new URL(input, base);
  if (url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/")) {
    url.pathname = `/api${url.pathname}`;
  }
  return `${url.pathname}${url.search}`;
}
