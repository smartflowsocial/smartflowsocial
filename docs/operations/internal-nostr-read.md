# Internal Nostr read cache

Profile, thread, notification, and social-graph reads run in this Node.js process. Redis is the
cache. NostrMash and Primal-compatible sockets are upstream data sources. A clean self-hosted
install does not need Cloudflare Workers, Wrangler, Cloudflare KV, or `cache.smartflowsocial.com`.

The Cloudflare cache worker remains available for rollback. This change does not delete it, archive
its repository, or change production traffic.

```text
caller
  |
  v
fetchFromCache
  |
  v
Redis (key version v2 on the internal reader)
  | miss
  v
NostrMash HTTP          user_profile, user_infos, events, zap-free thread_view
  | miss, invalid, or unmapped
  v
NostrMash WebSocket     wss://api.nostrmash.com/primal/ws/v1
  | miss, invalid, timeout, or empty when another source may have the page
  v
Primal-compatible sockets
  |
  v
validate, then Redis
```

`NOSTR_READ_BACKEND=legacy_http` keeps the previous path: this process tries NostrMash HTTP, then
POSTs to `PRIMAL_CACHING_URL` with `X-Cache-Skip-Native: 1`. `legacy_ws` is not a value you set. It
is the hosted default when the flag is unset and `PRIMAL_CACHING_URL` is empty or a `wss://` list.
That path tries NostrMash HTTP and then the direct sockets. It does not open the NostrMash
compatibility socket.

## What the app reads

The cache worker allowlist has 89 Primal request names. This app calls the ones below. The internal
reader does not send the rest. `network_stats`, `net_stats`, and `feed` stay accepted because the
old socket client accepted them. Nothing in this repository calls them today.

| Request                               | Callers                                     | First source                                     | If that source cannot answer                                                             | Redis TTL | Negative TTL |
| ------------------------------------- | ------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- | --------- | ------------ |
| `user_profile`                        | login, engagement, giveaways, quote reposts | NostrMash HTTP summary                           | NostrMash socket, then Primal                                                            | 300s      | 30s          |
| `user_infos`                          | search, contests, broadcasts                | NostrMash HTTP profile batch                     | NostrMash socket, then Primal                                                            | 300s      | 30s          |
| `events`                              | search                                      | NostrMash HTTP event batch                       | NostrMash socket, then Primal                                                            | 30s       | 5s           |
| `thread_view`                         | threads, search, giveaways, post stats      | NostrMash HTTP when the note has no zap receipts | Sockets. Zapped threads skip native HTTP because kind 9735 receipts are not in that JSON | 30s       | 5s           |
| `event_actions`                       | giveaway likes and reposts                  | NostrMash socket                                 | Primal. A page of profile events is rejected                                             | 30s       | 5s           |
| `likes`, `reposts`, `replies`, `zaps` | aliases of `event_actions`                  | same as `event_actions`                          | same                                                                                     | 30s       | 5s           |
| `get_notifications`                   | mentions and quote reposts                  | NostrMash socket                                 | Primal. A finished empty page is a real empty inbox                                      | 15s       | 5s           |
| `contact_list`                        | social graph                                | NostrMash socket                                 | Primal. Empty is a real empty follow list                                                | 60s       | 10s          |
| `user_followers`                      | social graph                                | NostrMash socket                                 | Primal. Empty is a real empty follower list                                              | 60s       | 10s          |
| `mutual_follows`                      | social graph                                | NostrMash socket                                 | Primal. Empty is valid                                                                   | 60s       | 10s          |
| `parametrized_replaceable_event`      | naddr search                                | NostrMash socket                                 | Primal                                                                                   | 30s       | 5s           |
| `mutelist`                            | mute list                                   | NostrMash socket                                 | Primal. Empty is valid                                                                   | 60s       | 10s          |

Paid post analytics still call NostrMash through `app/features/nostrmash/api.server.ts`. That path
is not part of this reader.

NostrMash statistics frames are unsigned. They set `synthetic: true`, an empty `id`, and an empty
`sig`. Callers that need a signed Nostr event must ignore those frames. `isSyntheticCacheEvent`
recognizes them.

## Configuration

| Install                                                     | Reader                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `PRIMAL_CACHING_URL` is `http://` or `https://`, flag unset | `legacy_http`                                                    |
| `SELF_HOSTED` enabled, no HTTP proxy, flag unset            | `internal`                                                       |
| Hosted, flag unset, URL empty or `wss://`                   | `legacy_ws`                                                      |
| `NOSTR_READ_BACKEND` set                                    | `internal` or `legacy_http` only. Anything else refuses to boot. |

