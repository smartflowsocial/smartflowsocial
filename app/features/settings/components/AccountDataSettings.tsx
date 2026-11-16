import { Form } from "react-router";

import {
  ACCOUNT_DELETE_CONFIRMATION,
  ACCOUNT_DELETE_RELAY_ACK,
} from "~/features/user/account-data.constants";

export function AccountDataSettings() {
  return (
    <section className="border-border space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="text-base font-semibold">Your data</h2>
        <p className="text-text-secondary mt-1 text-sm leading-relaxed">
          Download a JSON copy of this account. Deleting the account removes it
          from this database, including drafts, schedules, sessions, and the
          encrypted wallet connection. It does not remove events that relays
          already accepted. Payment amounts and hashes are kept without your
          public key for 12 months. Your public key is removed from referral
          records, and referral commissions that have not been paid out are
          forfeited.
        </p>
      </div>
      <p>
        <a
          className="text-link hover:text-link-hover text-sm font-medium"
          href="/dashboard/account/export"
        >
          Download account export
        </a>
      </p>
      <Form
        method="post"
        action="/dashboard/account/delete"
        className="space-y-3"
      >
        <label className="block text-sm">
          <span className="text-text-secondary">
            Type {ACCOUNT_DELETE_CONFIRMATION} to confirm
          </span>
          <input
            name="confirm"
            autoComplete="off"
            className="border-border mt-1 w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="acknowledgeRelays"
            value={ACCOUNT_DELETE_RELAY_ACK}
            className="mt-1"
          />
          <span>
            I understand published Nostr events can remain on relays after this
            account is deleted.
          </span>
        </label>
        <button
          type="submit"
          className="border-danger/50 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm font-medium"
        >
          Delete account
        </button>
      </Form>
    </section>
  );
}
