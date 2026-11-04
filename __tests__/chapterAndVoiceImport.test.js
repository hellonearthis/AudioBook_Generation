// =========================================================================
// UNIT TESTS: MULTI-CHAPTER MANUSCRIPT & DIRECT VOICE IMPORT WITH TUNING
// =========================================================================
// WHAT: Verifies multi-chapter manuscript splitting, continuous global cast persistence,
//       chapter switching, timeline compilation, direct audio voice import (skipping 100% synthetic generation),
//       and standardized phonetic calibration tuning.
// WHY: Ensures novelists and audio producers can divide 100,000-word books across chapters
//       without losing cast continuity, and import real voice clips for immediate clone tuning.

const {
  split_manuscript_into_chapters,
  upgrade_project_state_to_multichapter,
  switch_active_chapter,
  save_chapter_segments_to_project,
  compile_master_book_timeline_segments
} = require("../services/chapter_service");

const {
  PHONETIC_TUNING_SENTENCES,
  standardize_character_identifier,
  create_imported_character_voice_record,
  create_phonetic_tuning_task_payload,
  evaluate_phonetic_tuning_take
} = require("../services/voice_import_service");

describe("Multi-Chapter Manuscript & Shared Global Cast Service", () => {
  const sample_raw_manuscript = `
Before the beginning, there was only the hum of the cooling fans in the subterranean relay room.

CHAPTER 1: The Signal
The transmission arrived at midnight. Elena stepped up to the terminal and scanned the readout.
"Are we receiving telemetry from Sector Four?" she asked quietly.
Mark looked up from his console. "Nothing yet, Commander."

CHAPTER 2: Deep Transit
Three days later, the carrier had crossed into uncharted coordinates.
Elena called Mark to the bridge. "We are changing course immediately."
  `.trim();

  test("split_manuscript_into_chapters parses Prologue and numbered chapters accurately", () => {
    const chapters = split_manuscript_into_chapters(sample_raw_manuscript);
    expect(chapters.length).toBe(3);

    // Prologue
    expect(chapters[0].chapter_id).toBe("chapter_00");
    expect(chapters[0].chapter_title).toBe("Prologue");
    expect(chapters[0].raw_text).toContain("subterranean relay room");

    // Chapter 1
    expect(chapters[1].chapter_id).toBe("chapter_01");
    expect(chapters[1].chapter_title).toContain("CHAPTER 1: The Signal");
    expect(chapters[1].raw_text).toContain("Elena stepped up to the terminal");
    expect(chapters[1].word_count).toBeGreaterThan(10);
    expect(chapters[1].estimated_minutes).toBeGreaterThanOrEqual(0.1);

    // Chapter 2
    expect(chapters[2].chapter_id).toBe("chapter_02");
    expect(chapters[2].chapter_title).toContain("CHAPTER 2: Deep Transit");
    expect(chapters[2].raw_text).toContain("Three days later");
  });

  test("split_manuscript_into_chapters falls back safely to single chapter for unformatted prose", () => {
    const unformatted_prose = "It was the best of times, it was the worst of times. A story without headings.";
    const chapters = split_manuscript_into_chapters(unformatted_prose);
    expect(chapters.length).toBe(1);
    expect(chapters[0].chapter_id).toBe("chapter_01");
    expect(chapters[0].raw_text).toBe(unformatted_prose);
  });

  test("upgrade_project_state_to_multichapter preserves global voiceMapping and relationships", () => {
    const initial_project_state = {
      projectName: "Orbit_Novel",
      rawBookText: sample_raw_manuscript,
      scriptSegments: [{ id: "seg_1", speaker: "Elena", text: "Test line 1" }],
      // Cast established in Chapter 1
      voiceMapping: {
        "Elena": { character_name: "Elena", is_locked: true, voice: { description: "Calm commander" } },
        "Mark": { character_name: "Mark", is_locked: true, voice: { description: "Nervous technician" } }
      },
      relationships: [
        { characters: ["Elena", "Mark"], dynamic: "hierarchical_respect", current_tension: 0.2 }
      ],
      pronunciationDictionary: { "telemetry": "te-LEM-e-tree" },
      calibrationProfiles: { "elena": { capped_maximum_band_by_emotion: { anger: 3 } } }
    };

    const multi_chapter_project = upgrade_project_state_to_multichapter(
      initial_project_state,
      sample_raw_manuscript
    );

    expect(multi_chapter_project.is_multi_chapter).toBe(true);
    expect(multi_chapter_project.chapters.length).toBe(3);
    expect(multi_chapter_project.active_chapter_id).toBe("chapter_00");

    // CRITICAL: Global cast must be strictly preserved across all chapters
    expect(multi_chapter_project.voiceMapping["Elena"]).toBeDefined();
    expect(multi_chapter_project.voiceMapping["Elena"].is_locked).toBe(true);
    expect(multi_chapter_project.voiceMapping["Mark"]).toBeDefined();
    expect(multi_chapter_project.relationships[0].dynamic).toBe("hierarchical_respect");
    expect(multi_chapter_project.pronunciationDictionary["telemetry"]).toBe("te-LEM-e-tree");
    expect(multi_chapter_project.calibrationProfiles["elena"]).toBeDefined();
  });

  test("switch_active_chapter changes active chapter and segments while preserving global cast", () => {
    const multi_chapter_project = {
      projectName: "Orbit_Novel",
      active_chapter_id: "chapter_01",
      chapters: [
        {
          chapter_id: "chapter_01",
          raw_text: "Chapter 1 text",
          scriptSegments: [{ id: "c1_s1", speaker: "Elena", text: "Are we receiving telemetry?" }]
        },
        {
          chapter_id: "chapter_02",
          raw_text: "Chapter 2 text",
          scriptSegments: [{ id: "c2_s1", speaker: "Mark", text: "Course plotted, Commander." }]
        }
      ],
      voiceMapping: {
        "Elena": { is_locked: true },
        "Mark": { is_locked: true }
      }
    };

    const switched_project = switch_active_chapter(multi_chapter_project, "chapter_02");

    expect(switched_project.active_chapter_id).toBe("chapter_02");
    expect(switched_project.rawBookText).toBe("Chapter 2 text");
    expect(switched_project.scriptSegments[0].speaker).toBe("Mark");
    // Global cast is still intact
    expect(switched_project.voiceMapping["Elena"].is_locked).toBe(true);
  });

  test("save_chapter_segments_to_project updates only target chapter without corrupting others", () => {
    const multi_chapter_project = {
      projectName: "Orbit_Novel",
      active_chapter_id: "chapter_01",
      chapters: [
        { chapter_id: "chapter_01", scriptSegments: [{ id: "c1_1", text: "Original C1" }] },
        { chapter_id: "chapter_02", scriptSegments: [{ id: "c2_1", text: "Original C2" }] }
      ],
      voiceMapping: { "Elena": { is_locked: true } }
    };

    const updated_segments_c2 = [
      { id: "c2_1", text: "Edited line 1" },
      { id: "c2_2", text: "New line 2" }
    ];

    const saved_project = save_chapter_segments_to_project(
      multi_chapter_project,
      "chapter_02",
      updated_segments_c2,
      "Updated C2 raw text"
    );

    const ch2 = saved_project.chapters.find(c => c.chapter_id === "chapter_02");
    const ch1 = saved_project.chapters.find(c => c.chapter_id === "chapter_01");

    expect(ch2.scriptSegments.length).toBe(2);
    expect(ch2.scriptSegments[1].text).toBe("New line 2");
    expect(ch2.raw_text).toBe("Updated C2 raw text");
    // Chapter 1 is untouched
    expect(ch1.scriptSegments[0].text).toBe("Original C1");
    // Voice mapping remains intact
    expect(saved_project.voiceMapping["Elena"].is_locked).toBe(true);
  });

  test("compile_master_book_timeline_segments aggregates all chapter segments with global indexes", () => {
    const multi_chapter_project = {
      chapters: [
        {
          chapter_id: "chapter_01",
          chapter_title: "Chapter 1",
          scriptSegments: [
            { id: "c1_s1", speaker: "Narrator", text: "It began at dawn." },
            { id: "c1_s2", speaker: "Elena", text: "All systems green." }
          ]
        },
        {
          chapter_id: "chapter_02",
          chapter_title: "Chapter 2",
          scriptSegments: [
            { id: "c2_s1", speaker: "Mark", text: "Entering the asteroid belt." }
          ]
        }
      ]
    };

    const master_timeline = compile_master_book_timeline_segments(multi_chapter_project);

    expect(master_timeline.length).toBe(3);
    expect(master_timeline[0].global_segment_index).toBe(0);
    expect(master_timeline[0].chapter_id).toBe("chapter_01");
    expect(master_timeline[0].is_chapter_start).toBe(true);

    expect(master_timeline[1].global_segment_index).toBe(1);
    expect(master_timeline[1].chapter_id).toBe("chapter_01");
    expect(master_timeline[1].is_chapter_start).toBe(false);

    expect(master_timeline[2].global_segment_index).toBe(2);
    expect(master_timeline[2].chapter_id).toBe("chapter_02");
    expect(master_timeline[2].is_chapter_start).toBe(true);
  });
});

