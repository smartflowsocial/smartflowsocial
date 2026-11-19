import { beforeEach, describe, expect, it, vi } from "vitest";

interface JobCounts {
  waiting?: number;
  active?: number;
  failed?: number;
  delayed?: number;
}

interface OutboxCounts {
  pending: number;
  ready: number;
  deadLettered: number;
}

const queryRaw = vi.hoisted(() =>
  vi.fn<
    (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
  >()
);
const getJobCounts = vi.hoisted(() =>
  vi.fn<
    (
      waiting: string,
      active: string,
      failed: string,
      delayed: string
    ) => Promise<JobCounts>
  >()
);
const getQueueInstance = vi.hoisted(() =>
  vi.fn<(name: string) => { getJobCounts: typeof getJobCounts }>()
);
const getOutboxBacklogCounts = vi.hoisted(() =>
  vi.fn<() => Promise<OutboxCounts>>()
);

vi.mock("~/infra/outbox/outbox.server", () => ({
  getOutboxBacklogCounts,
}));
vi.mock("~/infra/queue/queue-client.server", () => ({
  getQueueInstance,
}));
vi.mock("~/lib/prisma.server", () => ({
  prisma: { $queryRaw: queryRaw },
}));

import { getAdminQueueHealthSnapshot } from "~/features/admin/repositories/admin-system-health.server";

const QUEUES = [
  "scheduled-posts",
  "scheduled-longform-posts",
  "post-checker",
  "broadcast-dm",
];

function countsFor(waiting: number, active = 0, failed = 0): JobCounts {
  return { waiting, active, failed, delayed: 0 };
}

describe("getAdminQueueHealthSnapshot", () => {
  beforeEach(() => {
    queryRaw.mockReset();
    getJobCounts.mockReset();
    getQueueInstance.mockReset();
    getOutboxBacklogCounts.mockReset();
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    getQueueInstance.mockImplementation(() => ({ getJobCounts }));
    getJobCounts.mockResolvedValue(countsFor(0));
    getOutboxBacklogCounts.mockResolvedValue({
      pending: 0,
      ready: 0,
      deadLettered: 0,
    });
  });

  it("reports every dependency healthy when the queues are idle", async () => {
    const rows = await getAdminQueueHealthSnapshot();

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(getQueueInstance.mock.calls.map((call) => call[0])).toEqual(QUEUES);
    expect(getJobCounts).toHaveBeenCalledWith(
      "waiting",
      "active",
      "failed",
      "delayed"
    );
    expect(rows).toEqual([
      {
        id: "db",
        label: "Database",
        status: "healthy",
        detail: "Connected",
      },
      {
        id: "queues",
        label: "Job queues",
        status: "healthy",
        detail:
          "scheduled-posts: 0w/0a/0f · scheduled-longform-posts: 0w/0a/0f · post-checker: 0w/0a/0f · broadcast-dm: 0w/0a/0f",
      },
      {
        id: "outbox",
        label: "Outbox",
        status: "healthy",
        detail: "0 pending/ready, 0 dead-lettered",
      },
      {
        id: "worker",
        label: "Workers",
        status: "healthy",
        detail: "No backlog; workers idle or polling",
      },
    ]);
  });

  it("treats missing job counters as zero and marks a dead-lettered outbox degraded", async () => {
    getJobCounts.mockResolvedValue({});
    getOutboxBacklogCounts.mockResolvedValue({
      pending: 2,
      ready: 3,
      deadLettered: 1,
    });

    const rows = await getAdminQueueHealthSnapshot();

    expect(rows[1]?.detail).toBe(
      "scheduled-posts: 0w/0a/0f · scheduled-longform-posts: 0w/0a/0f · post-checker: 0w/0a/0f · broadcast-dm: 0w/0a/0f"
    );
    expect(rows[2]).toEqual({
      id: "outbox",
      label: "Outbox",
      status: "degraded",
      detail: "5 pending/ready, 1 dead-lettered",
    });
    expect(rows[3]?.status).toBe("healthy");
  });

  it.each([
    [9, 4, "healthy", "4 active job(s), 9 waiting (all queues)"],
    [100, 0, "failing", "100 waiting, 0 active  -  likely no consumers"],
    [25, 0, "degraded", "25 waiting, 0 active  -  verify worker processes"],
    [3, 0, "healthy", "3 waiting, 0 active (short gap or slow pickup)"],
  ] as const)(
    "derives worker status from %s waiting and %s active",
    async (waiting, active, status, detail) => {
      getJobCounts
        .mockResolvedValueOnce(countsFor(waiting, active))
        .mockResolvedValue(countsFor(0));

      const rows = await getAdminQueueHealthSnapshot();
      const worker = rows[3];

      expect(worker).toEqual({
        id: "worker",
        label: "Workers",
        status,
        detail,
      });
    }
  );

  it("keeps the other probes when the database, redis, and outbox each throw", async () => {
    queryRaw.mockRejectedValue(new Error("db down"));
    getJobCounts.mockRejectedValue(new Error("redis down"));
    getOutboxBacklogCounts.mockRejectedValue("outbox down");

    const rows = await getAdminQueueHealthSnapshot();

    expect(rows).toEqual([
      {
        id: "db",
        label: "Database",
        status: "failing",
        detail: "Ping failed",
      },
      {
        id: "queues",
        label: "Job queues",
        status: "unknown",
        detail: "Redis unreachable from app server",
      },
      {
        id: "outbox",
        label: "Outbox",
        status: "unknown",
        detail: "Could not load outbox counts",
      },
      {
        id: "worker",
        label: "Workers",
        status: "unknown",
        detail: "Redis unreachable",
      },
    ]);
  });
});
