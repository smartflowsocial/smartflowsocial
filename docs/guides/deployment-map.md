# Deployment map

Checked on 15 November 2026 from the organization repositories and their workflow files. A green CI
job is not a production deploy. Nothing in this pass called a production host, Cloudflare, Coolify,
or a wallet.

| Production service   | Repository                                     | What the repository automates                                                         | Status                                                                                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| app.smartflow.social | `smartflowsocial/smartflowsocial`              | CI, E2E, secret scan. No deploy workflow.                                             | Requires a controlled deployment test. Confirm the host, likely Coolify, tracks `smartflowsocial/smartflowsocial` and not a retired personal repository.                                                                                                           |
| Publisher worker     | `smartflowsocial/smartflowsocial-publisher`    | CI. No Wrangler deploy workflow in the repository.                                    | Requires a controlled deployment test. Confirm the Cloudflare Worker is built from this repository.                                                                                                                                                                |
| Blastr               | `smartflowsocial/smartflowsocial-blastr`       | `publish.yml` runs `wrangler publish` on `master` only. The default branch is `main`. | Requires owner configuration. The new repository has no `CF_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID`. A push to `main` does not deploy. The workflow now fails before OAuth when those secrets are missing. Do not point it at `main` until the owner wants a deploy. |
| Blossom              | `smartflowsocial/smartflowsocial-blossom`      | Release workflow pushes `ghcr.io/smartflowsocial/smartflowsocial-blossom`.            | Requires a controlled deployment test. Confirm the host pulls that image name.                                                                                                                                                                                     |
| Cache worker         | `smartflowsocial/smartflowsocial-cache-worker` | CI only.                                                                              | Requires a controlled deployment test.                                                                                                                                                                                                                             |
| smartflow.social     | `smartflowsocial/smartflowsocial-landing`      | No GitHub Actions workflow.                                                           | Requires a controlled deployment test. The site source in this checkout uses the organization repository URL, the Unlicense, and the self-host quickstart.                                                                                                         |
| api.nostrmash.com    | `nostrmash/nostrmash`                          | CI and a GHCR release workflow.                                                       | Requires a controlled deployment test.                                                                                                                                                                                                                             |
| nostrmash.com        | `nostrmash/nostrmash-web`                      | CI deploy job on `main`. Run `43747234339` failed in the Cloudflare deploy step.      | Requires owner configuration. Quality, build, and Playwright passed. Production was not updated. See the NostrMash Web README for the secrets and the rerun.                                                                                                       |

## Obsolete references corrected in this pass

- Main Dependabot reviewers no longer name `xdzczk`.
- Blossom `CODEOWNERS` no longer names `xdzczk`.
- Blastr publish workflows pass `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` into Wrangler.
  `CF_API_TOKEN` alone is not a credential Wrangler will use, so an empty token was able to start
  interactive login. The workflows still trigger only as they did before.

## Not claimed

- No live Cloudflare resource was changed.
- No Coolify application or webhook was opened.
- No production URL was treated as proof of the new repository.
- Container image names that use `${{ github.repository }}` follow the new repository. Image names
  hardcoded to a personal account were not found in these workflow files.
