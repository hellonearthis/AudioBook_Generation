"use strict";

// =========================================================================
// TEXT SANITIZER & CHAPTER EXTRACTION ENGINE
// =========================================================================
// WHAT: Normalizes book manuscript prose, corrects typographic artifacts,
//       and detects chapter / scene boundaries.
// WHY: Ingesting raw prose from PDFs, ePubs, or OCR introduces curved quotes,
//       soft line breaks, footnote numbers, and broken em-dashes that degrade
//       LLM dialogue attribution and TTS pronunciation.

/**
 * Cleans and sanitizes book prose for attribution and TTS engines.
 *
 * @param {string} raw_text Raw book manuscript string
 * @param {object} options Cleaning flags
 * @returns {string} Cleaned, normalized manuscript text
 */
function sanitize_book_manuscript_text(raw_text = "", options = {}) {
  if (!raw_text || typeof raw_text !== "string") {
    return "";
  }

  let cleaned = raw_text;

  // 1. Normalize line endings
  cleaned = cleaned.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 2. Normalize smart / curled quotation marks and apostrophes
  cleaned = cleaned
    .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB]/g, '"') // Curly double quotes to straight "
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")             // Curly single quotes / apostrophes to straight '
    .replace(/`|´/g, "'");

  // 3. Normalize em-dashes, en-dashes, and horizontal bars
  cleaned = cleaned
    .replace(/--{1,3}/g, "—")
    .replace(/[\u2013\u2014\u2015]/g, "—");

  // 4. Normalize ellipses
  cleaned = cleaned.replace(/\u2026/g, "...").replace(/\.{4,}/g, "...");

  // 5. Strip bracketed footnote citations (e.g. "[1]", "[14]", "[note 2]")
  cleaned = cleaned.replace(/\[\s*(?:\d+|note\s*\d+)\s*\]/gi, "");

  // 6. Fix soft line breaks (wrap lines that break mid-sentence)
  // If a line does NOT end in punctuation (. ! ? " ' — … : ;) and the next line begins with a lowercase letter or continuation
  if (options.fix_soft_line_breaks !== false) {
    cleaned = cleaned.replace(/([^\n.!?":;—…])\n([a-z0-9"'])/gi, "$1 $2");
  }

  // 7. Strip trailing spaces per line and collapse 3+ empty lines to 2
  cleaned = cleaned
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // 8. Optional British dialogue quote normalization
  if (options.normalize_british_quotes === true) {
    cleaned = normalize_british_dialogue_quotes(cleaned);
  }

  return cleaned;
}

/**
 * Normalizes British literary dialogue convention (single quotes '...') to standard double quotes ("..."),
 * while preserving internal contractions (don't, it's, Gurgeh's) and possessives.
 *
 * @param {string} text Raw manuscript text
 * @returns {string} Text with normalized dialogue quotes
 */
function normalize_british_dialogue_quotes(text = "") {
  if (!text || typeof text !== "string") {
    return "";
  }
  const APOSTROPHE_PLACEHOLDER = "___APOSTROPHE___";
  // Protect intra-word apostrophes (e.g. don't, it's, Yay's)
  let protected_text = text.replace(/([a-zA-Z])'([a-zA-Z])/g, `$1${APOSTROPHE_PLACEHOLDER}$2`);
  // Protect common leading colloquial apostrophes ('em, 'cause, 'til)
  protected_text = protected_text.replace(/'(em|cause|til|round|bout)\b/gi, `${APOSTROPHE_PLACEHOLDER}$1`);
  // Convert dialogue quotes: preceded by line start, whitespace, em-dash, bracket/paren
  // and ending with line end, whitespace, em-dash, bracket/paren or punctuation
  protected_text = protected_text.replace(/(^|[\s—(\[{])'([^'\n]+)'(?=[\s—)\]}.,;:!?]|$)/g, '$1"$2"');
  // Restore protected intra-word apostrophes
  return protected_text.replace(new RegExp(APOSTROPHE_PLACEHOLDER, "g"), "'");
}

/**
 * Automatically detects chapter and section boundaries in book text.
 *
 * @param {string} text Sanitized book text
 * @returns {Array<object>} Array of discovered chapters with title and character ranges
 */
function detect_manuscript_chapters(text = "") {
  if (!text || typeof text !== "string") {
    return [];
  }

  const lines = text.split("\n");
  const discovered_chapters = [];

  // Patterns for standard book chapter headings
  const chapter_regex = /^(?:#+\s*)?(?:(chapter|act|part|prologue|epilogue|scene|book)\b(?:\s+([0-9ivxlcdm]+|[a-z]+))?(?:\s*[:\-—]\s*(.*))?)$/i;

  let current_chapter = null;
  let accumulated_lines = [];

  for (let line_idx = 0; line_idx < lines.length; line_idx++) {
    const line = lines[line_idx].trim();
    const match = chapter_regex.exec(line);

    if (match && line.length < 80) {
      if (current_chapter) {
        current_chapter.text = accumulated_lines.join("\n").trim();
        current_chapter.word_count = current_chapter.text.split(/\s+/).filter(Boolean).length;
        discovered_chapters.push(current_chapter);
      }

      const chapter_type = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
      const chapter_num = match[2] || "";
      const chapter_subtitle = match[3] || "";
      const chapter_title = [chapter_type, chapter_num, chapter_subtitle ? `— ${chapter_subtitle}` : ""].filter(Boolean).join(" ");

      current_chapter = {
        index: discovered_chapters.length + 1,
        title: chapter_title,
        heading_line: line,
        text: "",
        word_count: 0
      };
      accumulated_lines = [];
    } else {
      accumulated_lines.push(lines[line_idx]);
    }
  }

  if (current_chapter) {
    current_chapter.text = accumulated_lines.join("\n").trim();
    current_chapter.word_count = current_chapter.text.split(/\s+/).filter(Boolean).length;
    discovered_chapters.push(current_chapter);
  }

  // Fallback: If no chapters found, treat entire manuscript as Chapter 1
  if (discovered_chapters.length === 0 && text.trim().length > 0) {
    discovered_chapters.push({
      index: 1,
      title: "Chapter 1 (Full Manuscript)",
      heading_line: "Chapter 1",
      text: text.trim(),
      word_count: text.split(/\s+/).filter(Boolean).length
    });
  }

  return discovered_chapters;
}

module.exports = {
  sanitize_book_manuscript_text,
  detect_manuscript_chapters,
  normalize_british_dialogue_quotes
};
