/**
 * Resolve one campaign payout that stayed `paying` or `unknown`.
 *
 * This is a local operator command. It is not an HTTP route. It does not call
 * a wallet and it does not send a payment. `confirmed_unpaid` is refused until
 * the attempt's stored resolution deadline. That deadline covers the pay
 * timeout, both reconciliation lookups, and a safety margin.
 *
 * Requires the application environment, including DATABASE_URL.
 *
 *   pnpm exec tsx scripts/resolve-campaign-payout.ts \
 *     --item=<payout item id> \
 *     --decision=confirmed_paid \
 *     --note="wallet showed this payment hash settled"
 *
 *   pnpm exec tsx scripts/resolve-campaign-payout.ts \
 *     --item=<payout item id> \
 *     --decision=confirmed_unpaid \
 *     --note="wallet has no payment for this hash"
 */

import { resolve } from "node:path";

import { config } from "dotenv";

import { resolveUnknownCampaignPayoutItem } from "../app/features/payments/repositories/campaign-payout-claim.server";

config({ path: resolve(process.cwd(), ".env") });

function getArg(name: string): string | undefined {
  const full = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return full?.slice(name.length + 3);
}

async function main(): Promise<number> {
  const itemId = getArg("item")?.trim();
  const decision = getArg("decision")?.trim();
  const note = getArg("note")?.trim() ?? "";
  if (
    !itemId ||
    (decision !== "confirmed_paid" && decision !== "confirmed_unpaid")
  ) {
    process.stderr.write(
      "Usage: --item=<id> --decision=confirmed_paid|confirmed_unpaid --note=<what the wallet showed>\n"
    );
    return 1;
  }
  const result = await resolveUnknownCampaignPayoutItem({
    itemId,
    decision,
    note,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
