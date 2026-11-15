# Data inventory

This is an engineering inventory of what the application stores and where it goes. It is not a
privacy notice and it does not name a legal controller. The owner has to approve any text that is
published to users.

Reviewed against the Prisma schema and the payment, draft, media, and wallet code on 14
November 2026.

## What is not stored

Nostr signing keys. Sign-in and publishing use a NIP-07 browser extension or a NIP-46 remote signer.
The server checks signatures. It does not ask the user to paste an `nsec`, and the account row does
not contain one.

`NOSTR_NSEC` in the server environment is a separate operator key used for server-sent messages such
as feedback. It is not the user's signing key. Operators should treat it as a secret and should not
use a personal identity key.

## Account and content

| Data                                     | Where it lives                                           | Why it is there                                        |
| ---------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| Public key (`User.npub`, stored as hex)  | Postgres                                                 | Account identity                                       |
| Session cookie                           | Browser, signed with `SESSION_SECRET`                    | Stay signed in                                         |
| Profile fields the user saves            | Postgres                                                 | Display name and related settings                      |
| Draft post content and version snapshots | Postgres                                                 | Editing and restore                                    |
| Scheduled posts, queues, calendars       | Postgres                                                 | Publish later                                          |
| Signed Nostr events ready to publish     | Postgres, then relays via the publisher                  | The published event is public on Nostr once it is sent |
| Media files                              | S3-compatible bucket, and Blossom when that path is used | Attachments                                            |
| Engagement and analytics snapshots       | Postgres                                                 | In-app stats for paid profiles                         |

Drafts and schedules exist before anything is public. A draft is not a Nostr event until the user
signs it.

## Payments and wallet

| Data                                 | Where it lives                        | Why it is there                                       |
| ------------------------------------ | ------------------------------------- | ----------------------------------------------------- |
| Subscription and plan records        | Postgres                              | Access control                                        |
| Lightning and BTCPay payment records | Postgres                              | Receipts and renewal state                            |
| Referral ledger and payout audit     | Postgres                              | Commission balance and operator history               |
| Encrypted NWC connection             | Postgres (`encryptedNwc` and related) | Optional auto-renew and creator payouts               |
| Owner NWC connection string          | Server environment (`OWNER_NWC`)      | Operator wallet for referral payouts. Not a user key. |

An NWC connection string is a credential. The app encrypts the user connection at rest. Anyone who
can read both the database and the encryption key can use that connection within the permissions the
wallet granted. Users should grant pay-invoice only, with a budget, and can revoke the connection in
the wallet.

Referral payouts spend the operator wallet (`OWNER_NWC`), not the referrer's key. The referrer
supplies a Lightning address or an invoice.

## Processors the hosted service can use

These are optional in a self-hosted install. The hosted service should list the ones it actually
uses. This inventory does not invent a company name or a registered address.

- PostgreSQL host (application database)
- Redis host (queues and cache)
- S3-compatible object storage
- The HTTP Nostr publisher
- Blossom, when hosted media is enabled
- Blastr, when managed relay publishing is enabled
- NostrMash or a Primal cache, when profile and engagement lookups use them
- Relays the user or the operator configured (public Nostr network)
- BTCPay, when founder or on-chain checkout is enabled
- The user's Lightning wallet, via NWC, when they connect one
- Sentry, when `SENTRY_DSN` is set
- Web push provider, when VAPID keys are set
- Cloudflare, when the host or the marketing site sits behind it

Self-hosters replace these with their own providers. The software does not require an official
SmartFlowSocial account.

## Retention

The schema does not enforce a single retention period.

- Publish relay acknowledgements older than 30 days are deleted by the cleanup cron.
- Drafts, schedules, media, billing rows, and encrypted NWC connections stay until the user deletes
  them or the operator deletes the account.
- `RetainedFinancialRecord` rows and referral payout audit rows older than 365 days are deleted by
  the worker, every 24 hours by default, and by `POST /cron/purge-retained-records`. `GET` still
  works. 365 days is the software setting. It is not a claim that a statute requires that period.
- Referral earnings and referral links of an account that still exists have no timer.
- Signed events that have already been published to relays cannot be recalled by deleting the
  database row. Relays are independent.

A published privacy notice still needs retention periods for drafts, media, billing rows of live
accounts, and logs. The code does not supply those.

## User rights

A signed-in user can delete individual drafts and posts in the app. Settings also offers a JSON
export (`/dashboard/account/export`) and account deletion. Deletion requires the phrase
`delete my account` and an acknowledgement that relays keep published events. It removes the user
row and cascaded drafts, schedules, sessions, and the encrypted NWC connection. Before that, payment
amount, status, purpose, and payment hash are copied to `RetainedFinancialRecord`. That copy has no
public key, invoice, or preimage, and it is deleted after 365 days.

Deletion also removes the account's public key from referral rows:

- Referral links are deleted, whether the account was the referrer or the referred user.
- Unpaid earnings with no payout in flight are deleted. Commissions that were not paid out are
  forfeited. Paid earnings, and any earning with a payout in flight, stay under the placeholder
  `deleted-account` until they are older than 365 days. The purge does not delete a row a payout
  still holds.
- Earnings another referrer earned from the deleted account stay, with `deleted-account` in place of
  the deleted key.
- Payout audit rows keep the amount and the payment hash, lose the public key, and are deleted after
  365 days. The payment hash is what stops the same invoice from being paid twice, so payout
  invoices that stay valid for more than 365 days are refused.

Objects in this install's own bucket are deleted when the URL is under `clients/<user id>/` and no
other account references that URL. Blossom blobs and files on other servers are not deleted. Events
a relay has already accepted stay on that relay. Scheduled jobs whose post row is gone are skipped.
Sessions and the encrypted NWC connection are on the user row and go with it.

`ENABLE_NOSTR_DELETE_EVENTS`, when set, lets the server publish a kind 5 deletion signed by the
operator key in `NOSTR_NSEC`. That key is not the user's Nostr key. Relays may ignore the deletion.

A GDPR Article 13 notice has to say who the controller is, the purposes, the legal bases, the
recipients, the retention periods, and the rights to access, rectify, erase, restrict, and complain
to a supervisory authority. Those sentences need the owner's legal identity. They are not in this
repository.
