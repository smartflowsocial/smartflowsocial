# Hosted service disclosures

Checked on 16 November 2026 against the application code and the live pages:

- https://smartflow.social/privacy (updated 15 November 2026)
- https://smartflow.social/terms (updated 14 November 2026)
- https://smartflow.social/pricing

The marketing site lives in `smartflowsocial/smartflowsocial-landing`. Replacement copy is in pull
request https://github.com/smartflowsocial/smartflowsocial-landing/pull/2. That pull request is not
merged, and the live pages were not redeployed by this change.

## Release blocker: legal identity

The privacy page says the operator identity is still undecided. Do not invent it.

Ivan needs to supply, before the hosted service is described as a GDPR-ready controller:

- The legal name of the person or entity that operates app.smartflow.social
- A postal address, if one is required for that operator
- The jurisdiction they will state
- A contact that is not only a Nostr profile
- Which subprocessors the hosted deploy actually uses, and their countries if known
- Retention for drafts, media, billing rows of live accounts, and server logs

Until those are supplied, the privacy page should keep the sentence that the identity is not stated.

## What the fee code charges

Contest and giveaway finalization fees use `campaignFinalizationFeeRateBps` in
`app/features/payments/plan-policy.ts`. The fee is
`floor(planned prize pool sats * basis points / 10000)`. If that floor is 0 and the pool is
positive, the fee is 1 sat. A zero rate charges nothing.

| Plan    | Rate charged |
| ------- | ------------ |
| Free    | 10%          |
| Starter | 0%           |
| Creator | 5%           |
| Pro     | 0%           |
| Teams   | 0%           |
| Founder | 0%           |

The in-app plans page and comparison table use this table.

The live terms page says Starter is 7.5%, Creator is 5%, and Pro is 0%. It does not mention Free.
The live pricing page lists 7.5%, 5%, and 0% on Starter, Creator, and Pro, and says nothing on Free.
Those sentences do not match the invoice.

This change does not start charging Starter 7.5% or Teams 5%. Raising a fee needs an explicit
decision. A self-hosted install still calculates the fee from the account's plan. A Free account
there is still quoted 10% and cannot lock a prize pool until that invoice is paid to `OWNER_NWC`.
Waiving that on `SELF_HOSTED=true` is a separate decision.

## Replacement text for the website

Terms, replace the commission paragraph with:

> Lightning campaign finalization fees are calculated on the planned prize pool, in whole sats,
> rounded down. A positive pool with a positive rate and a rounded result of zero costs 1 sat. Free
> is 10%. Creator is 5%. Starter, Pro, Teams, and Founder are 0%. Prices for the plans are listed on
> the pricing page. The free plan has hard limits. Starter is $4/month, Creator is $7/month, and Pro
> is $17/month. Yearly billing on those three is charged as 10 months. Founder is $899 once, limited
> to 21 seats, and is tied to one account owner.

Pricing, add this line to Free:

> 10% fee on Lightning campaign prize pools

Pricing, change Starter's commission line to:

> 0% campaign commission

Leave Creator at 5% and Pro at 0%.

Privacy, add after the wallet paragraph:

> Contest and giveaway payouts store the winner's public key, the amount, a Lightning address when
> one was used, the invoice, and the payment hash. A payout whose result was not confirmed stays
> blocked until it is reconciled. The public-stats endpoint keeps the caller IP in Redis for about
> 60 seconds to limit request rate. That address is not written to the account database. The account
> export does not include the encrypted wallet connection or Lightning preimages.

## Owner decision still open

1. Publish the replacement text, or approve new rates and then change `campaignCommissionPercent` to
   match.
2. Decide whether `SELF_HOSTED=true` should waive the finalization fee.
3. Supply the legal identity fields above before calling the hosted privacy notice complete.
