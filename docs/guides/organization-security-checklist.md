# Organization security checklist

Checked on 15 November 2026 with the GitHub API. No organization setting was changed.

## What is already on

These public repositories have an active ruleset named `Protect main` on `refs/heads/main`:

- `smartflowsocial/smartflowsocial`
- `smartflowsocial/smartflowsocial-publisher`
- `smartflowsocial/smartflowsocial-blastr`
- `smartflowsocial/smartflowsocial-blossom`
- `smartflowsocial/smartflowsocial-cache-worker`
- `nostrmash/nostrmash`
- `nostrmash/nostrmash-web`

Each ruleset blocks deleting `main` and blocks non-fast-forward pushes. Classic branch protection is
not enabled. The ruleset does not require a pull request, a review, or status checks.

`smartflowsocial/smartflowsocial` `develop` is not covered by that ruleset. Classic protection on
`develop` is off.

`smartflowsocial/smartflowsocial-landing` is private. The free plan refused the protection and
ruleset APIs, so its branch rules are not known from this check.

Neither organization requires two-factor authentication (`two_factor_requirement_enabled` is false).
That does not say whether individual accounts have it turned on.

Repository and environment secret lists were empty, including `production` on
`nostrmash/nostrmash-web`. Secret values were not requested.

## Owner actions

- Organization **Settings → Authentication security**: require two-factor authentication for both
  organizations.
- On each `Protect main` ruleset, add the rules the owner wants: pull request required, required
  status checks, and no admin bypass unless a named break-glass path is intended. For
  `smartflowsocial/smartflowsocial`, the existing check names are CI, E2E Tests, and Secret scan. Do
  not require a check the workflow does not run.
- Decide whether `develop` gets the same deletion and force-push rules.
- For the private landing repository, open **Settings → Rules** in the browser. The API cannot read
  it on the free plan.
- The old personal account `xdzczk` is not a required reviewer. Dependabot in the main repository no
  longer assigns it. Blossom `CODEOWNERS` no longer names it.
- Collaborators should be members with the smallest role that still lets them work. Admin is for the
  person who changes settings.
- People keep using a GitHub noreply address. Do not put a personal email back into the history.

## Actions and secrets

- Organization **Settings → Actions → General**: allow actions from GitHub and verified creators, or
  a tighter allow-list the owner has reviewed. The default "all actions" is broader than these
  workflows need.
- Workflow permissions: read repository contents. The main CI workflow already sets `contents: read`
  and `pull-requests: write` for the coverage comment. Do not grant write to all workflows at the
  organization level.
- Secrets live on the environment that uses them. `nostrmash/nostrmash-web` deploys with
  `environment: production`. Put `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` there. On 15
  November 2026 that environment had no secrets, and neither did the repository.
- The production environment should require a reviewer before a deploy job runs, if the owner wants
  a human gate. The workflow does not deploy from a fork.
- Fork pull requests must not receive `CODECOV_TOKEN` or Cloudflare tokens. GitHub already withholds
  secrets from forks. The Codecov step uploads only when the token exists and the pull request is
  from this repository.
- Dependabot is configured in the repositories that have `.github/dependabot.yml`. Confirm
  **Settings → Advanced Security → Dependabot** alerts are on for each public repository. That
  switch was not read from the API.

## What was looked at

- Secret names were listed for all eight organization repositories, including the `production`
  environment on `nostrmash/nostrmash-web`. The lists were empty. Values were not requested.
- Classic branch protection and repository rulesets were read. They were not changed.
- No organization setting was changed.
