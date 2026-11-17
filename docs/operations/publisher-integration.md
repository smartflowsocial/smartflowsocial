# Publisher integration

`pnpm test:relay-publish` is the automated release check for publishing. It starts a loopback Nostr
relay and the publisher in `scripts/relay-publisher.mjs`. That publisher is part of this repository.
It is not the Cloudflare Worker in `smartflowsocial/smartflowsocial-publisher`.

The script uses an ephemeral key. It refuses a non-loopback database or Redis URL. It does not use a
public relay, a personal key, or a Lightning wallet.

What that run covers:

- The app authenticates to the publisher with `NOSTR_PUBLISHER_API_TOKEN`.
- A signed event is accepted by the disposable relay.
- A publisher that is down, then started again, delivers the waiting job.
- A second job for an already published post does not write a second event.
- An invalid signature is rejected.
- A relay that is not running fails the delivery.

A wrong token is covered separately by `tests/integration/relay-publisher.contract.test.ts`, because
the app reads the token when the process starts.

## What is not covered here

This command does not boot `wrangler dev` and it does not deploy the Worker. A green run is not
evidence that the Cloudflare publisher, its KV namespace, or its production secret is correct.

## Staging check for the Worker

Run this on infrastructure you control, with a throwaway token and a throwaway relay. Do not point
it at production and do not use a personal Nostr key.

1. Create a local secret file that is gitignored (`.dev.vars`), not a committed `wrangler.toml`
   value:

   ```bash
   # in smartflowsocial-publisher
   printf 'API_TOKEN=%s\n' "$(openssl rand -hex 32)" > .dev.vars
   ```

2. Start the Worker against a local or staging account:

   ```bash
   npx wrangler dev --port 8787
   ```

3. Do not treat `pnpm test:relay-publish` as this check. That command starts the publisher bundled
   in this repository. With the Worker listening, probe it directly:

   ```bash
   TOKEN="$(sed -n 's/^API_TOKEN=//p' ../smartflowsocial-publisher/.dev.vars)"
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/health
   curl -s -o /dev/null -w '%{http_code}\n' \
     -H "API-TOKEN: not-the-token" \
     -H 'content-type: application/json' \
     -d '{"event":{}}' \
     http://127.0.0.1:8787/publish
   curl -s -o /dev/null -w '%{http_code}\n' \
     -H "API-TOKEN: $TOKEN" \
     -H 'content-type: application/json' \
     -d '{"event":{}}' \
     http://127.0.0.1:8787/publish
   ```

   Pass: `/health` is 200. The wrong token is 403 with body `INVALID_TOKEN`. The right token is
   not 403. A malformed event can still be 400. That is authentication, not a successful publish.

4. Publish one event signed by an ephemeral key to a disposable local relay through the Worker. The
   relay must acknowledge that event id. This repository's relay test does not do this step.
5. Stop the Worker, queue one more signed event from the app, start the Worker, and confirm that
   event arrives once.
6. Submit the same event again and confirm the relay still has one copy.
7. Stop the disposable relay and confirm the Worker reports the delivery failure instead of marking
   the event published.

Until that staging check is written down with its result, do not describe the Cloudflare publisher
as production-proven by the in-repo relay test.
