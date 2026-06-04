/**
 * parseAssessmentDoc — Callable Cloud Function
 *
 * Parses a DOCX file (base64-encoded) into structured quiz questions for
 * admin review before saving. Requires admin role claim. Does NOT write to
 * Firestore — the client reviews returned questions and saves via QuizEditor.
 *
 * ── Expected DOCX text format ───────────────────────────────────────────────
 *
 *   Q1. What is the capital of France?
 *   A) Paris / B) London / C) Berlin / D) Madrid
 *   Answer: A
 *
 *   Q2. Is the sky blue?
 *   A) True / B) False
 *   Answer: A
 *
 * Rules:
 *   - Question line: starts with Q<n>. or Q<n>)  (case-insensitive, number optional)
 *   - Options line: 2–6 options separated by "/" or on separate lines.
 *     Supported prefixes: A) A. a) a. (A) — letters only.
 *   - Answer line: "Answer: B" or "Ans: B" (case-insensitive). Value must be
 *     a letter matching one of the option prefixes, OR "True"/"False".
 *   - True/False questions: detected when EXACTLY two options are "True" and "False"
 *     (case-insensitive), OR when the answer line value is "True" or "False".
 *   - Blocks are separated by one or more blank lines.
 *   - Malformed blocks (missing prompt, missing answer, unrecognised answer letter,
 *     fewer than 2 options, more than 6 options) are skipped and a warning is added.
 *
 * ── Limitations ─────────────────────────────────────────────────────────────
 *   - Only .docx files are supported. Legacy .doc is NOT supported by mammoth.
 *     If the admin has a .doc file they must open it in Word/LibreOffice and
 *     "Save As → .docx" before importing.
 *   - Maximum decoded payload: 5 MB.
 *
 * ── Returns ──────────────────────────────────────────────────────────────────
 *   { questions: ParsedQuestion[], warnings: string[] }
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as mammoth from "mammoth";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export interface ParsedQuestion {
  prompt: string;
  type: "mcq" | "tf";
  options: string[];
  correctIndex: number;
}

interface ParseAssessmentDocRequest {
  fileBase64: string;
  fileName: string;
}

interface ParseAssessmentDocResponse {
  questions: ParsedQuestion[];
  warnings: string[];
}

// ── Text parser ───────────────────────────────────────────────────────────────

/** Strip leading option prefix like "A)", "A.", "a)", "(A)" from an option string. */
function stripOptionPrefix(s: string): string {
  return s.replace(/^\(?[a-zA-Z]\)?[.)]\s*/, "").trim();
}

/** Return the 0-based index of the option letter (A=0, B=1, …). */
function letterToIndex(letter: string): number {
  return letter.toUpperCase().charCodeAt(0) - 65;
}

/**
 * Split an options line into individual option texts.
 * Supports slash-separated "A) Paris / B) London" or individual lines
 * that start with an option prefix.
 */
function splitOptions(line: string): string[] {
  // Try splitting on " / " or " | " first
  const parts = line
    .split(/\s*\/\s*|\s*\|\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return parts.map(stripOptionPrefix).filter(Boolean);
  }

  // Fallback: split on letter prefixes
  const matches = [...line.matchAll(/\(?[a-zA-Z]\)?[.)]\s*([^A-Za-z(][^\/(]*)/g)];
  if (matches.length >= 2) {
    return matches.map((m) => m[1].trim()).filter(Boolean);
  }

  return [];
}

/** Return true if line starts with a recognised option prefix (A), B., a), etc.) */
function looksLikeOptionLine(line: string): boolean {
  return /^\(?[a-zA-Z]\)?[.)]\s+\S/.test(line);
}

/** Return true if line is an Answer/Ans line. */
function looksLikeAnswerLine(line: string): boolean {
  return /^(answer|ans)\s*:/i.test(line.trim());
}

