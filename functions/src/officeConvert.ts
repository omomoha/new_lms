/**
 * officeConvert — pure helpers for the PPTX/PPT/DOC → PDF conversion trigger.
 * No firebase imports, so these are unit-testable from the root vitest setup.
 */

/** Office formats we auto-convert. .docx is excluded (rendered natively by
 *  the client via mammoth); .pdf/.md/.txt need no conversion. */
const CONVERTIBLE_EXTENSIONS = new Set(["pptx", "ppt", "doc"]);

/** Lowercase extension of a storage object name ("" when none). */
export function extensionOf(objectName: string): string {
  const base = objectName.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

/**
 * Should this uploaded object be auto-converted to PDF?
 *  - lesson resources only (resources/{courseId}/{moduleId}/…)
 *  - convertible Office extension
 *  - not itself a converted artifact (….pptx.pdf)
 */
export function shouldAutoConvert(objectName: string): boolean {
  if (!objectName.startsWith("resources/")) return false;
  if (objectName.endsWith("/")) return false; // folder placeholder
  return CONVERTIBLE_EXTENSIONS.has(extensionOf(objectName));
}

/** Storage path of the converted twin: the original name + ".pdf"
 *  (deck.pptx → deck.pptx.pdf — keeps the pair visibly linked and avoids
 *  collisions with a user-uploaded deck.pdf). */
export function convertedPathFor(objectName: string): string {
  return `${objectName}.pdf`;
}

/** soffice writes <basename-without-ext>.pdf into --outdir. */
export function sofficeOutputName(objectName: string): string {
  const base = objectName.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return `${dot === -1 ? base : base.slice(0, dot)}.pdf`;
}
