// @ts-nocheck -- mocked collaborators are narrower than the production types.
import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface RateLimitConfig {
  windowMs: number;
  max: number;
  standardHeaders: boolean;
  legacyHeaders: boolean;
  message: string;
  handler: (req: Request, res: Response) => void;
  skip: (req: Request) => boolean;
}

interface ConsumeResult {
  remainingPoints: number;
  msBeforeNext: number;
}

interface LimiterState {
  remainingPoints: number;
  msBeforeNext: number;
}

interface LimiterOptions {
  storeClient: unknown;
  keyPrefix: string;
  points: number;
  duration: number;
  blockDuration?: number;
}

interface CreatedLimiter {
  keyPrefix: string;
  points: number;
  duration: number;
  blockDuration?: number;
  storeClient: unknown;
  consume: ReturnType<
    typeof vi.fn<(key: string, points?: number) => Promise<ConsumeResult>>
  >;
  get: ReturnType<typeof vi.fn<(key: string) => Promise<LimiterState | null>>>;
}

interface RequestShape {
  user?: { id?: string };
  ip?: string;
  socket?: { remoteAddress?: string };
  path?: string;
  method?: string;
  rateLimit?: { resetTime?: number };
}

interface SentBody {
  statusCode: number;
  body: unknown;
  contentType: string | null;
  html: string | null;
}

const envState = vi.hoisted(() => ({
  NODE_ENV: "production",
  CYPRESS: undefined as string | undefined,
  E2E_TEST: undefined as string | undefined,
  DISABLE_RATE_LIMIT: undefined as string | undefined,
  REDIS_URL: "redis://localhost:6379",
}));

const redisState = vi.hoisted(() => ({
  status: "ready",
}));

const logs = vi.hoisted(() => ({
  logError:
    vi.fn<(error: unknown, context?: Record<string, unknown>) => void>(),
  logWarning: vi.fn<(message: string) => void>(),
}));

const captured = vi.hoisted(() => ({
  configs: [] as RateLimitConfig[],
}));

const limiters = vi.hoisted(() => ({
  created: [] as CreatedLimiter[],
  consume: vi.fn<(key: string, points?: number) => Promise<ConsumeResult>>(),
  get: vi.fn<(key: string) => Promise<LimiterState | null>>(),
}));

vi.mock("~/lib/env.server", () => ({ env: envState }));
vi.mock("~/infra/queue/queue-client.server", () => ({ redis: redisState }));
vi.mock("~/lib/error-logger.server", () => logs);
vi.mock("express-rate-limit", () => ({
  default: (options: RateLimitConfig) => {
    captured.configs.push(options);
    return options;
  },
}));
vi.mock("rate-limiter-flexible", () => ({
  RateLimiterRedis: class RateLimiterRedis {
    consume: CreatedLimiter["consume"];
    get: CreatedLimiter["get"];

    constructor(options: LimiterOptions) {
      this.consume = limiters.consume;
      this.get = limiters.get;
      limiters.created.push({
        keyPrefix: options.keyPrefix,
        points: options.points,
        duration: options.duration,
        blockDuration: options.blockDuration,
        storeClient: options.storeClient,
        consume: limiters.consume,
        get: limiters.get,
      });
    }
  },
}));

import {
  apiLimiter,
  authLimiter,
  broadcastUnsubscribeLimiter,
  checkProductFeedbackRateLimit,
  checkUserPostCreationLimit,
  createIPRateLimiter,
  createUserRateLimiter,
  getRateLimitInfo,
  isAuthPageLoad,
  pollingLimiter,
  strictLimiter,
} from "~/lib/rate-limit.server";

function asRequest(value: RequestShape): Request {
  return value as unknown as Request;
}

