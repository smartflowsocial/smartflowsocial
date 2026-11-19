# Internal Nostr publisher

SmartFlowSocial publishes already signed Nostr events from this Node.js process. Hosted and
self-hosted installs use the same publisher. The process does not need a private key, Cloudflare
Workers, Cloudflare KV, or Wrangler.

```text
API publish, scheduled jobs, outbox deletes
        |
        v
InternalNostrPublisher
  signature and id check
  relay URL and SSRF check
  per-relay WebSocket EVENT/OK
  Redis acknowledgement, one relay at a time
        |
        v
Nostr relays
```

There is no second publisher. A process that still has `NOSTR_PUBLISHER_BACKEND`,
`NOSTR_PUBLISHER_URL`, `NOSTR_PUBLISHER_API_TOKEN`, or `NOSTR_PUBLISHER_ALLOW_UNAUTHENTICATED` set
refuses to boot.

## Configuration

Production still requires `CRON_SECRET`.

`NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS=true` is the only switch that allows loopback, private, and
carrier-grade NAT relay addresses, including `ws://` on those hosts. Hosted production leaves it
unset. Link-local addresses, including `169.254.169.254`, metadata hostnames, multicast, and
credentials in the URL stay blocked. DNS answers are checked on the socket lookup, so a public name
that resolves to a private address is refused.

Public relays use `wss://`. The publisher caps a call at 32 relays and an event at 256 KiB. The
default timeouts are 5 seconds to connect, 8 seconds for the acknowledgement, and 15 seconds for the
whole call. One transient failure is retried. A negative `OK` is not retried. At most 8 relays are
contacted at once, and the process keeps at most 24 publish sockets in flight.

A positive `OK` is stored at `nostr-publish:v1:{eventId}:{canonicalRelay}` for 7 days. A success on
relay A does not block relay B. Redis errors fail open: the event can be sent again. An
unacknowledged attempt is not stored and is not treated as success.

Callers persist each relay row before they treat a total failure as an error. Scheduled posts,
long-form posts, `/api/publish`, and delete jobs throw after that write when every relay failed, so
a total failure is not marked published.

Logs include the backend, correlation id, event id, relay hostname, result, latency, failure
category, and retry count. They do not include event content or secrets. Metrics:

- `nostr_publisher_relay_total{backend,result,failure_category}`
- `nostr_publisher_relay_latency_ms`
- `nostr_publisher_open_sockets`

The worker closes open relay sockets on `SIGTERM` and `SIGINT`.

`/healthcheck` still returns `OK` when Postgres answers. `Accept: application/json` adds
`publisherBackend: "internal"`. That field names this publisher. It does not prove a relay accepted
an event.

## Staging

CI builds the production image and health-checks it with `SFS_DEPLOYMENT_MODE=self_hosted`. That
proves the image boots. It does not prove a relay accepted an event.

Read the running web process before changing it:

```bash
curl -fsS -H 'accept: application/json' https://app.smartflow.social/healthcheck
curl -fsS -H 'accept: application/json' https://staging.smartflow.social/healthcheck
```

On 18 November 2026 the production web process reported commit
`1dcf61c729635a5e7375a2d588462fba7a2e0ea4` with `publisherBackend` and `nostrReadBackend` both
`internal`. Staging reported `0a6c87aa86f107968fa18ebf0b7c9316bca9c3cc` with the same backends.
Those two commits have the same tree. The JSON names the web process. Confirm the worker in the host
before treating the cutover as complete, and do not retire the legacy publisher until that worker
has been observed.

This build has no HTTP publisher rollback. A non-empty `NOSTR_PUBLISHER_BACKEND` or
`NOSTR_PUBLISHER_URL` refuses to boot. Use a disposable key for a publish test.

Checks before any production change:

```bash
pnpm exec prettier --check app/infra/publishers tests/unit/internal-nostr-publisher.test.ts tests/unit/relay-target.test.ts tests/unit/publisher-backend.test.ts tests/unit/publisher-ledger.test.ts tests/integration/publisher-parity.test.ts tests/integration/internal-publisher-app.test.ts
pnpm exec eslint app/infra/publishers app/routes/api.publish.tsx app/features/posts/queue-handlers/post-job.server.ts app/features/posts/queue-handlers/longform-job.server.ts app/infra/outbox/outbox-handlers.server.ts worker.ts
pnpm exec tsc --noEmit --pretty false
pnpm exec vitest run tests/unit/internal-nostr-publisher.test.ts tests/unit/relay-target.test.ts tests/unit/publisher-backend.test.ts tests/unit/publisher-ledger.test.ts tests/unit/production-secrets.test.ts tests/unit/nostr-messenger-dm-relays.test.ts tests/integration/publisher-parity.test.ts tests/integration/internal-publisher-app.test.ts
pnpm test:relay-publish
```

Watch the metrics above plus Redis errors, worker restarts, and publish-ack rows stuck in `PENDING`.
A useful staging window shows successful `OK` rows, partial failures that stay partial, and no
growth in `nostr_publisher_open_sockets` after the queue drains.

## Production cutover

Do not switch production until the project owner accepts the staging result.

Production and staging already publish from this process. No database migration is required. Confirm
`/healthcheck` JSON says `publisherBackend: "internal"`, a disposable event is readable from a
relay, and new ack rows are `ACCEPTED` or a real `FAILED`/`TIMEOUT`.

This application does not call the Cloudflare publisher. Decommissioning that Worker is an owner
action. The procedure is in [NostrMash utility migration](./nostrmash-utility-migration.md).

- Confirm nothing else calls the Worker's `/publish`, `/batch`, `/profile`, `/health`, or SSE
  routes.
- The standalone repository can move to NostrMash as an independent utility. Do not archive it as
  part of this application change.
- The Worker's global event-id replay is not part of this publisher. Success is stored per relay.

## Code provenance

The internal publisher was written for this repository from NIP-01 and the `nostr-tools` version
already used here (`verifyEvent` and `getEventHash`). It uses the `ws` package that is already a
dependency. It does not import or adapt source from
[getAlby/http-nostr-publisher](https://github.com/getAlby/http-nostr-publisher) or from
`smartflowsocial-publisher`.

The Alby repository has no `LICENSE` file. GitHub reports its license as null. Its last push was 16
May 2023. `smartflowsocial-publisher` is distributed under the Unlicense and has its own `LICENSE`
file. No Alby copyright header was found in that Worker's publish path during this review. Absence
of a header does not prove the Worker is free of Alby-derived expression, and the Unlicense badge
does not settle that question. Whether the Worker contains copied Alby implementation is unresolved
and needs a person to review it. This application change does not copy that source, so shipping the
internal publisher does not decide the question.

Refactoring the Worker would not clear that provenance. This change does not do that.
