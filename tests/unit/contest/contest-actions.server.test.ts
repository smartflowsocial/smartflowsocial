import { beforeEach, describe, expect, it, vi } from "vitest";

const crud = vi.hoisted(() => ({
  appendContestEventLog: vi.fn(),
  createContest: vi.fn(),
  deleteContest: vi.fn(),
  duplicateContest: vi.fn(),
}));

const lifecycle = vi.hoisted(() => ({
  cancelContest: vi.fn(),
  completeContest: vi.fn(),
  freezeContestAtDeadline: vi.fn(),
  launchContest: vi.fn(),
  lockContest: vi.fn(),
}));

const queries = vi.hoisted(() => ({
  getContestById: vi.fn(),
  getContestByIdPublic: vi.fn(),
  getContestEntryCounts: vi.fn(),
  getContestKpiCounts: vi.fn(),
  getContestSourcePostThumbnails: vi.fn(),
  listContests: vi.fn(),
  listContestsFiltered: vi.fn(),
}));

const payout = vi.hoisted(() => ({
  runContestPayoutBatchStepWithNwc: vi.fn(),
  runContestPayoutBatchWithNwc: vi.fn(),
  setContestWinnerPayoutStatus: vi.fn(),
  updateContestPayoutSettings: vi.fn(),
}));

vi.mock("~/features/contest/contest-actions-crud.server", () => crud);
vi.mock("~/features/contest/contest-actions-lifecycle.server", () => lifecycle);
vi.mock("~/features/contest/contest-actions-queries.server", () => queries);
vi.mock("~/features/contest/contest-actions-payout.server", () => payout);

import * as actions from "~/features/contest/contest-actions.server";

describe("contest actions barrel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("re-exports the crud, lifecycle, query, and payout functions", () => {
    expect(actions.appendContestEventLog).toBe(crud.appendContestEventLog);
    expect(actions.createContest).toBe(crud.createContest);
    expect(actions.deleteContest).toBe(crud.deleteContest);
    expect(actions.duplicateContest).toBe(crud.duplicateContest);
    expect(actions.cancelContest).toBe(lifecycle.cancelContest);
    expect(actions.completeContest).toBe(lifecycle.completeContest);
    expect(actions.freezeContestAtDeadline).toBe(
      lifecycle.freezeContestAtDeadline
    );
    expect(actions.launchContest).toBe(lifecycle.launchContest);
    expect(actions.lockContest).toBe(lifecycle.lockContest);
    expect(actions.getContestById).toBe(queries.getContestById);
    expect(actions.getContestByIdPublic).toBe(queries.getContestByIdPublic);
    expect(actions.getContestEntryCounts).toBe(queries.getContestEntryCounts);
    expect(actions.getContestKpiCounts).toBe(queries.getContestKpiCounts);
    expect(actions.getContestSourcePostThumbnails).toBe(
      queries.getContestSourcePostThumbnails
    );
    expect(actions.listContests).toBe(queries.listContests);
    expect(actions.listContestsFiltered).toBe(queries.listContestsFiltered);
    expect(actions.runContestPayoutBatchStepWithNwc).toBe(
      payout.runContestPayoutBatchStepWithNwc
    );
    expect(actions.runContestPayoutBatchWithNwc).toBe(
      payout.runContestPayoutBatchWithNwc
    );
    expect(actions.setContestWinnerPayoutStatus).toBe(
      payout.setContestWinnerPayoutStatus
    );
    expect(actions.updateContestPayoutSettings).toBe(
      payout.updateContestPayoutSettings
    );
  });
});