/** Parse the raw extracted text into question blocks. */
function parseText(
  text: string
): { questions: ParsedQuestion[]; warnings: string[] } {
  const questions: ParsedQuestion[] = [];
  const warnings: string[] = [];

  // Split into blocks separated by one or more blank lines
  const rawBlocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  // Re-join consecutive non-blank lines that are part of the same Q block.
  // A block is everything from a Q<n>. line until the next blank-line-separated chunk.
  for (let bi = 0; bi < rawBlocks.length; bi++) {
    const lines = rawBlocks[bi]
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    // Find prompt line
    const promptLineIdx = lines.findIndex((l) =>
      /^Q\s*\d*[.)]\s+\S/.test(l) || /^Q\s*\d+\s+\S/.test(l)
    );

    if (promptLineIdx === -1) {
      // Not a question block — skip silently
      continue;
    }

    const blockLabel = `Block ${bi + 1}`;

    // Prompt: everything from the Q line, stripping the Q<n>. prefix
    const promptRaw = lines[promptLineIdx]
      .replace(/^Q\s*\d*[.)]\s*/i, "")
      .trim();
    if (!promptRaw) {
      warnings.push(`${blockLabel}: empty question prompt — skipped.`);
      continue;
    }

    // Collect remaining lines after the prompt line
    const restLines = lines.slice(promptLineIdx + 1);

    // Gather option lines and answer line
    let rawOptions: string[] = [];
    let answerLetter: string | null = null;
    let answerRaw: string | null = null;

    for (const line of restLines) {
      if (looksLikeAnswerLine(line)) {
        answerRaw = line.replace(/^(answer|ans)\s*:\s*/i, "").trim();
        break;
      }
      if (looksLikeOptionLine(line)) {
        rawOptions.push(line);
      } else if (rawOptions.length === 0) {
        // Could be an inline options line like "A) Paris / B) London / C) Berlin"
        const split = splitOptions(line);
        if (split.length >= 2) {
          rawOptions = split.map((_, i) => {
            const letter = String.fromCharCode(65 + i);
            return `${letter}) ${split[i]}`;
          });
        }
        // else: ignore the line (continuation of prompt, etc.)
      }
    }

    // If no separate options lines found, try inline on the same block text
    if (rawOptions.length === 0) {
      const inlineIdx = restLines.findIndex((l) => {
        const sp = splitOptions(l);
        return sp.length >= 2;
      });
      if (inlineIdx !== -1) {
        const split = splitOptions(restLines[inlineIdx]);
        rawOptions = split.map((txt, i) => {
          const letter = String.fromCharCode(65 + i);
          return `${letter}) ${txt}`;
        });
      }
    }

    if (!answerRaw) {
      warnings.push(`${blockLabel} ("${promptRaw.slice(0, 40)}"): no Answer line found — skipped.`);
      continue;
    }

    // Parse options
    let optionTexts: string[];
    if (rawOptions.length >= 2) {
      optionTexts = rawOptions.map(stripOptionPrefix).filter(Boolean);
    } else {
      // Possibly all on one "A) ... / B) ..." line not yet caught
      optionTexts = [];
    }

    // Detect True/False question
    const isTrueFalse =
      optionTexts.length === 0 ||
      (optionTexts.length === 2 &&
        optionTexts[0].toLowerCase() === "true" &&
        optionTexts[1].toLowerCase() === "false") ||
      /^(true|false)$/i.test(answerRaw);

    if (isTrueFalse) {
      // Normalise TF options
      optionTexts = ["True", "False"];
      const correctTF = answerRaw.trim().toLowerCase();
      if (correctTF !== "true" && correctTF !== "false" && !/^[ab]$/i.test(correctTF)) {
        warnings.push(
          `${blockLabel} ("${promptRaw.slice(0, 40)}"): invalid True/False answer "${answerRaw}" — skipped.`
        );
        continue;
      }
      let correctIndex: number;
      if (/^(true|a)$/i.test(correctTF)) {
        correctIndex = 0;
      } else {
        correctIndex = 1;
      }
      questions.push({
        prompt: promptRaw,
        type: "tf",
        options: optionTexts,
        correctIndex,
      });
      continue;
    }

    if (optionTexts.length < 2) {
      warnings.push(
        `${blockLabel} ("${promptRaw.slice(0, 40)}"): fewer than 2 options found — skipped.`
      );
      continue;
    }
    if (optionTexts.length > 6) {
      warnings.push(
        `${blockLabel} ("${promptRaw.slice(0, 40)}"): more than 6 options found — skipped.`
      );
      continue;
    }

    // Resolve answer letter → index
    const answerTrimmed = answerRaw.trim();
    if (/^[a-zA-Z]$/.test(answerTrimmed)) {
      answerLetter = answerTrimmed.toUpperCase();
    } else {
      warnings.push(
        `${blockLabel} ("${promptRaw.slice(0, 40)}"): unrecognised answer "${answerRaw}" (expected a single letter like A, B, C…) — skipped.`
      );
      continue;
    }

    const correctIndex = letterToIndex(answerLetter);
    if (correctIndex < 0 || correctIndex >= optionTexts.length) {
      warnings.push(
        `${blockLabel} ("${promptRaw.slice(0, 40)}"): answer "${answerLetter}" out of range (only ${optionTexts.length} options) — skipped.`
      );
      continue;
    }

    questions.push({
      prompt: promptRaw,
      type: "mcq",
      options: optionTexts,
      correctIndex,
    });
  }

  return { questions, warnings };
}

