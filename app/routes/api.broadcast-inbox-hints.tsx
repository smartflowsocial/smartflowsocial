import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

import { requireSession } from "~/features/auth/auth.server";
import { withCSRFProtection } from "~/lib/csrf.server";
import { jsonResponse } from "~/lib/http/json-response";
import { resolveCachedKind10050InboxRelays } from "~/lib/nostr.messenger.server";

const bodySchema = z.object({
  pubkeys: z.array(z.string().regex(/^[0-9a-fA-F]{64}$/)).max(500),
});

export const action = withCSRFProtection(
  async ({ request }: ActionFunctionArgs) => {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, { status: 405 });
    }

    await requireSession(request);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonResponse({ error: "Invalid body" }, { status: 400 });
    }

    const hints: Record<string, string> = {};
    for (const pk of parsed.data.pubkeys) {
      const lower = pk.toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(lower)) continue;
      const relays = await resolveCachedKind10050InboxRelays(lower);
      const first = relays[0]?.trim();
      if (first) hints[lower] = first;
    }

    return jsonResponse({ hints });
  }
);
