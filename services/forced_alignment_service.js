// =========================================================================
// PURE FUNCTIONAL FORCED ALIGNMENT & WORD-LEVEL TIMESTAMP SERVICE
// =========================================================================
// WHAT: Derives word-level time intervals, WebVTT subtitle tracks, and EPUB3 SMIL
//       Media Overlays from synthesized speech takes.
// WHY: Word-level timestamps enable read-along synchronized text (EPUB3 media overlays),
//      precise waveform scrubbing, pause calibration at word boundaries, and automated
//      leading/trailing silence trimming.

/**
 * WHAT: Derives word-level timestamp intervals for a spoken dialogue line and take duration.
 * WHY: Provides deterministic word timing using syllabic and character weighting across the audio take.
 * 
 * @param {string} dialogue_text - Cleaned spoken text.
 * @param {number} total_audio_duration_seconds - Measured audio file duration.
 * @param {ReadonlyArray<{ word: string, timestamp_seconds: number }>} [stt_observed_tokens=null] - Optional observed STT tokens.
 * @returns {ReadonlyArray<{ readonly index: number, readonly word: string, readonly start_seconds: number, readonly end_seconds: number, readonly duration_seconds: number }>}
 */
function compute_word_level_timestamps(
  dialogue_text,
  total_audio_duration_seconds,
  stt_observed_tokens = null
) {
  const cleaned_words = (dialogue_text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (cleaned_words.length === 0 || !total_audio_duration_seconds || total_audio_duration_seconds <= 0) {
    return [];
  }

  // WHAT: If empirical STT token timestamps are provided, map directly.
  if (Array.isArray(stt_observed_tokens) && stt_observed_tokens.length === cleaned_words.length) {
    let current_start = 0.0;
    return Object.freeze(
      stt_observed_tokens.map((token, index) => {
        const token_end = Math.min(total_audio_duration_seconds, token.timestamp_seconds);
        const word_duration = Number((token_end - current_start).toFixed(3));
        const item = {
          index,
          word: token.word,
          start_seconds: Number(current_start.toFixed(3)),
          end_seconds: Number(token_end.toFixed(3)),
          duration_seconds: Math.max(0.05, word_duration)
        };
        current_start = token_end;
        return item;
      })
    );
  }

  // WHAT: Syllabic character-weighted acoustic duration model.
  // WHY: Words with more characters and punctuation pauses take proportionally longer to pronounce.
  const word_weights = cleaned_words.map(w => {
    let weight = w.length;
    // Add extra duration weight for trailing punctuation (commas, periods, question marks)
    if (/[,\-—;]$/.test(w)) weight += 3;
    if (/[.!?]$/.test(w)) weight += 5;
    return Math.max(2, weight);
  });

  const total_weight = word_weights.reduce((sum, w) => sum + w, 0);
  const time_per_weight_unit = total_audio_duration_seconds / total_weight;

  let current_time_accumulator = 0.0;
  const word_intervals = [];

  for (let idx = 0; idx < cleaned_words.length; idx++) {
    const raw_word = cleaned_words[idx];
    const duration = idx === cleaned_words.length - 1
      ? Math.max(0.05, Number((total_audio_duration_seconds - current_time_accumulator).toFixed(3)))
      : Number((word_weights[idx] * time_per_weight_unit).toFixed(3));

    const start_seconds = Number(current_time_accumulator.toFixed(3));
    const end_seconds = Number((start_seconds + duration).toFixed(3));

    word_intervals.push({
      index: idx,
      word: raw_word,
      start_seconds,
      end_seconds,
      duration_seconds: duration
    });

    current_time_accumulator += duration;
  }

  return Object.freeze(word_intervals);
}

/**
 * WHAT: Converts seconds to standard WebVTT / SRT timestamp format (HH:MM:SS.mmm).
 * 
 * @param {number} total_seconds 
 * @returns {string} Formatted timestamp string.
 */
function format_seconds_to_webvtt_timestamp(total_seconds) {
  const safe_seconds = Math.max(0, total_seconds || 0);
  const hours = Math.floor(safe_seconds / 3600);
  const minutes = Math.floor((safe_seconds % 3600) / 60);
  const seconds = Math.floor(safe_seconds % 60);
  const milliseconds = Math.floor((safe_seconds % 1) * 1000);

  const pad = (num, digits = 2) => String(num).padStart(digits, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(milliseconds, 3)}`;
}

/**
 * WHAT: Generates W3C WebVTT subtitle track cues for a collection of word timestamps.
 * 
 * @param {ReadonlyArray<{ word: string, start_seconds: number, end_seconds: number }>} word_intervals 
 * @param {number} [timeline_offset_seconds=0] 
 * @returns {string} WebVTT formatted cues.
 */
function export_webvtt_cues(word_intervals, timeline_offset_seconds = 0) {
  if (!Array.isArray(word_intervals) || word_intervals.length === 0) {
    return "WEBVTT\n\n";
  }

  const lines = ["WEBVTT", ""];

  for (let idx = 0; idx < word_intervals.length; idx++) {
    const item = word_intervals[idx];
    const cue_start = format_seconds_to_webvtt_timestamp(item.start_seconds + timeline_offset_seconds);
    const cue_end = format_seconds_to_webvtt_timestamp(item.end_seconds + timeline_offset_seconds);
    lines.push(`${idx + 1}`);
    lines.push(`${cue_start} --> ${cue_end}`);
    lines.push(item.word);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * WHAT: Generates an EPUB3 SMIL Media Overlays XML document for synchronized read-along audio.
 * WHY: Enables eBook readers (Apple Books, Thorium, Readium) to highlight text in sync with speech.
 * 
 * @param {Readonly<{
 *   chapter_id: string,
 *   xhtml_content_document_path: string,
 *   audio_file_relative_path: string,
 *   word_intervals: ReadonlyArray<{ word: string, start_seconds: number, end_seconds: number }>
 * }>} smil_payload 
 * @returns {string} XML formatted SMIL document.
 */
function export_epub3_smil_media_overlay(smil_payload) {
  const {
    chapter_id = "chapter1",
    xhtml_content_document_path = "chapter1.xhtml",
    audio_file_relative_path = "audio/chapter1.mp3",
    word_intervals = []
  } = smil_payload;

  const xml_lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">',
    `  <body id="${chapter_id}_overlay">`,
    `    <seq id="${chapter_id}_seq" epub:textref="${xhtml_content_document_path}">`
  ];

  for (let idx = 0; idx < word_intervals.length; idx++) {
    const item = word_intervals[idx];
    const word_id = `w_${idx + 1}`;
    xml_lines.push(
      `      <par id="par_${idx + 1}">`,
      `        <text src="${xhtml_content_document_path}#${word_id}"/>`,
      `        <audio src="${audio_file_relative_path}" clipBegin="${item.start_seconds}s" clipEnd="${item.end_seconds}s"/>`,
      `      </par>`
    );
  }

  xml_lines.push(
    "    </seq>",
    "  </body>",
    "</smil>\n"
  );

  return xml_lines.join("\n");
}

module.exports = {
  compute_word_level_timestamps,
  format_seconds_to_webvtt_timestamp,
  export_webvtt_cues,
  export_epub3_smil_media_overlay
};

