// @ts-nocheck -- mocked collaborators are narrower than the production types.
import { describe, expect, it } from "vitest";

import type { PostData } from "~/features/posts/types";
import {
  comparePostDataByProperty,
  getPostDataProperty,
} from "~/lib/validation/post-data-properties.server";

function post(values: Record<string, unknown>): PostData {
  return values as PostData;
}

describe("getPostDataProperty", () => {
  it("returns id and caption, including an empty caption", () => {
    expect(getPostDataProperty(post({ id: "post-1" }), "id")).toBe("post-1");
    expect(
      getPostDataProperty(post({ id: "post-1", caption: "Hello" }), "caption")
    ).toBe("Hello");
    expect(
      getPostDataProperty(post({ id: "post-1", caption: "" }), "caption")
    ).toBe("");
    expect(
      getPostDataProperty(post({ id: "post-1", caption: null }), "caption")
    ).toBeUndefined();
  });

  it("reads schedule fields from a Date, a string, or an unusable value", () => {
    const scheduled = new Date("2024-01-02T03:04:05.000Z");
    expect(
      getPostDataProperty(post({ scheduledAtUtc: scheduled }), "scheduledFor")
    ).toBe(scheduled);
    expect(
      getPostDataProperty(post({ scheduledAtUtc: scheduled }), "scheduledAtUtc")
    ).toBe(scheduled);

    const fromString = getPostDataProperty(
      post({ scheduledAtUtc: "2024-05-06T07:08:09.000Z" }),
      "scheduledAtUtc"
    );
    expect(fromString).toBeInstanceOf(Date);
    expect((fromString as Date).toISOString()).toBe("2024-05-06T07:08:09.000Z");
    expect(
      getPostDataProperty(post({ scheduledAtUtc: null }), "scheduledFor")
    ).toBeUndefined();
    expect(
      getPostDataProperty(post({ scheduledAtUtc: 5 }), "scheduledFor")
    ).toBeUndefined();
  });

  it("reads published, created, and updated timestamps", () => {
    const published = new Date("2024-02-02T00:00:00.000Z");
    const created = new Date("2024-03-03T00:00:00.000Z");
    const updated = new Date("2024-04-04T00:00:00.000Z");
    expect(
      getPostDataProperty(post({ publishedAt: published }), "publishedAt")
    ).toBe(published);
    expect(getPostDataProperty(post({ createdAt: created }), "createdAt")).toBe(
      created
    );
    expect(getPostDataProperty(post({ updatedAt: updated }), "updatedAt")).toBe(
      updated
    );

    const publishedString = getPostDataProperty(
      post({ publishedAt: "2024-02-02T00:00:00.000Z" }),
      "publishedAt"
    );
    const createdString = getPostDataProperty(
      post({ createdAt: "2024-03-03T00:00:00.000Z" }),
      "createdAt"
    );
    const updatedString = getPostDataProperty(
      post({ updatedAt: "2024-04-04T00:00:00.000Z" }),
      "updatedAt"
    );
    expect((publishedString as Date).toISOString()).toBe(
      "2024-02-02T00:00:00.000Z"
    );
    expect((createdString as Date).toISOString()).toBe(
      "2024-03-03T00:00:00.000Z"
    );
    expect((updatedString as Date).toISOString()).toBe(
      "2024-04-04T00:00:00.000Z"
    );
    expect(
      getPostDataProperty(post({ publishedAt: null }), "publishedAt")
    ).toBeUndefined();
    expect(
      getPostDataProperty(post({ createdAt: 1 }), "createdAt")
    ).toBeUndefined();
    expect(
      getPostDataProperty(post({ updatedAt: false }), "updatedAt")
    ).toBeUndefined();
  });

  it("returns only string, number, and Date values for unknown keys", () => {
    const when = new Date("2024-06-06T00:00:00.000Z");
    expect(getPostDataProperty(post({ custom: "text" }), "custom")).toBe(
      "text"
    );
    expect(getPostDataProperty(post({ custom: 0 }), "custom")).toBe(0);
    expect(getPostDataProperty(post({ custom: when }), "custom")).toBe(when);
    expect(
      getPostDataProperty(post({ custom: false }), "custom")
    ).toBeUndefined();
    expect(
      getPostDataProperty(post({ custom: null }), "custom")
    ).toBeUndefined();
    expect(
      getPostDataProperty(post({ custom: { id: 1 } }), "custom")
    ).toBeUndefined();
    expect(getPostDataProperty(post({}), "missing")).toBeUndefined();
  });
});

describe("comparePostDataByProperty", () => {
  it("orders missing values by direction", () => {
    const left = post({});
    const right = post({});
    expect(comparePostDataByProperty(left, right, "caption", "asc")).toBe(0);
    expect(comparePostDataByProperty(left, right, "caption", "desc")).toBe(0);
    expect(
      comparePostDataByProperty(left, post({ caption: "b" }), "caption", "asc")
    ).toBe(-1);
    expect(
      comparePostDataByProperty(left, post({ caption: "b" }), "caption", "desc")
    ).toBe(1);
    expect(
      comparePostDataByProperty(post({ caption: "a" }), right, "caption", "asc")
    ).toBe(1);
    expect(
      comparePostDataByProperty(
        post({ caption: "a" }),
        right,
        "caption",
        "desc"
      )
    ).toBe(-1);
  });

  it("orders dates, strings, and numbers in both directions", () => {
    const earlier = post({
      publishedAt: new Date("2024-01-01T00:00:00.000Z"),
    });
    const later = post({
      publishedAt: new Date("2024-02-01T00:00:00.000Z"),
    });
    const same = post({
      publishedAt: new Date("2024-01-01T00:00:00.000Z"),
    });
    expect(
      comparePostDataByProperty(earlier, later, "publishedAt", "asc")
    ).toBeLessThan(0);
    expect(
      comparePostDataByProperty(earlier, later, "publishedAt", "desc")
    ).toBeGreaterThan(0);
    expect(comparePostDataByProperty(earlier, same, "publishedAt", "asc")).toBe(
      0
    );

    expect(
      comparePostDataByProperty(
        post({ caption: "a" }),
        post({ caption: "b" }),
        "caption",
        "asc"
      )
    ).toBe(-1);
    expect(
      comparePostDataByProperty(
        post({ caption: "a" }),
        post({ caption: "b" }),
        "caption",
        "desc"
      )
    ).toBe(1);
    expect(
      comparePostDataByProperty(
        post({ caption: "a" }),
        post({ caption: "a" }),
        "caption",
        "desc"
      )
    ).toBe(0);
    expect(
      comparePostDataByProperty(
        post({ custom: 1 }),
        post({ custom: 2 }),
        "custom",
        "asc"
      )
    ).toBe(-1);
    expect(
      comparePostDataByProperty(
        post({ custom: 2 }),
        post({ custom: 1 }),
        "custom",
        "desc"
      )
    ).toBe(-1);
    expect(
      comparePostDataByProperty(
        post({ custom: 2 }),
        post({ custom: 2 }),
        "custom",
        "asc"
      )
    ).toBe(0);
  });
});
