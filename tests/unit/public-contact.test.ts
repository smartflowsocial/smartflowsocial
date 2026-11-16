import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import {
  SMARTFLOW_PUBLIC_CONTACT_NPUB,
  SMARTFLOW_PUBLIC_CONTACT_NOSTR_URI,
  SMARTFLOW_PUBLIC_CONTACT_PROFILE_URL,
} from "~/lib/public-contact";

describe("public contact", () => {
  it("uses a checksum-valid npub and does not invent another identity", () => {
    const decoded = nip19.decode(SMARTFLOW_PUBLIC_CONTACT_NPUB);
    expect(decoded.type).toBe("npub");
    expect(typeof decoded.data === "string" ? decoded.data : "").toHaveLength(
      64
    );
    expect(SMARTFLOW_PUBLIC_CONTACT_NOSTR_URI).toBe(
      `nostr:${SMARTFLOW_PUBLIC_CONTACT_NPUB}`
    );
    expect(SMARTFLOW_PUBLIC_CONTACT_PROFILE_URL).toBe(
      `https://njump.me/${SMARTFLOW_PUBLIC_CONTACT_NPUB}`
    );
  });
});
