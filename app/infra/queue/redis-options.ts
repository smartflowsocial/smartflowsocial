export interface RedisConnectionEnv {
  nodeEnv?: string;
  e2eTest?: string;
}

/**
 * Unit tests set NODE_ENV=test and often have no Redis, so they fail fast.
 * E2E and production need a real connection. E2E also sets NODE_ENV=test,
 * and the worker does not override it. A 200ms timeout there drops Redis
 * under CI load and crashes the worker.
 */
export function redisConnectionOptions(input: RedisConnectionEnv): {
  maxRetriesPerRequest: null;
  lazyConnect: boolean;
  enableOfflineQueue: boolean;
  connectTimeout: number;
  retryStrategy?: () => null;
} {
  const redisOptional = input.nodeEnv === "test" && input.e2eTest !== "true";
  return {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    enableOfflineQueue: !redisOptional,
    connectTimeout: redisOptional ? 200 : 10_000,
    ...(redisOptional ? { retryStrategy: () => null } : {}),
  };
}

export function redisErrorsAreIgnored(input: RedisConnectionEnv): boolean {
  return input.nodeEnv === "test" && input.e2eTest !== "true";
}
