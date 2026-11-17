import { describe, expect, it } from "vitest";

import { parseStoredNostrProfile } from "~/features/user/stored-nostr-profile";

describe("parseStoredNostrProfile", () => {
  it("keeps an object profile", () => {
    expect(
      parseStoredNostrProfile({
        name: "operator",
        picture: "https://example.com/a.png",
      })
    ).toEqual({
      name: "operator",
      picture: "https://example.com/a.png",
    });
  });

  it("parses a JSON string stored in the profile column", () => {
    expect(
      parseStoredNostrProfile(
        JSON.stringify({
          display_name: "SmartFlow Operator",
          picture: "https://example.com/parent.png",
        })
      )
    ).toEqual({
      display_name: "SmartFlow Operator",
      picture: "https://example.com/parent.png",
    });
  });

  it("returns null for invalid JSON and non-objects", () => {
    expect(parseStoredNostrProfile("not-json")).toBeNull();
    expect(parseStoredNostrProfile(["name"])).toBeNull();
    expect(parseStoredNostrProfile(null)).toBeNull();
  });
});
