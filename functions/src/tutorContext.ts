/**
 * tutorContext — deterministic, unit-testable retrieval-grounding helpers for
 * the AI tutor.
 *
 * This is the SIMPLE in-function retrieval approach from the Phase 4 plan:
 * no external vector DB, no embeddings provider. We chunk lesson text, score
 * each chunk against the learner's question with a deterministic lexical
 * (keyword/TF-style) ranking, and select the most relevant chunks up to a
 * character budget. For small courses this degrades gracefully to "include
 * everything in order".
 *
 * NO firebase / network imports here on purpose — every function is pure so the
 * eval/regression harness can exercise the ranking with plain fixtures.
 */

/** A unit of lesson text to be ranked & selected. */
export interface LessonChunk {
  /** Lesson title (repeated as a heading on every chunk from that lesson). */
  title: string;
  /** Plain-text body of this chunk. */
  text: string;
  /** Stable ordering hint (module index * 1000 + lesson index, then chunk #). */
  order: number;
}

/** A lesson's raw fields, as stored in Firestore (all optional). */
export interface RawLesson {
  title?: string;
  content?: string;
  textContent?: string;
  transcript?: string;
  /** Text extracted from uploaded PDF/DOCX/deck files (conversion pipeline). */
  extractedText?: string;
}

/** Default chunk size in characters. Big enough to keep code/paragraphs whole. */
export const DEFAULT_CHUNK_CHARS = 1200;

/** English stop words excluded from lexical scoring (keeps ranking on content). */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "of",
  "to", "in", "on", "for", "with", "as", "by", "at", "from", "into", "is",
  "are", "was", "were", "be", "been", "being", "do", "does", "did", "have",
  "has", "had", "this", "that", "these", "those", "it", "its", "i", "you",
  "he", "she", "we", "they", "my", "your", "our", "their", "me", "us", "them",
  "what", "which", "who", "how", "why", "can", "could", "should", "would",
  "will", "shall", "may", "might", "about", "so", "not", "no", "yes", "up",
  "down", "out", "over", "under", "again", "more", "most", "some", "any",
  "all", "each", "than", "too", "very", "just", "also",
]);

/**
 * Tokenize text into lowercased word tokens, dropping stop words and very short
 * tokens. Deterministic: same input → same output, always.
 */
