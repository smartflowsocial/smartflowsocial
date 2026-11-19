import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const MANAGED_KEYS = [
  "ADMIN_NPUBS",
  "ALLOWED_ORIGINS",
  "APP_URL",
  "BLASTR_ADMIN_API_TOKEN",
  "BLASTR_ADMIN_URL",
  "BLOSSOM_INTERNAL_SECRET",
  "BLOSSOM_SFS_API_URL",
  "BLOSSOM_UPLOAD_TOKEN_SECRET",
  "BTCPAY_API_KEY",
  "BTCPAY_STORE_ID",
  "BTCPAY_URL",
  "BTCPAY_WEBHOOK_SECRET",
  "CONTESTS_V1_ENABLED",
  "COOLIFY_URL",
  "CRON_SECRET",
  "CYPRESS",
  "DATABASE_URL",
  "DISABLE_RATE_LIMIT",
  "E2E_TEST",
  "ENABLE_NOSTR_DELETE_EVENTS",
  "ENABLE_SOURCE_MAPS",
  "ENFORCE_NOSTR_SESSION_PUBKEY",
  "FEEDBACK_INBOX_NPUB",
  "FINANCIAL_RECORD_PURGE_INTERVAL_HOURS",
  "FLY_REGION",
  "HOST",
  "LANDING_STATS_ORIGINS",
  "MEDIA_PIPELINE_V2_ENABLED",
  "METRICS_ALLOWED_IPS",
  "METRICS_PORT",
  "METRICS_TOKEN",
  "NIP88_POLLS_ENABLED",
  "NODE_ENV",
  "NOSTRMASH_API_TOKEN",
  "NOSTRMASH_BASE_URL",
  "NOSTRMASH_WS_URL",
  "NOSTR_AUTH_V2_ENABLED",
  "NOSTR_DM_NIP17_ENABLED",
  "NOSTR_NSEC",
  "NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS",
  "NOSTR_PUBLISHER_ALLOW_UNAUTHENTICATED",
  "NOSTR_PUBLISHER_API_TOKEN",
  "NOSTR_PUBLISHER_BACKEND",
  "NOSTR_PUBLISHER_URL",
  "NOSTR_READ_BACKEND",
  "NOSTR_READ_TIMEOUT_MS",
  "NWC_PAY_TIMEOUT_MS",
  "NWC_RECONCILE_TIMEOUT_MS",
  "OWNER_NWC",
  "OWNER_NWC_RELAY",
  "OWNER_NWC_RELAYS",
  "OWNED_OBJECT_DELETION_INTERVAL_SECONDS",
  "PORT",
  "POST_ANALYTICS_BATCH_SIZE",
  "POST_ANALYTICS_CONCURRENCY",
  "POST_ANALYTICS_INTERVAL_MINUTES",
  "PRIMAL_CACHING_URL",
  "PRIMAL_HTTP_MAX_RETRIES",
  "PRIMAL_HTTP_TIMEOUT_MS",
  "PRIMARY_REGION",
  "PUBLIC_STATS_ENABLED",
  "REDIS_URL",
  "REFERRAL_LANDING_URL",
  "REFERRAL_MANUAL_PAYOUT_SECRET",
  "REFERRAL_PAYOUTS_ENABLED",
  "REFERRAL_PAYOUT_DAILY_CAP_SATS",
  "REFERRAL_PAYOUT_MAX_SATS",
  "RELAY_HEALTH_STORE",
  "RUNWAY_LOW_CRON_INTERVAL_MINUTES",
  "SELF_HOSTED",
  "SENTRY_DSN",
  "SENTRY_PROFILES_SAMPLE_RATE",
  "SENTRY_TRACES_SAMPLE_RATE",
  "SESSION_SECRET",
  "SIGNING_MULTI_SLOT",
  "STORAGE_ACCESS_KEY",
  "STORAGE_BUCKET",
  "STORAGE_CDN_URL",
  "STORAGE_REGION",
  "STORAGE_SECRET",
  "SUBSCRIPTION_CHECKOUT_V2_ENABLED",
  "SUBSCRIPTION_RENEWAL_INTERVAL_MINUTES",
  "TEST_DATABASE_URL",
  "VAPID_PRIVATE_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_SUBJECT",
  "WORKER_METRICS_PORT",
] as const;

