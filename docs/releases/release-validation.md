# Release validation

Use this before publishing a release. It does not create a tag, edit a GitHub Release, or deploy.

1. Push the candidate commit and wait until its CI, E2E, and secret-scan workflows finish. A green
   run on a different commit does not count.
2. Choose the publisher commit that will ship with it and wait for that commit's checks as well.
3. Run **Release validation** with `workflow_dispatch` on the candidate. Set `candidate_sha` and
   `publisher_sha` to those full 40-character commits, and set `owner_approval` to
   `approve-release`.
4. In the GitHub environment `release-approval`, add required reviewers. Until that protection
   exists, anyone who can dispatch workflows can type the phrase. The phrase does not publish the
   release.

The workflow checks out `candidate_sha` and fails unless these application checks are `success` on
that commit:

- Lint, Format & Type Check
- Tests & Coverage
- Clean install migrations
- Build & Bundle Budget
- Docker image boots
- E2E Smoke
- Gitleaks

A pending, failed, skipped, or missing required check fails the run. E2E Core is optional and is not
in that list.

The publisher commit must have successful Lint & Type Check, Unit Tests, Integration Tests,
Property-Based Tests, Chaos Tests, Security Tests, Worker execution, Test Summary, and Gitleaks.

After those checks pass, the workflow builds that same commit and opens it in Cypress. The sign-in
page has to hydrate under the production content security policy. A nonce in the HTML is not the
assertion. `ALLOW_HYDRATION_EXCEPTIONS` is false for that job.

Do not point this workflow at a production database or a production publisher. The browser job uses
the disposable Postgres and Redis started by the workflow.
