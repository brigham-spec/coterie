import "server-only";

import {
  MAX_UPLOAD_BYTES,
  normalizeExtractedText,
} from "@/lib/knowledge-docs";

// Server-side collateral ingestion (option B): an uploaded file becomes stored
// TEXT, never a binary. PDFs are parsed with unpdf (serverless-friendly, runs in
// the Node runtime on Vercel); plain-text/markdown files are decoded directly.
// The extracted text is normalized here so the caller stores clean, capped text.

export class KnowledgeExtractError extends Error {}

function isPdf(file: File): boolean {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

function isPlainText(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("text/") ||
    name.endsWith(".txt") ||
    name.endsWith(".md")
  );
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // Import lazily so the pdf parser is only loaded when a PDF is actually
  // uploaded (keeps it off other server paths).
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/**
 * Extract normalized text from an uploaded collateral file. Accepts PDF and
 * plain-text/markdown. Throws KnowledgeExtractError on empty, oversized,
 * unsupported, or unreadable input — callers surface the message via their
 * action state.
 */
export async function extractTextFromUpload(file: File): Promise<string> {
  if (file.size === 0)
    throw new KnowledgeExtractError("The file is empty.");
  if (file.size > MAX_UPLOAD_BYTES)
    throw new KnowledgeExtractError(
      "The file is too large (max 10 MB).",
    );

  const bytes = new Uint8Array(await file.arrayBuffer());

  let raw: string;
  if (isPdf(file)) {
    try {
      raw = await extractPdfText(bytes);
    } catch {
      throw new KnowledgeExtractError(
        "Couldn't read that PDF. Try exporting it again or paste the text instead.",
      );
    }
  } else if (isPlainText(file)) {
    raw = new TextDecoder().decode(bytes);
  } else {
    throw new KnowledgeExtractError(
      "Unsupported file type. Upload a PDF or text file, or paste the text.",
    );
  }

  const text = normalizeExtractedText(raw);
  if (text === "")
    throw new KnowledgeExtractError(
      "No text could be extracted from that file.",
    );
  return text;
}
