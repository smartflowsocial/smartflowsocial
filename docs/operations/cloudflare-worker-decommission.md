# Cloudflare Worker decommission review

Reviewed 19 November 2026 from the Git repositories only. No Cloudflare API call completed. No
script, route, secret, KV namespace, DNS record, or other Cloudflare resource was changed.

Wrangler in the publisher checkout did not return an account identity. Do not treat the script names
below as proof of what is deployed.

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
- No change to unrelated Cloudflare services
