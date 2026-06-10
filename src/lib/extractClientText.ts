/**
 * extractClientText — browser-side text extraction from uploaded documents.
 *
 * Used by the AI assessment generator so admins can upload the learning
 * material (PDF / DOCX / TXT / MD) instead of pasting it. Extraction happens
 * entirely in the browser with libraries the app already ships:
 *  - PDF  → pdfjs-dist (same engine as the paginated reader)
 *  - DOCX → mammoth (same engine as the document viewer)
 *  - TXT/MD → plain file read
 * Legacy binary .doc is not supported in the browser — callers get a clear
 * error suggesting a .docx/.pdf export.
 */

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

export class ExtractError extends Error {}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

async function pdfToText(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  try {
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(
        content.items
          .map((it) => ("str" in it ? (it as { str: string }).str : ""))
          .join(" ")
      );
    }
    return parts.join("\n\n");
  } finally {
    void doc.destroy();
  }
}

async function docxToText(buf: ArrayBuffer): Promise<string> {
  const mammoth = (await import("mammoth")) as unknown as {
    extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
  };
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  return value;
}

/** Extract plain text from an uploaded document. Throws ExtractError with a
 *  user-friendly message on unsupported/oversized/unreadable files. */
export async function extractTextFromFile(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ExtractError("File is too large (max 20 MB).");
  }
  const ext = extension(file.name);

  let raw: string;
  try {
    if (ext === "pdf") {
      raw = await pdfToText(await file.arrayBuffer());
    } else if (ext === "docx") {
      raw = await docxToText(await file.arrayBuffer());
    } else if (ext === "txt" || ext === "md" || ext === "markdown") {
      raw = await file.text();
    } else if (ext === "doc") {
      throw new ExtractError(
        "Legacy .doc files can't be read in the browser — save it as .docx or PDF and upload again."
      );
    } else {
      throw new ExtractError("Unsupported file type. Upload a PDF, DOCX, TXT or MD file.");
    }
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    console.error("extractTextFromFile failed:", err);
    throw new ExtractError("Could not read that file. Check it opens normally, then try again.");
  }

  const text = raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 40) {
    throw new ExtractError(
      "No readable text found in that file (scanned/image-only documents can't be used)."
    );
  }
  return text;
}
