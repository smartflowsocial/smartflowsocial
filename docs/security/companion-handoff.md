# Companion repository handoff

Reviewed again on 18 November 2026. The earlier patches now live in
[docs/archive/security/companion-patches](../archive/security/companion-patches/) because they
describe the retired external Workers. The work they described is on each repository's default
branch. Nothing in this review was deployed, and no production SHA was read from a running service.

| Repository   | On the default branch                                                                                                                                                                                                                        | Still not verified                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Publisher    | README does not put `API_TOKEN` in `wrangler.toml`. `pnpm test:worker` runs the Worker in local `wrangler` against a loopback relay. Private relays require `ENVIRONMENT=test` or `development`. A failed publish releases the replay claim. | The suite is not yet a required status check on `main`. The deployed Worker was not called.               |
| Blastr       | Production deploy is `workflow_dispatch` and requires `confirm=deploy-production`. Staging is configured for `blastr-publish-jobs-staging`.                                                                                                  | The staging queue was not created from here. The running worker's configuration was not read.             |
| Cache worker | `readBodyWithLimit` stops at 256 KiB. A full-history Gitleaks workflow is on the default branch.                                                                                                                                             | The deployed worker was not called.                                                                       |
| Blossom      | `/ready` classifies a missing probe object separately from access, timeout, and network errors.                                                                                                                                              | On 17 November 2026 at 22:38 UTC the public `/ready` was HTTP 200. Upload, read, and delete were not run. |
| Landing      | `main` includes the hosted Starter 7.5% copy.                                                                                                                                                                                                | The live pricing page was not re-read in this pass. The landing commit is not tagged with the app.        |

The patch files remain as the record of the earlier diff. They are not a second set of outstanding
changes.

## Publisher

The README on `main` tells the operator to set the token as a secret. It does not put `API_TOKEN` in
`wrangler.toml`. The operator commands are:

```bash
wrangler secret put API_TOKEN
wrangler secret put API_TOKEN --env production
```

`.dev.vars` is added to `.gitignore`. `.env*` does not match that filename. The KV section matches
the current file: binding `PROFILES`, no id, Wrangler 4 provisions it. The "production ready"
feature line is removed. Companion repositories require Node 26.13.1 or newer, the same pin as the
SmartFlowSocial app.

## Blastr

`wrangler.toml` on `main` has KV bindings without ids and D1 names `blastr-db` and
`blastr-db-staging`. The README no longer tells operators to replace `REPLACE_WITH_*` ids.
`API_TOKEN` is `wrangler secret put API_TOKEN`, including `--env staging`. `.dev.vars` is
gitignored. No Cloudflare account change was made. `main` gives staging its own queue name,
`blastr-publish-jobs-staging`. Create that queue before the next staging deploy. Until that deploy,
a worker built from the previous configuration can still consume production jobs. The running
configuration was not read.

## Cache worker

The local `readBodyWithLimit` reads the request stream, stops when the byte count would pass 256
KiB, cancels the reader, and returns 413. A numeric `Content-Length` above the limit is still
rejected before reading. A non-numeric or too-small length is not trusted. The README says this
repository does not configure a Cloudflare dashboard rate limit. The dashboard was not checked.

## Blossom

README, `.gitignore`, and `.env.example` were read. Secrets are empty placeholders. `.env` is
ignored. There is no committed Wrangler token. No code change is included in that pass. Blossom
requires Node 26.13.1, the same pin as the app.

## Landing

Pull request #2 is merged. Hosted Starter stays 7.5%. The live page
`https://smartflow.social/pricing/` said that on 17 November 2026: Free 10%, Starter 7.5%, Creator
5%, and 0% on Pro and Founder, with self-hosted commission at 0%. The disclosure text is in
[hosted service disclosures](../legal/hosted-service-disclosures.md).