const SECRET = "s".repeat(32);
const CRON = "c".repeat(32);
const PUBLISHER_TOKEN = "p".repeat(16);
const PAYOUT_SECRET = "r".repeat(32);

const savedEnv = new Map<string, string | undefined>();
for (const key of MANAGED_KEYS) {
  savedEnv.set(key, process.env[key]);
}

const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
const consoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);
const exitSpy = vi
  .spyOn(process, "exit")
  .mockImplementation((code?: number) => {
    throw new Error(`process.exit:${String(code)}`);
  });

function applyEnv(values: Record<string, string | undefined>): void {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function baseline(
  extra: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
    NODE_ENV: "test",
    NOSTR_PUBLISHER_BACKEND: "internal",
    NOSTR_READ_BACKEND: "internal",
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: SECRET,
    ...extra,
  };
}

async function loadEnv() {
  vi.resetModules();
  return import("~/lib/env.server");
}

async function rejectionText(): Promise<string> {
  await expect(loadEnv()).rejects.toThrow("process.exit:1");
  return consoleError.mock.calls
    .map((call) => call.map((part) => String(part)).join(" "))
    .join("\n");
}

describe("env.server validation branches", () => {
  beforeEach(() => {
    consoleLog.mockClear();
    consoleError.mockClear();
    exitSpy.mockClear();
  });

  afterEach(() => {
    applyEnv({});
  });

  afterAll(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    consoleLog.mockRestore();
    consoleError.mockRestore();
    exitSpy.mockRestore();
  });

  it("accepts an internal publisher, postgres and redis URLs, and optional values", async () => {
    applyEnv(
      baseline({
        DATABASE_URL: "postgres://user:pass@localhost:5432/app",
        POST_ANALYTICS_INTERVAL_MINUTES: "0",
        SENTRY_DSN: "https://sentry.example/1",
      })
    );
    process.env["SENTRY_DSN"] = "https://sentry.example/1";
    delete process.env["PORT"];

    const { env } = await loadEnv();

    expect(env.DATABASE_URL).toBe("postgres://user:pass@localhost:5432/app");
    expect(env.NOSTR_PUBLISHER_BACKEND).toBe("internal");
    expect(env.NOSTR_READ_BACKEND).toBe("internal");
    expect(env.NODE_ENV).toBe("test");
    expect(env.SENTRY_DSN).toBe("https://sentry.example/1");
    expect(env.POST_ANALYTICS_INTERVAL_MINUTES).toBe("0");
    expect(env.PORT).toBeUndefined();
    expect(env.STORAGE_BUCKET).toBeUndefined();
    expect(consoleLog.mock.calls.map((call) => call[0])).toEqual([
      "Nostr publisher backend: internal",
      "Nostr read backend: internal",
      "✅ Environment variables validated",
    ]);
  });

  it("defaults NODE_ENV and warns when private relays are explicitly allowed", async () => {
    applyEnv(
      baseline({
        NODE_ENV: undefined,
        NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS: "true",
      })
    );

    const { env } = await loadEnv();

    expect(env.NODE_ENV).toBe("development");
    expect(consoleLog.mock.calls.map((call) => String(call[0]))).toContain(
      "WARNING: NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS=true lets the internal publisher open private-network relay URLs. Do not set this on hosted production."
    );
  });

  it("copies storage only when every storage variable is set", async () => {
    applyEnv(
      baseline({
        STORAGE_ACCESS_KEY: "key",
        STORAGE_BUCKET: "bucket",
        STORAGE_REGION: "us-east-1",
        STORAGE_SECRET: "secret",
        STORAGE_CDN_URL: "https://cdn.example",
      })
    );
    const { env } = await loadEnv();
    expect(env.STORAGE_ACCESS_KEY).toBe("key");
    expect(env.STORAGE_SECRET).toBe("secret");
    expect(env.STORAGE_REGION).toBe("us-east-1");
    expect(env.STORAGE_BUCKET).toBe("bucket");
    expect(env.STORAGE_CDN_URL).toBe("https://cdn.example");
  });

  it("fills E2E defaults without overriding values that are already set", async () => {
    applyEnv(
      baseline({
        DATABASE_URL: undefined,
        E2E_TEST: "true",
        NOSTR_PUBLISHER_BACKEND: undefined,
        NOSTR_PUBLISHER_URL: undefined,
        NOSTR_READ_BACKEND: undefined,
        REDIS_URL: undefined,
        SELF_HOSTED: undefined,
        SESSION_SECRET: undefined,
        TEST_DATABASE_URL:
          "postgresql://postgres:postgres@localhost:5432/custom",
      })
    );

    const { env } = await loadEnv();

    expect(env.DATABASE_URL).toBe(
      "postgresql://postgres:postgres@localhost:5432/custom"
    );
    expect(env.SESSION_SECRET).toBe(
      "test-session-secret-very-long-and-secure-32-chars-minimum"
    );
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.NOSTR_PUBLISHER_URL).toBe("http://localhost:3001/publish");
    expect(env.NOSTR_PUBLISHER_BACKEND).toBe("http");
    expect(env.NOSTR_READ_BACKEND).toBe("legacy_ws");
  });

  it("keeps a preset database URL and skips the publisher URL for an internal E2E boot", async () => {
    applyEnv(
      baseline({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/kept",
        E2E_TEST: "true",
        NOSTR_PUBLISHER_BACKEND: "internal",
        NOSTR_PUBLISHER_URL: undefined,
        SELF_HOSTED: "true",
      })
    );

    const { env } = await loadEnv();

    expect(env.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/kept");
    expect(env.NOSTR_PUBLISHER_URL).toBeUndefined();
    expect(env.NOSTR_PUBLISHER_BACKEND).toBe("internal");
  });

  it("uses the built-in E2E database when TEST_DATABASE_URL is unset", async () => {
    applyEnv(
      baseline({
        DATABASE_URL: undefined,
        E2E_TEST: "true",
        NOSTR_PUBLISHER_BACKEND: "internal",
        REDIS_URL: undefined,
        SESSION_SECRET: undefined,
        TEST_DATABASE_URL: undefined,
      })
    );

    const { env } = await loadEnv();
    expect(env.DATABASE_URL).toBe(
      "postgresql://postgres:postgres@localhost:5432/smartflow_test"
    );
  });

  it("reports missing and invalid required variables together", async () => {
    applyEnv(
      baseline({
        DATABASE_URL: "mysql://localhost/app",
        REDIS_URL: " ",
        SESSION_SECRET: "too-short",
      })
    );

    const text = await rejectionText();

    expect(text).toContain("Missing required environment variables");
    expect(text).toContain("[REDACTED]");
    expect(text).toContain("Invalid environment variables");
    expect(text).toContain("must be at least 32 characters long");
    expect(text).toContain("must be a valid PostgreSQL connection string");
    expect(text).toContain("docs/reference/configuration.md");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it.each([
    ["blank database", { DATABASE_URL: "   " }, "[REDACTED]"],
    ["blank session secret", { SESSION_SECRET: " " }, "[REDACTED]"],
    [
      "rediss URL",
      { REDIS_URL: "rediss://localhost:6379" },
      "must be a valid Redis connection string",
    ],
  ])("rejects a %s", async (_label, overrides, snippet) => {
    applyEnv(baseline(overrides));
    const text = await rejectionText();
    expect(text).toContain(snippet);
  });

  it("requires the publisher URL only for the HTTP backend", async () => {
    applyEnv(
      baseline({
        NOSTR_PUBLISHER_BACKEND: "http",
        NOSTR_PUBLISHER_URL: "  ",
      })
    );
    expect(await rejectionText()).toContain("NOSTR_PUBLISHER_URL");

    applyEnv(
      baseline({
        NOSTR_PUBLISHER_BACKEND: "http",
        NOSTR_PUBLISHER_URL: "http://localhost:3001/publish",
      })
    );
    const { env } = await loadEnv();
    expect(env.NOSTR_PUBLISHER_BACKEND).toBe("http");
    expect(env.NOSTR_PUBLISHER_URL).toBe("http://localhost:3001/publish");
  });

  it("rejects an unknown publisher backend and still applies the E2E publisher URL", async () => {
    applyEnv(
      baseline({
        E2E_TEST: "true",
        NOSTR_PUBLISHER_BACKEND: "nope",
        NOSTR_PUBLISHER_URL: undefined,
      })
    );

    const text = await rejectionText();

    expect(text).toContain("NOSTR_PUBLISHER_BACKEND");
    expect(process.env["NOSTR_PUBLISHER_URL"]).toBe(
      "http://localhost:3001/publish"
    );
  });

  it("rejects an unknown read backend before checking sockets", async () => {
    applyEnv(baseline({ NOSTR_READ_BACKEND: "sockets" }));
    const text = await rejectionText();
    expect(text).toContain("NOSTR_READ_BACKEND");
    expect(text).not.toContain("PRIMAL_CACHING_URL only");
  });

  it("rejects an internal reader pointed at an HTTP cache and a legacy HTTP reader without one", async () => {
    applyEnv(
      baseline({
        NOSTR_READ_BACKEND: "internal",
        PRIMAL_CACHING_URL: "https://cache.example",
      })
    );
    expect(await rejectionText()).toContain(
      "internal cannot be combined with an HTTP(S) PRIMAL_CACHING_URL"
    );

    applyEnv(
      baseline({
        NOSTR_READ_BACKEND: "legacy_http",
        PRIMAL_CACHING_URL: "wss://cache.example/v1",
      })
    );
    expect(await rejectionText()).toContain(
      "The legacy HTTP backend requires PRIMAL_CACHING_URL"
    );
  });

  it("accepts legacy HTTP with an HTTP proxy and rejects a bad socket list", async () => {
    applyEnv(
      baseline({
        NOSTR_READ_BACKEND: "legacy_http",
        PRIMAL_CACHING_URL: "https://cache.example",
      })
    );
    const { env } = await loadEnv();
    expect(env.NOSTR_READ_BACKEND).toBe("legacy_http");

    applyEnv(
      baseline({
        NOSTR_READ_BACKEND: "internal",
        PRIMAL_CACHING_URL: "ftp://cache.example",
      })
    );
    expect(await rejectionText()).toContain(
      "PRIMAL_CACHING_URL only ws:// and wss:// are allowed"
    );
  });

  it("validates the NostrMash socket and the read timeout", async () => {
    applyEnv(
      baseline({
        NOSTRMASH_WS_URL: "wss://api.nostrmash.com/primal/ws/v1",
        NOSTR_READ_TIMEOUT_MS: "15000",
      })
    );
    const { env } = await loadEnv();
    expect(env.NOSTRMASH_WS_URL).toBe("wss://api.nostrmash.com/primal/ws/v1");
    expect(env.NOSTR_READ_TIMEOUT_MS).toBe("15000");

    applyEnv(baseline({ NOSTRMASH_WS_URL: "https://api.nostrmash.com" }));
    expect(await rejectionText()).toContain(
      "NOSTRMASH_WS_URL must use ws:// or wss://"
    );

    applyEnv(baseline({ NOSTRMASH_WS_URL: "not a url" }));
    expect(await rejectionText()).toContain(
      "NOSTRMASH_WS_URL must be a ws:// or wss:// URL"
    );

    applyEnv(
      baseline({
        NOSTRMASH_WS_URL: "wss://user:pass@api.nostrmash.com/primal/ws/v1",
      })
    );
    expect(await rejectionText()).toContain(
      "NOSTRMASH_WS_URL must not include credentials"
    );

    applyEnv(
      baseline({ NOSTRMASH_WS_URL: "wss://api.nostrmash.com/primal/ws" })
    );
    expect(await rejectionText()).toContain(
      "NOSTRMASH_WS_URL must use /primal/ws/v1"
    );

    applyEnv(baseline({ NOSTR_READ_TIMEOUT_MS: "nope" }));
    expect(await rejectionText()).toContain(
      "NOSTR_READ_TIMEOUT_MS must be an integer"
    );

    applyEnv(baseline({ NOSTR_READ_TIMEOUT_MS: "1000" }));
    expect(await rejectionText()).toContain(
      "NOSTR_READ_TIMEOUT_MS must be an integer"
    );
  });

  it("requires the full storage set when any storage variable is present", async () => {
    applyEnv(
      baseline({
        STORAGE_ACCESS_KEY: " ",
        STORAGE_BUCKET: "bucket",
        STORAGE_REGION: "",
        STORAGE_SECRET: undefined,
      })
    );
    const text = await rejectionText();
    expect(text).toContain("[REDACTED]");
    expect(text).toContain("STORAGE_REGION");
    expect(text).not.toContain("STORAGE_BUCKET");
  });

  it("enforces production secrets unless the boot is an E2E run", async () => {
    applyEnv(
      baseline({
        CRON_SECRET: "short",
        NODE_ENV: "production",
        NOSTR_PUBLISHER_BACKEND: "internal",
      })
    );
    expect(await rejectionText()).toContain("CRON_SECRET");

    applyEnv(
      baseline({
        CRON_SECRET: CRON,
        E2E_TEST: "true",
        NODE_ENV: "production",
        NOSTR_PUBLISHER_BACKEND: "internal",
      })
    );
    const e2e = await loadEnv();
    expect(e2e.env.NODE_ENV).toBe("production");

    applyEnv(
      baseline({
        CRON_SECRET: CRON,
        NODE_ENV: "production",
        NOSTR_PUBLISHER_BACKEND: "http",
        NOSTR_PUBLISHER_URL: "http://publisher.example/publish",
        REFERRAL_MANUAL_PAYOUT_SECRET: "short",
        REFERRAL_PAYOUTS_ENABLED: "true",
      })
    );
    const payout = await rejectionText();
    expect(payout).toContain("REFERRAL_MANUAL_PAYOUT_SECRET");
    expect(payout).toContain("NOSTR_PUBLISHER_API_TOKEN");

    applyEnv(
      baseline({
        CRON_SECRET: CRON,
        NODE_ENV: "production",
        NOSTR_PUBLISHER_ALLOW_UNAUTHENTICATED: "true",
        NOSTR_PUBLISHER_BACKEND: "http",
        NOSTR_PUBLISHER_URL: "http://publisher.example/publish",
        REFERRAL_MANUAL_PAYOUT_SECRET: PAYOUT_SECRET,
        REFERRAL_PAYOUTS_ENABLED: "true",
      })
    );
    const allowed = await loadEnv();
    expect(allowed.env.NOSTR_PUBLISHER_ALLOW_UNAUTHENTICATED).toBe("true");

    applyEnv(
      baseline({
        CRON_SECRET: CRON,
        NODE_ENV: "production",
        NOSTR_PUBLISHER_API_TOKEN: PUBLISHER_TOKEN,
        NOSTR_PUBLISHER_BACKEND: "http",
        NOSTR_PUBLISHER_URL: "http://publisher.example/publish",
      })
    );
    const tokenized = await loadEnv();
    expect(tokenized.env.NOSTR_PUBLISHER_API_TOKEN).toBe(PUBLISHER_TOKEN);
  });

  it("ignores an empty optional value", async () => {
    applyEnv(baseline({ SENTRY_DSN: "" }));
    const { env } = await loadEnv();
    expect(env.SENTRY_DSN).toBeUndefined();
  });
});
