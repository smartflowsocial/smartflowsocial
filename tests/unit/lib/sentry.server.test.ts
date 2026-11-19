import { beforeEach, describe, expect, it, vi } from "vitest";

interface SentryEvent {
  request?: { url?: string };
  transaction?: string;
}

interface SentryInitOptions {
  dsn: string;
  environment: string;
  tracesSampleRate: number;
  beforeSend: (event: SentryEvent) => SentryEvent | null;
  beforeSendTransaction: (event: SentryEvent) => SentryEvent | null;
  integrations: unknown[];
}

interface SpanContext {
  name: string;
  op?: string;
  attributes?: Record<string, unknown>;
}

interface EnvState {
  SENTRY_DSN?: string;
  NODE_ENV?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
}

const envState = vi.hoisted(() => ({
  SENTRY_DSN: undefined as string | undefined,
  NODE_ENV: "development",
  SENTRY_TRACES_SAMPLE_RATE: undefined as string | undefined,
}));

const sentry = vi.hoisted(() => ({
  init: vi.fn<(options: SentryInitOptions) => void>(),
  captureException:
    vi.fn<(error: Error, context?: Record<string, unknown>) => void>(),
  captureMessage:
    vi.fn<(message: string, context?: Record<string, unknown>) => void>(),
  addBreadcrumb: vi.fn<(breadcrumb: Record<string, unknown>) => void>(),
  setUser: vi.fn<(user: unknown) => void>(),
  startSpan: undefined as
    | ((ctx: SpanContext, cb: () => Promise<unknown>) => Promise<unknown>)
    | undefined,
  startSpanManual: undefined as
    ((ctx: SpanContext) => { end?: () => void }) | undefined,
}));

const logs = vi.hoisted(() => ({
  safeConsoleError: vi.fn<(message: string, error: unknown) => void>(),
}));

vi.mock("@sentry/react-router", () => sentry);
vi.mock("~/lib/env.server", () => ({ env: envState }));
vi.mock("~/lib/secrets-sanitizer.server", () => logs);

async function loadSentry() {
  return import("~/lib/sentry.server");
}

function applyEnv(patch: EnvState): void {
  envState.SENTRY_DSN = patch.SENTRY_DSN;
  envState.NODE_ENV = patch.NODE_ENV;
  envState.SENTRY_TRACES_SAMPLE_RATE = patch.SENTRY_TRACES_SAMPLE_RATE;
}

async function boot(patch: EnvState) {
  vi.resetModules();
  sentry.init.mockClear();
  applyEnv(patch);
  const api = await loadSentry();
  api.initSentry();
  const options = sentry.init.mock.calls[0]?.[0];
  if (!options) throw new Error("Sentry.init was not called");
  return { api, options };
}

