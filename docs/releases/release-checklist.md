# Release checklist

Use this for a public alpha. A green CI run is not the whole gate. Leave a box unchecked until that
command has been run on the commit you intend to tag. Do not mark a live website, a production
deploy, or a legal review as done from a source change.

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
- [ ] `pnpm test:relay-publish` against disposable Postgres, Redis, and a loopback relay
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
- [ ] Self-host docs say Node.js 22.22 or newer

## Human

- [ ] A follow-up landing change sets Starter commission to 7.5%. Pull request
      [#2](https://github.com/smartflowsocial/smartflowsocial-landing/pull/2) is already merged and
      is the page that published Starter at 0%
- [ ] Companion repository handoff in [companion-handoff.md](../security/companion-handoff.md) is
      applied or explicitly deferred
- [ ] Production `REFERRAL_PAYOUTS_ENABLED` is set if payouts should continue
- [ ] No `paying` or `unknown` campaign payout is left for the new build to retry
- [ ] Cloudflare token scopes, GitHub permissions, and backups were checked by a person
- [ ] The operator ran one controlled NWC reconciliation against a wallet they control
- [ ] The tag is created by the owner. This file does not create it

## Not part of the engineering pass

- Creating or pushing `v0.1.0-alpha.3`
- Publishing a GitHub Release
- Deploying production
- Changing production Cloudflare resources
- Rotating secrets
- Sending a mainnet Lightning payment
