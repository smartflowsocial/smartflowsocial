import { describe, expect, it } from "vitest";

import {
  normalizeEvent,
  normalizeLoaderResponseData,
} from "~/lib/validation/normalize-loader-response-data";

const CREATED = new Date("2024-07-01T00:00:00.000Z");

describe("normalizeEvent", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "event"],
    ["a number", 4],
    ["an array", ["tag"]],
  ])("returns %s unchanged", (_label, value) => {
    expect(normalizeEvent(value)).toBe(value);
  });

  it("leaves an object without tags unchanged and normalizes every tag shape", () => {
    expect(normalizeEvent({ id: "e1", content: "hello" })).toEqual({
      id: "e1",
      content: "hello",
    });

    expect(
      normalizeEvent({
        id: "e2",
        tags: [
          ["p", 1, null, undefined],
          { 0: "e", 1: null, 2: "id" },
          { 2: "late", 0: "t" },
          { 1: "skipped-zero", 3: "gap" },
          { label: "topic" },
          {},
          null,
          undefined,
          7,
        ],
      })
    ).toEqual({
      id: "e2",
      tags: [
        ["p", "1", "null", "undefined"],
        ["e", "", "id"],
        ["t", "late"],
        ["skipped-zero", "gap"],
        ["topic"],
        [],
        [""],
        [""],
        ["7"],
      ],
    });
  });

  it("normalizes tag maps that are sequential, gapped, empty, or not objects", () => {
    expect(
      normalizeEvent({
        tags: {
          1: ["p", "second"],
          0: { 0: "e", 1: "first" },
          extra: "ignored-because-sequential",
        },
      })
    ).toEqual({
      tags: [
        ["e", "first"],
        ["p", "second"],
      ],
    });
    expect(normalizeEvent({ tags: { 1: ["p", "only"] } })).toEqual({
      tags: [["p", "only"]],
    });
    expect(normalizeEvent({ tags: { b: ["t", "b"], a: "topic" } })).toEqual({
      tags: [["t", "b"], ["topic"]],
    });
    expect(normalizeEvent({ tags: {} })).toEqual({ tags: [] });
    expect(normalizeEvent({ tags: null })).toEqual({ tags: [] });
    expect(normalizeEvent({ tags: undefined })).toEqual({ tags: [] });
    expect(normalizeEvent({ tags: "" })).toEqual({ tags: [] });
    expect(normalizeEvent({ tags: 0 })).toEqual({ tags: [] });
    expect(normalizeEvent({ tags: false })).toEqual({ tags: [] });
  });
});

describe("normalizeLoaderResponseData", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["zero", 0],
    ["an empty string", ""],
    ["false", false],
  ])("returns %s unchanged", (_label, value) => {
    expect(normalizeLoaderResponseData(value)).toBe(value);
  });

  it("preserves a root date and walks arrays", () => {
    expect(normalizeLoaderResponseData(CREATED)).toBe(CREATED);
    const nested = {
      signedEvent: { tags: { 0: ["p", "nested"] } },
    };
    expect(normalizeLoaderResponseData([CREATED, nested, "plain"])).toEqual([
      CREATED,
      { signedEvent: { tags: [["p", "nested"]] } },
      "plain",
    ]);
  });

  it("normalizes top-level signed and nostr events and preserves their dates", () => {
    const normalized = normalizeLoaderResponseData({
      signedEvent: { tags: { 0: ["e", "1"] }, createdAt: CREATED },
      nostrEvent: { tags: ["t", "nostr"], createdAt: CREATED },
      untouched: 1,
    });
    expect(normalized).toEqual({
      signedEvent: { tags: [["e", "1"]], createdAt: CREATED },
      nostrEvent: { tags: [["t"], ["nostr"]], createdAt: CREATED },
      untouched: 1,
    });
  });

  it.each([
    "scheduledPosts",
    "posts",
    "longformPosts",
    "pastPosts",
    "scheduledLongFormPosts",
    "pastLongFormPosts",
  ] as const)(
    "normalizes event fields inside %s and leaves other items",
    (key) => {
      const normalized = normalizeLoaderResponseData({
        [key]: [
          {
            signedEvent: { tags: { 0: ["p", "a"] } },
            nostrEvent: { tags: [["e", "b"]] },
            createdAt: CREATED,
            caption: "kept",
          },
          null,
          "raw",
          ["nested"],
          CREATED,
        ],
      });
      expect(normalized).toEqual({
        [key]: [
          {
            signedEvent: { tags: [["p", "a"]] },
            nostrEvent: { tags: [["e", "b"]] },
            createdAt: CREATED,
            caption: "kept",
          },
          null,
          "raw",
          ["nested"],
          CREATED,
        ],
      });

      const notAnArray = normalizeLoaderResponseData({
        [key]: { signedEvent: { tags: { 0: ["p", "raw"] } } },
      });
      expect(notAnArray).toEqual({
        [key]: { signedEvent: { tags: { 0: ["p", "raw"] } } },
      });
    }
  );

  it("normalizes flow item data and leaves items without an object payload", () => {
    const normalized = normalizeLoaderResponseData({
      flowItems: [
        {
          id: "item",
          data: {
            signedEvent: { tags: { 0: ["p", "flow"] } },
            createdAt: CREATED,
            label: "kept",
          },
        },
        { id: "empty-data", data: [] },
        { id: "null-data", data: null },
        { id: "text-data", data: "text" },
        null,
        "raw",
        CREATED,
      ],
      flowItemsIgnored: "not-an-array",
    });
    expect(normalized).toEqual({
      flowItems: [
        {
          id: "item",
          data: {
            signedEvent: { tags: [["p", "flow"]] },
            createdAt: CREATED,
            label: "kept",
          },
        },
        { id: "empty-data", data: {} },
        { id: "null-data", data: null },
        { id: "text-data", data: "text" },
        null,
        "raw",
        CREATED,
      ],
      flowItemsIgnored: "not-an-array",
    });
    expect(
      normalizeLoaderResponseData({ flowItems: { id: "object" } })
    ).toEqual({ flowItems: { id: "object" } });
  });

  it("recurses only through objects that directly contain a known event key", () => {
    const buried = {
      signedEvent: { tags: { 0: ["p", "buried"] } },
    };
    const normalized = normalizeLoaderResponseData({
      wrapper: { pastPosts: [{ nostrEvent: { tags: ["e"] } }] },
      plain: { nested: buried, count: 1 },
      list: [buried],
      when: CREATED,
    });
    expect(normalized).toEqual({
      wrapper: { pastPosts: [{ nostrEvent: { tags: [["e"]] } }] },
      plain: { nested: buried, count: 1 },
      list: [buried],
      when: CREATED,
    });
  });
});
