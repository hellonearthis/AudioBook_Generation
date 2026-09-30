/**
 * @jest-environment jsdom
 */

describe("Line Studio Inspector (Column 3)", () => {
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
      save_audiobook_project_state: jest.fn().mockResolvedValue(true)
    };
    window.active_selected_workspace_directory_path = "/mock/workspace";
    global.active_selected_workspace_directory_path = "/mock/workspace";

    // Global active loaded project state
    window.active_loaded_project_state_object = {
      projectName: "HeyTest",
      voiceMapping: {
        "Narrator": {},
        "Inspector Mara": {
          traits: "Formal, precise, and duty-bound",
          identityBackground: "Directorate inspector tasked with decommissioning."
        },
        "Archivist Kaelen": {
          traits: "Reverent, poetic, and custodial"
        }
      },
      relationships: [
        {
          source_character: "Inspector Mara",
          target_character: "Archivist Kaelen",
          relation_tone: "Guarded",
          relation_type: "Administrative",
          status: "Investigating"
        }
      ],
      scriptSegments: [
        {
          index_position: 0,
          type: "narrator",
          speaker: "Narrator",
          text: "Inspector Mara did not touch it.",
          confidence: 1.0,
          direction: "calm, steady narration"
        },
        {
          index_position: 1,
          type: "dialogue",
          speaker: "Inspector Mara",
          text: "Explain the cupola, Brother,",
          direction: "Flat, clipped by the environmental seal of her collar.",
          confidence: 0.94,
          emotion: "calm",
          energy: 1.0,
          is_user_locked: true,
          engine: "laya",
          intent: "Demanding technical accountability under procedural authority.",
          pre_pause_ms: 150,
          post_pause_ms: 400,
          inject_breath: true,
          phonetic_overrides: {
            "cupola": "KOO-puh-luh"
          },
          audioVersions: [
            { take: 1, take_number: 1, duration: 2.8, energy: 1.1, isActive: true, audioPath: "/audio/take1.wav" },
            { take: 2, take_number: 2, duration: 2.6, energy: 1.4, isActive: false, audioPath: "/audio/take2.wav" }
          ]
        }
      ]
    };
  });

  test("renders all 5 Line Inspector modules when selecting Line 1", () => {
    // Load editor script in test scope
    const fs = require("fs");
    const editorCode = fs.readFileSync("renderer/js/editor.js", "utf8");
    eval(editorCode);

    select_and_inspect_segment(1);

    const container = document.getElementById("line_inspector_content_container");
    expect(container).toBeDefined();

    // Module 1: Narrative Subtext & Dynamic Relationship
    expect(container.innerHTML).toContain("Narrative State &amp; Subtext");
    expect(container.innerHTML).toContain("Inspector Mara");
    expect(container.innerHTML).toContain("Archivist Kaelen");
    expect(container.innerHTML).toContain("Guarded");
    expect(container.innerHTML).toContain("Demanding technical accountability");

    // Module 2: Pronunciation & Phonetics
    expect(container.innerHTML).toContain("Pronunciation &amp; Phonetics");
    expect(container.innerHTML).toContain("cupola");
    expect(container.innerHTML).toContain("KOO-puh-luh");

    // Module 3: Take A/B Testing & Waveform Telemetry
    expect(container.innerHTML).toContain("Take A/B Auditioning");
    expect(container.innerHTML).toContain("Take 1 (Master)");
    expect(container.innerHTML).toContain("Take 2");
    expect(container.innerHTML).toContain("waveform_bar_sim");

    // Module 4: Micro-Pacing & Breath Controls
    expect(container.innerHTML).toContain("Micro-Pacing &amp; Breath");
    expect(container.innerHTML).toContain("150 ms");
    expect(container.innerHTML).toContain("400 ms");

    // Module 5: AI Confidence & Shadow QC
    expect(container.innerHTML).toContain("Confidence &amp; Shadow QC");
    expect(container.innerHTML).toContain("94%");
    expect(container.innerHTML).toContain("High Confidence");
    expect(container.innerHTML).toContain("Locked Ground Truth");
  });

  test("allows adding and removing phonetic overrides", async () => {
    const fs = require("fs");
    const editorCode = fs.readFileSync("renderer/js/editor.js", "utf8");
    eval(editorCode);

    select_and_inspect_segment(1);

    const termInput = document.getElementById("inspector_phonetic_term_input");
    const valInput = document.getElementById("inspector_phonetic_val_input");
    termInput.value = "titanium";
    valInput.value = "ty-TAY-nee-um";

    await handle_inspector_add_phonetic_override(1);

    const seg = window.active_loaded_project_state_object.scriptSegments[1];
    expect(seg.phonetic_overrides["titanium"]).toBe("ty-TAY-nee-um");

    // Verify it saved to global project dictionary too
    expect(window.active_loaded_project_state_object.pronunciationDictionary["titanium"]).toBe("ty-TAY-nee-um");

    // Now remove override
    await handle_inspector_remove_phonetic_override(1, "titanium");
    expect(seg.phonetic_overrides["titanium"]).toBeUndefined();
  });

  test("adjusting pause sliders updates segment pre_pause_ms and post_pause_ms", async () => {
    const fs = require("fs");
    const editorCode = fs.readFileSync("renderer/js/editor.js", "utf8");
    eval(editorCode);

    select_and_inspect_segment(1);

    await handle_inspector_pause_change(1, "pre_pause_ms", "250");
    await handle_inspector_pause_change(1, "post_pause_ms", "600");

    const seg = window.active_loaded_project_state_object.scriptSegments[1];
    expect(seg.pre_pause_ms).toBe(250);
    expect(seg.post_pause_ms).toBe(600);
  });
});
