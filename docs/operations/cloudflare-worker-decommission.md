# Cloudflare Worker decommission review

Reviewed 19 November 2026. Wrangler `whoami` did not return an account. A later read-only Cloudflare
API call did. Nothing was deleted. Secret values were not read.

## Verified on the account

Account `9f65435f3bc2df9dee3cb9aeb02da2f4`. The workers.dev subdomain is `birwix`. These scripts
exist: `smartflowsocial-publisher`, `smartflowsocial-publisher-staging`,
`smartflowsocial-cache-worker`, `smartflowsocial-blastr`, `smartflowsocial-landing`, and
`nostrmash-web`. `smartflowsocial-primal-cache-worker` does not exist.
`nostrmash-nostr-publish-gateway` and `nostrmash-nostr-read-gateway` do not exist.

`smartflowsocial-cache-worker` is served at
`https://smartflowsocial-cache-worker.birwix.workers.dev`. Workers.dev is enabled. It has no secret
bindings. Its plain-text bindings are `NOSTRMASH_HTTP_BASE=https://api.nostrmash.com` and
`NOSTRMASH_WS_URL=wss://api.nostrmash.com/primal/ws/v1`. Workers Builds trigger "Deploy default
branch" runs `pnpm exec wrangler deploy` for `main`. Wrangler warns that `wrangler.toml` says
`smartflowsocial-primal-cache-worker` and then overrides the name to `smartflowsocial-cache-worker`.

Merging the README pull request started that trigger. The build succeeded and uploaded version
`873bfd53-83a4-4fdd-9dec-0fd6b45ee2d3` at 2026-11-19T21:22:06Z from commit `a92fce6`. The parent,
`526270c`, was already production from 2026-11-18T07:31:13Z. The merge changes `README.md` only.
That file is not in the Worker bundle. This was still a production deploy, and it was not intended.
It has not been rolled back. A rollback would deploy again.

`smartflowsocial-publisher` has workers.dev enabled, secret name `API_TOKEN`, and KV binding
`PROFILES` namespace `09f055c2671d4bf3a73a958a6a72cbea`. The trigger list that was read has a
preview trigger for the documentation branch and no default-branch deploy trigger. The documentation
branch ran `npx wrangler preview`. It did not replace the production script.
`smartflowsocial-publisher-staging` has secret name `API_TOKEN`, `ENVIRONMENT=staging`, and KV
binding `PROFILES` namespace `cafb44fe56d540fcbda91433cbff8ba8`.

Custom domains on this account are `smartflow.social`, `www.smartflow.social`,
`smartflowsocial.com`, and `www.smartflowsocial.com` on `smartflowsocial-landing`;
`blastr.smartflow.social` on `smartflowsocial-blastr`; and `nostrmash.com` on `nostrmash-web`. Zone
routes exist only for `blastr.smartflow.social` and `blastr.smartflow.social/event`. No custom
domain or zone route points at the publisher or the cache worker.

The NostrMash Web documentation branch ran `npx wrangler preview`. It did not replace
`nostrmash-web`.

Caller traffic is still unknown. Do not delete either retired script until that is checked.

## Publisher Worker

| Item               | What the repository shows                                                                     | Still needs the owner                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Script name        | `smartflowsocial-publisher` in `wrangler.toml` `name`                                         | Confirm the deployed script name and the account that owns it                              |
| Account            | No `account_id` in `wrangler.toml`                                                            | Read the account in the Cloudflare dashboard                                               |
| Routes and domains | No `routes` or `workers_dev` override in `wrangler.toml`                                      | List routes and custom domains. Nothing in Git names a production hostname for this script |
| GitHub deploy      | No workflow under `.github/` runs `wrangler deploy` or `wrangler publish`                     | Check Cloudflare's GitHub integration in the dashboard. Repository CI is validation only   |
| Secrets            | README tells operators to set `API_TOKEN` with `wrangler secret put`. The token is not in Git | List Worker secrets. Do not print values. Do not revoke them from this review              |
| KV                 | Binding name `PROFILES`. No namespace id is committed                                         | Confirm whether a namespace was created on deploy and whether anything else reads it       |
| External callers   | This application no longer calls the Worker                                                   | Search other clients before deleting the script. Repository docs are not that search       |

## Cache Worker

| Item                      | What the repository shows                                                                                                                                             | Still needs the owner                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Script name               | `smartflowsocial-primal-cache-worker` in `wrangler.toml` `name`. The GitHub repository is `smartflowsocial-cache-worker`                                              | Confirm the deployed script name and account                                                                                                                                          |
| Account                   | No `account_id` in `wrangler.toml`                                                                                                                                    | Read the account in the dashboard                                                                                                                                                     |
| Routes and domains        | No route table in `wrangler.toml`                                                                                                                                     | List routes and custom domains                                                                                                                                                        |
| Upstream the Worker calls | `https://api.nostrmash.com`, `wss://api.nostrmash.com/primal/ws/v1`, `wss://cache.smartflowsocial.com/v1`, `wss://cache1.primal.net/v1`, `wss://cache2.primal.net/v1` | These are outbound targets, not proof that this Worker is attached to those hostnames. `cache.smartflowsocial.com` may be a different service. Do not change its DNS from this review |
| GitHub deploy             | No workflow under `.github/` runs Wrangler deploy                                                                                                                     | Check the Cloudflare GitHub integration                                                                                                                                               |
| Secrets                   | No secret names are required by the checked-in config. `[vars]` holds public base URLs                                                                                | Confirm the deployed Worker has no extra secrets                                                                                                                                      |
| KV and other bindings     | No KV, R2, D1, or queue bindings in `wrangler.toml`                                                                                                                   | Confirm the deployed Worker matches the file                                                                                                                                          |
| External callers          | This application no longer calls the Worker. The Worker answered unauthenticated browser `POST`s with `Access-Control-Allow-Origin: *`                                | A public client outside this organization is possible. Deletion needs a caller check                                                                                                  |

## Leave these alone

- NostrMash Web and its Cloudflare deploy
- The landing site
- Blastr and Blossom
- SmartFlowSocial production and staging on Coolify
- Any DNS name that is not shown to point only at the retired scripts

## Rollback

SmartFlowSocial current source will not boot if the old publisher URL or cache URL is put back.
Rolling the application back to an image from before the in-process publisher would be a separate
release decision. It is not a reason to delete the Workers, and deleting the Workers is not a
rollback plan.

If an external client still uses either script, deleting it removes that client's path. Keep the
scripts until that is checked.

## Not done

- No `wrangler delete`
- No secret revocation
- No KV deletion
- No DNS edit
- No change to landing, Blastr, NostrMash Web, or Coolify
- The cache-worker production script was redeployed by its existing `main` trigger, as recorded
  above. That version was not rolled back
