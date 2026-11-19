import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/user", () => ({
  countUsers: vi.fn(async () => 1),
}));

vi.mock("~/lib/error-logger.server", () => ({
  logError: vi.fn(),
}));

import {
  handleHealthCheckError,
  performHealthCheck,
} from "~/features/infra/services/healthcheck.server";
import { countUsers } from "~/features/user";

const SHA = "9b1e08cf9a8cf381b640d26c26277e2b0c5ad169";

describe("performHealthCheck", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects a request that has no host", async () => {
    await expect(performHealthCheck(null)).rejects.toThrow(/host/i);
  });

  it("returns OK and names the build commit", async () => {
    vi.stubEnv("SOURCE_COMMIT", SHA);
    vi.stubEnv("BUILD_TIME", "2026-11-18T07:02:25Z");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 }))
    );

    const response = await performHealthCheck("localhost:3000");

    expect(countUsers).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Source-Commit")).toBe(SHA);
    expect(response.headers.get("X-Build-Time")).toBe("2026-11-18T07:02:25Z");
  });

  it("returns the same identity as JSON when the client asks for it", async () => {
    vi.stubEnv("SOURCE_COMMIT", "unknown");
    vi.stubEnv("BUILD_TIME", "today");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 }))
    );

    const response = await performHealthCheck(
      "app.example",
      "text/html, application/json;q=0.8"
    );
    const body: unknown = await response.json();

    expect(body).toMatchObject({
      status: "ok",
      sourceCommit: null,
      sourceCommitStatus: "unknown",
      buildTime: null,
      buildTimeStatus: "unknown",
    });
  });

  it("probes the listen port instead of the request host", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await performHealthCheck("127.0.0.1:3080", "application/json");

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:3000/", {
      method: "HEAD",
    });
  });

  it("fails when this process cannot reach itself", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 503 }))
    );

    await expect(performHealthCheck("localhost")).rejects.toBeInstanceOf(
      Response
    );
  });
});

describe("handleHealthCheckError", () => {
  it("answers with the plain error body", async () => {
    const response = handleHealthCheckError(
      new Error("database unavailable"),
      "http://localhost/healthcheck"
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("ERROR");
  });
});
