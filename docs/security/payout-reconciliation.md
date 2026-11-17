# Payout reconciliation

Campaign and referral Lightning payouts can reach the wallet and then lose the reply. A timeout is
not proof that the wallet failed. This page is the operator procedure for that case.

The application does not send a second payment for a claim whose outcome is unknown.

## States

| State         | Meaning                                                                                                       | Automatic `pay_invoice`                         |
| ------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Not attempted | No claim row, or a claim that was never submitted                                                             | Allowed when the invoice and budget checks pass |
| `paying`      | Claim committed, payment submitted or about to be submitted                                                   | No                                              |
| `paid`        | Wallet returned a preimage, lookup showed a settled payment with a preimage, or an operator confirmed payment | No                                              |
| `failed`      | The wallet rejected the payment, or an operator confirmed it was not paid                                     | A later run may pay a new invoice               |
| `unknown`     | The reply was lost and lookup could not prove the result                                                      | No                                              |

`paying` and `unknown` amounts stay inside the campaign budget. Another worker cannot spend them.

## What the application can check

`@getalby/sdk` exposes NIP-47 `lookup_invoice`. After a timeout the payer asks the same wallet
whether that payment hash settled.

- Lookup is used when `getInfo` lists `lookup_invoice`, or when the wallet does not return a method
  list.
- A settled lookup counts only when the millisatoshi amount converts to the exact authorized sats
  and the preimage is 32 bytes whose SHA-256 is the invoice payment hash. A long unrelated string
  does not confirm the payment. A returned payment hash that does not match the invoice is ignored.
- `pay_invoice` is bounded by `NWC_PAY_TIMEOUT_MS` (default 45 seconds). The lookup that follows,
  including `get_info`, is bounded by `NWC_RECONCILE_TIMEOUT_MS` (default 15 seconds). If both stay
  unresolved, the result is `unknown` and the worker continues.
- `state: failed` with no preimage and no settle time is a definitive failure for that attempt.
- A missing method, a lookup error, a pending payment, or a settled payment without a preimage stays
  unknown. The application does not guess.

Not every wallet implements `lookup_invoice`. When it does not, the payout stays unknown. There is
no other automatic reconciliation.

## Campaign payouts

Find claims that must not be paid again:

```sql
SELECT id, status, "amountSats", "winnerPubkey", "paymentHash", "errorCode"
FROM "PayoutItem"
WHERE status IN ('paying', 'unknown');
```

In the creator's wallet, look up `paymentHash`. Do not request a new invoice while the row is
`paying` or `unknown`.

Resolution goes through `resolveUnknownCampaignPayoutItem` in
`app/features/payments/repositories/campaign-payout-claim.server.ts`. It does not call the wallet.
It accepts only `paying` and `unknown`, and it requires a note of at least 8 characters describing
what the wallet showed.

- `confirmed_paid` sets the row to `paid`. No second payment is possible for that winner on this
  run.
- `confirmed_unpaid` sets the row to `failed`, clears `paymentHash`, and stores the old hash as
  `releasedPaymentHash` on the destination snapshot. A later run may then pay a new invoice for the
  same winner. Use this only after the wallet shows that hash was not paid.
- `confirmed_unpaid` is refused for two minutes after the latest attempt started
  (`ACTIVE_PAYOUT_RESOLUTION_HOLD_MS`). That covers the pay timeout, the lookup timeout, and a slow
  worker. `confirmed_paid` is still allowed during the hold, because that decision does not create
  another payment.

Run it from a machine that has the application environment and `DATABASE_URL`:

```bash
pnpm exec tsx scripts/resolve-campaign-payout.ts \
  --item=<payout item id> \
  --decision=confirmed_paid \
  --note="wallet showed this payment hash settled"
```

Use `--decision=confirmed_unpaid` only with a note of what the wallet showed, and only after the
hold. There is no HTTP route for this decision. Do not clear `paymentHash` with a direct SQL update.
That bypasses the lock and can allow a second payment.

## Referral payouts

A referral attempt stores the payment hash on the audit row and holds `payoutClaimHash` on the
earning. A timeout sets the audit status to `unknown` and does not release the claim.

The next payout for that referrer calls `lookup_invoice` for the held hash. It completes the ledger
only when lookup is settled and includes a preimage. A failed lookup does not release the claim.
Deleting `payoutClaimHash` by hand would allow another invoice to be paid. Do not do that unless the
wallet shows the original hash was not paid, and record that check first.

## Restart and concurrency

The claim is committed before `pay_invoice`. A crash after the claim leaves `paying`. The next run
looks the payment up. It can mark the row `paid` when lookup proves it. It does not mark that row
`failed` from a concurrent lookup, because the original request may still be in flight. If lookup is
inconclusive, the row becomes `unknown` and stays there.

Two workers can claim the same winner only once. The database lock and the unique payment hash
reject the second claim before either worker pays.
