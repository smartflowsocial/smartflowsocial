/**
 * Optional signed heartbeat for Nostr Watchdog.
 * Disabled when WATCHDOG_URL or WATCHDOG_HMAC_SECRET is unset.
 * A failed send never throws and never blocks queue processing.
 */

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
}

export function sampleFromCounts(
  counts: QueueCounts[],
  now = Date.now()
): { progress: string; idle: boolean; loopAt: number } {
  let backlog = 0;
  let completed = 0;
  for (const row of counts) {
    backlog +=
      Math.max(0, row.waiting) +
      Math.max(0, row.active) +
      Math.max(0, row.delayed);
    completed += Math.max(0, row.completed);
  }
  return {
    progress: String(completed),
    idle: backlog === 0,
    loopAt: now,
  };
}

export async function createSignedHeartbeat(input: {
  url: string;
  secret: string;
  payload: { progress: string; idle: boolean; loopAt: number };
  now?: number;
  nonce?: string;
}): Promise<{ url: string; headers: Record<string, string>; body: string }> {
  const target = new URL(input.url);
  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    target.search !== "" ||
    target.hash !== ""
  ) {
    throw new Error("watchdog_url_invalid");
  }
  if (input.secret.length < 32) throw new Error("watchdog_secret_invalid");
  const body = JSON.stringify({
    progress: input.payload.progress,
    idle: input.payload.idle,
    loopAt: input.payload.loopAt,
  });
  const bytes = new TextEncoder().encode(body);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const bodyHash = hex(digest);
  const timestamp = String(Math.floor((input.now ?? Date.now()) / 1000));
  const nonce = input.nonce ?? crypto.randomUUID().replace(/-/g, "");
  const canonical = `${timestamp}\n${nonce}\nPOST\n${target.pathname}\n${bodyHash}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = hex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical))
  );
  return {
    url: target.toString(),
    headers: {
      "content-type": "application/json",
      "x-watchdog-timestamp": timestamp,
      "x-watchdog-nonce": nonce,
      "x-watchdog-signature": signature,
    },
    body,
  };
}

const QUEUE_NAMES = [
  "scheduled-posts",
  "scheduled-longform-posts",
  "post-checker",
  "broadcast-dm",
] as const;

export async function runWatchdogHeartbeatTick(
  url: string,
  secret: string
): Promise<void> {
  const { getQueueInstance } = await import("~/infra/queue");
  const counts: QueueCounts[] = [];
  for (const name of QUEUE_NAMES) {
    const queue = getQueueInstance(name);
    const row = await queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "completed"
    );
    counts.push({
      waiting: row.waiting ?? 0,
      active: row.active ?? 0,
      delayed: row.delayed ?? 0,
      completed: row.completed ?? 0,
    });
  }
  await postSample(url, secret, sampleFromCounts(counts));
}

export function startWatchdogHeartbeat(intervalMs = 30_000): () => void {
  const url = process.env["WATCHDOG_URL"]?.trim() ?? "";
  const secret = process.env["WATCHDOG_HMAC_SECRET"]?.trim() ?? "";
  if (url === "" || secret.length < 32) return () => {};

  let stopped = false;
  let inFlight = false;
  const tick = async (): Promise<void> => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await runWatchdogHeartbeatTick(url, secret);
    } catch {
      // The worker continues when queue inspection or the watchdog is unavailable.
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function postSample(
  url: string,
  secret: string,
  sample: { progress: string; idle: boolean; loopAt: number }
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const request = await createSignedHeartbeat({
      url,
      secret,
      payload: sample,
    });
    try {
      const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(3_000),
        redirect: "error",
      });
      if (response.ok) return;
    } catch {
      // Retry once, then drop the sample.
    }
  }
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
