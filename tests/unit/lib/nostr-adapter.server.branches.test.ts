import { generateSecretKey, getPublicKey } from "nostr-tools";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BRAND_NAME } from "~/lib/brand";
import { nostrAdapter } from "~/lib/nostr-adapter.server";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const SECRET = bytesToHex(generateSecretKey());
const PUBLIC_KEY = nostrAdapter.getPublicKey(SECRET);

describe("nostrAdapter key codecs", () => {
  it("encodes and decodes npubs, and returns null for invalid input", () => {
    const npub = nostrAdapter.encodeNpub(PUBLIC_KEY);
    expect(npub?.startsWith("npub1")).toBe(true);
    if (!npub) {
      throw new Error("expected npub");
    }
    expect(nostrAdapter.decodeNpub(npub)).toBe(PUBLIC_KEY);
    expect(nostrAdapter.decodeNpub(PUBLIC_KEY)).toBe(PUBLIC_KEY);
    expect(nostrAdapter.encodeNpub("zz")).toBeNull();
    expect(nostrAdapter.decodeNpub("npub1notvalid")).toBeNull();
  });

  it("encodes nsecs and treats decoded nsec data as non-string", () => {
    const nsec = nostrAdapter.encodeNsec(SECRET);
    expect(nsec?.startsWith("nsec1")).toBe(true);
    if (!nsec) {
      throw new Error("expected nsec");
    }
    expect(nostrAdapter.decodeNsec(nsec)).toBeNull();
    expect(nostrAdapter.decodeNsec(SECRET)).toBe(SECRET);
    expect(nostrAdapter.encodeNsec("ab".repeat(10000))).toBeNull();
    expect(nostrAdapter.decodeNsec("nsec1notvalid")).toBeNull();
  });

  it("derives the same public key from hex and nsec and rejects a bad nsec", () => {
    const nsec = nostrAdapter.encodeNsec(SECRET);
    if (!nsec) {
      throw new Error("expected nsec");
    }
    expect(nostrAdapter.getPublicKey(SECRET)).toBe(
      getPublicKey(hexToBytes(SECRET))
    );
    expect(nostrAdapter.getPublicKey(nsec)).toBe(PUBLIC_KEY);
    expect(() => nostrAdapter.getPublicKey("nsec1notvalid")).toThrow();
    expect(() => nostrAdapter.getPublicKey("zz")).toThrow();
  });
});

describe("nostrAdapter events", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("signs with hex and nsec and validates the event shape", () => {
    const template = {
      kind: 1,
      created_at: 1_700_000_000,
      tags: [["t", "nostr"]],
      content: "hello",
    };
    const nsec = nostrAdapter.encodeNsec(SECRET);
    if (!nsec) {
      throw new Error("expected nsec");
    }
    const fromHex = nostrAdapter.finalizeEvent(template, SECRET);
    const fromNsec = nostrAdapter.finalizeEvent(template, nsec);
    expect(fromHex.pubkey).toBe(PUBLIC_KEY);
    expect(fromNsec.pubkey).toBe(PUBLIC_KEY);
    expect(fromHex.sig.length).toBeGreaterThan(0);
    expect(nostrAdapter.validateEvent(fromHex)).toBe(true);
    expect(nostrAdapter.validateEvent({})).toBe(false);
    expect(nostrAdapter.validateEvent(null)).toBe(false);
    expect(() =>
      nostrAdapter.finalizeEvent(template, "nsec1notvalid")
    ).toThrow();
  });

  it("creates short notes with explicit fields and defaults", () => {
    expect(
      nostrAdapter.createEvent({
        content: "note",
        created_at: 10,
        kind: 0,
        tags: [["p", PUBLIC_KEY]],
      })
    ).toEqual({
      content: "note",
      created_at: 10,
      kind: 0,
      tags: [["p", PUBLIC_KEY]],
    });
    expect(
      nostrAdapter.createEvent({ content: "plain", created_at: 11 })
    ).toEqual({
      content: "plain",
      created_at: 11,
      kind: 1,
      tags: [],
    });
  });

  it("builds long-form tags for every optional field and skips blank ones", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T00:00:00.000Z"));
    const full = nostrAdapter.createLongFormEvent({
      title: "Title",
      content: "Body",
      summary: "Summary",
      image: "https://cdn.example/cover.jpg",
      identifier: "slug",
      publishedAt: 1_700_000_000,
      tags: [" Nostr ", "  ", "AI"],
    });
    expect(full).toEqual({
      content: "Body",
      created_at: 1_717_200_000,
      kind: 30023,
      tags: [
        ["title", "Title"],
        ["r", "wss://relay.primal.net/"],
        ["client", BRAND_NAME],
        ["summary", "Summary"],
        ["image", "https://cdn.example/cover.jpg"],
        ["d", "slug"],
        ["published_at", "1700000000"],
        ["t", "nostr"],
        ["t", "ai"],
      ],
    });

    const minimal = nostrAdapter.createLongFormEvent({
      title: "",
      content: "Only",
      publishedAt: 0,
      tags: [],
    });
    expect(minimal.tags).toEqual([
      ["r", "wss://relay.primal.net/"],
      ["client", BRAND_NAME],
    ]);
    expect(minimal.created_at).toBe(1_717_200_000);
  });
});

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
