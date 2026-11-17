import type { ProfileData } from "~/features/nostr/types";

/**
 * `User.nostrProfile` is a JSON column, but older writes stored a JSON string
 * rather than an object. Readers need the object to show a name and picture.
 */
export function parseStoredNostrProfile(value: unknown): ProfileData | null {
  let current = value;
  for (let depth = 0; depth < 2 && typeof current === "string"; depth++) {
    try {
      current = JSON.parse(current) as unknown;
    } catch {
      return null;
    }
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    return null;
  }
  return current as ProfileData;
}
