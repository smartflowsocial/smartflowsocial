# Publisher integration

`pnpm test:relay-publish` is the release check for publishing. It starts a loopback Nostr relay and
publishes through the internal publisher in this process. It uses an ephemeral key. It refuses a
non-loopback database or Redis URL. It does not use a public relay, a personal key, or a Lightning
wallet.

What that run covers:

- A signed event is acknowledged by the disposable relay.
- The same event is read back from that relay with a separate WebSocket.
- Redis records the acknowledgement for that relay.
- A relay that is down fails the job, and the same post publishes after the relay is reachable.
- A second job for an already published post does not write a second event.
- An invalid signature is rejected.
- A relay that is not running does not mark the post published.

`pnpm smoke:publish` is the faster check. It forces `NOSTR_PUBLISHER_BACKEND=http` and talks to
`scripts/local-publisher.mjs`, which checks the signature and does not open a relay.

`tests/integration/publisher-parity.test.ts` compares per-relay success and rejection with
`scripts/relay-publisher.mjs` on isolated relays. That script is a test publisher. It is not the
Cloudflare Worker.

## HTTP adapter

`NOSTR_PUBLISHER_BACKEND=http` still posts signed events to `NOSTR_PUBLISHER_URL`. Hosted production
keeps that setting until the cutover in [Internal Nostr publisher](./internal-nostr-publisher.md). A
wrong token is covered by `tests/integration/relay-publisher.contract.test.ts`.

Do not treat a green `pnpm test:relay-publish` as proof that the Cloudflare Worker, its KV
namespace, or its production secret is correct. Those belong to the optional HTTP adapter.
