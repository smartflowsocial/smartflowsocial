# Self-host smoke test

**Estimated time:** 30–60 minutes the first time, a few minutes after Postgres and Redis are up  
**Last updated:** 2026-11-16

This is the check that a clean checkout can schedule a signed Nostr note and hand it to a publisher.
It does not use the hosted service, a paid account, or a production relay.

## What you are starting

| Piece                                    | Required for the scheduler?     | How it starts                                                          |
| ---------------------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| This app and its worker                  | Yes                             | `pnpm dev` starts both. Do not also run `pnpm worker:local`.           |
| PostgreSQL and Redis                     | Yes                             | `pnpm docker`                                                          |
| Nostr publisher                          | Yes, and it is part of this app | Unset selects it. `pnpm publisher:local` is only a signature stub      |
| S3-compatible storage                    | Only for uploads                | Environment variables in `example.env`                                 |
| Blossom, Blastr, cache worker, NostrMash | No                              | Leave their variables empty. Reads use the in-process reader.          |
| Lightning, NWC, referral payouts         | No                              | Leave `REFERRAL_PAYOUTS_ENABLED=false`. The payout routes stay closed. |

A clean install publishes signed events from this process. It does not need Cloudflare, Wrangler, a
publisher URL, or a publisher token. `pnpm publisher:local` checks signatures and returns success.
It does not connect to relays. `pnpm smoke:publish` forces that HTTP stub. `pnpm test:relay-publish`
uses the internal publisher against a relay on this machine. Set
`NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS=true` only when that relay is on a private network you
operate. `SELF_HOSTED` does not turn that flag on.

Production is different. After `pnpm build`, `pnpm start` runs the web server and one worker
together. `pnpm start:server` and `pnpm start:worker` run them as two separate processes. Do not
point production processes at the same Redis as a development session.

`pnpm test:self-host-acceptance --up` is the check that the built server and worker publish a signed
note. It starts a disposable Postgres and Redis from `docker-compose.clean-room.yml`, refuses the
development database, and does not set a publisher URL or a cache-worker URL.
`docker-compose.self-host.yml` is the optional container stack for web, worker, Postgres, and Redis.
It listens on `127.0.0.1:3080` and still needs `SESSION_SECRET` and `CRON_SECRET`.

```bash
pnpm build
pnpm test:self-host-acceptance --up
```

## Steps

1. Install Node.js 26.13.1 or newer. `.nvmrc` is `26.13.1`. Node 26 does not ship Corepack. Install
   Corepack and activate pnpm 12.21.0 (`package.json` `packageManager`).
2. Clone the repository and install:

```bash
git clone https://github.com/smartflowsocial/smartflowsocial.git
cd smartflowsocial
npm install --global corepack@0.36.0
corepack enable
corepack prepare pnpm@12.21.0 --activate
pnpm install
cp example.env .env
```

3. In `.env`, set at least:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres
REDIS_URL=redis://127.0.0.1:6379
SELF_HOSTED=true
NOSTR_PUBLISHER_BACKEND=internal
SESSION_SECRET=replace-with-32-or-more-random-characters
```

Generate `SESSION_SECRET` with `openssl rand -base64 32`. Leave storage, Blastr, Blossom, and
`OWNER_NWC` empty until you need those features.

4. Start data stores and apply the schema. Do not start a separate publisher.

```bash
pnpm docker
pnpm exec prisma generate
pnpm exec prisma migrate deploy
```

5. Prove the scheduled-publish path. This creates an ephemeral key, inserts one due post, runs the
   same job the worker runs, and deletes that user. The key is not a personal Nostr identity.

```bash
pnpm smoke:publish
```

Expected last line:

```text
self-host publish smoke passed post=<id> state=PUBLISHED publisher=local
```

`pnpm docker` publishes Postgres and Redis on `127.0.0.1` only. Use that address in `DATABASE_URL`
and `REDIS_URL`. The development passwords in `docker-compose.yml` are for a laptop. Do not start
that file on a public server.

5b. Before a release, prove the event reaches a relay. This starts a loopback relay and publishes
through the internal publisher. It does not use a public relay or a personal key.

```bash
pnpm test:relay-publish
```

Expected last line:

```text
relay publish integration passed post=<id> relay=ws://127.0.0.1:<port> events=1
```

The same command also checks a relay that is down, recovery after it accepts again, a second job for
an already published post, a bad signature, and an independent read of the stored event. The script
sets `NOSTR_PUBLISHER_BACKEND=internal` and `NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS=true` for that
loopback relay only.

6. Start the app:

```bash
pnpm dev
```

`pnpm dev` starts the web server and the worker. Step 5 passed without one because the smoke script
calls the publish job directly. Posts you schedule in the browser are published by the worker that
`pnpm dev` started.

7. Check the process, then sign in with a NIP-07 extension or a NIP-46 remote signer at
   `http://localhost:3000`. Create a post and schedule it. The worker sends the event you signed
   straight to your relays. A JSON health response names the active backend:

```bash
curl -fsS -H 'accept: application/json' http://localhost:3000/healthcheck
```

`publisherBackend` is `internal`. `/healthcheck` without that header still returns `OK` when
Postgres is reachable. A 200 does not mean storage, Lightning, or a public relay is configured, and
it does not mean a relay accepted an event. Relay results are the `nostr_publisher_relay_total` and
`nostr_publisher_relay_latency_ms` series on the metrics ports.

## Pinned tag

`node scripts/self-host-clean-room.mjs` checks this checkout's Node and pnpm against `package.json`.
It does not clone a tag. `--migrate` runs only when both URLs are loopback.

The published tag is `v1.0.0-beta.1` at `9b1e08cf9a8cf381b640d26c26277e2b0c5ad169`. Check that
commit out explicitly. `main` is newer and is not that release.

## What this does not prove

- A browser extension signed the smoke event. The smoke signs with `nostr-tools` so the job path can
  run without a person clicking a signer. Browser login is covered by `pnpm test:e2e:smoke` when
  Cypress is installed.
- The note reached a public relay. `pnpm smoke:publish` stops at the local signature stub.
  `pnpm test:relay-publish` reaches a relay on this machine through the internal publisher.
- Uploads, Blossom, Blastr, analytics, or Lightning work. Those stay off until their variables are
  set. Missing payout and cron secrets do not open those routes.
