# Companion repository handoff

Reviewed again on 17 November 2026 during the `1.0.0-beta.1` pass. The earlier patches in
[companion-patches](./companion-patches/) described work that is now present in the local clones.
Those clones are not the published GitHub history until the owner commits and pushes them. Nothing
in this pass was deployed.

| Repository   | What the local tree now contains                                                                                                                                                                                                                                            | GitHub                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Publisher    | README no longer puts `API_TOKEN` in `wrangler.toml`. `pnpm test:worker` runs the Worker in local `wrangler` against a loopback relay. Private relays require `ENVIRONMENT=test` or `development`. A failed publish releases the replay claim.                              | Not pushed by this pass                                                                  |
| Blastr       | Production deploy is `workflow_dispatch` and requires `confirm=deploy-production`. Staging uses `blastr-publish-jobs-staging`. The older note that said not to add a second queue is superseded: staging and production must not share a queue.                             | Not pushed. The running worker still has the previous configuration                      |
| Cache worker | `readBodyWithLimit` reads the stream and stops at 256 KiB. A Gitleaks workflow was added.                                                                                                                                                                                   | Not pushed by this pass                                                                  |
| Blossom      | `/ready` classifies a missing probe object separately from access, timeout, and network errors. `docs/ops/r2-readiness.md` is the operator check. The live `/ready` response on 17 November 2026 did not include `storageError`, so production is still the previous build. | Not deployed                                                                             |
| Landing      | Source on `fix/hosted-commission-copy` and the live `/pricing/` page both say Starter commission is 7.5%.                                                                                                                                                                   | Live pricing was read on 17 November 2026. The landing commit is not tagged with the app |

The patch files remain as the record of the earlier diff. They are not a second set of outstanding
changes.

## Publisher

The local README tells the operator to set the token as a secret. It does not put `API_TOKEN` in
`wrangler.toml`. The published GitHub README matches that only after this tree is pushed. The
operator commands are:

```bash
wrangler secret put API_TOKEN
wrangler secret put API_TOKEN --env production
```

`.dev.vars` is added to `.gitignore`. `.env*` does not match that filename. The KV section matches
the current file: binding `PROFILES`, no id, Wrangler 4 provisions it. The "production ready"
feature line is removed. This Worker's `package.json` still says Node `>=20`. That is its own
toolchain. The SmartFlowSocial app requires Node 22.22 or newer.

## Blastr

`wrangler.toml` already has KV bindings without ids, D1 names `blastr-db` and `blastr-db-staging`,
and, before this pass, the queue `blastr-publish-jobs` for both production and staging. The README
no longer tells operators to replace `REPLACE_WITH_*` ids. `API_TOKEN` is
`wrangler secret put API_TOKEN`, including `--env staging`. `.dev.vars` is already gitignored. No
Cloudflare account change was made. The `1.0.0-beta.1` working tree gives staging its own queue,
`blastr-publish-jobs-staging`. Create that queue before the next staging deploy. Until that deploy,
a worker built from the previous file can still consume production jobs.

## Cache worker

The local `readBodyWithLimit` reads the request stream, stops when the byte count would pass 256
KiB, cancels the reader, and returns 413. A numeric `Content-Length` above the limit is still
rejected before reading. A non-numeric or too-small length is not trusted. The README says this
repository does not configure a Cloudflare dashboard rate limit. The dashboard was not checked.

## Blossom

README, `.gitignore`, and `.env.example` were read. Secrets are empty placeholders. `.env` is
ignored. There is no committed Wrangler token. No code change is included. Node 20 in that README
matches that repository's own engine and is not the app's Node 22.22 requirement.

## Landing

Pull request #2 is merged. Hosted Starter stays 7.5%. The live page
`https://smartflow.social/pricing/` said that on 17 November 2026: Free 10%, Starter 7.5%, Creator
5%, and 0% on Pro and Founder, with self-hosted commission at 0%. The disclosure text is in
[hosted service disclosures](../legal/hosted-service-disclosures.md).
