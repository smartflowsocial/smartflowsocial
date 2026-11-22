/**
 * Optional signed heartbeat for Nostr Watchdog.
 * Disabled when WATCHDOG_URL or WATCHDOG_HMAC_SECRET is unset.
 * A failed send never throws and never blocks queue processing.
 *
 * The sample is an observation of BullMQ, not of the heartbeat timer:
 * - `loopAt` is when queue inspection succeeded. It does not mean a job ran.
 * - `idle` is true only when no queue is paused and no job is waiting, active,
 *   or already due. A post scheduled for later stays idle.
 * - `progress` is `<process start>:<completions since start>`. BullMQ's retained
 *   completed count is not used, because retention can freeze or rewind it.
 *   A restart changes the token, so the watchdog starts a new progress window
 *   instead of treating the reset as a stall.
 */

export const OVERDUE_WAITING_MS = 120_000;
export const STALLED_ACTIVE_MS = 5 * 60_000;
const DUE_SKEW_MS = 1_000;

export interface QueueObservation {
  paused: boolean;
  waitingCount: number;
  activeCount: number;
  delayedCount: number;
  oldestWaitingAt: number | null;
  oldestActiveProcessedOn: number | null;
  soonestDelayedPromoteAt: number | null;
}

export interface WorkerAssessment {
  progress: string;
  idle: boolean;
  loopAt: number;
  actionable: boolean;
  futureScheduled: number;
  overdueWaiting: number;
  overdueDelayed: number;
  active: number;
  stalledActive: number;
  paused: boolean;
}

let processStartedAt = Date.now();
let completedSinceStart = 0;

export function noteWatchdogJobCompleted(): void {
  completedSinceStart += 1;
}

export function workerProgressToken(
  startedAt = processStartedAt,
  completed = completedSinceStart
): string {
  return `${startedAt}:${completed}`;
}

/** Test-only reset. Production progress lives for the life of the process. */
export function testingSetWatchdogProgress(
  startedAt: number,
  completed: number
): void {
  processStartedAt = startedAt;
  completedSinceStart = completed;
}

export function assessWorkerHealth(
  queues: QueueObservation[],
  observedAt: number,
  progress = workerProgressToken()
): WorkerAssessment {
  let paused = false;
  let waiting = 0;
  let active = 0;
  let futureScheduled = 0;
  let overdueWaiting = 0;
  let overdueDelayed = 0;
  let stalledActive = 0;
  for (const queue of queues) {
    if (queue.paused) paused = true;
    waiting += Math.max(0, queue.waitingCount);
    active += Math.max(0, queue.activeCount);
    const delayed = Math.max(0, queue.delayedCount);
    const promoteAt = queue.soonestDelayedPromoteAt;
    if (
      delayed > 0 &&
      promoteAt !== null &&
      promoteAt > observedAt + DUE_SKEW_MS
    ) {
      futureScheduled += delayed;
    } else if (
      delayed > 0 &&
      (promoteAt === null || promoteAt <= observedAt + DUE_SKEW_MS)
    ) {
      overdueDelayed += delayed;
    }
    if (
      queue.waitingCount > 0 &&
      queue.oldestWaitingAt !== null &&
      observedAt - queue.oldestWaitingAt >= OVERDUE_WAITING_MS
    ) {
      overdueWaiting += queue.waitingCount;
    }
    if (
      queue.activeCount > 0 &&
      queue.oldestActiveProcessedOn !== null &&
      observedAt - queue.oldestActiveProcessedOn >= STALLED_ACTIVE_MS
    ) {
      stalledActive += queue.activeCount;
    }
  }
  const actionable = paused || waiting > 0 || active > 0 || overdueDelayed > 0;
  return {
    progress,
    idle: !actionable,
    loopAt: observedAt,
    actionable,
    futureScheduled,
    overdueWaiting,
    overdueDelayed,
    active,
    stalledActive,
    paused,
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

interface InspectableQueue {
  isPaused(): Promise<boolean>;
  getJobCounts(
    ...types: string[]
  ): Promise<{ [index: string]: number | undefined }>;
  getJobs(
    types: string[],
    start?: number,
    end?: number,
    asc?: boolean
  ): Promise<
    Array<{ timestamp?: number; delay?: number; processedOn?: number }>
  >;
}

export async function runWatchdogHeartbeatTick(
  url: string,
  secret: string
): Promise<void> {
  const { getQueueInstance } = await import("~/infra/queue");
  const observations: QueueObservation[] = [];
  for (const name of QUEUE_NAMES) {
    observations.push(
      await inspectQueue(getQueueInstance(name) as InspectableQueue)
    );
  }
  const observedAt = Date.now();
  await postSample(
    url,
    secret,
    assessWorkerHealth(observations, observedAt, workerProgressToken())
  );
}

async function inspectQueue(
  queue: InspectableQueue
): Promise<QueueObservation> {
  const [paused, counts, waitingJobs, activeJobs, delayedJobs] =
    await Promise.all([
      queue.isPaused(),
      queue.getJobCounts("waiting", "active", "delayed", "paused"),
      queue.getJobs(["waiting"], 0, 0, true),
      queue.getJobs(["active"], 0, 19, true),
      queue.getJobs(["delayed"], 0, 0, true),
    ]);
  const waiting = waitingJobs[0];
  const delayed = delayedJobs[0];
  const activeProcessed = activeJobs
    .map((job) => job.processedOn)
    .filter((value): value is number => typeof value === "number");
  const promoteAt =
    delayed && typeof delayed.timestamp === "number"
      ? delayed.timestamp +
        (typeof delayed.delay === "number" ? delayed.delay : 0)
      : null;
  return {
    paused: paused || (counts["paused"] ?? 0) > 0,
    waitingCount: counts["waiting"] ?? 0,
    activeCount: counts["active"] ?? 0,
    delayedCount: counts["delayed"] ?? 0,
    oldestWaitingAt:
      waiting && typeof waiting.timestamp === "number"
        ? waiting.timestamp
        : null,
    oldestActiveProcessedOn:
      activeProcessed.length === 0 ? null : Math.min(...activeProcessed),
    soonestDelayedPromoteAt: promoteAt,
  };
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