// ── Cloud Function ────────────────────────────────────────────────────────────

export const parseAssessmentDoc = onCall<ParseAssessmentDocRequest>(
  { region: "us-central1", enforceAppCheck: process.env.ENFORCE_APPCHECK === "true" },
  async (request): Promise<ParseAssessmentDocResponse> => {
    // Must be authenticated
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "You must be signed in to use this feature."
      );
    }

    // Must have admin role claim
    const role = request.auth.token?.role as string | undefined;
    if (role !== "admin") {
      throw new HttpsError(
        "permission-denied",
        "Only admins can import assessment documents."
      );
    }

    const { fileBase64, fileName } = request.data;

    if (!fileBase64 || typeof fileBase64 !== "string") {
      throw new HttpsError("invalid-argument", "fileBase64 is required.");
    }
    if (!fileName || typeof fileName !== "string") {
      throw new HttpsError("invalid-argument", "fileName is required.");
    }

    // Only .docx is supported (mammoth does not support legacy binary .doc)
    if (!fileName.toLowerCase().endsWith(".docx")) {
      throw new HttpsError(
        "invalid-argument",
        fileName.toLowerCase().endsWith(".doc")
          ? "Legacy .doc format is not supported. Please open the file in Word or LibreOffice and save it as .docx, then try again."
          : "Only .docx files are supported."
      );
    }

    // Decode base64 and enforce size limit
    let buffer: Buffer;
    try {
      buffer = Buffer.from(fileBase64, "base64");
    } catch {
      throw new HttpsError("invalid-argument", "Invalid base64 encoding.");
    }

    if (buffer.byteLength > MAX_BYTES) {
      throw new HttpsError(
        "invalid-argument",
        `File is too large (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 5 MB.`
      );
    }

    // Extract plain text via mammoth
    let rawText: string;
    try {
      const result = await mammoth.extractRawText({ buffer });
      rawText = result.value;
    } catch (err: unknown) {
      throw new HttpsError(
        "internal",
        `Failed to read DOCX file: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!rawText.trim()) {
      throw new HttpsError(
        "invalid-argument",
        "The document appears to be empty or contains no readable text."
      );
    }

    // Parse questions
    const { questions, warnings } = parseText(rawText);

    if (questions.length === 0) {
      warnings.push(
        "No valid questions were found. Make sure your document follows the expected format: " +
          "Q1. Question text / A) Option / B) Option / Answer: A"
      );
    }

    return { questions, warnings };
  }
);
