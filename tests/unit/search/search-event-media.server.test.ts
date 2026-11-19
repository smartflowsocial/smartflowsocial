import { describe, expect, it } from "vitest";

import {
  extractMediaUrlsFromContent,
  extractMediaUrlsFromTags,
} from "~/features/search/services/search-event-media.server";

function asTagList(value: unknown[]): string[][] {
  return value as string[][];
}

describe("extractMediaUrlsFromContent", () => {
  it("returns image and video urls", () => {
    const content = [
      "Hello https://cdn.example.com/a.JPG",
      "and http://cdn.example.com/clip.webm",
      "plus https://cdn.example.com/move.mov",
    ].join(" ");

    expect(extractMediaUrlsFromContent(content)).toEqual([
      "https://cdn.example.com/a.JPG",
      "http://cdn.example.com/clip.webm",
      "https://cdn.example.com/move.mov",
    ]);
  });

  it("returns an empty list when the note has no media url", () => {
    expect(extractMediaUrlsFromContent("")).toEqual([]);
    expect(extractMediaUrlsFromContent("just text")).toEqual([]);
    expect(
      extractMediaUrlsFromContent("https://cdn.example.com/file.txt")
    ).toEqual([]);
  });

  it("ignores a url whose extension is not media", () => {
    expect(
      extractMediaUrlsFromContent("see https://cdn.example.com/notes/abc")
    ).toEqual([]);
  });
});

describe("extractMediaUrlsFromTags", () => {
  it("collects url tags and imeta urls", () => {
    expect(
      extractMediaUrlsFromTags([
        ["url", "https://cdn.example.com/from-tag.png"],
        ["imeta", "dim", "http://cdn.example.com/from-imeta.gif"],
      ])
    ).toEqual([
      "https://cdn.example.com/from-tag.png",
      "http://cdn.example.com/from-imeta.gif",
    ]);
  });

  it("returns an empty list for no tags", () => {
    expect(extractMediaUrlsFromTags([])).toEqual([]);
  });

  it("skips short, non-http, and unrelated tags", () => {
    const looseTags: unknown[] = [
      "skip-me",
      ["url"],
      ["url", "notaurl"],
      ["url", "ftp://cdn.example.com/a.jpeg"],
      ["imeta", "url"],
      ["imeta", "x", "relative.png"],
      ["t", "topic"],
      ["url", "https://cdn.example.com/keep.webp"],
    ];

    expect(extractMediaUrlsFromTags(asTagList(looseTags))).toEqual([
      "https://cdn.example.com/keep.webp",
    ]);
  });
});
