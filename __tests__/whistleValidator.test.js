/**
 * @jest-environment jsdom
 */

// =========================================================================
// WHISTLE SPEECH-TO-TEXT VALIDATOR SERVICE & UI TEST SUITE
// =========================================================================
// WHAT: Comprehensive test suite for Cactus Whistle STT validation service
//       and the Line Inspector on-demand take validation UI.
// WHY: Ensures strict 90% threshold enforcement, accurate missing/hallucinated
//      word detection, diff generation, and smooth renderer integration.

const fs = require("fs");
const path = require("path");
const {
  validate_audio_take_against_text,
  check_whistle_engine_availability
} = require("../services/whistle_validator_service");

describe("Whistle Speech-to-Text Audio Validation Service", () => {
  test("check_whistle_engine_availability returns available engine status", async () => {
    const status = await check_whistle_engine_availability();
    expect(status).toBeDefined();
    expect(typeof status.success).toBe("boolean");
    if (status.success) {
      expect(status.available).toBe(true);
      expect(status.engine).toBe("needle.Whistle");
    }
  });

  test("validates anchor audio clip with strict 90% pass threshold", async () => {
    const anchorPath = path.join(
      __dirname,
      "..",
      "workspace",
      "A Little Journey  By RAY BRADBURY",
      "audio",
      "anchors",
      "character_voice_mr._thirkell.wav"
    );

    if (!fs.existsSync(anchorPath)) {
      console.warn("Skipping real audio test: anchor file not found at " + anchorPath);
      return;
    }

    const expectedText =
      "The direct path through the valley was covered in thick dark moss. Young children should always evaluate their choices before jumping into unknown waters. She saw a magnificent blue jay perched high upon the smooth wooden fence, singing a remarkably clear tune that echoed softly across the quiet frozen northern landscape.";

    const result = await validate_audio_take_against_text(anchorPath, expectedText, {
      strict_threshold: 90.0
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("passed");
    expect(result.match_percentage).toBeGreaterThanOrEqual(90.0);
    expect(result.word_error_rate).toBeLessThan(0.1);
    expect(Array.isArray(result.diff_tokens)).toBe(true);
    expect(result.telemetry).toBeDefined();
    expect(result.telemetry.ttft_ms).toBeGreaterThanOrEqual(0);
  });

  test("flags strict failure when dialogue text completely diverges", async () => {
    const anchorPath = path.join(
      __dirname,
      "..",
      "workspace",
      "A Little Journey  By RAY BRADBURY",
      "audio",
      "anchors",
      "character_voice_mr._thirkell.wav"
    );

    if (!fs.existsSync(anchorPath)) {
      return;
    }

    const wrongText = "Astronauts landed on the moons of Jupiter in the distant twenty-second century.";

    const result = await validate_audio_take_against_text(anchorPath, wrongText, {
      strict_threshold: 90.0
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("failed");
    expect(result.match_percentage).toBeLessThan(90.0);
    expect(result.missing_words.length).toBeGreaterThan(0);
    expect(result.hallucinated_words.length).toBeGreaterThan(0);
  });
});

describe("Whistle Validator UI in Line Inspector", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="editor_pane_inspector">
        <span id="inspector_active_line_badge">Line 0</span>
        <button id="btn_inspector_synthesize_line">⚡ Synthesize Line</button>
        <button id="btn_inspector_play_take">▶ Play</button>
        <div id="line_inspector_content_container"></div>
        <div id="directorial_segment_cards_wrapper" class="d-none"></div>
      </div>
      <div id="screenplay_segment_cards_wrapper"></div>
      <audio id="individual_clip_audio_player"></audio>
    `;

    window.audiobook_api = {
      save_audiobook_project_state: jest.fn().mockResolvedValue(true),
      validate_audio_take: jest.fn().mockResolvedValue({
        success: true,
        status: "passed",
        match_percentage: 95.5,
        strict_threshold_percent: 90.0,
        word_error_rate: 0.04,
        expected_text: "Explain the cupola, Brother,",
        transcribed_text: "Explain the cupola, Brother,",
        missing_words: [],
        hallucinated_words: [],
        diff_tokens: [
          { type: "match", word: "explain" },
          { type: "match", word: "the" },
          { type: "match", word: "cupola" },
          { type: "match", word: "brother" }
        ],
        telemetry: { ttft_ms: 12.4, decode_tps: 1100.0 }
      })
    };

    window.active_selected_workspace_directory_path = "/mock/workspace";
    global.active_selected_workspace_directory_path = "/mock/workspace";

    window.active_loaded_project_state_object = {
      projectName: "WhistleTestProject",
      relationships: [],
      scriptSegments: [
        {
          index_position: 0,
          type: "dialogue",
          speaker: "Inspector Mara",
          text: "Explain the cupola, Brother,",
          audioVersions: [
            {
              take: 1,
              duration: 2.5,
              energy: 1.0,
              isActive: true,
              filePath: "/mock/audio/take_1.wav"
            },
            {
              take: 2,
              duration: 2.4,
              energy: 1.2,
              isActive: false,
              filePath: "/mock/audio/take_2.wav",
              validation: {
                status: "failed",
                match_percentage: 64.0,
                word_error_rate: 0.42,
                expected_text: "Explain the cupola, Brother,",
                transcribed_text: "Explain cupola,",
                missing_words: ["the", "brother"],
                hallucinated_words: [],
                diff_tokens: [
                  { type: "match", word: "explain" },
                  { type: "omission", word: "the" },
                  { type: "match", word: "cupola" },
                  { type: "omission", word: "brother" }
                ],
                telemetry: { ttft_ms: 14.1, decode_tps: 980.0 }
              }
            }
          ]
        }
      ]
    };

    const editorCode = fs.readFileSync("renderer/js/editor.js", "utf8");
    (0, eval)(editorCode);
  });

  test("renders Whistle validation controls on unvalidated take 1 and badge on validated take 2", () => {
    select_and_inspect_segment(0);

    const container = document.getElementById("line_inspector_content_container");
    expect(container).toBeDefined();

    // Take 1 is unvalidated -> should show "🎯 Validate (Whistle)" button
    expect(container.innerHTML).toContain("Validate (Whistle)");
    expect(container.innerHTML).toContain("btn_whistle_0_1");

    // Take 2 has validation (<90% failed) -> should show "✗ 64% Match (<90%)" badge and "🔍 Diff"
    expect(container.innerHTML).toContain("✗ 64% Match (&lt;90%)");
    expect(container.innerHTML).toContain("open_whistle_validation_details_modal(0, 2)");
  });

  test("clicking validate on take 1 executes Whistle STT and updates take state", async () => {
    select_and_inspect_segment(0);

    await handle_validate_take_with_whistle(0, 1);

    expect(window.audiobook_api.validate_audio_take).toHaveBeenCalledWith(
      "/mock/audio/take_1.wav",
      "Explain the cupola, Brother,",
      { strict_threshold: 90.0 }
    );

    const take1 = window.active_loaded_project_state_object.scriptSegments[0].audioVersions[0];
    expect(take1.validation).toBeDefined();
    expect(take1.validation.status).toBe("passed");
    expect(take1.validation.match_percentage).toBe(95.5);

    // Inspector view updated with passed badge
    const container = document.getElementById("line_inspector_content_container");
    expect(container.innerHTML).toContain("✓ 95.5% Match");

    // Module 5 also reflects active master take validation
    expect(container.innerHTML).toContain("🎯 Whistle Audio Match (Take 1)");
    expect(container.innerHTML).toContain("Strict Passed (≥90%)");
  });

  test("opening details modal renders word-level diff, telemetry, and missing words", () => {
    select_and_inspect_segment(0);

    open_whistle_validation_details_modal(0, 2);

    const modal = document.getElementById("whistle_validation_details_modal");
    expect(modal).toBeDefined();
    expect(modal.innerHTML).toContain("Whistle Audio Validator");
    expect(modal.innerHTML).toContain("64%");
    expect(modal.innerHTML).toContain("FAILED (&lt;90%)");
    expect(modal.innerHTML).toContain("Missing (2)");
    expect(modal.innerHTML).toContain("14.1 ms TTFT");
    expect(modal.innerHTML).toContain("Strict Pass Benchmark: <strong class=\"text-white\">≥ 90.0%</strong>");

    // Clean up modal
    modal.remove();
  });
});
