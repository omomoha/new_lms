/**
 * Unit tests — CSV export (RFC-4180 building, formula-injection guard, BOM)
 */

import { describe, it, expect } from "vitest";
import { toCsv, sanitizeCsvField, CSV_BOM } from "../src/lib/csvExport";

/** Strip BOM and split into lines for easy row assertions. */
function lines(csv: string): string[] {
  expect(csv.startsWith(CSV_BOM)).toBe(true);
  return csv.slice(CSV_BOM.length).split("\r\n");
}

describe("toCsv — structure", () => {
  it("emits BOM + header + rows with CRLF line endings", () => {
    const csv = toCsv(["a", "b"], [["1", "2"]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain("\r\n");
    expect(lines(csv)).toEqual(["a,b", "1,2", ""]); // trailing CRLF
  });

  it("handles empty rows (header-only CSV)", () => {
    const csv = toCsv(["name", "email"], []);
    expect(lines(csv)).toEqual(["name,email", ""]);
  });

  it("serialises numbers verbatim and null/undefined as empty fields", () => {
    const csv = toCsv(["n", "neg", "zero", "nul", "undef"], [
      [42, -7, 0, null, undefined],
    ]);
    expect(lines(csv)[1]).toBe("42,-7,0,,");
  });
});

describe("toCsv — RFC-4180 quoting", () => {
  it("quotes fields containing commas", () => {
    const csv = toCsv(["name"], [["Doe, Jane"]]);
    expect(lines(csv)[1]).toBe('"Doe, Jane"');
  });

  it("doubles embedded quotes and wraps the field", () => {
    const csv = toCsv(["name"], [['Jane "JJ" Doe']]);
    expect(lines(csv)[1]).toBe('"Jane ""JJ"" Doe"');
  });

  it("quotes fields containing newlines (LF and CRLF)", () => {
    const csv = toCsv(["note"], [["line1\nline2"]]);
    expect(csv).toContain('"line1\nline2"');

    const csv2 = toCsv(["note"], [["a\r\nb"]]);
    // Field starts with "a" (safe) but contains CR/LF → must be quoted
    expect(csv2).toContain('"a\r\nb"');
  });

  it("quotes headers too", () => {
    const csv = toCsv(['weird "header", yes'], []);
    expect(lines(csv)[0]).toBe('"weird ""header"", yes"');
  });
});

describe("toCsv — formula-injection guard", () => {
  const dangerous: Array<[string, string]> = [
    ["=", "=HYPERLINK(\"http://evil\")"],
    ["+", "+1+1"],
    ["-", "-2+3"],
    ["@", "@SUM(A1:A9)"],
    ["tab", "\tpadded"],
    ["CR", "\rstart"],
  ];

  for (const [label, payload] of dangerous) {
    it(`prefixes fields starting with ${label} with a single quote`, () => {
      const sanitized = sanitizeCsvField(payload);
      // The serialised field must begin with ' (possibly inside RFC quoting)
      const unquoted = sanitized.startsWith('"')
        ? sanitized.slice(1)
        : sanitized;
      expect(unquoted.startsWith("'")).toBe(true);
    });
  }

  it("neutralises a formula in a full document", () => {
    const csv = toCsv(["name"], [["=cmd|' /C calc'!A0"]]);
    // Guard prefix applied first, then RFC quoting (field contains no comma/quote
    // here other than the apostrophes, which do not force quoting)
    expect(lines(csv)[1]).toBe("'=cmd|' /C calc'!A0");
  });

  it("applies guard AND quoting when a dangerous field also needs quoting", () => {
    const csv = toCsv(["f"], [['=1,2"x']]);
    expect(lines(csv)[1]).toBe('"\'=1,2""x"');
  });

  it("does not prefix safe strings or numbers", () => {
    expect(sanitizeCsvField("Alice")).toBe("Alice");
    expect(sanitizeCsvField("a-b")).toBe("a-b"); // dash not at start
    expect(sanitizeCsvField(-5)).toBe("-5"); // numbers are trusted
  });
});