describe("sentry server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    applyEnv({
      SENTRY_DSN: undefined,
      NODE_ENV: "development",
      SENTRY_TRACES_SAMPLE_RATE: undefined,
    });
    sentry.startSpan = undefined;
    sentry.startSpanManual = undefined;
    sentry.init.mockImplementation(() => undefined);
  });

  it("does nothing until a DSN is configured", async () => {
    const api = await loadSentry();
    api.initSentry();
    expect(api.isSentryInitialized()).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
    api.captureException(new Error("x"));
    api.captureMessage("hello");
    api.addBreadcrumb({ message: "crumb" });
    api.setUser({ id: "user-1" });
    api.clearUser();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    expect(sentry.addBreadcrumb).not.toHaveBeenCalled();
    expect(sentry.setUser).not.toHaveBeenCalled();
  });

  it("initializes once and drops noise from send hooks", async () => {
    const { api, options } = await boot({
      SENTRY_DSN: "https://dsn.example/1",
      NODE_ENV: "production",
      SENTRY_TRACES_SAMPLE_RATE: "0.25",
    });
    expect(api.isSentryInitialized()).toBe(true);
    expect(options).toMatchObject({
      dsn: "https://dsn.example/1",
      environment: "production",
      tracesSampleRate: 0.25,
      integrations: [],
    });
    api.initSentry();
    expect(sentry.init).toHaveBeenCalledTimes(1);

    const event = { request: { url: "https://app.example/dashboard" } };
    expect(options.beforeSend(event)).toBe(event);
    expect(options.beforeSend({})).toEqual({});
    for (const url of [
      "https://app.example/health",
      "https://app.example/metrics",
      "https://app.example/favicon.ico",
      "https://app.example/robots.txt",
    ]) {
      expect(options.beforeSend({ request: { url } })).toBeNull();
    }

    const transaction = {
      request: { url: "/dashboard" },
      transaction: "GET /dashboard",
    };
    expect(options.beforeSendTransaction(transaction)).toBe(transaction);
    expect(options.beforeSendTransaction({})).toEqual({});
    expect(
      options.beforeSendTransaction({ transaction: "GET /health" })
    ).toBeNull();
    expect(
      options.beforeSendTransaction({ request: { url: "/metrics" } })
    ).toBeNull();
    expect(
      options.beforeSendTransaction({ transaction: "GET /favicon.ico" })
    ).toBeNull();
    expect(
      options.beforeSendTransaction({ request: { url: "/robots.txt" } })
    ).toBeNull();
  });

  it("clamps trace sample rates and defaults by environment", async () => {
    const cases: Array<{
      nodeEnv: string | undefined;
      rate: string | undefined;
      expected: number;
      environment: string;
    }> = [
      {
        nodeEnv: "production",
        rate: undefined,
        expected: 0.1,
        environment: "production",
      },
      {
        nodeEnv: "development",
        rate: undefined,
        expected: 1,
        environment: "development",
      },
      {
        nodeEnv: undefined,
        rate: undefined,
        expected: 1,
        environment: "development",
      },
      {
        nodeEnv: "production",
        rate: "",
        expected: 0.1,
        environment: "production",
      },
      {
        nodeEnv: "production",
        rate: "nope",
        expected: 0.1,
        environment: "production",
      },
      {
        nodeEnv: "production",
        rate: "-0.2",
        expected: 0,
        environment: "production",
      },
      {
        nodeEnv: "production",
        rate: "2",
        expected: 1,
        environment: "production",
      },
      {
        nodeEnv: "production",
        rate: "0",
        expected: 0,
        environment: "production",
      },
      {
        nodeEnv: "production",
        rate: "1",
        expected: 1,
        environment: "production",
      },
    ];
    for (const item of cases) {
      const { options } = await boot({
        SENTRY_DSN: "https://dsn.example/1",
        NODE_ENV: item.nodeEnv,
        SENTRY_TRACES_SAMPLE_RATE: item.rate,
      });
      expect(options.tracesSampleRate).toBe(item.expected);
      expect(options.environment).toBe(item.environment);
    }
  });

  it("retries initialization after a thrown Error or string", async () => {
    envState.SENTRY_DSN = "https://dsn.example/1";
    sentry.init.mockImplementationOnce(() => {
      throw new Error("bad dsn");
    });
    const api = await loadSentry();
    api.initSentry();
    expect(api.isSentryInitialized()).toBe(false);
    expect(logs.safeConsoleError).toHaveBeenCalledWith(
      "Failed to initialize Sentry:",
      expect.any(Error)
    );

    vi.resetModules();
    sentry.init.mockImplementationOnce(() => {
      throw "bad dsn";
    });
    const again = await loadSentry();
    again.initSentry();
    expect(logs.safeConsoleError).toHaveBeenCalledWith(
      "Failed to initialize Sentry:",
      "bad dsn"
    );
    expect(again.isSentryInitialized()).toBe(false);
    again.initSentry();
    expect(again.isSentryInitialized()).toBe(true);
  });

  it("captures exceptions, messages, breadcrumbs, and users", async () => {
    const { api } = await boot({
      SENTRY_DSN: "https://dsn.example/1",
      NODE_ENV: "test",
    });
    const error = new Error("boom");
    api.captureException(error);
    expect(sentry.captureException).toHaveBeenCalledWith(error, {
      tags: undefined,
      extra: undefined,
      user: undefined,
      level: "error",
    });
    api.captureException(error, {
      tags: { area: "pay" },
      extra: { id: "1" },
      user: { id: "user-1" },
      level: "warning",
    });
    expect(sentry.captureException).toHaveBeenLastCalledWith(error, {
      tags: { area: "pay" },
      extra: { id: "1" },
      user: { id: "user-1" },
      level: "warning",
    });

    api.captureMessage("hello");
    expect(sentry.captureMessage).toHaveBeenCalledWith("hello", {
      level: "info",
      tags: undefined,
      extra: undefined,
    });
    api.captureMessage("bad", "error", { tags: { area: "pay" } });
    expect(sentry.captureMessage).toHaveBeenLastCalledWith("bad", {
      level: "error",
      tags: { area: "pay" },
      extra: undefined,
    });

    api.addBreadcrumb({ message: "crumb" });
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith({
      message: "crumb",
      category: undefined,
      level: "info",
      data: undefined,
    });
    api.addBreadcrumb({
      message: "crumb",
      category: "pay",
      level: "warning",
      data: { id: "1" },
    });
    api.setUser({ id: "user-1", email: "a@example.com", username: "ada" });
    expect(sentry.setUser).toHaveBeenCalledWith({
      id: "user-1",
      email: "a@example.com",
      username: "ada",
    });
    api.clearUser();
    expect(sentry.setUser).toHaveBeenLastCalledWith(null);

    envState.SENTRY_DSN = undefined;
    sentry.captureException.mockClear();
    sentry.captureMessage.mockClear();
    sentry.addBreadcrumb.mockClear();
    sentry.setUser.mockClear();
    api.captureException(error);
    api.captureMessage("muted");
    api.addBreadcrumb({ message: "muted" });
    api.setUser({ id: "user-1" });
    api.clearUser();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    expect(sentry.addBreadcrumb).not.toHaveBeenCalled();
    expect(sentry.setUser).not.toHaveBeenCalled();
  });

  it("swallows Error and string failures from Sentry calls", async () => {
    const { api } = await boot({
      SENTRY_DSN: "https://dsn.example/1",
      NODE_ENV: "test",
    });
    const failures: Array<{ run: () => void; message: string }> = [
      {
        message: "Failed to capture exception in Sentry:",
        run: () => {
          sentry.captureException.mockImplementationOnce(() => {
            throw new Error("ex");
          });
          api.captureException(new Error("boom"));
        },
      },
      {
        message: "Failed to capture exception in Sentry:",
        run: () => {
          sentry.captureException.mockImplementationOnce(() => {
            throw "ex";
          });
          api.captureException(new Error("boom"));
        },
      },
      {
        message: "Failed to capture message in Sentry:",
        run: () => {
          sentry.captureMessage.mockImplementationOnce(() => {
            throw new Error("msg");
          });
          api.captureMessage("hello");
        },
      },
      {
        message: "Failed to capture message in Sentry:",
        run: () => {
          sentry.captureMessage.mockImplementationOnce(() => {
            throw "msg";
          });
          api.captureMessage("hello");
        },
      },
      {
        message: "Failed to add breadcrumb in Sentry:",
        run: () => {
          sentry.addBreadcrumb.mockImplementationOnce(() => {
            throw new Error("crumb");
          });
          api.addBreadcrumb({ message: "crumb" });
        },
      },
      {
        message: "Failed to add breadcrumb in Sentry:",
        run: () => {
          sentry.addBreadcrumb.mockImplementationOnce(() => {
            throw "crumb";
          });
          api.addBreadcrumb({ message: "crumb" });
        },
      },
      {
        message: "Failed to set user in Sentry:",
        run: () => {
          sentry.setUser.mockImplementationOnce(() => {
            throw new Error("user");
          });
          api.setUser({ id: "user-1" });
        },
      },
      {
        message: "Failed to set user in Sentry:",
        run: () => {
          sentry.setUser.mockImplementationOnce(() => {
            throw "user";
          });
          api.setUser({ id: "user-1" });
        },
      },
      {
        message: "Failed to clear user in Sentry:",
        run: () => {
          sentry.setUser.mockImplementationOnce(() => {
            throw new Error("clear");
          });
          api.clearUser();
        },
      },
      {
        message: "Failed to clear user in Sentry:",
        run: () => {
          sentry.setUser.mockImplementationOnce(() => {
            throw "clear";
          });
          api.clearUser();
        },
      },
    ];
    for (const failure of failures) {
      logs.safeConsoleError.mockClear();
      failure.run();
      expect(logs.safeConsoleError).toHaveBeenCalledWith(
        failure.message,
        expect.anything()
      );
    }
  });

  it("runs the callback directly when tracing is disabled", async () => {
    const api = await loadSentry();
    const calls: string[] = [];
    await expect(
      api.withSentrySpan({ name: "disabled" }, () => {
        calls.push("run");
        return "ok";
      })
    ).resolves.toBe("ok");
    expect(calls).toEqual(["run"]);
    await expect(
      api.withSentrySpan({ name: "disabled" }, () => {
        throw new Error("direct");
      })
    ).rejects.toThrow("direct");
  });

  it("uses startSpan, startSpanManual, and falls back when tracing throws", async () => {
    const { api } = await boot({
      SENTRY_DSN: "https://dsn.example/1",
      NODE_ENV: "test",
    });
    const span = vi.fn<
      (ctx: SpanContext, cb: () => Promise<unknown>) => Promise<unknown>
    >(async (_ctx, cb) => cb());
    sentry.startSpan = span;
    await expect(
      api.withSentrySpan(
        { name: "pay", op: "invoice", attributes: { amount: 5 } },
        async () => "paid"
      )
    ).resolves.toBe("paid");
    expect(span).toHaveBeenCalledWith(
      { name: "pay", op: "invoice", attributes: { amount: 5 } },
      expect.any(Function)
    );

    const calls: string[] = [];
    span.mockImplementation(async () => {
      throw new Error("span failed");
    });
    await expect(
      api.withSentrySpan({ name: "pay" }, () => {
        calls.push("fallback");
        return "recovered";
      })
    ).resolves.toBe("recovered");
    expect(calls).toEqual(["fallback"]);

    span.mockImplementation(async (_ctx, cb) => cb());
    const retried: string[] = [];
    await expect(
      api.withSentrySpan({ name: "pay" }, () => {
        retried.push("try");
        if (retried.length === 1) throw new Error("first");
        return "second";
      })
    ).resolves.toBe("second");
    expect(retried).toEqual(["try", "try"]);

    sentry.startSpan = undefined;
    const end = vi.fn<() => void>();
    const manual = vi.fn<(ctx: SpanContext) => { end?: () => void }>(() => ({
      end,
    }));
    sentry.startSpanManual = manual;
    await expect(
      api.withSentrySpan({ name: "manual", op: "db" }, () => "done")
    ).resolves.toBe("done");
    expect(manual).toHaveBeenCalledWith({
      name: "manual",
      op: "db",
      attributes: undefined,
    });
    expect(end).toHaveBeenCalledTimes(1);

    end.mockImplementation(() => {
      throw new Error("end failed");
    });
    await expect(
      api.withSentrySpan({ name: "manual" }, () => "still")
    ).resolves.toBe("still");

    const bare = vi.fn<(ctx: SpanContext) => { end?: () => void }>(() => ({}));
    sentry.startSpanManual = bare;
    await expect(
      api.withSentrySpan({ name: "manual" }, () => "bare")
    ).resolves.toBe("bare");

    const manualCalls: string[] = [];
    sentry.startSpanManual = () => ({
      end() {
        manualCalls.push("end");
      },
    });
    await expect(
      api.withSentrySpan({ name: "manual" }, () => {
        manualCalls.push("fn");
        if (manualCalls.filter((item) => item === "fn").length === 1) {
          throw new Error("manual first");
        }
        return "manual second";
      })
    ).resolves.toBe("manual second");
    expect(manualCalls).toEqual(["fn", "end", "fn"]);

    sentry.startSpan = undefined;
    sentry.startSpanManual = undefined;
    await expect(
      api.withSentrySpan({ name: "none" }, () => "plain")
    ).resolves.toBe("plain");
  });
});