describe("Direct Audio Voice Import & Phonetic Tuning Service", () => {
  test("standardize_character_identifier cleanses names for filesystem and model tags", () => {
    expect(standardize_character_identifier("Dr. Elena Vance, Ph.D.")).toBe("dr_elena_vance_ph_d");
    expect(standardize_character_identifier("  Lieutenant Mark O'Connor  ")).toBe("lieutenant_mark_o_connor");
    expect(standardize_character_identifier("")).toBe("character");
    expect(standardize_character_identifier(null)).toBe("character");
  });

  test("create_imported_character_voice_record marks voice as imported and skips VoiceDesign", () => {
    const initial_voice_mapping = {
      "Narrator": { character_name: "Narrator", is_locked: true }
    };

    const updated_mapping = create_imported_character_voice_record(
      initial_voice_mapping,
      "Captain Reynolds",
      "C:/AudioAuditions/reynolds_take.wav",
      "C:/Projects/Book/audio/anchors/character_voice_captain_reynolds.wav",
      { gender: "male", age_range: "middle-aged" }
    );

    const reynolds = updated_mapping["Captain Reynolds"];
    expect(reynolds).toBeDefined();
    expect(reynolds.is_locked).toBe(true);
    expect(reynolds.source).toBe("imported_audio");
    expect(reynolds.skipped_voice_design).toBe(true);
    expect(reynolds.is_100_percent_generated).toBe(false);
    expect(reynolds.tuning_status).toBe("pending_phonetic_tuning");
    expect(reynolds.anchorFilePath).toContain("character_voice_captain_reynolds.wav");
    expect(reynolds.voice.gender).toBe("male");
    // Narrator remains untouched
    expect(updated_mapping["Narrator"]).toBeDefined();
  });

  test("create_phonetic_tuning_task_payload configures AuK-02 clone with standard test sentence", () => {
    const task = create_phonetic_tuning_task_payload(
      "C:/Audiobooks",
      "SciFiNovel",
      "Captain Reynolds",
      "rainbow_passage"
    );

    expect(task.task_type).toBe("phonetic_tuning_synthesis");
    expect(task.character_name).toBe("Captain Reynolds");
    expect(task.sanitized_identifier).toBe("captain_reynolds");
    expect(task.model_version).toBe("AuK-02");
    expect(task.reference_anchor_path).toContain("character_voice_captain_reynolds.wav");
    expect(task.output_tuning_wav_path).toContain("captain_reynolds_phonetic_tuning_test.wav");
    expect(task.dialogue_text).toBe(PHONETIC_TUNING_SENTENCES.rainbow_passage);
    expect(task.sentence_key).toBe("rainbow_passage");
  });

  test("create_phonetic_tuning_task_payload supports custom phonetic text", () => {
    const custom_test = "The anomalous radiation patterns confirm our initial hyperspace calculations.";
    const task = create_phonetic_tuning_task_payload(
      "C:/Audiobooks",
      "SciFiNovel",
      "Elena",
      custom_test
    );

    expect(task.dialogue_text).toBe(custom_test);
    expect(task.sentence_key).toBe("custom");
  });

  test("evaluate_phonetic_tuning_take accurately scores timbre similarity and initializes profile", () => {
    // Generate synthetic matching vectors with high cosine similarity
    const anchor_vector = [0.2, 0.5, 0.8, 0.1, 0.3];
    const take_vector = [0.21, 0.49, 0.82, 0.11, 0.29];

    const evaluation = evaluate_phonetic_tuning_take(
      take_vector,
      anchor_vector,
      {
        character_name: "Elena",
        stt_accuracy_percentage: 97.5,
        chars_per_second: 15.0
      }
    );

    expect(evaluation.similarity_score).toBeGreaterThan(0.95);
    expect(evaluation.is_identity_verified).toBe(true);
    expect(evaluation.is_articulation_clean).toBe(true);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.status).toBe("tuned_and_verified");
    expect(evaluation.baseline_profile.character_identifier).toBe("elena");
  });

  test("evaluate_phonetic_tuning_take flags distorted or degraded clone takes", () => {
    // Orthogonal or drifting vector
    const anchor_vector = [1.0, 0.0, 0.0, 0.0];
    const drifting_vector = [0.1, 0.9, 0.5, 0.3];

    const evaluation = evaluate_phonetic_tuning_take(
      drifting_vector,
      anchor_vector,
      {
        character_name: "Mark",
        stt_accuracy_percentage: 75.0,
        chars_per_second: 13.0
      }
    );

    expect(evaluation.similarity_score).toBeLessThan(0.75);
    expect(evaluation.is_identity_verified).toBe(false);
    expect(evaluation.is_articulation_clean).toBe(false);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.status).toBe("tuning_needs_review");
  });
});

