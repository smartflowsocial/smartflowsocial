# Release checklist

Use this for the `1.0.0-beta.1` prerelease. A green CI run is not the whole gate. Leave a box
unchecked until that command has been run on the commit you intend to tag. Do not mark a live
website, a production deploy, or a legal review as done from a source change.

## Automated

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm exec prisma generate`
- [ ] `pnpm lint:ci`
- [ ] `pnpm format:check`
- [ ] `pnpm typecheck`
- [ ] `pnpm test:unit`
- [ ] `pnpm test:security`
- [ ] `pnpm test` (integration, property, and performance included)
- [ ] `pnpm audit --prod` reviewed, including a written note if it is not empty
- [ ] `pnpm exec prisma migrate deploy` on an empty database, then
      `pnpm exec tsx scripts/verify-migrated-database.ts`
- [ ] `pnpm test:relay-publish` against disposable Postgres, Redis, and a loopback relay. This uses
      the in-repo relay publisher, not the Cloudflare Worker
- [ ] `pnpm test:worker` in `smartflowsocial-publisher` against `wrangler` and a loopback relay
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

## Not part of the engineering pass

- Creating or pushing `v1.0.0-beta.1`
- Publishing a GitHub Release
- Deploying production
- Changing production Cloudflare resources
- Rotating secrets
- Sending a mainnet Lightning payment
