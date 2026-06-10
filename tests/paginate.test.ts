import { describe, it, expect } from "vitest";
import { paginateBlocks, clampPage, type DocBlock } from "@/lib/paginate";

const block = (tag: string, textLength = 100): DocBlock => ({
  tag,
  html: `<${tag}>x</${tag}>`,
  textLength,
});

describe("paginateBlocks", () => {
  it("returns [] for empty input", () => {
    expect(paginateBlocks([])).toEqual([]);
  });

  it("keeps a short document on one page", () => {
    const pages = paginateBlocks([block("p"), block("p"), block("p")]);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(3);
  });

  it("starts a new page at every h2", () => {
    const pages = paginateBlocks([
      block("h2"),
      block("p"),
      block("h2"),
      block("p"),
      block("h2"),
      block("p"),
    ]);
    expect(pages).toHaveLength(3);
    pages.forEach((p) => expect(p[0].tag).toBe("h2"));
  });

  it("does not start with an empty first page when doc opens with h2", () => {
    const pages = paginateBlocks([block("h2"), block("p")]);
    expect(pages).toHaveLength(1);
  });

  it("breaks when the char budget is exceeded", () => {
    const pages = paginateBlocks(
      [block("p", 2000), block("p", 2000), block("p", 2000)],
      3000
    );
    expect(pages.length).toBeGreaterThan(1);
  });

  it("enforces a minimum budget of 500", () => {
    // budget 1 is clamped to 500; two 300-char paragraphs exceed it
    const pages = paginateBlocks([block("p", 300), block("p", 300), block("p", 300)], 1);
    expect(pages.length).toBe(2);
  });

  it("never leaves a heading dangling at the end of a page", () => {
    const pages = paginateBlocks(
      [block("p", 3400), block("h3", 20), block("p", 3000)],
      3000
    );
    expect(pages.length).toBeGreaterThan(1);
    for (let i = 0; i < pages.length - 1; i++) {
      const last = pages[i][pages[i].length - 1];
      expect(["h1", "h2", "h3", "h4", "h5", "h6"]).not.toContain(last.tag);
    }
    // The heading must lead the page that contains its content
    const headingPage = pages.find((p) => p.some((b) => b.tag === "h3"));
    expect(headingPage?.[0].tag).toBe("h3");
  });

  it("h1 also forces a page break", () => {
    const pages = paginateBlocks([block("p"), block("h1"), block("p")]);
    expect(pages).toHaveLength(2);
    expect(pages[1][0].tag).toBe("h1");
  });

  it("preserves every block exactly once, in order", () => {
    const input = [
      block("p", 1200),
      block("h2"),
      block("table", 900),
      block("p", 4000),
      block("ul", 300),
    ];
    const pages = paginateBlocks(input, 2000);
    const flat = pages.flat();
    expect(flat).toHaveLength(input.length);
    expect(flat.map((b) => b.tag)).toEqual(input.map((b) => b.tag));
  });
});

describe("clampPage", () => {
  it("clamps below range", () => expect(clampPage(0, 10)).toBe(1));
  it("clamps above range", () => expect(clampPage(99, 10)).toBe(10));
  it("passes valid values", () => expect(clampPage(5, 10)).toBe(5));
  it("handles total 0", () => expect(clampPage(3, 0)).toBe(1));
  it("handles NaN", () => expect(clampPage(NaN, 10)).toBe(1));
  it("rounds fractional input", () => expect(clampPage(2.6, 10)).toBe(3));
});
