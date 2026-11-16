# Release checklist

Use this for a public alpha. A green CI run is not the whole gate.

## Automated

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm exec prisma generate`
- [ ] `pnpm typecheck`
- [ ] `pnpm test:unit`
- [ ] `pnpm test:security`
- [ ] `pnpm audit --prod` reviewed, including a written note if it is not empty
- [ ] `pnpm exec prisma migrate deploy` on an empty loopback database
- [ ] `pnpm test:relay-publish` against that database and loopback Redis
- [ ] Secret scanning in CI

## Financial

- [ ] Invoice amount tests cover one sat over, one sat under, amountless, expired, wrong network,
      and a corrupt invoice
- [ ] A timed-out payout test does not call the wallet a second time
- [ ] Two concurrent claims of one winner produce one `paying` row
- [ ] Referral payouts stay off when `REFERRAL_PAYOUTS_ENABLED` is unset

## Human

- [ ] Privacy, terms, and pricing text match
      [hosted service disclosures](../legal/hosted-service-disclosures.md), or the differences are
      an explicit decision
- [ ] Legal identity is either supplied or the page says it is missing
- [ ] Production referral flag is set if payouts should continue
- [ ] No `paying` or `unknown` campaign payout is left for the new build to retry
- [ ] Cloudflare token scopes, GitHub permissions, and backups were checked by a person
- [ ] The tag is created by the owner. This file does not create it
