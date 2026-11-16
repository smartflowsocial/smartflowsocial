import { encode } from "turbo-stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchRemixLoader,
  readRemixActionData,
  toSingleFetchActionUrl,
  toSingleFetchLoaderUrl,
} from "~/lib/remix/single-fetch";

function turboResponse(value: unknown, status = 200): Response {
  const bytes = encode(value).pipeThrough(new TextEncoderStream());
  return new Response(bytes, { status });
}

describe("single fetch urls", () => {
  it("targets one loader and asks it for plain JSON", () => {
    const url = toSingleFetchLoaderUrl(
      "/dashboard/scheduled?page=2&_data=routes/dashboard.scheduled",
      "routes/dashboard.scheduled"
    );

    expect(url.startsWith("/dashboard/scheduled.data?")).toBe(true);
    expect(url).toContain("_routes=routes%2Fdashboard.scheduled");
    expect(url).toContain("_loader=json");
    expect(url).toContain("page=2");
    expect(url.includes("_data=")).toBe(false);
  });

  it("maps the document root to the single-fetch root path", () => {
    expect(toSingleFetchActionUrl("/")).toBe("/_root.data");
    expect(toSingleFetchActionUrl("/dashboard/published")).toBe(
      "/dashboard/published.data"
    );
  });
});

describe("single fetch bodies", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unwraps an action payload", async () => {
    const response = turboResponse({
      data: { cascadeDeletedIds: ["child-1"] },
    });

    await expect(readRemixActionData(response)).resolves.toEqual({
      cascadeDeletedIds: ["child-1"],
    });
  });

  it("returns null for a single-fetch error envelope", async () => {
    const response = turboResponse({
      error: { message: "nope" },
    });

    await expect(readRemixActionData(response)).resolves.toBeNull();
  });

  it("decodes one loader from a .data response", async () => {
    const routeId = "routes/dashboard._index";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        turboResponse({
          [routeId]: { data: { flowItems: [{ id: "1" }] } },
        })
      )
    );

    const result = await fetchRemixLoader<{ flowItems: Array<{ id: string }> }>(
      "/dashboard?before=cursor",
      routeId
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ flowItems: [{ id: "1" }] });
    const [calledUrl] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(calledUrl)).toContain("/dashboard.data?");
    expect(String(calledUrl)).toContain("_loader=json");
    expect(String(calledUrl)).toContain("before=cursor");
  });
});
