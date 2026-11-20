# Hosted service

The public contact is the SmartFlowSocial Nostr account:

`npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0`

Profile: <https://njump.me/npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0>

`nostr:npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0`

The privacy notice is
[docs/privacy/proposed-privacy-notice.md](../privacy/proposed-privacy-notice.md). The public page is
the landing repository's Privacy page.

## Campaign commission

Hosted rates, from `app/features/payments/plan-policy.ts`:

| Plan    | Commission |
| ------- | ---------: |
| Free    |        10% |
| Starter |       7.5% |
| Creator |         5% |
| Pro     |         0% |
| Teams   |         0% |
| Founder |         0% |

Self-hosted (`SFS_DEPLOYMENT_MODE=self_hosted`, also the default when the mode is empty): every plan
is 0%. The process does not create a platform-fee invoice, does not require `OWNER_NWC` for that
fee, and does not block finalization because billing is unavailable. Winner payouts stay a separate
payment from a wallet the creator or operator connects.

A browser header, cookie, query parameter, or account field cannot select the self-hosted rate.

The fee is `floor(planned prize pool × basis points / 10000)` in whole sats. A positive pool and a
positive rate that round to zero cost 1 sat. A paid invoice is not rewritten when the rate later
changes. An open invoice at or below the current quote is reused. A higher open invoice is expired
in the database and is not collected. This software does not send refunds.

Hosted plan prices are Starter $4/month, Creator $7/month, and Pro $17/month. Yearly billing on
those three is charged as 10 months. Founder is $899 once, limited to 21 seats. Checkout happens in
the app after sign-in.
