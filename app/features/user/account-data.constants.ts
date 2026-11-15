export const ACCOUNT_DELETE_CONFIRMATION = "delete my account";
export const ACCOUNT_DELETE_RELAY_ACK = "relays keep events";

/**
 * Days that retained payment rows and referral payout audit rows are kept.
 * Payout invoices may not stay valid longer than this, because the audit row
 * is what stops the same invoice from being paid twice.
 */
export const FINANCIAL_RECORD_RETENTION_DAYS = 365;

/** Stored in referral rows in place of the public key of a deleted account. */
export const DELETED_ACCOUNT_NPUB = "deleted-account";
