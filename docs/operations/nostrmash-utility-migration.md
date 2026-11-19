# NostrMash utility migration and Worker decommission

SmartFlowSocial no longer calls these Workers. They can become independent NostrMash utilities. This
document is the owner procedure. It does not transfer repositories or delete Cloudflare resources.

## Proposed destinations

| Current repository                             | Proposed destination             | Role                                                                    |
| ---------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `smartflowsocial/smartflowsocial-publisher`    | `nostrmash/http-nostr-publisher` | TypeScript HTTP-to-Nostr publishing gateway for Cloudflare Workers      |
| `smartflowsocial/smartflowsocial-cache-worker` | `nostrmash/primal-gateway`       | Primal-compatible gateway for NostrMash and configurable read upstreams |

Confirm both names are free in the NostrMash organization before the transfer. Prefer GitHub's
repository transfer so issues, pull requests, and the old URL redirect stay intact. Do not rewrite
git history to change branding.

## Transfer procedure

1. Confirm the NostrMash organization can receive a transfer from the current owner account.
2. In each repository, replace SmartFlowSocial-only production URLs, tokens, and badges with
   configurable endpoints. Keep the Unlicense only where the file's history supports it.
3. Run each repository's CI on the prepared commit.
4. Owner transfers `smartflowsocial/smartflowsocial-publisher` to `nostrmash/http-nostr-publisher`.
5. Owner transfers `smartflowsocial/smartflowsocial-cache-worker` to `nostrmash/primal-gateway`.
6. Update remaining public links after the redirects exist.
7. Do not delete the old organization repositories by hand. A transfer leaves the redirect.

## Provenance

The in-app publisher was written in this repository and does not import
[getAlby/http-nostr-publisher](https://github.com/getAlby/http-nostr-publisher).

The standalone publisher Worker is a separate tree. A public GitHub repository is not a license
grant. The Alby repository has no `LICENSE` file. GitHub reports its license as null.

A file comparison on 19 November 2026 found copied expression, not only a shared idea:

- `src/index.ts` returns the exact Alby 404 body `Sooner and later you will see great changes made.`
- `src/utils.ts` `normalizeToHex` and `bech32Decode` follow Alby's `src/utils.js`, including the
  `npub`/`nsec`/`note` prefix check, `substring(0, 4)`, and bech32 decode limit `2000`.
- `src/transport/http/handlers.ts` keeps the profile cache rule
  `metadata.createdAt + 3 * HOUR * 1000`, the `application/json;charset=UTF-8` header, and
  `ctx.waitUntil` refresh. Alby's `src/getProfile.js` is the same rule.
- `src/security/access.ts` still answers `INVALID_TOKEN` with status 403 for the `API-TOKEN` header.
- `src/core/RelayUrl.ts` comments that it is similar to Alby's `cleanURLs`.

The relay publish engine is a later TypeScript implementation. It is not a line-for-line copy of
Alby's `publishEvent.js`, which returns `OK` before any relay acknowledgement. That difference does
not clear the copied profile, routing, and token fragments.

The Worker's Unlicense file does not grant rights in those fragments. A clean-room rewrite of the
matching portions, or permission from the Alby authors, is advisable before the repository is
published under the NostrMash name. This question is unresolved. Do not treat the transfer as a
clean license change.

## Cloudflare decommission checklist

Do this only after the owner confirms SmartFlowSocial production and staging have run on the
in-process publisher and reader, and after a search shows no other client of the Worker routes.

Publisher Worker:

- [ ] Script name and account
- [ ] Routes, including `/publish` and any batch, profile, health, or SSE routes
- [ ] `API_TOKEN` and other Worker secrets
- [ ] KV namespaces used only by this Worker
- [ ] GitHub Actions or Cloudflare GitHub integration that deploys it
- [ ] Custom domain DNS records that point only at this Worker

Cache Worker:

- [ ] Script name and account
- [ ] HTTP routes that SmartFlowSocial used to call
- [ ] Worker secrets
- [ ] KV or other bindings used only by this Worker
- [ ] Deploy integration

Leave landing-site, NostrMash Web, and any other Cloudflare services in place. Deleting a script,
route, token, or namespace is an owner action.
