import { describe, expect, it } from "vitest";
import { buildBacklinks, extractWikilinks } from "./links.js";

describe("wikilinks", () => {
  it("extracts ids from plain, aliased and heading links, deduplicated, ignoring code", () => {
    const body = [
      "See [[Storage Decision]] and [[storage-decision|the decision]] plus [[Graph View#design]].",
      "Inline `[[not-a-link]]` and",
      "```",
      "[[also-not]]",
      "```",
      "then [[Second Note]].",
    ].join("\n");
    expect(extractWikilinks(body)).toEqual(["storage-decision", "graph-view", "second-note"]);
  });

  it("builds a sorted backlink map without self-links", () => {
    const map = buildBacklinks([
      { id: "a", links: ["b", "c", "a"] },
      { id: "b", links: ["c"] },
      { id: "c", links: [] },
    ]);
    expect(map.get("c")).toEqual(["a", "b"]);
    expect(map.get("b")).toEqual(["a"]);
    expect(map.has("a")).toBe(false);
  });
});