`NOSTR_READ_BACKEND=internal` together with an HTTP `PRIMAL_CACHING_URL` refuses to boot. An HTTP
URL is the legacy proxy. A WebSocket URL is an upstream cache, not a backend selector.

| Variable                  | Default                                          | Role                                                                                   |
| ------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `NOSTR_READ_BACKEND`      | see the table                                    | `internal` or `legacy_http`                                                            |
| `NOSTRMASH_BASE_URL`      | `https://api.nostrmash.com`                      | NostrMash HTTP. The token stays on the server.                                         |
| `NOSTRMASH_API_TOKEN`     | unset                                            | Bearer token only when that deployment requires one.                                   |
| `NOSTRMASH_WS_URL`        | `wss://api.nostrmash.com/primal/ws/v1`           | Compatibility socket. `/primal/ws` is rejected.                                        |
| `PRIMAL_CACHING_URL`      | public `wss://cache1.primal.net/v1` and `cache2` | Custom Primal sockets, comma-separated. Not required.                                  |
| `NOSTR_READ_TIMEOUT_MS`   | `15000`                                          | Budget for one internal read. Each socket uses at most 3s to connect and 5s to answer. |
| `PRIMAL_HTTP_TIMEOUT_MS`  | `8000`                                           | Legacy HTTP proxy only.                                                                |
| `PRIMAL_HTTP_MAX_RETRIES` | `0`                                              | Legacy HTTP proxy only.                                                                |

Socket URLs must be `ws://` or `wss://`, with a host and no username or password. The process
accepts at most eight. These values come from the operator's environment, not from a request. A
self-hosted operator can point them at a cache on a private address. Do not accept cache URLs from
users.

The internal reader does not publish an HTTP route. Browsers do not receive NostrMash tokens or the
upstream URL list.

Redis keys are `smartflow:primal:v2:<hash>` for the internal reader and `v1` for the legacy readers.
The hash includes the request type and every parameter, so two users do not share a notification or
follow-list page. A user-scoped request without a pubkey is not stored. Transport failures are not
stored. A finished empty page for a type that can be empty uses the negative TTL. Entries expire by
TTL. Publishing a note does not scan Redis for related pages. The short thread and reaction TTLs are
the freshness mechanism.

One in-flight read is shared by concurrent callers of the same key. A failure is not remembered, so
the next call can try again. Redis errors are logged and the read continues against the upstreams.

## Metrics and logs

`/metrics` includes:

- `nostr_read_cache_total{result,request_type}` with `hit`, `miss`, `negative`, or `bypass`. Hits
  are upstream fetches that did not run.
- `nostr_read_upstream_total{source,result,request_type}`
- `nostr_read_upstream_latency_ms{source,request_type}`

`source` is `nostrmash-native`, `nostrmash-ws`, or `primal`. `result` is `success`, `empty`,
`unavailable`, `connect_timeout`, `response_timeout`, `invalid_response`, `unsupported`,
`rate_limited`, or `partial`.

Logs use the same source names. They include the request type and the socket host. They do not
include the NostrMash token, event content, or the full parameter object.

`/healthcheck` still returns `OK`. `Accept: application/json` adds `nostrReadBackend`. That field is
the selected reader. It does not prove an upstream answered.

## Staging

This repository has no staging deploy workflow, staging host, or staging credentials. Do not invent
a target and do not point this change at production.

Confirm the running process before comparing traffic:

```bash
curl -fsS -H 'accept: application/json' https://staging.smartflow.social/healthcheck
curl -fsS -H 'accept: application/json' https://app.smartflow.social/healthcheck
```

`nostrReadBackend` names the web process. On 18 November 2026 staging and production both reported
`internal`. That does not prove the worker process, and it does not prove an upstream read. Compare
the same accounts on both hosts. An empty page is valid only when the upstream finished. An upstream
failure must not be stored as an empty result.

Rollback is `NOSTR_READ_BACKEND=legacy_http` and the previous HTTP `PRIMAL_CACHING_URL`, then
restart. Do not change the read backend and the publisher in the same step.

Checks before any production change:

