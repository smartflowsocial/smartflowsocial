# Release validation

Use this before publishing a release. It does not create a tag, edit a GitHub Release, or deploy.

1. Push the candidate commit and wait until its CI, E2E, and secret-scan workflows finish. A green
   run on a different commit does not count. A green run is not a deployment.
2. Leave `publisher_mode` at `internal` and leave `publisher_sha` empty. Any other mode, or a
   publisher SHA, fails the check. The application publishes from this repository.
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
- E2E Core
- Self-host Compose

`Internal Nostr paths` runs the loopback relay publication and the Nostr read cache tests. A
pending, failed, skipped, or missing required check fails the run. The workflow does not read checks
from the historical publisher repository.

The same workflow then builds the candidate and runs the clean-room self-host acceptance test. That
job is not a check that already exists on the commit. CI success does not skip it, and it does not
mean a live deployment is on that commit.

The Self-host Compose job in this workflow calls the reusable compose workflow with `candidate_sha`.
That job checks out that commit, not the branch selected in the dispatch form. Its health check
requires `sourceCommit` to equal that same SHA. A green compose run on another commit does not
satisfy it.

After those checks pass, the workflow builds that same commit and opens it in Cypress. The sign-in
page has to hydrate under the production content security policy. A nonce in the HTML is not the
assertion. `ALLOW_HYDRATION_EXCEPTIONS` is false for that job.

Do not point this workflow at a production database or a production publisher. The browser job uses
the disposable Postgres and Redis started by the workflow.
