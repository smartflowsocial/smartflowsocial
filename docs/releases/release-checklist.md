# Release checklist

`v1.0.0-beta.1` is already a published GitHub prerelease. The tag is
`9b1e08cf9a8cf381b640d26c26277e2b0c5ad169`. Do not move the tag. Do not create a second release to
correct the description. Replace the description of the existing release with
[v1.0.0-beta.1.github-release.md](./v1.0.0-beta.1.github-release.md).

A green CI run on `main`, or on any commit other than the candidate, is not evidence for that
candidate. Leave a box unchecked until that command has been run on the commit you intend to tag. Do
not mark a live website, a production deploy, or a legal review as done from a source change.

## Published v1.0.0-beta.1

- [x] Tag `v1.0.0-beta.1` points at `9b1e08cf9a8cf381b640d26c26277e2b0c5ad169`
- [x] GitHub Release `v1.0.0-beta.1` is a prerelease, published 2026-11-18T07:02:25Z
- [x] Required checks on that commit later completed successfully. `Tests & Coverage` finished at
      07:04:30Z, after publication. That order is not acceptable for the next release
- [ ] The GitHub Release description is replaced with the corrected notes. The tagged commit still
      contains the pre-publication wording
- [ ] Production and staging SHAs are read from the running services and recorded with
      `productionShaStatus: verified-from-running-service`. They are unknown today
- [ ] Companion release SHAs are recorded only for commits that were actually validated with this
      application tag. They are unknown today

## Next release

Run the Release validation workflow on the candidate commit after
`.github/workflows/release-validation.yml` is on the default branch. The workflow checks out that
SHA and requires the checks below to be `success` on that SHA. Pending, failed, and skipped required
checks fail the run. It does not publish a release and it does not deploy.

Type `approve-release` only when you mean to record owner approval. Configure the `release-approval`
GitHub environment with required reviewers so the typed phrase is not the only gate.

Required on the application SHA:

- Lint, Format & Type Check
- Tests & Coverage
- Internal Nostr paths
- Clean install migrations
- Build & Bundle Budget
- Docker image boots
- E2E Smoke
- Gitleaks
- Production CSP smoke, executed by the release workflow against that SHA
- Clean-room self-host, executed by the release workflow against that SHA

`publisher_mode=internal` does not take a publisher SHA. Required on the publisher SHA only when
`publisher_mode=http`:

- Lint & Type Check
- Unit Tests
- Integration Tests
- Property-Based Tests
- Chaos Tests
- Security Tests
- Worker execution
- Test Summary
- Gitleaks

E2E Core stays optional. A skipped optional job does not satisfy a required name.

## Automated

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm exec prisma generate`
- [ ] `pnpm lint:ci`
- [ ] `pnpm format:check`
- [ ] `pnpm typecheck`
- [ ] `node scripts/check-release-version.mjs --tag v<this-version>` matches `package.json`. Do not
      move `v1.0.0-beta.2`.
- [ ] `pnpm test:unit`
- [ ] `pnpm test:security`
- [ ] `pnpm test` (integration, property, and performance included)
- [ ] `pnpm audit --prod` reviewed, including a written note if it is not empty
- [ ] `pnpm exec prisma migrate deploy` on an empty database, then
      `pnpm exec tsx scripts/verify-migrated-database.ts`
- [ ] `pnpm test:relay-publish` against disposable Postgres, Redis, and a loopback relay. This uses
      the in-repo relay publisher, not the Cloudflare Worker
- [ ] Full E2E Core has a successful check on the commit. A skipped core suite is not a pass
- [ ] `pnpm build`
- [ ] Secret scanning in CI
- [ ] The CI `migrate` job is green on the commit to tag

## Financial

- [ ] Hosted and self-hosted commission tests cover Free, Starter, Creator, Pro, Teams, and Founder
- [ ] A zero fee does not create an owner-wallet invoice
- [ ] Invoice amount tests cover one sat over, one sat under, amountless, expired, wrong network,
      and a corrupt invoice
- [ ] A timed-out payout, including a lookup that also hangs, does not call the wallet a second time
- [ ] An invalid preimage does not confirm a payout
- [ ] Two concurrent claims of one winner produce one `paying` row
- [ ] Referral payouts stay off when `REFERRAL_PAYOUTS_ENABLED` is unset
- [ ] A `paying` row cannot be marked unpaid before its stored resolution deadline

## Product

- [ ] In-app `/plans`, fee quotations, and invoices use the same hosted rates: Free 10%, Starter
      7.5%, Creator 5%, Pro/Teams/Founder 0%
- [ ] Landing pricing, terms, privacy, contact, and FAQ match
      [hosted service disclosures](../legal/hosted-service-disclosures.md)
- [ ] Those landing pages are deployed by the operator and then read on the live site
- [ ] The public contact is `npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0`
- [ ] The pages do not claim GDPR or commercial-identity compliance
- [ ] Self-host docs say Node.js 26.13.1 or newer

## Human

- [x] Live `https://smartflow.social/pricing/` on 17 November 2026 says hosted commission is 10% on
      Free, 7.5% on Starter, 5% on Creator, and 0% on Pro and Founder, and self-hosted commission is
      0%. Pull request [#2](https://github.com/smartflowsocial/smartflowsocial-landing/pull/2) had
      published Starter at 0% and is superseded by that page
- [x] `GET https://blossom-api.smartflow.social/ready` on 17 November 2026 at 22:38 UTC returned
      HTTP 200 with storage ready and the probe object missing. Upload, read, delete, and the
      deployed commit were not checked
- [ ] Companion repository handoff in [companion-handoff.md](../security/companion-handoff.md) is
      applied or explicitly deferred
- [ ] Production `REFERRAL_PAYOUTS_ENABLED` is set if payouts should continue
- [ ] No `paying` or `unknown` campaign payout is left for the new build to retry
- [ ] Cloudflare token scopes, GitHub permissions, and backups were checked by a person
- [ ] The operator ran one controlled NWC reconciliation against a wallet they control
- [ ] The tag is created by the owner. This file does not create it

## Still not done by a source change

- Replacing the published GitHub Release description
- Deploying production or staging
- Changing production Cloudflare resources
- Recording a deployment SHA from a running process
- Rotating secrets
- Sending a mainnet Lightning payment
- Moving or recreating `v1.0.0-beta.1`
