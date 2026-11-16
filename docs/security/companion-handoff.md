# Companion repository handoff

Reviewed on 16 November 2026 through GitHub. These repositories were not edited in this pass.

| Repository                                     | Visibility | What was checked                                                                                                                         |
| ---------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `smartflowsocial/smartflowsocial`              | Public     | This working tree                                                                                                                        |
| `smartflowsocial/smartflowsocial-publisher`    | Public     | README secret example                                                                                                                    |
| `smartflowsocial/smartflowsocial-blastr`       | Public     | README versus `wrangler.toml`                                                                                                            |
| `smartflowsocial/smartflowsocial-blossom`      | Public     | Name and description only                                                                                                                |
| `smartflowsocial/smartflowsocial-cache-worker` | Public     | `src/index.ts` body limit                                                                                                                |
| `smartflowsocial/smartflowsocial-landing`      | Private    | Pricing, terms, and privacy. Pull request [#2](https://github.com/smartflowsocial/smartflowsocial-landing/pull/2) is open and not merged |

## Publisher

`README.md` still tells an operator to put `API_TOKEN` in `wrangler.toml` under
`[env.production.vars]`. That file is committed. Replace that example with:

```bash
wrangler secret put API_TOKEN
```

Leave `wrangler.toml` with bindings only. `.dev.vars` is the local file, and it should stay
gitignored. Do not commit a live token.

## Blastr

`wrangler.toml` no longer contains `REPLACE_WITH_*` resource ids. KV bindings have no id, and the
comment says Wrangler 4 provisions them on deploy. The README still says deploy fails until those
placeholder ids are replaced. Update the README setup section so it matches the current file.
`API_TOKEN` is described as a secret or an env var. Prefer `wrangler secret put API_TOKEN`.

## Cache worker

`readBodyWithLimit` rejects a `Content-Length` above 256 KiB before reading. If the header is
missing, or smaller than the body, `request.arrayBuffer()` still buffers the whole body and only
then returns 413. A chunked request can force that allocation. Read the stream and stop once the
byte count passes 256 KiB. Do not claim a Cloudflare dashboard rate limit unless it is checked in
the account. This pass did not check the dashboard.

## Blossom

Not reviewed beyond the repository name, public visibility, and description. No change is requested
from this pass.
