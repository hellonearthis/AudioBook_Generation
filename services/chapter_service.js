// =========================================================================
// PURE FUNCTIONAL MULTI-CHAPTER MANUSCRIPT & GLOBAL CAST SERVICE
// =========================================================================
// WHAT: Splits large novel manuscripts into discrete chapters while sharing and
//       preserving the global character cast, voice anchors, relationship states,
//       and pronunciation dictionaries across all chapters of the book.
// WHY: In production audiobooks, authors rarely record an entire novel in one pass.
//      Splitting a book into chapters keeps editing responsive, while sharing the
//      Voice Matrix ensures that characters discovered or locked in Chapter 1
//      remain identical and consistently attributed in Chapters 2 through 30.

/**
 * WHAT: Standard regular expression detecting chapter, act, and part headings in raw text.
 * WHY: Supports common authorial conventions (Markdown headings, numbered chapters, Roman numerals).
 */
const CHAPTER_HEADING_REGEX = /(?:^|\n)(?:#{1,3}\s*)?(?:CHAPTER|Chapter|ACT|Act|PART|Part)\s+([0-9IVXLCDM]+|[A-Za-z]+)(?::?\s*([^\n\r]*))?/g;

/**
 * WHAT: High-performance, non-allocating word counter for large manuscripts.
 * WHY: Avoids creating hundreds of thousands of ephemeral string objects via split(/\s+/),
 *      drastically reducing V8 heap churn and GC pauses when parsing 100k-word novels.
 * 
 * @param {string} text_content 
 * @returns {number} Word count.
 */
function count_words_in_text(text_content) {
  if (!text_content || typeof text_content !== "string") {
    return 0;
  }
  const non_whitespace_regex = /\S+/g;
  let word_counter = 0;
  while (non_whitespace_regex.exec(text_content) !== null) {
    word_counter++;
  }
  return word_counter;
}

/**
 * WHAT: Splits a continuous novel manuscript into discrete chapter records.
 * WHY: Breaks a 100,000-word book into manageable chapters for sequential processing.
 * 
 * @param {string} raw_manuscript_text 
 * @returns {ReadonlyArray<Object>} List of parsed chapter objects.
 */
function split_manuscript_into_chapters(raw_manuscript_text) {
  if (!raw_manuscript_text || typeof raw_manuscript_text !== "string") {
    return [];
  }

  const clean_text = raw_manuscript_text.trim();
  const matches = [...clean_text.matchAll(CHAPTER_HEADING_REGEX)];

  // WHAT: If no explicit chapter headings found, treat entire text as Chapter 1.
  if (matches.length === 0) {
    const single_chapter_word_count = count_words_in_text(clean_text);
    return Object.freeze([
      {
        chapter_id: "chapter_01",
        chapter_number: 1,
        chapter_title: "Chapter 1",
        raw_text: clean_text,
        word_count: single_chapter_word_count,
        character_count: clean_text.length,
        estimated_minutes: Number((single_chapter_word_count / 150.0).toFixed(1))
      }
    ]);
  }

  const chapters_list = [];

  // Handle prologue / text before first chapter heading
  if (matches[0].index > 0) {
    const prologue_text = clean_text.substring(0, matches[0].index).trim();
    if (prologue_text.length > 50) {
      const prologue_word_count = count_words_in_text(prologue_text);
      chapters_list.push({
        chapter_id: "chapter_00",
        chapter_number: 0,
        chapter_title: "Prologue",
        raw_text: prologue_text,
        word_count: prologue_word_count,
        character_count: prologue_text.length,
        estimated_minutes: Number((prologue_word_count / 150.0).toFixed(1))
      });
    }
  }

  for (let idx = 0; idx < matches.length; idx++) {
    const current_match = matches[idx];
    const chapter_number_string = current_match[1];
    const optional_subtitle = (current_match[2] || "").trim();
    const heading_full_text = current_match[0].trim();

    const start_offset = current_match.index + current_match[0].length;
    const end_offset = idx + 1 < matches.length ? matches[idx + 1].index : clean_text.length;

    const chapter_body_text = clean_text.substring(start_offset, end_offset).trim();
    const display_title = optional_subtitle
      ? `${heading_full_text.replace(/^[#\s]+/, "")}: ${optional_subtitle}`
      : heading_full_text.replace(/^[#\s]+/, "");

    const chapter_number = parseInt(chapter_number_string, 10) || (idx + 1);
    const pad_num = String(chapter_number).padStart(2, "0");
    const chapter_word_count = count_words_in_text(chapter_body_text);

    chapters_list.push({
      chapter_id: `chapter_${pad_num}`,
      chapter_number,
      chapter_title: display_title,
      raw_text: chapter_body_text,
      word_count: chapter_word_count,
      character_count: chapter_body_text.length,
      estimated_minutes: Number((chapter_word_count / 150.0).toFixed(1))
    });
  }

  return Object.freeze(chapters_list);
}

/**
 * WHAT: Initializes or upgrades a project state to multi-chapter architecture while strictly
 *       preserving the existing global character cast (voiceMapping), relationship timelines,
 *       and pronunciation dictionary.
 * 
 * @param {Readonly<Object>} current_project_state 
 * @param {string|ReadonlyArray<Object>} raw_text_or_chapters 
 * @returns {Readonly<Object>} Multi-chapter project state with preserved cast continuity.
 */
function upgrade_project_state_to_multichapter(current_project_state, raw_text_or_chapters) {
  const existing_voice_mapping = current_project_state.voiceMapping || {};
  const existing_relationships = current_project_state.relationships || [];
  const existing_pronunciation = current_project_state.pronunciationDictionary || {};
  const existing_calibration = current_project_state.calibrationProfiles || {};

  let chapters_list = [];
  if (Array.isArray(raw_text_or_chapters)) {
    chapters_list = raw_text_or_chapters;
  } else if (typeof raw_text_or_chapters === "string") {
    chapters_list = split_manuscript_into_chapters(raw_text_or_chapters);
  } else if (Array.isArray(current_project_state.chapters) && current_project_state.chapters.length > 0) {
    chapters_list = current_project_state.chapters;
  } else {
    // Default wrap existing single-text project into Chapter 1
    chapters_list = [
      {
        chapter_id: "chapter_01",
        chapter_number: 1,
        chapter_title: "Chapter 1",
        raw_text: current_project_state.rawBookText || "",
        scriptSegments: current_project_state.scriptSegments || [],
        directorialSegments: current_project_state.directorialSegments || [],
        word_count: count_words_in_text(current_project_state.rawBookText || "")
      }
    ];
  }

  const active_chapter_id = current_project_state.active_chapter_id || (chapters_list[0] ? chapters_list[0].chapter_id : "chapter_01");

  return Object.freeze({
    ...current_project_state,
    is_multi_chapter: true,
    active_chapter_id,
    chapters: Object.freeze(chapters_list),
    // WHAT: Global project assets shared across ALL chapters.
    // WHY: Characters created or locked in Chapter 1 are immediately inherited by Chapter 2.
    voiceMapping: Object.freeze({ ...existing_voice_mapping }),
    relationships: Object.freeze([...existing_relationships]),
    pronunciationDictionary: Object.freeze({ ...existing_pronunciation }),
    calibrationProfiles: Object.freeze({ ...existing_calibration })
  });
}

/**
 * WHAT: Switches the active chapter in the editor while keeping the global cast roster active.
 * 
 * @param {Readonly<Object>} project_state 
 * @param {string} target_chapter_id 
 * @returns {Readonly<Object>} Updated project state with target chapter active.
 */
function switch_active_chapter(project_state, target_chapter_id) {
  if (!project_state || !Array.isArray(project_state.chapters)) {
    return project_state;
  }

  const matched_chapter = project_state.chapters.find(c => c.chapter_id === target_chapter_id);
  if (!matched_chapter) {
    return project_state;
  }

  return Object.freeze({
    ...project_state,
    active_chapter_id: target_chapter_id,
    rawBookText: matched_chapter.raw_text || "",
    scriptSegments: matched_chapter.scriptSegments || [],
    directorialSegments: matched_chapter.directorialSegments || []
  });
}

/**
 * WHAT: Saves updated screenplay segments and text for a specific chapter back into the project.
 * WHY: Ensures that editing Chapter 2 flushes Chapter 2 data without touching Chapter 1 or the shared cast.
 * 
 * @param {Readonly<Object>} project_state 
 * @param {string} chapter_id 
 * @param {ReadonlyArray<Object>} updated_script_segments 
 * @param {string} [updated_raw_text] 
 * @returns {Readonly<Object>} Updated project state.
 */
function save_chapter_segments_to_project(
  project_state,
  chapter_id,
  updated_script_segments,
  updated_raw_text = null
) {
  if (!project_state || !Array.isArray(project_state.chapters)) {
    return {
      ...project_state,
      scriptSegments: updated_script_segments,
      rawBookText: updated_raw_text !== null ? updated_raw_text : project_state.rawBookText
    };
  }

  const updated_chapters = project_state.chapters.map(chapter => {
    if (chapter.chapter_id === chapter_id) {
      return {
        ...chapter,
        scriptSegments: updated_script_segments,
        raw_text: updated_raw_text !== null ? updated_raw_text : chapter.raw_text,
        word_count: updated_raw_text !== null ? count_words_in_text(updated_raw_text) : chapter.word_count
      };
    }
    return chapter;
  });

  return Object.freeze({
    ...project_state,
    chapters: Object.freeze(updated_chapters),
    scriptSegments: project_state.active_chapter_id === chapter_id ? updated_script_segments : project_state.scriptSegments,
    rawBookText: project_state.active_chapter_id === chapter_id && updated_raw_text !== null ? updated_raw_text : project_state.rawBookText
  });
}

/**
 * WHAT: Merges all chapter script segments into a continuous master timeline for full-book assembly.
 * 
 * @param {Readonly<Object>} project_state 
 * @returns {ReadonlyArray<Object>} Continuous array of segments across all chapters with chapter titles.
 */
function compile_master_book_timeline_segments(project_state) {
  if (!project_state || !Array.isArray(project_state.chapters)) {
    return project_state.scriptSegments || [];
  }

  const aggregated_master_segments = [];
  let global_index_counter = 0;

  for (const chapter of project_state.chapters) {
    const chapter_segments = chapter.scriptSegments || [];
    for (let idx = 0; idx < chapter_segments.length; idx++) {
      const segment = chapter_segments[idx];
      aggregated_master_segments.push({
        ...segment,
        global_segment_index: global_index_counter,
        chapter_id: chapter.chapter_id,
        chapter_title: chapter.chapter_title,
        is_chapter_start: idx === 0
      });
      global_index_counter++;
    }
  }

  return Object.freeze(aggregated_master_segments);
}

/**
 * WHAT: Registers multi-chapter manuscript IPC handlers on the Electron main process.
 * WHY: Bridges front-end renderer requests across the context isolation barrier to manipulate
 *      chapter structures, active chapter transitions, and timeline compilation.
 * 
 * @param {Object} ipcMain - Electron IPC main dispatcher.
 */
function register_chapter_handlers(ipcMain) {
  if (!ipcMain || typeof ipcMain.handle !== "function") {
    return;
  }

  // WHAT: Splits raw book manuscript into discrete chapter records while preserving global cast.
  ipcMain.handle("chapter:split-manuscript", async (ipc_event_context, request_arguments) => {
    const raw_manuscript_text = (request_arguments && request_arguments.raw_manuscript_text) || "";
    const extracted_chapters_list = split_manuscript_into_chapters(raw_manuscript_text);
    return { success: true, chapters: extracted_chapters_list };
  });

  // WHAT: Upgrades existing single-chapter project state to multi-chapter while preserving global cast.
  ipcMain.handle("chapter:upgrade-project-state", async (ipc_event_context, request_arguments) => {
    const { current_project_state, raw_text_or_chapters } = request_arguments || {};
    const upgraded_project_state = upgrade_project_state_to_multichapter(current_project_state, raw_text_or_chapters);
    return { success: true, project_state: upgraded_project_state };
  });

  // WHAT: Switches active editor chapter while retaining global cast.
  ipcMain.handle("chapter:switch-active-chapter", async (ipc_event_context, request_arguments) => {
    const { project_state, target_chapter_id } = request_arguments || {};
    const updated_project_state = switch_active_chapter(project_state, target_chapter_id);
    return { success: true, project_state: updated_project_state };
  });

  // WHAT: Saves segments and text for a specific chapter back into project state.
  ipcMain.handle("chapter:save-chapter-segments", async (ipc_event_context, request_arguments) => {
    const { project_state, chapter_id, updated_script_segments, updated_raw_text } = request_arguments || {};
    const updated_project_state = save_chapter_segments_to_project(
      project_state,
      chapter_id,
      updated_script_segments,
      updated_raw_text
    );
    return { success: true, project_state: updated_project_state };
  });

  // WHAT: Compiles continuous master timeline segments across all chapters for full-book export.
  ipcMain.handle("chapter:compile-master-timeline", async (ipc_event_context, request_arguments) => {
    const { project_state } = request_arguments || {};
    const master_timeline_segments_list = compile_master_book_timeline_segments(project_state);
    return { success: true, master_segments: master_timeline_segments_list };
  });
}

module.exports = {
  CHAPTER_HEADING_REGEX,
  count_words_in_text,
  split_manuscript_into_chapters,
  upgrade_project_state_to_multichapter,
  switch_active_chapter,
  save_chapter_segments_to_project,
  compile_master_book_timeline_segments,
  register_chapter_handlers
};

