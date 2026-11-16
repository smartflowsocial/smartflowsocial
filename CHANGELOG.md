# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/) and this project adheres to
[Semantic Versioning](https://semver.org/).

---

## [Unreleased]

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
- In-app campaign commission copy matches the invoice: Free 10%, Creator 5%, and 0% on Starter, Pro,
  Teams, and Founder. The public marketing pages still describe Starter as 7.5% and omit the Free
  fee. See [hosted service disclosures](docs/legal/hosted-service-disclosures.md).

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
