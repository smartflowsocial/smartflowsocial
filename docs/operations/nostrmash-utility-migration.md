# NostrMash utility migration and Worker decommission

SmartFlowSocial no longer calls the external publisher or cache Workers. The maintained utilities
are new repositories. They are not GitHub transfers, and they do not inherit the old Git history.

This document does not delete Cloudflare resources and it does not archive the original
repositories.

## Repositories

| Historical repository                          | Maintained successor              | What changed                                                               |
| ---------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| `smartflowsocial/smartflowsocial-publisher`    | `nostrmash/nostr-publish-gateway` | New history. Publish path reimplemented. Private while provenance is open. |
| `smartflowsocial/smartflowsocial-cache-worker` | `nostrmash/nostr-read-gateway`    | New history. Configurable upstreams. NostrMash is optional.                |

The names `nostrmash/http-nostr-publisher` and `nostrmash/primal-gateway` were an earlier proposal.
They were not created. Do not transfer the SmartFlowSocial repositories onto those names.

Neither utility is a dependency of this application or of NostrMash Core.

## What was not done

- The original repositories were not deleted, archived, or transferred.
- Their Git history was not rewritten.
- No Cloudflare script, route, secret, KV namespace, or DNS record was deleted.
- No release was published for the new utilities.

## Provenance

The in-app publisher was written in this repository and does not import
[getAlby/http-nostr-publisher](https://github.com/getAlby/http-nostr-publisher).

The standalone publisher Worker is a separate tree. A public GitHub repository is not a license
grant. The Alby repository has no `LICENSE` file. GitHub reports its license as null.

A file comparison on 19 November 2026 found copied expression in `smartflowsocial-publisher`, not
only a shared idea:

- `src/index.ts` returns the exact Alby 404 body `Sooner and later you will see great changes made.`
- `src/utils.ts` `normalizeToHex` and `bech32Decode` follow Alby's `src/utils.js`, including the
  `npub`/`nsec`/`note` prefix check, `substring(0, 4)`, and bech32 decode limit `2000`.
- `src/transport/http/handlers.ts` keeps the profile cache rule
  `metadata.createdAt + 3 * HOUR * 1000`, the `application/json;charset=UTF-8` header, and
  `ctx.waitUntil` refresh. Alby's `src/getProfile.js` is the same rule.
- `src/security/access.ts` still answers `INVALID_TOKEN` with status 403 for the `API-TOKEN` header.
- `src/core/RelayUrl.ts` comments that it is similar to Alby's `cleanURLs`.

The relay publish engine in that Worker is a later TypeScript implementation. It is not a
line-for-line copy of Alby's `publishEvent.js`, which returns `OK` before any relay acknowledgement.
That difference does not clear the copied profile, routing, and token fragments.

The Worker's Unlicense file does not grant rights in those fragments. Changing variable names is not
a license review. `nostr-publish-gateway` records its own provenance in that repository. This
application does not copy the Worker source.

## Cloudflare

The owner checklist for leaving the old scripts in place, and for what still has to be read from the
Cloudflare account, is [cloudflare-worker-decommission.md](./cloudflare-worker-decommission.md).
