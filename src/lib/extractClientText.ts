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

interface PdfTextItem {
  str: string;
  /** [a, b, c, d, x, y] text matrix — x/y give the item's position in pt */
  transform: number[];
  width: number;
  height: number;
}

/**
 * Assemble page text POSITION-AWARE. Many PDFs emit each glyph run as a
 * separate text item; naively joining items with spaces shatters words
 * ("F eedback C heck"). Instead: insert a newline when the baseline (y)
 * moves, a space only when there is a real horizontal gap between items,
 * and otherwise concatenate runs directly.
 */
function assemblePageText(items: PdfTextItem[]): string {
  let out = "";
  let lastY: number | null = null;
  let lastEndX: number | null = null;
  let lastHeight = 10;

  for (const item of items) {
    if (!item.str) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const height = item.height || lastHeight;

    if (lastY !== null && Math.abs(y - lastY) > height * 0.5) {
      out += "\n";
    } else if (
      lastEndX !== null &&
      out.length > 0 &&
      !out.endsWith(" ") &&
      !out.endsWith("\n") &&
      !item.str.startsWith(" ") &&
      // real word gap ≈ at least a fifth of the line height; glyph-run
      // continuations inside a word have ~zero gap
      x - lastEndX > Math.max(1, height * 0.2)
    ) {
      out += " ";
    }

    out += item.str;
    lastEndX = x + (item.width || 0);
    lastY = y;
    lastHeight = height;
  }
  return out;
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
      // pdf.js items are TextItem | TextMarkedContent; the "str" filter keeps
      // TextItems, which carry the str/transform/width/height we consume.
      const textItems = content.items.filter(
        (it) => "str" in it
      ) as unknown as PdfTextItem[];
      parts.push(assemblePageText(textItems));
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

export type ExtractProgress = (message: string) => void;

/** OCR pages cap — scanned decks beyond this are truncated (speed/memory). */
const OCR_MAX_PAGES = 12;
/** Render scale for OCR rasterisation — higher is more accurate but slower. */
const OCR_SCALE = 2;

/** OCR a scanned PDF: render each page to canvas (pdf.js), recognise with
 *  tesseract.js (worker + language data fetched lazily from its CDN). */
async function ocrPdf(buf: ArrayBuffer, onProgress?: ExtractProgress): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
  const { createWorker } = await import("tesseract.js");

  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const worker = await createWorker("eng");
  try {
    const pages = Math.min(doc.numPages, OCR_MAX_PAGES);
    const parts: string[] = [];
    for (let i = 1; i <= pages; i++) {
      onProgress?.(`OCR — reading page ${i} of ${pages}…`);
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: OCR_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new ExtractError("Could not prepare the page for OCR in this browser.");
      await page.render({ canvasContext: ctx, viewport }).promise;
      const { data } = await worker.recognize(canvas);
      parts.push(data.text ?? "");
      canvas.width = 0; // release bitmap memory
    }
    if (doc.numPages > pages) {
      onProgress?.(`OCR finished — first ${pages} of ${doc.numPages} pages used.`);
    }
    return parts.join("\n\n");
  } finally {
    await worker.terminate().catch(() => undefined);
    void doc.destroy();
  }
}

/** Extract plain text from an uploaded document. Throws ExtractError with a
 *  user-friendly message on unsupported/oversized/unreadable files.
 *  Scanned/image-only PDFs automatically fall back to in-browser OCR
 *  (slower — onProgress receives per-page status strings). */
export async function extractTextFromFile(
  file: File,
  onProgress?: ExtractProgress
): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ExtractError("File is too large (max 20 MB).");
  }
  const ext = extension(file.name);

  let raw: string;
  try {
    if (ext === "pdf") {
      const buf = await file.arrayBuffer();
      raw = await pdfToText(buf.slice(0));
      if (raw.replace(/\s+/g, "").length < 40) {
        // No usable text layer — scanned/image-exported PDF. OCR it.
        onProgress?.("No text layer found — running OCR (this takes a while)…");
        raw = await ocrPdf(buf, onProgress);
      }
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
      "No readable text could be recovered from that file — even with OCR. " +
        "If it's a low-quality scan, try the original document or paste the text manually."
    );
  }
  return text;
}
