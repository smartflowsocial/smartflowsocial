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

3. Point this app at it and run the smoke, still with an ephemeral key and a loopback relay:

   ```bash
   NOSTR_PUBLISHER_URL=http://127.0.0.1:8787 \
   NOSTR_PUBLISHER_API_TOKEN="$(sed -n 's/^API_TOKEN=//p' ../smartflowsocial-publisher/.dev.vars)" \
   pnpm test:relay-publish
   ```

   `pnpm test:relay-publish` starts its own publisher process. To exercise the Worker instead, set
   the same URL and token in `.env` and run `pnpm smoke:publish` only after you have confirmed the
   Worker is the process listening on that port. Record which binary answered.

4. Send one request with the wrong bearer token and confirm the Worker returns 401.
5. Stop the Worker mid-job, start it again, and confirm the waiting job is delivered once.
6. Submit the same published event again and confirm the relay still has one copy.

Until that staging check is written down with its result, do not describe the Cloudflare publisher
as production-proven by the in-repo relay test.
