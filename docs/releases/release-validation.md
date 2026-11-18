# Release validation

Use this before publishing a release. It does not create a tag, edit a GitHub Release, or deploy.

1. Push the candidate commit and wait until its CI, E2E, and secret-scan workflows finish. A green
   run on a different commit does not count. A green run is not a deployment.
2. For a release that publishes from this process, leave `publisher_mode` at `internal` and leave
   `publisher_sha` empty. Set `publisher_mode` to `http` and `publisher_sha` to the full publisher
   commit only when that external publisher is part of the release. A blank SHA is not a pass in
   `http` mode.
3. Run **Release validation** with `workflow_dispatch` on the candidate. Set `candidate_sha` to the
   full 40-character application commit and `owner_approval` to `approve-release`.
4. In the GitHub environment `release-approval`, add required reviewers. Until that protection
   exists, anyone who can dispatch workflows can type the phrase. The phrase does not publish the
   release.

The workflow checks out `candidate_sha` and fails unless these application checks are `success` on
that commit:

- Lint, Format & Type Check
- Tests & Coverage
- Internal Nostr paths
- Clean install migrations
- Build & Bundle Budget
- Docker image boots
- E2E Smoke
- Gitleaks

`Internal Nostr paths` runs the loopback relay publication and the Nostr read cache tests. A
pending, failed, skipped, or missing required check fails the run. E2E Core is optional and is not
in that list.

When `publisher_mode` is `http`, the publisher commit must have successful Lint & Type Check, Unit
Tests, Integration Tests, Property-Based Tests, Chaos Tests, Security Tests, Worker execution, Test
Summary, and Gitleaks. `internal` does not read those checks.

The same workflow then builds the candidate and runs the clean-room self-host acceptance test. That
job is not a check that already exists on the commit. CI success does not skip it, and it does not
mean a live deployment is on that commit.

After those checks pass, the workflow builds that same commit and opens it in Cypress. The sign-in
page has to hydrate under the production content security policy. A nonce in the HTML is not the
assertion. `ALLOW_HYDRATION_EXCEPTIONS` is false for that job.

Do not point this workflow at a production database or a production publisher. The browser job uses
the disposable Postgres and Redis started by the workflow.