function response(): { res: Response; sent: SentBody } {
  const sent: SentBody = {
    statusCode: 0,
    body: null,
    contentType: null,
    html: null,
  };
  const res = {
    status(code: number) {
      sent.statusCode = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
    type(contentType: string) {
      sent.contentType = contentType;
      return this;
    },
    send(html: string) {
      sent.html = html;
      return this;
    },
  };
  return { res: res as unknown as Response, sent };
}

function configAt(index: number): RateLimitConfig {
  const config = captured.configs[index];
  if (!config) throw new Error(`missing limiter config ${index}`);
  return config;
}

function latestLimiter(): CreatedLimiter {
  const limiter = limiters.created.at(-1);
  if (!limiter) throw new Error("missing redis limiter");
  return limiter;
}

describe("express rate limiters", () => {
  beforeEach(() => {
    envState.NODE_ENV = "production";
    envState.CYPRESS = undefined;
    envState.E2E_TEST = undefined;
    envState.DISABLE_RATE_LIMIT = undefined;
  });

  it("builds production windows and skips test traffic at request time", () => {
    expect(captured.configs).toHaveLength(5);
    expect(apiLimiter).toBe(captured.configs[0]);
    expect(strictLimiter).toBe(captured.configs[1]);
    expect(pollingLimiter).toBe(captured.configs[2]);
    expect(authLimiter).toBe(captured.configs[3]);
    expect(broadcastUnsubscribeLimiter).toBe(captured.configs[4]);

    const [api, strict, polling, auth, broadcast] = captured.configs;
    expect(api?.max).toBe(1000);
    expect(strict?.max).toBe(100);
    expect(polling?.max).toBe(2000);
    expect(auth?.max).toBe(20);
    expect(broadcast?.max).toBe(60);
    for (const config of captured.configs) {
      expect(config.windowMs).toBe(15 * 60 * 1000);
      expect(config.standardHeaders).toBe(true);
      expect(config.legacyHeaders).toBe(false);
    }

    const page = asRequest({ method: "GET", path: "/api/other" });
    expect(api?.skip(page)).toBe(false);
    expect(
      api?.skip(asRequest({ method: "POST", path: "/api/publish-result" }))
    ).toBe(true);
    expect(strict?.skip(page)).toBe(false);
    expect(polling?.skip(page)).toBe(false);
    expect(auth?.skip(asRequest({ method: "GET", path: "/" }))).toBe(true);
    expect(auth?.skip(asRequest({ method: "HEAD", path: "/login" }))).toBe(
      true
    );
    expect(auth?.skip(asRequest({ method: "POST", path: "/" }))).toBe(false);
    expect(auth?.skip(asRequest({ method: "GET", path: "/dashboard" }))).toBe(
      false
    );
    expect(broadcast?.skip(page)).toBe(false);

    envState.NODE_ENV = "test";
    expect(api?.skip(page)).toBe(true);
    expect(strict?.skip(page)).toBe(true);
    expect(polling?.skip(page)).toBe(true);
    expect(auth?.skip(asRequest({ method: "POST", path: "/dashboard" }))).toBe(
      true
    );
    expect(broadcast?.skip(page)).toBe(true);
    envState.NODE_ENV = "production";
    envState.CYPRESS = "true";
    expect(strict?.skip(page)).toBe(true);
    envState.CYPRESS = undefined;
    envState.E2E_TEST = "true";
    expect(polling?.skip(page)).toBe(true);
    envState.E2E_TEST = undefined;
    envState.DISABLE_RATE_LIMIT = "true";
    expect(broadcast?.skip(page)).toBe(true);
  });

  it("recognizes auth page loads", () => {
    expect(isAuthPageLoad({ method: "GET", path: "/" })).toBe(true);
    expect(isAuthPageLoad({ method: "HEAD", path: "/login" })).toBe(true);
    expect(isAuthPageLoad({ method: "POST", path: "/login" })).toBe(false);
    expect(isAuthPageLoad({ method: "GET", path: "/signup" })).toBe(false);
  });

  it("writes a json 429 and an html 429", () => {
    const api = configAt(0);
    const fallback = response();
    api.handler(asRequest({ path: "/api" }), fallback.res);
    expect(fallback.sent.statusCode).toBe(429);
    expect(fallback.sent.body).toEqual({
      error: "Rate limit exceeded",
      message: "Too many requests, please try again later.",
      retryAfter: 900,
    });

    const reset = response();
    api.handler(
      asRequest({ path: "/api", rateLimit: { resetTime: 2_000 } }),
      reset.res
    );
    expect(reset.sent.body).toMatchObject({ retryAfter: 2 });

    const strict = response();
    configAt(1).handler(asRequest({ path: "/secret" }), strict.res);
    expect(strict.sent.body).toMatchObject({
      message: "Rate limit exceeded for this endpoint. Please try again later.",
    });

    const polling = response();
    configAt(2).handler(asRequest({ path: "/poll" }), polling.res);
    expect(polling.sent.body).toMatchObject({
      message: "Too many polling requests. Please wait before polling again.",
    });

    const auth = response();
    configAt(3).handler(asRequest({ path: "/login" }), auth.res);
    expect(auth.sent.body).toMatchObject({
      message: "Too many authentication attempts, please try again later.",
    });

    const broadcast = response();
    configAt(4).handler(asRequest({ path: "/unsubscribe" }), broadcast.res);
    expect(broadcast.sent.statusCode).toBe(429);
    expect(broadcast.sent.contentType).toBe("html");
    expect(broadcast.sent.html).toContain(
      "Too many requests, please try again later."
    );
  });
});

describe("redis rate limiters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envState.NODE_ENV = "production";
    envState.CYPRESS = undefined;
    envState.E2E_TEST = undefined;
    envState.DISABLE_RATE_LIMIT = undefined;
    envState.REDIS_URL = "redis://localhost:6379";
    redisState.status = "ready";
    limiters.created.length = 0;
    limiters.consume.mockReset();
    limiters.get.mockReset();
    limiters.consume.mockResolvedValue({
      remainingPoints: 1,
      msBeforeNext: 1_000,
    });
    limiters.get.mockResolvedValue(null);
  });

  it("skips per-user limiting without a user or a ready redis", async () => {
    const limiter = createUserRateLimiter(10, 30);
    const next = vi.fn<NextFunction>();
    const { res } = response();
    await limiter(asRequest({ path: "/api" }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(limiters.created).toHaveLength(0);

    redisState.status = "connecting";
    await limiter(asRequest({ user: { id: "user-1" } }), res, next);
    expect(next).toHaveBeenCalledTimes(2);
    envState.REDIS_URL = "";
    redisState.status = "ready";
    await limiter(asRequest({ user: { id: "user-1" } }), res, next);
    expect(limiters.created).toHaveLength(0);
  });

  it("consumes a user bucket and returns 429 when it is exhausted", async () => {
    const limiter = createUserRateLimiter(10, 30);
    const next = vi.fn<NextFunction>();
    const allowed = response();
    const pending = limiter(
      asRequest({ user: { id: "user-1" } }),
      allowed.res,
      next
    );
    const created = latestLimiter();
    expect(created).toMatchObject({
      keyPrefix: "rl:user",
      points: 10,
      duration: 30,
      blockDuration: 30,
      storeClient: redisState,
    });
    created.consume.mockResolvedValue({
      remainingPoints: 9,
      msBeforeNext: 1000,
    });
    await pending;
    expect(created.consume).toHaveBeenCalledWith("user-1");
    expect(next).toHaveBeenCalledTimes(1);

    created.consume.mockRejectedValueOnce({ msBeforeNext: 1_500 });
    const blocked = response();
    await limiter(asRequest({ user: { id: "user-1" } }), blocked.res, next);
    expect(blocked.sent.statusCode).toBe(429);
    expect(blocked.sent.body).toEqual({
      error: "Rate limit exceeded",
      message: "Too many requests, please try again later.",
      retryAfter: 2,
    });

    created.consume.mockRejectedValueOnce({ msBeforeNext: 0 });
    const zero = response();
    await limiter(asRequest({ user: { id: "user-1" } }), zero.res, next);
    expect(zero.sent.body).toMatchObject({ retryAfter: 30 });

    created.consume.mockRejectedValueOnce(new Error("redis"));
    const unexpected = response();
    await limiter(asRequest({ user: { id: "user-1" } }), unexpected.res, next);
    expect(unexpected.sent.body).toMatchObject({ retryAfter: 30 });
    expect(logs.logError).not.toHaveBeenCalled();

    created.consume.mockRejectedValueOnce("redis");
    const thrownString = response();
    await limiter(
      asRequest({ user: { id: "user-1" } }),
      thrownString.res,
      next
    );
    expect(thrownString.sent.statusCode).toBe(429);
  });

  it("limits by ip, socket address, or unknown", async () => {
    const limiter = createIPRateLimiter();
    const next = vi.fn<NextFunction>();
    const { res } = response();
    redisState.status = "wait";
    await limiter(asRequest({ ip: "203.0.113.8" }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(limiters.created).toHaveLength(0);

    redisState.status = "ready";
    const pending = limiter(
      asRequest({ ip: "203.0.113.8", socket: { remoteAddress: "127.0.0.1" } }),
      res,
      next
    );
    const created = latestLimiter();
    created.consume.mockResolvedValue({ remainingPoints: 1, msBeforeNext: 10 });
    await pending;
    expect(created.consume).toHaveBeenCalledWith("203.0.113.8");
    expect(created.keyPrefix).toBe("rl:ip");
    expect(created.points).toBe(100);
    expect(created.duration).toBe(60);

    const socketPending = limiter(
      asRequest({ socket: { remoteAddress: "198.51.100.4" } }),
      res,
      next
    );
    latestLimiter().consume.mockResolvedValue({
      remainingPoints: 1,
      msBeforeNext: 10,
    });
    await socketPending;
    expect(latestLimiter().consume).toHaveBeenCalledWith("198.51.100.4");

    const unknownPending = limiter(asRequest({ socket: {} }), res, next);
    latestLimiter().consume.mockResolvedValue({
      remainingPoints: 1,
      msBeforeNext: 10,
    });
    await unknownPending;
    expect(latestLimiter().consume).toHaveBeenCalledWith("unknown");

    latestLimiter().consume.mockRejectedValueOnce({ msBeforeNext: 2_200 });
    const blocked = response();
    await limiter(
      asRequest({ ip: "203.0.113.8", socket: {} }),
      blocked.res,
      next
    );
    expect(blocked.sent.body).toEqual({
      error: "Rate limit exceeded",
      message: "Too many requests from this IP, please try again later.",
      retryAfter: 3,
    });

    latestLimiter().consume.mockRejectedValueOnce("down");
    const fallback = response();
    await limiter(
      asRequest({ ip: "203.0.113.9", socket: {} }),
      fallback.res,
      next
    );
    expect(fallback.sent.body).toMatchObject({ retryAfter: 60 });
  });

  it("reads, defaults, and logs rate-limit info", async () => {
    redisState.status = "end";
    await expect(getRateLimitInfo("user-1")).resolves.toBeNull();
    expect(limiters.created).toHaveLength(0);

    redisState.status = "ready";
    const missing = getRateLimitInfo("user-1");
    const created = latestLimiter();
    created.get.mockResolvedValue(null);
    const before = Date.now();
    const open = await missing;
    const after = Date.now();
    expect(created.keyPrefix).toBe("rl:user");
    expect(created.points).toBe(100);
    expect(created.duration).toBe(60);
    expect(created.blockDuration).toBeUndefined();
    expect(open?.remaining).toBe(100);
    expect(open?.resetTime).toBeGreaterThanOrEqual(before + 60_000);
    expect(open?.resetTime).toBeLessThanOrEqual(after + 60_000);

    created.get.mockResolvedValue({ remainingPoints: 4, msBeforeNext: 2_500 });
    const usedBefore = Date.now();
    const used = await getRateLimitInfo("user-1");
    const usedAfter = Date.now();
    expect(used?.remaining).toBe(4);
    expect(used?.resetTime).toBeGreaterThanOrEqual(usedBefore + 2_500);
    expect(used?.resetTime).toBeLessThanOrEqual(usedAfter + 2_500);

    created.get.mockRejectedValueOnce(new Error("info down"));
    await expect(getRateLimitInfo("user-1")).resolves.toBeNull();
    expect(logs.logError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect((logs.logError.mock.calls[0]?.[0] as Error).message).toBe(
      "info down"
    );
    expect(logs.logError.mock.calls[0]?.[1]).toEqual({
      message: "Error getting rate limit info",
      userId: "user-1",
    });

    created.get.mockRejectedValueOnce("info string");
    await expect(getRateLimitInfo("user-2")).resolves.toBeNull();
    expect((logs.logError.mock.calls[1]?.[0] as Error).message).toBe(
      "info string"
    );
  });

  it("allows post creation when tests or redis bypass the limiter", async () => {
    envState.NODE_ENV = "test";
    const tested = await checkUserPostCreationLimit("user-1", 3, 15, 9);
    expect(tested.allowed).toBe(true);
    expect(tested.remaining).toBe(9);
    expect(limiters.created).toHaveLength(0);

    envState.NODE_ENV = "production";
    envState.CYPRESS = "true";
    expect((await checkUserPostCreationLimit("user-1", 1)).allowed).toBe(true);
    envState.CYPRESS = undefined;
    envState.E2E_TEST = "true";
    expect((await checkUserPostCreationLimit("user-1", 1)).allowed).toBe(true);
    envState.E2E_TEST = undefined;
    envState.DISABLE_RATE_LIMIT = "true";
    expect((await checkUserPostCreationLimit("user-1", 1)).allowed).toBe(true);

    envState.DISABLE_RATE_LIMIT = undefined;
    redisState.status = "wait";
    const bypass = await checkUserPostCreationLimit("user-1", 4, 10, 12);
    expect(bypass.allowed).toBe(true);
    expect(bypass.remaining).toBe(12);
    expect(logs.logWarning).toHaveBeenCalledWith(
      "Redis not available for post creation rate limiting, allowing request"
    );
    expect(limiters.created).toHaveLength(0);
  });

  it("enforces the post-creation bucket", async () => {
    redisState.status = "ready";
    const over = checkUserPostCreationLimit("user-1", 5, 10, 3);
    const created = latestLimiter();
    created.get.mockResolvedValue(null);
    const denied = await over;
    expect(created).toMatchObject({
      keyPrefix: "rl:posts:user",
      points: 3,
      duration: 600,
      blockDuration: 600,
    });
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.error).toBe(
      "Cannot create 5 posts. Maximum 3 posts per 10 minutes."
    );
    expect(created.consume).not.toHaveBeenCalled();

    created.get.mockResolvedValue(null);
    created.consume.mockResolvedValue({
      remainingPoints: 1,
      msBeforeNext: 4_000,
    });
    const before = Date.now();
    const allowed = await checkUserPostCreationLimit("user-1", 2, 10, 3);
    const after = Date.now();
    expect(created.consume).toHaveBeenCalledWith("user-1", 2);
    expect(allowed).toEqual({
      allowed: true,
      remaining: 1,
      resetTime: allowed.resetTime,
    });
    expect(allowed.resetTime).toBeGreaterThanOrEqual(before + 4_000);
    expect(allowed.resetTime).toBeLessThanOrEqual(after + 4_000);

    created.get.mockResolvedValue({ remainingPoints: 1, msBeforeNext: 8_000 });
    const short = await checkUserPostCreationLimit("user-1", 2, 10, 3);
    expect(short.allowed).toBe(false);
    expect(short.remaining).toBe(1);
    expect(short.error).toContain("You can create 1 more posts.");
    expect(short.error).toContain("8 seconds");

    created.get.mockResolvedValue({ remainingPoints: 5, msBeforeNext: 1_000 });
    created.consume.mockResolvedValue({
      remainingPoints: 3,
      msBeforeNext: 900,
    });
    const room = await checkUserPostCreationLimit("user-1", 2, 10, 3);
    expect(room.allowed).toBe(true);
    expect(room.remaining).toBe(3);
    expect(created.consume).toHaveBeenLastCalledWith("user-1", 2);

    created.consume.mockRejectedValueOnce({
      msBeforeNext: 1_500,
      remainingPoints: 0,
    });
    const blocked = await checkUserPostCreationLimit("user-1", 1, 10, 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.error).toContain("2 seconds");

    created.consume.mockRejectedValueOnce({ msBeforeNext: 1_000 });
    const missingRemaining = await checkUserPostCreationLimit(
      "user-1",
      1,
      10,
      3
    );
    expect(missingRemaining.remaining).toBe(0);

    created.consume.mockRejectedValueOnce(new Error("post down"));
    const failOpen = await checkUserPostCreationLimit("user-1", 2, 10, 3);
    expect(failOpen.allowed).toBe(true);
    expect(failOpen.remaining).toBe(3);
    expect((logs.logError.mock.calls[0]?.[0] as Error).message).toBe(
      "post down"
    );
    expect(logs.logError.mock.calls[0]?.[1]).toEqual({
      message: "Error checking post creation limit",
      userId: "user-1",
      postCount: 2,
      windowMinutes: 10,
      maxPosts: 3,
    });

    created.consume.mockRejectedValueOnce("post string");
    const failString = await checkUserPostCreationLimit("user-1", 2, 10, 3);
    expect(failString.allowed).toBe(true);
    expect((logs.logError.mock.calls[1]?.[0] as Error).message).toBe(
      "post string"
    );
  });

  it("uses the default post window", async () => {
    const pending = checkUserPostCreationLimit("user-1", 1);
    const created = latestLimiter();
    created.get.mockResolvedValue(null);
    created.consume.mockResolvedValue({
      remainingPoints: 1999,
      msBeforeNext: 10,
    });
    await pending;
    expect(created.points).toBe(2000);
    expect(created.duration).toBe(3600);
    expect(created.blockDuration).toBe(3600);
  });

  it("limits product feedback submissions", async () => {
    envState.NODE_ENV = "test";
    await expect(checkProductFeedbackRateLimit("user-1")).resolves.toEqual({
      allowed: true,
    });
    expect(limiters.created).toHaveLength(0);

    envState.NODE_ENV = "production";
    redisState.status = "wait";
    await expect(checkProductFeedbackRateLimit("user-1")).resolves.toEqual({
      allowed: true,
    });
    expect(logs.logWarning).toHaveBeenCalledWith(
      "Redis not available for product feedback rate limit, allowing request"
    );

    redisState.status = "ready";
    const pending = checkProductFeedbackRateLimit("user-1");
    const created = latestLimiter();
    created.consume.mockResolvedValue({ remainingPoints: 7, msBeforeNext: 10 });
    await expect(pending).resolves.toEqual({ allowed: true });
    expect(created).toMatchObject({
      keyPrefix: "rl:product-feedback",
      points: 8,
      duration: 3600,
    });
    expect(created.blockDuration).toBeUndefined();
    expect(created.consume).toHaveBeenCalledWith("user-1");

    created.consume.mockRejectedValueOnce({ msBeforeNext: 2_400 });
    const blocked = await checkProductFeedbackRateLimit("user-1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.error).toBe(
      "Too many feedback submissions. Try again in 3 seconds."
    );

    created.consume.mockRejectedValueOnce(new Error("feedback down"));
    await expect(checkProductFeedbackRateLimit("user-1")).resolves.toEqual({
      allowed: true,
    });
    expect((logs.logError.mock.calls[0]?.[0] as Error).message).toBe(
      "feedback down"
    );

    created.consume.mockRejectedValueOnce("feedback string");
    await expect(checkProductFeedbackRateLimit("user-1")).resolves.toEqual({
      allowed: true,
    });
    expect((logs.logError.mock.calls[1]?.[0] as Error).message).toBe(
      "feedback string"
    );
    expect(logs.logError.mock.calls[1]?.[1]).toEqual({
      message: "Product feedback rate limit check failed",
      userId: "user-1",
    });
  });
});
