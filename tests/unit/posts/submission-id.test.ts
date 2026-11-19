import { describe, expect, it } from "vitest";

import { readSubmissionId } from "~/features/posts/composer/services/newpost-action/submission-id.server";

describe("readSubmissionId", () => {
  it("keeps a uuid and drops an empty or oversized value", () => {
    const present = new FormData();
    present.set("submissionId", "  6f1c1c5e-4b2a-4e7a-9c1d-2a6e5b0d9f11  ");
    expect(readSubmissionId(present)).toBe(
      "6f1c1c5e-4b2a-4e7a-9c1d-2a6e5b0d9f11"
    );

    const empty = new FormData();
    empty.set("submissionId", "   ");
    expect(readSubmissionId(empty)).toBeUndefined();
    expect(readSubmissionId(new FormData())).toBeUndefined();

    const huge = new FormData();
    huge.set("submissionId", "x".repeat(129));
    expect(readSubmissionId(huge)).toBeUndefined();
  });
});
