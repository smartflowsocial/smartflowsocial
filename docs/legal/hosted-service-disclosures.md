# Hosted service disclosures

Owner decisions recorded for the 0.1.0-alpha.3 engineering pass and kept for `1.0.0-beta.1`. These
supersede the 16 November 2026 notes that set Starter to 0% and asked for a legal name. The fee
table below was not changed for the prerelease.

The public contact is the SmartFlowSocial Nostr account:

`npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0`

Profile: <https://njump.me/npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0>

`nostr:npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0`

That account is how the project communicates in public. It is not a registered company, a personal
legal name, a postal address, a registration number, or a statement that a data controller has been
identified.

## Campaign commission

Hosted, from `app/features/payments/plan-policy.ts`, in basis points:

| Plan    | Commission |
| ------- | ---------: |
| Free    |        10% |
| Starter |       7.5% |
| Creator |         5% |
| Pro     |         0% |
| Teams   |         0% |
| Founder |         0% |

Self-hosted (`SFS_DEPLOYMENT_MODE=self_hosted`, also the default): every plan is 0%. The process
does not create a platform-fee invoice, does not require `OWNER_NWC` for that fee, and does not
block finalization because billing is unavailable. Winner payouts stay a separate payment from a
wallet the creator or operator connects.

A browser header, cookie, query parameter, or account field cannot select the self-hosted rate.

The fee is `floor(planned prize pool × basis points / 10000)` in whole sats. A positive pool and a
positive rate that round to zero cost 1 sat. A paid invoice is not rewritten when the rate later
changes. An open invoice at or below the current quote is reused. A higher open invoice is expired
in the database and is not collected. This software does not send refunds.

## Landing repository

`smartflowsocial/smartflowsocial-landing` was not writable from the application workspace. Pull
request [#2](https://github.com/smartflowsocial/smartflowsocial-landing/pull/2) is the open legal
and pricing change. Revise it before merge. Do not merge a version that sets hosted Starter to 0%.

These sentences were not committed, merged, deployed, or checked on the live site from this change.

### Pricing

On every hosted plan card, state the campaign commission next to the plan:

- Free: 10% campaign commission on Lightning prize pools
- Starter: 7.5% campaign commission
- Creator: 5% campaign commission
- Pro: 0% campaign commission
- Teams: 0% campaign commission
- Founder: 0% campaign commission

Add this paragraph:

> A self-hosted install of the same software charges 0% platform commission on contest and giveaway
> finalization. The hosted rates above apply only to the service operated at smartflow.social.
> Winner payouts are paid from a wallet you connect. SmartFlowSocial does not hold the prize pool.

Replace any line that says the operator is still deciding whether to publish an identity, and any
line that sets Starter to 0%.

Node.js for self-hosting is 26.13.1 or newer, matching `.nvmrc`. Do not advertise Node 20+ or
Node 22.

### Terms

Replace the commission paragraph with:

> On the hosted service, Lightning campaign finalization fees are calculated on the planned prize
> pool, in whole sats, before a payable action. Free is 10%. Starter is 7.5%. Creator is 5%. Pro,
> Teams, and Founder are 0%. A self-hosted deployment of this software charges 0% platform
> commission on the same workflows. Prices for hosted plans are listed on the pricing page. The fee
> is separate from winner payouts. Paying a finalization fee does not place prize funds in the
> custody of SmartFlowSocial.

Replace the operator sentence with:

> SmartFlowSocial communicates publicly under its Nostr identity
> npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0
> (https://njump.me/npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0). That identity
> is not a registered company and it is not a legal name or postal address. Publishing it does not
> by itself meet identity-disclosure duties that can apply to a commercial hosted service, including
> GDPR Article 13 and Article 5 of Directive 2000/31/EC. The hosted service does not claim that
> those duties are satisfied.

### Privacy

Use the draft in [proposed privacy notice](../privacy/proposed-privacy-notice.md). Do not claim the
hosted service is GDPR-compliant because the Nostr contact is published. Do not invent a company,
address, support email, or privacy officer.

### Contact, footer, and FAQ

Use the same npub and the njump link anywhere the site names a contact, a support channel, or the
operator. Remove wording that says the owner is still deciding whether to publish an identity.
Replace it with the sentence that the project communicates publicly under that Nostr identity.

FAQ answer for "Who operates the hosted service?":

> The hosted service is operated under the SmartFlowSocial Nostr identity
> npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0. That is a public contact, not a
> registered company name or a postal address. Questions can be sent to that Nostr account.

## Remaining legal exposure

The owner accepted a pseudonymous public contact and instructed engineering not to invent a legal
identity. A Nostr npub does not by itself identify a data controller under GDPR Article 13 or a
service provider under Directive 2000/31/EC Article 5. Those obligations, where they apply to the
commercial hosted service, remain unmet. This is an owner-accepted compliance risk. It is not marked
verified, and it is not cured by the wording above.
