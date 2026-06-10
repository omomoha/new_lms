import { describe, it, expect } from "vitest";
import {
  shouldAutoConvert,
  convertedPathFor,
  sofficeOutputName,
  extensionOf,
} from "../functions/src/officeConvert";

describe("shouldAutoConvert", () => {
  it("converts pptx/ppt/doc under resources/", () => {
    expect(shouldAutoConvert("resources/c1/m1/deck.pptx")).toBe(true);
    expect(shouldAutoConvert("resources/c1/m1/old.ppt")).toBe(true);
    expect(shouldAutoConvert("resources/c1/m1/legacy.doc")).toBe(true);
    expect(shouldAutoConvert("resources/c1/m1/Deck.PPTX")).toBe(true); // case-insensitive
  });

  it("skips formats the client renders natively or that need no conversion", () => {
    expect(shouldAutoConvert("resources/c1/m1/doc.docx")).toBe(false);
    expect(shouldAutoConvert("resources/c1/m1/file.pdf")).toBe(false);
    expect(shouldAutoConvert("resources/c1/m1/notes.md")).toBe(false);
    expect(shouldAutoConvert("resources/c1/m1/notes.txt")).toBe(false);
  });

  it("never reconverts a converted twin (loop guard)", () => {
    expect(shouldAutoConvert("resources/c1/m1/deck.pptx.pdf")).toBe(false);
  });

  it("ignores other storage areas", () => {
    expect(shouldAutoConvert("videos/c1/m1/deck.pptx")).toBe(false);
    expect(shouldAutoConvert("certTemplates/deck.pptx")).toBe(false);
    expect(shouldAutoConvert("deck.pptx")).toBe(false);
  });

  it("ignores folder placeholders and extensionless names", () => {
    expect(shouldAutoConvert("resources/c1/m1/")).toBe(false);
    expect(shouldAutoConvert("resources/c1/m1/noext")).toBe(false);
  });
});

describe("convertedPathFor", () => {
  it("appends .pdf to the full original name", () => {
    expect(convertedPathFor("resources/c1/m1/deck.pptx")).toBe(
      "resources/c1/m1/deck.pptx.pdf"
    );
  });
});

describe("sofficeOutputName", () => {
  it("replaces the extension with .pdf", () => {
    expect(sofficeOutputName("resources/c1/m1/deck.pptx")).toBe("deck.pdf");
    expect(sofficeOutputName("resources/c1/m1/my.file.ppt")).toBe("my.file.pdf");
  });
});

describe("extensionOf", () => {
  it("lowercases and handles dots in directories", () => {
    expect(extensionOf("resources/v1.2/m1/Deck.PPTX")).toBe("pptx");
    expect(extensionOf("resources/v1.2/m1/noext")).toBe("");
  });
});
