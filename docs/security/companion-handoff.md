# Companion repository handoff

Reviewed again on 17 November 2026. The application token can read these public repositories and
cannot push to them. `git push` returned
`Permission to smartflowsocial/smartflowsocial-cache-worker.git denied to cursor[bot]`. The same
token is what the other companion remotes use. Nothing in those repositories was updated on GitHub.

Apply the patches in [companion-patches](./companion-patches/) from each repository's `main`, then
open the pull request there. The patches were tested or reviewed as noted below. They are not merged
and not deployed.

| Repository                                     | Patch                                                                              | Local check                                                                                        | GitHub status                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `smartflowsocial/smartflowsocial-publisher`    | [publisher-readme.patch](./companion-patches/publisher-readme.patch)               | Diff reviewed. No Worker tests were run in that clone.                                             | Not pushed                                |
| `smartflowsocial/smartflowsocial-blastr`       | [blastr-readme.patch](./companion-patches/blastr-readme.patch)                     | Diff reviewed against current `wrangler.toml`. No deploy.                                          | Not pushed                                |
| `smartflowsocial/smartflowsocial-cache-worker` | [cache-worker-body-limit.patch](./companion-patches/cache-worker-body-limit.patch) | `pnpm exec vitest run test/index.spec.ts`: 31 passed, including chunked and lying `Content-Length` | Not pushed. Push denied for `cursor[bot]` |
| `smartflowsocial/smartflowsocial-blossom`      | None                                                                               | `.env` is gitignored. `.env.example` has empty secret values. No new critical issue in this pass.  | Unchanged                                 |
| `smartflowsocial/smartflowsocial-landing`      | None in this workspace                                                             | Private repository was not readable. Revise pull request #2. See the legal disclosures.            | Not updated                               |

## Publisher

The live README still puts `API_TOKEN` in a committed `wrangler.toml` example. The patch removes
that example and tells the operator:

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
and the queue `blastr-publish-jobs` for both production and staging. The README still told operators
to replace `REPLACE_WITH_*` ids. The patch deletes that instruction. `API_TOKEN` is
`wrangler secret put API_TOKEN`, including `--env staging`. `.dev.vars` is already gitignored. No
Cloudflare account change was made. Staging uses the same queue name as production in the checked-in
file. Do not invent a second queue unless an operator chooses to.

## Cache worker

`readBodyWithLimit` used `request.arrayBuffer()` whenever `Content-Length` was missing or not above
256 KiB. The patch reads the stream, stops when the byte count would pass 256 KiB, cancels the
reader, and returns 413. A numeric `Content-Length` above the limit is still rejected before
reading. A non-numeric or too-small length is not trusted. The README says this repository does not
configure a Cloudflare dashboard rate limit. The dashboard was not checked.

## Blossom

README, `.gitignore`, and `.env.example` were read. Secrets are empty placeholders. `.env` is
ignored. There is no committed Wrangler token. No code change is included. Node 20 in that README
matches that repository's own engine and is not the app's Node 22.22 requirement.

## Landing

`https://github.com/smartflowsocial/smartflowsocial-landing/pull/2` is the open change to revise.
Hosted Starter stays 7.5%. Replacement text is in
[hosted service disclosures](../legal/hosted-service-disclosures.md). The live site was not edited
and was not re-checked in this pass.