```bash
pnpm exec prettier --check \
  app/features/cache app/infra/nostr-read app/lib/nostrwebsocket.server.ts \
  app/lib/env.server.ts app/lib/redis-cache.server.ts \
  app/features/nostrmash/native-frames.server.ts \
  tests/unit/nostr-read-backend.test.ts tests/unit/nostr-read-policy.test.ts \
  tests/unit/nostr-read-socket.test.ts tests/unit/nostr-read-service.test.ts \
  tests/unit/redis-cache-failure.test.ts tests/unit/nostrmash/native-frames.test.ts \
  tests/integration/services/nostr-read-cache.test.ts \
  tests/integration/services/cache-service.test.ts
pnpm exec eslint \
  app/features/cache app/infra/nostr-read app/lib/nostrwebsocket.server.ts \
  app/lib/env.server.ts app/lib/redis-cache.server.ts \
  app/features/nostrmash/native-frames.server.ts \
  app/features/infra/services/healthcheck.server.ts
pnpm exec vitest run \
  tests/unit/nostr-read-backend.test.ts tests/unit/nostr-read-policy.test.ts \
  tests/unit/nostr-read-socket.test.ts tests/unit/nostr-read-service.test.ts \
  tests/unit/redis-cache-failure.test.ts tests/unit/nostrmash/native-frames.test.ts \
  tests/integration/services/nostr-read-cache.test.ts \
  tests/integration/services/cache-service.test.ts \
  tests/unit/healthcheck.server.test.ts
```

On the staging process, watch for one session:

- profile, thread, reaction, repost, zap total, notification, follower, and mute pages
- `nostr_read_cache_total` hits after the first load
- `nostr_read_upstream_total` failures when NostrMash is blocked and Primal still answers
- errors that name the request type when both are blocked, with the request ending inside
  `NOSTR_READ_TIMEOUT_MS`
- Redis memory and `nostr_read_upstream_latency_ms` p95
- no growth in open sockets after the page is idle

A useful failure drill blocks `NOSTRMASH_BASE_URL` and `NOSTRMASH_WS_URL` and confirms profile and
thread pages still load from Primal. Blocking the Primal sockets as well should fail the read
instead of hanging. Analytics sweeps are a separate NostrMash client. Compare a paid analytics page
before and after, and do not treat a read-cache failure as an analytics failure.

There is no side-by-side latency table from a live staging host in this change. The automated tests
use local sockets and fixtures.

## Production cutover

Do this only after the project owner accepts a staging result.

1. Deploy the build while production is still on its current `PRIMAL_CACHING_URL`. Leave
   `NOSTR_READ_BACKEND` unset so an HTTP proxy stays on `legacy_http`.
2. No database migration. Redis `v1` keys belong to the legacy reader. The internal reader writes
   `v2`. TTLs are at most 300 seconds, so old keys expire on their own.
3. Canary one process with `NOSTR_READ_BACKEND=internal` and the HTTP proxy URL removed. A `wss://`
   list is optional. Do not switch every production process in the same step as a publisher cutover.
4. Watch the metrics above for at least one busy hour. Suggested stop conditions: upstream failure
   ratio above 50% for 15 minutes, timeout ratio above 20% for 15 minutes, or profile and thread
   pages missing notes that the legacy reader still returns.
5. After that window, set the remaining production processes to `internal` and remove the HTTP proxy
   URL. Keep the proxy deployed and its secret available.
6. Confirm `/healthcheck` JSON says `internal`.

### Rollback

Set `NOSTR_READ_BACKEND=legacy_http`, restore the HTTP `PRIMAL_CACHING_URL`, and restart. No
database rollback. `v2` keys are ignored by the legacy reader. `v1` keys that are still inside their
TTL are used again. In-flight sockets close when the process stops.

## Retiring the cache worker

Do this only after the owner accepts the production observation window.

- Remove the hosted requirement for an HTTP `PRIMAL_CACHING_URL`.
- Remove `X-Cache-Skip-Native` from the legacy client once `legacy_http` is no longer deployed.
- Update the remaining notes that still describe the worker as the cache.
- Search for clients of the worker's public CORS `POST` API outside this repository. This app is the
  only caller found here. The worker repository documents a public HTTP API, so an external client
  is possible. That search is not proof that none exist.
- Archive
  [smartflowsocial-cache-worker](https://github.com/smartflowsocial/smartflowsocial-cache-worker)
  only after that inventory. Do not archive it in the implementation change.
- Do not delete the Cloudflare script, KV, or route until the owner says so.

## What is still external

Removing the worker does not make reads independent of the network. Self-hosting this application
does not mean you are operating an independent Nostr indexer. The default internal reader still asks
NostrMash and the public Primal caches. An operator can replace either with their own base URL and
socket list. Direct relay reads remain a separate path, used for mention fallback and for
publishing. They are not a full replacement for indexed profiles, threads, and notifications.
