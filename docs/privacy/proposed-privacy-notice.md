# Proposed privacy notice

Replacement text for the landing site. The owner decided the public contact is the Nostr account
below and that no legal name or postal address will be published. Do not add one. Do not write that
the hosted service is GDPR-compliant. The engineering inventory is
[data-inventory.md](./data-inventory.md).

This file is not the live page. The landing repository was not updated from the application
workspace.

The current marketing page says the service stores the public key, signed posts, uploaded media,
queue settings, and billing details. That is true and incomplete. It does not mention draft text,
draft version history, encrypted wallet connections, referral records, or the processors above.

## Draft text

**Who we are.** SmartFlowSocial communicates publicly under its Nostr identity
npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0
(https://njump.me/npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0). That account is
a public contact. It is not a registered company, a legal name, or a postal address. Publishing it
does not by itself identify a data controller under GDPR Article 13 or a service provider under
Article 5 of Directive 2000/31/EC. Where those duties apply to the commercial hosted service, they
are not met by this notice.

**Signing keys.** SmartFlowSocial does not store your Nostr signing key. You sign with a browser
extension or a remote signer on a device you control. We store the public key and the events you
have already signed. We do not sign posts for you.

**Wallet connections.** Connecting a wallet is optional. If you connect an NWC wallet for renewals
or creator payouts, we store that connection encrypted. It is a payment credential. The wallet
provider enforces the permissions and spending limit you set. You can revoke the connection in the
wallet. Referral payouts from the operator, when that program is running, are paid from the
operator's wallet to an invoice or Lightning address you provide.

**What we store.** Draft text and older draft versions, media you upload, schedules and queues,
billing and subscription records, referral balances, and the operational logs needed to publish and
to debug failed jobs.

**How long.** [State the retention period for drafts, media, billing, and logs. The software does
not delete most of these on a timer. Publish-relay acknowledgements are deleted after 30 days.
Payment facts kept after account deletion, and referral payout audit rows, are deleted after 365
days. That is the software's current setting, not a statutory period. Events already sent to Nostr
relays stay on those relays.]

**Who else processes it.** [List the database host, object storage, publisher, Blossom if used,
error tracking if used, and the relays. Say which country they operate in if you know.]

**Your rights.** If the controller is established in the EU or UK, or offers the service to people
there, you can ask for access, correction, deletion, restriction, and a copy of the data the
controller holds. You can complain to a supervisory authority. A signed-in user can download a JSON
export at `/dashboard/account/export` and can delete the account from Settings. Deletion removes the
account row, drafts, schedules, sessions, and the encrypted wallet connection. It keeps payment
amount, status, purpose, and payment hash in `RetainedFinancialRecord`, without the public key or
the invoice, for 365 days. It removes the public key from referral records. Pending and failed
commissions with no payout in progress are removed. Paid commissions, and any commission already
submitted for payment, stay without the public key until the retention purge. Payout audit rows keep
the amount and payment hash without the public key for 365 days. Deleting the account does not
delete events that relays already accepted. When the operator enables delete events, those events
are signed by the operator key in `NOSTR_NSEC`, which is not the user's key. Unshared objects in
this install's bucket are deleted. Blossom blobs and files on other servers may remain.

**Contact.** The public contact is the Nostr account above. There is no separate support email or
privacy officer published with this service.

## What changed relative to the 8 November 2026 page

- Say explicitly that signing keys are not stored, and that optional NWC connections are stored
  encrypted.
- Add drafts, draft snapshots, schedules, and referral records.
- Separate the operator wallet from the user's wallet.
- Replace the single "billing details" sentence with the processors the hosted service actually
  uses.
- Add retention and the limits of deletion once an event is on a relay.
- The owner decided not to publish a legal name or address. Do not invent one, and do not describe
  the Nostr account as a company.
