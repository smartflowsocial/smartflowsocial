/**
 * Safety checks for the self-host acceptance script.
 * The script creates rows and publishes events, so it refuses a development
 * database name and the default Redis port unless the caller opts in.
 */

export function databaseNameAccepted(name) {
  return /(?:^|_)(?:test|tests|testing|cleanroom|acceptance)(?:_|$)/i.test(
    name
  );
}

export function redisPort(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis://");
  }
  return Number(parsed.port || 6379);
}

/**
 * @param {string} url
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
export function redisIsolationProblem(url, env) {
  let port = 6379;
  try {
    port = redisPort(url);
  } catch (error) {
    return error instanceof Error ? error.message : "REDIS_URL is not a URL";
  }
  if (port !== 6379) return null;
  if (env.CI === "true" || env.CLEAN_ROOM_REDIS === "isolated") return null;
  return "REDIS_URL uses port 6379, which is the development Redis. Start docker-compose.clean-room.yml or set CLEAN_ROOM_REDIS=isolated when no other worker is connected.";
}