export function tokenize(text: string): string[] {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/** Flatten a lesson's stored text fields into a single body string. */
export function lessonBody(lesson: RawLesson): string {
  return [lesson.content, lesson.textContent, lesson.transcript, lesson.extractedText]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .join("\n\n")
    .trim();
}

/**
 * Split a lesson into chunks of ~chunkChars, preferring to break on blank-line
 * paragraph boundaries so code blocks / paragraphs stay intact. A lesson with
 * no usable body yields zero chunks.
 */
export function chunkLesson(
  lesson: RawLesson,
  baseOrder: number,
  chunkChars: number = DEFAULT_CHUNK_CHARS
): LessonChunk[] {
  const title = (lesson.title ?? "Untitled lesson").trim() || "Untitled lesson";
  const body = lessonBody(lesson);
  if (!body) return [];

  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: LessonChunk[] = [];
  let buf = "";

  const flush = () => {
    const text = buf.trim();
    if (text) {
      chunks.push({ title, text, order: baseOrder * 1000 + chunks.length });
    }
    buf = "";
  };

  for (const para of paragraphs) {
    // A single oversized paragraph is hard-split so no chunk blows the budget.
    if (para.length > chunkChars) {
      flush();
      for (let i = 0; i < para.length; i += chunkChars) {
        buf = para.slice(i, i + chunkChars);
        flush();
      }
      continue;
    }
    if (buf && buf.length + para.length + 2 > chunkChars) flush();
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  flush();
  return chunks;
}

/**
 * Score a chunk against the question's query tokens.
 *
 * Deterministic lexical score:
 *  - sum over distinct query tokens of (matches in chunk) — rewards coverage &
 *    repetition of relevant terms;
 *  - normalised by sqrt(chunk token count) so long chunks don't always win;
 *  - small bonus for a query token appearing in the lesson TITLE.
 */
export function scoreChunk(chunk: LessonChunk, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const bodyTokens = tokenize(chunk.text);
  if (bodyTokens.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const t of bodyTokens) counts.set(t, (counts.get(t) ?? 0) + 1);

  const titleTokens = new Set(tokenize(chunk.title));
  const distinctQuery = Array.from(new Set(queryTokens));

  let raw = 0;
  for (const qt of distinctQuery) {
    const c = counts.get(qt) ?? 0;
    if (c > 0) raw += c;
    if (titleTokens.has(qt)) raw += 1; // title-match bonus
  }
  return raw / Math.sqrt(bodyTokens.length);
}

export interface SelectOptions {
  /** Total character budget for the selected, joined context. */
  maxChars: number;
  /** Chunk size used when chunking lessons (default DEFAULT_CHUNK_CHARS). */
  chunkChars?: number;
}

/**
 * Rank lesson chunks against `question` and select the highest-scoring ones up
 * to the character budget, then RE-ORDER the selected chunks back into natural
 * course order so the model reads them coherently.
 *
 * Deterministic tie-break: higher score first, then lower `order` first.
 * If the question has no usable tokens (or nothing scores), falls back to the
 * first chunks in course order until the budget is hit — i.e. never worse than
 * the old "blind dump from the top".
 */
export function selectRelevantChunks(
  chunks: LessonChunk[],
  question: string,
  opts: SelectOptions
): LessonChunk[] {
  const maxChars = Math.max(0, opts.maxChars);
  if (maxChars === 0 || chunks.length === 0) return [];

  const queryTokens = tokenize(question);

  const scored = chunks.map((chunk) => ({ chunk, score: scoreChunk(chunk, queryTokens) }));
  const anyMatch = scored.some((s) => s.score > 0);

  const ranked = anyMatch
    ? [...scored].sort((a, b) =>
        b.score !== a.score ? b.score - a.score : a.chunk.order - b.chunk.order
      )
    : // No lexical signal: preserve natural course order (graceful fallback).
      [...scored].sort((a, b) => a.chunk.order - b.chunk.order);

  const picked: LessonChunk[] = [];
  let used = 0;
  for (const { chunk } of ranked) {
    const cost = chunk.text.length + chunk.title.length + 8; // heading overhead
    if (picked.length > 0 && used + cost > maxChars) continue;
    picked.push(chunk);
    used += cost;
    if (used >= maxChars) break;
  }

  // Re-order selected chunks into natural course order for coherent reading.
  picked.sort((a, b) => a.order - b.order);
  return picked;
}

/**
 * Render selected chunks into the grounding-context string. Consecutive chunks
 * from the same lesson are grouped under a single heading. Capped at maxChars.
 */
export function renderContext(chunks: LessonChunk[], maxChars: number): string {
  let out = "";
  let lastTitle: string | null = null;
  for (const chunk of chunks) {
    const heading = chunk.title !== lastTitle ? `\n## ${chunk.title}\n` : "\n";
    out += heading + chunk.text + "\n";
    lastTitle = chunk.title;
  }
  return out.trim().slice(0, maxChars);
}

/**
 * End-to-end helper: chunk a list of (already ordered) lessons, rank against the
 * question, select within budget, and render. Pure — the caller fetches lessons.
 */
export function buildGroundingContext(
  lessons: RawLesson[],
  question: string,
  opts: SelectOptions
): string {
  const chunks: LessonChunk[] = [];
  lessons.forEach((lesson, idx) => {
    chunks.push(...chunkLesson(lesson, idx, opts.chunkChars));
  });
  const selected = selectRelevantChunks(chunks, question, opts);
  return renderContext(selected, opts.maxChars);
}
