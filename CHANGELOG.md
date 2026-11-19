# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/) and this project adheres to
[Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Changed

- A fresh install is self-hosted. `SFS_DEPLOYMENT_MODE=self_hosted` or `hosted` is the explicit
  choice. Production, and the managed hosts `app.smartflow.social` and `staging.smartflow.social`,
  refuse to start when the mode is unset. `SELF_HOSTED=true` and `SELF_HOSTED=false` still select
  the same modes and must agree with `SFS_DEPLOYMENT_MODE` when both are set. Self-hosted platform
  commission stays 0%. Hosted rates are unchanged.
- The Nostr publisher defaults to `internal`. `NOSTR_PUBLISHER_BACKEND=http` is the explicit legacy
  adapter. A publisher URL without that setting refuses to boot.
- The Nostr reader defaults to `internal`. `NOSTR_READ_BACKEND=legacy_http` is the explicit legacy
  cache proxy. An HTTP `PRIMAL_CACHING_URL` without that setting refuses to boot.
- Vitest coverage floors are 80% lines, 80% statements, 78% functions, and 75% branches.
- Full Cypress E2E Core runs on pull requests and pushes. Hydration errors fail that run.
- A release tag must match `package.json`. `v1.0.0-beta.2` remains the historical exception.

### Added

- An in-process Nostr publisher. `SELF_HOSTED=true` uses it without Cloudflare, a publisher URL, or
  a publisher token. `NOSTR_PUBLISHER_BACKEND=http` keeps the external HTTP publisher. There is no
  automatic failover. See [Internal Nostr publisher](docs/operations/internal-nostr-publisher.md).
- A retryable publish failure returns the scheduled note or long-form post to `SCHEDULED`, so the
  worker can try again. A negative relay acknowledgement stays `FAILED`.
- `pnpm test:self-host-acceptance` boots the production server and worker and publishes a signed
  note to a loopback relay without a Cloudflare publisher or cache worker.
- Release validation defaults to the internal publisher. `publisher_mode=http` still requires the
  external publisher commit and its checks.

## [1.0.0-beta.1] - 2026-11-18

First coordinated open-source prerelease. SmartFlowSocial was already in open beta before this
repository was public. This is not a first launch, and it is not a stable `1.0.0`. The GitHub
Release and tag `v1.0.0-beta.1` were published on 18 November 2026 at commit
`9b1e08cf9a8cf381b640d26c26277e2b0c5ad169`. Notes:
[docs/releases/v1.0.0-beta.1.md](docs/releases/v1.0.0-beta.1.md). The tagged copy of those notes
still says the tag was unpublished. That wording was corrected on `main` and the tag was not moved.
`v0.1.0-alpha.0` and the withdrawn `v1.0.0` came from an earlier repository and are not supported
releases of this one.

### Security

- Account deletion writes owned object-storage keys into `OwnedObjectDeletion` in the same
  transaction that removes the account. A storage outage or a worker restart can still delete those
  objects. Shared objects, Blossom blobs, and keys outside `clients/<account id>/` are not deleted.
- Blossom `/ready` treats a missing probe object as healthy storage and reports `storageError` for
  access, timeout, and network failures. `NODE_ENV=test` no longer skips the check.
- The publisher keeps loopback `ws://` only when `ENVIRONMENT` is `test` or `development` and
  `ALLOW_PRIVATE_RELAYS=true`. A failed publish releases the replay claim so the same event can be
  tried again. A successful publish still rejects a duplicate for 24 hours.

### Changed

- Package version is `1.0.0-beta.1`. `"private": true` stays, so the package is not published to
  npm.
- Blastr production deploy is a manual workflow. Staging uses `blastr-publish-jobs-staging`.
- Publisher, Blossom, Blastr, and the cache worker gain a full-history Gitleaks workflow.

## [0.1.0-alpha.3] - 2026-11-17

Prepared locally. The tag and GitHub release are not published. Do not tag `0.1.0-alpha.2`. Notes:
[docs/releases/v0.1.0-alpha.3.md](docs/releases/v0.1.0-alpha.3.md).

### Security

- NWC `pay_invoice`, `get_info`, and `lookup_invoice` each stop at a configurable deadline. A
  payment and a lookup that both stay unresolved leave the payout `unknown`. The worker does not
  hang and it does not send another payment.
- A payout is confirmed only when the preimage is 32 bytes and its SHA-256 matches the invoice
  payment hash. A returned lookup payment hash that does not match is not confirmation.
- Wallet errors are a definitive failure only for structured NIP-47 rejections. The words "payment
  failed" stay `unknown`.
- `confirmed_unpaid` waits for a stored deadline. The deadline is the payment timeout, both
  reconciliation lookups, and a 30 second margin. Defaults are 45s, 15s, and 15s, so the hold is 105
  seconds. At the 120 second maximum for both timeouts the hold is 390 seconds. Older rows without a
  stored deadline use that 390 second budget. The operator command is
  `scripts/resolve-campaign-payout.ts`. There is no public resolution route.
- Incoming payment lookups stop at the reconciliation timeout. A returned hash, amount, and preimage
  are checked before the payment is marked paid. A settled invoice with no preimage can still be
  accepted.
- A contest or giveaway commission invoice is stored only when its decoded BOLT11 amount is the
  exact authorized fee in whole sats. One pending invoice is kept per campaign configuration.

### Changed

- Hosted campaign commission is Free 10%, Starter 7.5% (750 basis points), Creator 5%, and 0% on
  Pro, Teams, and Founder. Contest and giveaway invoices use that table.
- `SELF_HOSTED=true` charges 0% on every plan, creates no platform-fee invoice, and does not require
  `OWNER_NWC` to finalize. Winner payouts are unchanged.
- Paid invoices are not rewritten. An open invoice at or below the new quote is reused.
- Contests can create a finalization invoice. The screen shows the sat amount before payment.
- The in-app footer links to the official Nostr contact
  `npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0`.
- CI has a clean-install job that runs `prisma migrate deploy` on an empty database.

### Documentation

- Privacy and terms replacement text names the Nostr contact and does not claim GDPR or e-commerce
  identity compliance. Landing pull request #2 is already merged and still says Starter commission
  is 0%. The live site stays wrong until a follow-up landing change is deployed. See
  [hosted service disclosures](docs/legal/hosted-service-disclosures.md).
- The `Protect main` ruleset requires the `Clean install migrations` status check.

## [0.1.0-alpha.2] - 2026-11-16

Prepared locally. The tag and GitHub release are not published. Notes:
[docs/releases/v0.1.0-alpha.2.md](docs/releases/v0.1.0-alpha.2.md).

### Security

- Campaign Lightning payouts pay a BOLT11 invoice only when the decoded amount is the exact
  authorized whole-sat amount, on Bitcoin mainnet, unexpired, and carrying a payment hash. An LNURL
  callback that returns any other invoice is refused before the wallet is called.
- A campaign payout is claimed in the database before `pay_invoice`. A timeout, crash, or missing
  acknowledgement leaves that claim `paying` or `unknown`. Automatic retries do not send another
  payment. `lookup_invoice` can confirm a payment that already settled. When lookup cannot prove the
  outcome, the payout stays blocked for an operator. See
  [Payout reconciliation](docs/security/payout-reconciliation.md).
- `paying` and `unknown` amounts stay inside the campaign budget, so a second worker cannot spend
  them again.
- Referral payouts no longer turn on because `OWNER_NWC` is set. Set `REFERRAL_PAYOUTS_ENABLED` to
  `true`, `1`, or `yes` to keep them on. A timed-out referral claim is held instead of being
  released for another invoice.

### Changed

- Operators who relied on the previous production compatibility path must set
  `REFERRAL_PAYOUTS_ENABLED=true` before upgrading, or referral payouts stop.
- A fresh `prisma migrate deploy` inserts the legacy plan rows the pricing migration expected.
  `prisma db push` is no longer the documented install path.
- In-app campaign commission copy at this snapshot said Free 10%, Creator 5%, and 0% on Starter,
  Pro, Teams, and Founder. That Starter rate was superseded by 0.1.0-alpha.3 before either tag was
  published. See [hosted service disclosures](docs/legal/hosted-service-disclosures.md).

## [0.1.0-alpha.1] - 2026-11-15

Prepared on `main`. The tag and GitHub release are not published. Notes:
[docs/releases/v0.1.0-alpha.1.md](docs/releases/v0.1.0-alpha.1.md).

### Security

- Development Compose publishes Postgres and Redis on `127.0.0.1` only. The Postgres image is
  `postgres:16` instead of `latest`. `.dockerignore` keeps `.env` and key files out of the build
  context. `pnpm check:compose` fails if a development database or Redis port is published on every
  interface.
- `SELF_HOSTED=true` unlocks software features on an install the operator runs. Managed hosting
  keeps the commercial plans. The mode is a process environment variable. Hosted Blossom and hosted
  Blastr stay on the paid plan.
- Referral payouts stay off unless `REFERRAL_PAYOUTS_ENABLED` is `true`, `1`, or `yes`. A missing
  `OWNER_NWC` never enables them. An existing production process that already has `OWNER_NWC` and
  leaves the flag unset still pays, and logs a warning. Set the flag explicitly on that host. The
  compatibility path stays until then.
- `pnpm test:db:setup` requires `TEST_DATABASE_URL`. It does not fall back to `DATABASE_URL` and it
  does not run `prisma db push --accept-data-loss`. That reset is `pnpm test:db:reset` with
  `CONFIRM_DESTRUCTIVE_TEST_DB_RESET=reset-test-database`, and only for a loopback test database.
- E2E Redis connections no longer use the 200ms unit-test timeout. That timeout dropped the worker
  when Redis answered slowly and stopped the smoke job.

### Fixed

- `pnpm dev` did not run the worker, and the worker bundle it wrote crashed because `sharp` was
  bundled. `pnpm dev` now starts the worker and restarts it when worker files change.
- The built server and worker ignored `.env`. Validation ran before the file was loaded. They now
  load `.env` from the working directory first and do not override variables already set.
- The `Dockerfile` copied a `.npmrc` that is not in the repository, and it installed with npm. There
  is no npm lockfile. The image now installs with pnpm from `pnpm-lock.yaml`.

### Added

- `pnpm test:relay-publish` schedules a signed event through the publish job and checks that a local
  relay stored it. `pnpm smoke:publish` remains the fast signature-only check.
- Settings can export the account as JSON and delete it. Deletion keeps payment amount, status,
  purpose, and payment hash without the public key. Pending and failed referral commissions with no
  in-flight claim are removed. Paid referral rows stay, with the key replaced, until the retention
  purge. It does not remove events from relays. It deletes unshared objects in this install's
  bucket. Blossom blobs stay.
- The worker purges retained financial rows every 24 hours. `POST /cron/purge-retained-records`
  remains the manual path. `GET` still runs and is marked deprecated.
- `pnpm worker:local` runs the worker without the web server. Do not run it next to `pnpm dev`.

## [0.1.0-alpha.0] - 2026-11-14

First alpha. `package.json` is `0.1.0-alpha.0` and `"private": true`. A `v1.0.0` GitHub release was
published earlier on 14 November 2026 and withdrawn the same day. The old `[1.0.0] - 2024-01-01`
heading further down was a placeholder. Neither is a supported version. Release notes:
[docs/releases/v0.1.0-alpha.0.md](docs/releases/v0.1.0-alpha.0.md).

### Security

- Cron routes fail closed when `CRON_SECRET` is missing or wrong.
- Manual referral payout fails closed, checks the BOLT11 amount against the declared amount, and
  refuses amountless, expired, or mismatched invoices before calling the wallet.
- Referral payouts claim earnings under a database lock and will not pay the same invoice twice.
- Production boot requires the cron secret and a publisher token unless public publisher mode is
  explicit. `REFERRAL_MANUAL_PAYOUT_SECRET` is required at boot only when
  `REFERRAL_PAYOUTS_ENABLED=true`. The manual payout route stays 401 without that secret, and wallet
  payouts do not run when the flag is `false`.

### Added

- Local signature-checking publisher (`pnpm publisher:local`) and `pnpm smoke:publish` for a
  scheduled signed event against Postgres, without a public relay.
- Weekly full Cypress core run, and a CI summary that labels k6 fixture runs separately from
  application health and staging capacity tests.
- Blossom upload integration: token-based uploads, commit-batch, quota/usage tracking.
- Web Push notifications: subscribe/unsubscribe, VAPID config, publish success/failure and
  runway-low alerts.
- Media intents and commit API: declare files before upload, commit after upload (S3/Blossom).
- Engagement feed APIs: mark-state, reply-templates; engagement feed UI improvements.
- "Also repost/quote this" in composer and calendar: schedule a repost or quote alongside a main
  post.
- Thread view: load and display Nostr thread (root + replies) from engagement feed.
- Preferred Nostr client for external links: choose which client opens "View on Nostr" (PRIMAL,
  DAMUS, AMETHYST, etc., or CUSTOM URL).
- Random schedule window: post at a random time within ±N minutes of the chosen slot (queue or
  composer).
- Complex giveaways: presets, per-engagement-type winner pools and sats, selection mode, filters.
- Referral system and cron: referral payouts, cron jobs for subscription checks and runway-low
  notifications.
- NIP-46 (remote signer) support and auth signer architecture improvements.
- Additional API endpoints: global-search, zap-profile, profile-display-name, post-stats,
  publish-result, posts/:id, push-subscribe/unsubscribe, primary-signer-profile.

### Changed

- API reference, database schema, and configuration docs updated to match current codebase.
- Documentation: fixed broken links, added user guides for new features, corrected payment-status
  and posts/batch docs.

### Fixed

- (Add fixes as they land.)

---

## Draft notes previously labeled 1.0.0

These items were listed under a 1 January 2024 release heading. That release was not tagged.

### Added

- User registration and authentication with Nostr (NIP-07).
- Scheduled posting with calendar view and queue types (interval and fixed slots).
- Bulk image upload and bulk scheduling.
- Hashtag presets and automated hashtag handling.
- Giveaway management: track engagement, select random winners, blacklist.
- Dashboard with posts, drafts, calendar, queues, giveaways, settings.
- Long-form articles (NIP-23) with rich text editor.
- Templates and recyclable posts.
- Multi-account (parent/child) support.
- Lightning payments (NWC) and subscription plans.
- REST API for posts, uploads, queue scheduling, user operations.

### Changed

- None.

### Fixed

- None.

---

When releasing: add a new `## [x.y.z] - YYYY-MM-DD` section, move Unreleased items into it, and
clear Unreleased. In PRs, add user-facing or notable changes under Unreleased.

### Format Guide

Each section in this changelog uses the following categories:

- **Added**: For new features.
- **Changed**: For changes in existing functionality.
- **Fixed**: For any bug fixes.
- **Removed**: For any features removed in that version.

---

This changelog should be updated with each release, summarizing what’s new, improved, or fixed to
keep track of all project changes in a clear and organized manner.
