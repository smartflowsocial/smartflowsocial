# Privacy notice

SmartFlowSocial is a Nostr-native publishing application. This notice explains what information the
hosted service processes, how it is used, and what happens when you export or delete your account.
For questions, contact SmartFlowSocial through its official Nostr account
`npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0`
(<https://njump.me/npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0>). Self-hosted
installations are operated by their respective administrators.

The engineering inventory is [data-inventory.md](./data-inventory.md). The public page is in
`smartflowsocial/smartflowsocial-landing`.

## Signing keys

Sign-in uses a NIP-07 browser extension or a NIP-46 remote signer. The server does not ask for a
private key and does not store the Nostr signing key. You sign each post when you schedule it. The
server stores that signed event and publishes it at the scheduled time. It does not sign your posts
with your key.

`NOSTR_NSEC`, when the operator sets it, signs operator messages such as feedback replies and, when
delete events are turned on, kind 5 deletion events. That key is not the account key.

## What the hosted service stores

- Your public key.
- Drafts and older draft versions.
- Signed posts, queues, and schedule settings.
- A signed-in session cookie.
- Media you upload, in object storage or, when that path is used, Blossom.
- Subscription and payment records when you pay.
- An optional encrypted NWC wallet connection. It is a payment credential. You can revoke it in the
  wallet.
- Referral and campaign payout records when those features are used: public key, amount, Lightning
  address, invoice, and payment hash. A payout whose result was not confirmed stays blocked until it
  is reconciled.
- The caller IP for the public-stats endpoint, in Redis for about 60 seconds. That address is not
  written to the account database.

The account export does not include the encrypted wallet connection or Lightning preimages.

## Who else handles it

The hosted service uses its own database, Redis, and object storage. Signed events are published
from the application. Profile and thread reads run in the same application and can still ask public
Nostr relays and indexers. The relays for a post are chosen for that post. Blossom, Blastr, BTCPay,
Sentry, and web push are used only when those features are turned on. A self-hosted install uses the
operator's providers and does not include the hosted Blossom or Blastr services. Running this
application does not operate a full Nostr indexer.

## How long

Publish acknowledgements are deleted after 30 days. From Settings you can download a JSON export and
delete the account. Deletion removes drafts, schedules, sessions, and the encrypted wallet
connection. It keeps payment amount, status, purpose, and payment hash without your public key for
365 days. It removes your public key from referral records. Pending and failed commissions with no
payout in progress are removed. Paid commissions, and any commission already submitted for payment,
stay without your public key until that retention purge. Payout audit records keep the amount and
payment hash without your public key for 365 days. Those periods are the software's current
settings.

Deleting the account does not remove events from relays. Deleting a post in the app removes that
row. Relays that already accepted the event keep their copy. Unshared files in the install's own
bucket are queued for deletion and retried if storage is unavailable. The queue does not need the
account row to remain. Blossom blobs and copies on servers this install does not operate may remain.

## This website

The marketing site uses Cloudflare Web Analytics. That measurement does not use cookies and is not
used to advertise to you on other sites.

## Contact

Privacy questions go to the Nostr account above.
