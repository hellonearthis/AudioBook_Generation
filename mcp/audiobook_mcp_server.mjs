#!/usr/bin/env node
// =========================================================================
// AUDIOBOOKS MODEL CONTEXT PROTOCOL (MCP) SERVER
// =========================================================================
// WHAT: Exposes the full AudioBooks generation, manuscript parsing, cast extraction,
//       directorial staging, pronunciation lexicon, and audio synthesis engine
//       as a standard Model Context Protocol (MCP) server over stdio.
// WHY: Allows external AI coding agents (Antigravity, Claude, Cline, Cursor, Roo)
//       to programmatically audit, control, and execute audiobook production workflows.

import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

const require = createRequire(import.meta.url);

// WHAT: Importing pure functional backend services.
const {
  count_words_in_text,
  split_manuscript_into_chapters,
  upgrade_project_state_to_multichapter,
  switch_active_chapter,
  save_chapter_segments_to_project,
  compile_master_book_timeline_segments
} = require("../services/chapter_service.js");

const {
  load_project_lexicon_from_disk,
  save_project_lexicon_to_disk,
  apply_pronunciation_lexicon,
  compile_lexicon_rules
} = require("../services/pronunciation_lexicon_service.js");

const {
  transcode_or_copy_reference_audio,
  create_imported_character_voice_record,
  standardize_character_identifier
} = require("../services/voice_import_service.js");

const {
  enrich_script_segments_with_directorial_staging,
  extract_acoustic_cues_from_narrative_context
} = require("../services/directorial_staging_service.js");

const {
  probe_service_health
} = require("../services/service_health_service");

// Default workspace root relative to project
const DEFAULT_WORKSPACE_PATH = path.resolve(process.cwd(), "workspace");

/**
 * WHAT: Resolves a project directory path safely.
 * WHY: Prevents directory traversal attacks outside the workspace directory.
 * 
 * @param {string} [workspace_path] 
 * @param {string} project_name 
 * @returns {string} Absolute path to project folder.
 */
function resolve_project_directory(workspace_path, project_name) {
  const base_workspace = workspace_path ? path.resolve(process.cwd(), workspace_path) : DEFAULT_WORKSPACE_PATH;
  const project_dir = path.join(base_workspace, project_name);
  return project_dir;
}

/**
 * WHAT: Reads project_state.json from disk.
 * 
 * @param {string} project_dir 
 * @returns {Object|null}
 */
function read_project_state(project_dir) {
  const state_file = path.join(project_dir, "project_state.json");
  if (!fs.existsSync(state_file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(state_file, "utf-8"));
}

/**
 * WHAT: Writes project_state.json to disk.
 * 
 * @param {string} project_dir 
 * @param {Object} state_data 
 */
function write_project_state(project_dir, state_data) {
  if (!fs.existsSync(project_dir)) {
    fs.mkdirSync(project_dir, { recursive: true });
  }
  const state_file = path.join(project_dir, "project_state.json");
  fs.writeFileSync(state_file, JSON.stringify(state_data, null, 2), "utf-8");
}

// =========================================================================
// MCP SERVER INITIALIZATION & TOOL REGISTRATION
// =========================================================================

const server = new Server(
  {
    name: "audiobooks-mcp-server",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// WHAT: Tool Schema Declarations
const TOOLS_DEFINITIONS = [
  {
    name: "audiobook_list_projects",
    description: "Lists all existing audiobook projects within a workspace folder, returning project names, chapter counts, and last modified dates.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_path: {
          type: "string",
          description: "Path to workspace directory containing projects. Defaults to './workspace'."
        }
      }
    }
  },
  {
    name: "audiobook_get_project_state",
    description: "Loads the full project state database (metadata, cast, chapters, segment count) for a specified audiobook project.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_path: {
          type: "string",
          description: "Path to workspace directory. Defaults to './workspace'."
        },
        project_name: {
          type: "string",
          description: "Name of the audiobook project folder."
        },
        include_segments: {
          type: "boolean",
          description: "Whether to include full script dialogue segments in output (can be large). Defaults to false."
        }
      },
      required: ["project_name"]
    }
  },
  {
    name: "audiobook_create_project",
    description: "Initializes a brand new audiobook project from raw text, auto-splitting chapters and establishing project folder structure.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_path: {
          type: "string",
          description: "Path to workspace directory. Defaults to './workspace'."
        },
        project_name: {
          type: "string",
          description: "Name for the new audiobook project."
        },
        raw_text: {
          type: "string",
          description: "Full manuscript or chapter text to initialize the project with."
        }
      },
      required: ["project_name", "raw_text"]
    }
  },
  {
    name: "audiobook_split_manuscript",
    description: "Analyzes novel manuscript text and splits it into discrete chapters using standard heading patterns (Chapter, Part, Act), returning chapter summaries and word counts.",
    inputSchema: {
      type: "object",
      properties: {
        raw_text: {
          type: "string",
          description: "The complete or partial novel manuscript text to analyze."
        }
      },
      required: ["raw_text"]
    }
  },
  {
    name: "audiobook_switch_chapter",
    description: "Switches the active editing chapter in a multi-chapter project while retaining shared global cast voice assignments.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_path: {
          type: "string",
          description: "Path to workspace directory. Defaults to './workspace'."
        },
        project_name: {
          type: "string",
          description: "Name of the project."
        },
        target_chapter_id: {
          type: "string",
          description: "Target chapter identifier (e.g. 'chapter_01', 'chapter_02')."
        }
      },
      required: ["project_name", "target_chapter_id"]
    }
  },
  {
    name: "audiobook_get_cast",
    description: "Retrieves the global cast members, voice model assignments, speeds, pitches, and reference audio paths for a project.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_path: {
          type: "string",
          description: "Path to workspace directory. Defaults to './workspace'."
        },
        project_name: {
          type: "string",
          description: "Name of the project."
        }
      },
      required: ["project_name"]
    }
  },
  {
    name: "audiobook_update_character_voice",
    description: "Configures or updates a character's voice model parameters (model name, gender, traits, speed, pitch).",
    inputSchema: {
      type: "object",
      properties: {
        workspace_path: {
          type: "string",
          description: "Path to workspace directory. Defaults to './workspace'."
        },
        project_name: {
          type: "string",
          description: "Name of the project."
        },
        character_name: {
          type: "string",
          description: "Name of the character (e.g. 'Gurgeh', 'Yay', 'Narrator')."
        },
        voice_settings: {
          type: "object",
          description: "Voice settings object containing model, speed, pitch, gender, traits.",
          properties: {
            model: { type: "string" },
            speed: { type: "number" },
            pitch: { type: "number" },
            gender: { type: "string" },
            traits: { type: "string" }
          }
        }
      },
      required: ["project_name", "character_name", "voice_settings"]
    }
  },
  {
    name: "audiobook_import_voice_anchor",
    description: "Imports a user-supplied external audio recording (.wav/.mp3) to serve as a reference voice clone for a character, skipping synthetic VoiceDesign generation.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_path: {
          type: "string",
          description: "Path to workspace directory. Defaults to './workspace'."
        },
        project_name: {
          type: "string",
          description: "Name of the project."
        },
        character_name: {
          type: "string",
          description: "Name of character to associate with this voice."
        },
        source_audio_file_path: {
          type: "string",
          description: "Absolute path to source audio recording file on disk."
        }
      },
      required: ["project_name", "character_name", "source_audio_file_path"]
    }
  },
  {
    name: "audiobook_get_lexicon",
    description: "Reads the project's persistent pronunciation lexicon overrides and phonetic respellings.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_path: {
          type: "string",
          description: "Path to workspace directory. Defaults to './workspace'."
        },
        project_name: {
          type: "string",
          description: "Name of the project."
        }
      },
      required: ["project_name"]
    }
  },
  {
    name: "audiobook_add_lexicon_entry",
    description: "Adds or updates a phonetic respelling or acronym expansion in the project pronunciation lexicon.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_path: {
          type: "string",
          description: "Path to workspace directory. Defaults to './workspace'."
        },
        project_name: {
          type: "string",
          description: "Name of the project."
        },
        target_word: {
          type: "string",
          description: "Target word or acronym to replace (e.g. 'Gurgeh', 'Azad', 'CMBR')."
        },
        replacement: {
          type: "string",
          description: "Phonetic respelling or expansion (e.g. 'GUR-geh', 'Ah-ZAD')."
        },
        type: {
          type: "string",
          enum: ["respelling", "phoneme", "expansion"],
          description: "Replacement type. Defaults to 'respelling'."
        },
        case_sensitive: {
          type: "boolean",
          description: "Whether replacement requires exact case match. Defaults to false."
        }
      },
      required: ["project_name", "target_word", "replacement"]
    }
  },
  {
    name: "audiobook_preview_pronunciation",
    description: "Applies the project pronunciation lexicon or custom rules to a test passage, returning transformed text and applied substitutions.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text passage to condition with lexicon."
        },
        workspace_path: {
          type: "string",
          description: "Optional workspace path to read project lexicon."
        },
        project_name: {
          type: "string",
          description: "Optional project name to load project lexicon."
        },
        custom_entries: {
          type: "array",
          description: "Optional array of custom lexicon entry objects."
        }
      },
      required: ["text"]
    }
  },
  {
    name: "audiobook_enrich_directorial_staging",
    description: "Extracts acoustic tags (whispers, shouts, flat delivery, weariness) and enriches dialogue segments with micro-level directorial performance instructions.",
    inputSchema: {
      type: "object",
      properties: {
        script_segments: {
          type: "array",
          description: "Array of script segment objects ({ speaker, text, type })."
        },
        voice_mapping: {
          type: "object",
          description: "Character voice configuration dictionary."
        }
      },
      required: ["script_segments"]
    }
  },
  {
    name: "audiobook_extract_acoustic_cues",
    description: "Extracts vocal clauses, participles, tone phrases, and speech verbs from a narrative context sentence without modifying the prose.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Narrative context sentence (e.g. 'she whispered softly, her voice flat')."
        }
      },
      required: ["text"]
    }
  },
  {
    name: "audiobook_check_pipeline_health",
    description: "Probes and reports operational status of local AI services: ComfyUI (8188), llama-server (8081), and Laya NPU (8765).",
    inputSchema: {
      type: "object",
      properties: {
        comfyui_url: { type: "string", description: "ComfyUI base URL. Defaults to 'http://127.0.0.1:8188'." },
        llama_url: { type: "string", description: "Llama base URL. Defaults to 'http://127.0.0.1:8081'." },
        laya_url: { type: "string", description: "Laya base URL. Defaults to 'http://127.0.0.1:8765'." }
      }
    }
  },
  {
    name: "audiobook_compile_master_timeline",
    description: "Compiles all chapter segments into a unified, continuous master timeline with chapter markers and estimated total book duration.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_path: {
          type: "string",
          description: "Path to workspace directory. Defaults to './workspace'."
        },
        project_name: {
          type: "string",
          description: "Name of the project."
        }
      },
      required: ["project_name"]
    }
  }
];

// Handle tools/list request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS_DEFINITIONS
  };
});

// Handle tools/call request
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: tool_arguments } = request.params;

  try {
    switch (name) {
      case "audiobook_list_projects": {
        const workspace_path = (tool_arguments && tool_arguments.workspace_path) || DEFAULT_WORKSPACE_PATH;
        if (!fs.existsSync(workspace_path)) {
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, projects: [] }, null, 2) }]
          };
        }
        const entries = fs.readdirSync(workspace_path, { withFileTypes: true });
        const projects = [];
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const state_path = path.join(workspace_path, entry.name, "project_state.json");
            if (fs.existsSync(state_path)) {
              try {
                const state = JSON.parse(fs.readFileSync(state_path, "utf-8"));
                projects.push({
                  project_name: entry.name,
                  title: state.projectName || entry.name,
                  chapters_count: Array.isArray(state.chapters) ? state.chapters.length : 1,
                  segments_count: Array.isArray(state.scriptSegments) ? state.scriptSegments.length : 0,
                  active_chapter_id: state.active_chapter_id || "chapter_01"
                });
              } catch (_) {
                projects.push({ project_name: entry.name, error: "Invalid project_state.json" });
              }
            }
          }
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, workspace_path, projects }, null, 2) }]
        };
      }

      case "audiobook_get_project_state": {
        const { workspace_path, project_name, include_segments } = tool_arguments;
        const project_dir = resolve_project_directory(workspace_path, project_name);
        const state = read_project_state(project_dir);
        if (!state) {
          return {
            isError: true,
            content: [{ type: "text", text: `Project "${project_name}" not found at ${project_dir}` }]
          };
        }
        let output_state = state;
        if (!include_segments) {
          output_state = {
            ...state,
            scriptSegments: `[${(state.scriptSegments || []).length} segments hidden; pass include_segments: true to view]`,
            directorialSegments: state.directorialSegments ? `[${state.directorialSegments.length} segments hidden]` : undefined
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(output_state, null, 2) }]
        };
      }

      case "audiobook_create_project": {
        const { workspace_path, project_name, raw_text } = tool_arguments;
        const project_dir = resolve_project_directory(workspace_path, project_name);
        const chapters = split_manuscript_into_chapters(raw_text);
        
        const initial_state = {
          projectName: project_name,
          rawBookText: raw_text,
          active_chapter_id: chapters[0] ? chapters[0].chapter_id : "chapter_01",
          chapters: chapters,
          scriptSegments: [],
          directorialSegments: [],
          voiceMapping: {
            Narrator: { model: "F5-TTS_Base", gender: "neutral", speed: 1.0, pitch: 0 }
          },
          relationships: [],
          created_at: Date.now()
        };

        write_project_state(project_dir, initial_state);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              project_name,
              project_dir,
              chapters_created: chapters.length,
              total_words: count_words_in_text(raw_text)
            }, null, 2)
          }]
        };
      }

      case "audiobook_split_manuscript": {
        const { raw_text } = tool_arguments;
        const chapters = split_manuscript_into_chapters(raw_text);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              total_chapters: chapters.length,
              total_words: count_words_in_text(raw_text),
              chapters: chapters.map(c => ({
                id: c.chapter_id,
                title: c.chapter_title,
                word_count: c.word_count,
                estimated_minutes: c.estimated_minutes
              }))
            }, null, 2)
          }]
        };
      }

      case "audiobook_switch_chapter": {
        const { workspace_path, project_name, target_chapter_id } = tool_arguments;
        const project_dir = resolve_project_directory(workspace_path, project_name);
        const state = read_project_state(project_dir);
        if (!state) {
          return { isError: true, content: [{ type: "text", text: `Project "${project_name}" not found.` }] };
        }
        const updated_state = switch_active_chapter(state, target_chapter_id);
        write_project_state(project_dir, updated_state);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              active_chapter_id: updated_state.active_chapter_id,
              active_segments_count: (updated_state.scriptSegments || []).length
            }, null, 2)
          }]
        };
      }

      case "audiobook_get_cast": {
        const { workspace_path, project_name } = tool_arguments;
        const project_dir = resolve_project_directory(workspace_path, project_name);
        const state = read_project_state(project_dir);
        if (!state) {
          return { isError: true, content: [{ type: "text", text: `Project "${project_name}" not found.` }] };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              project_name,
              voice_mapping: state.voiceMapping || {},
              relationships: state.relationships || []
            }, null, 2)
          }]
        };
      }

      case "audiobook_update_character_voice": {
        const { workspace_path, project_name, character_name, voice_settings } = tool_arguments;
        const project_dir = resolve_project_directory(workspace_path, project_name);
        const state = read_project_state(project_dir);
        if (!state) {
          return { isError: true, content: [{ type: "text", text: `Project "${project_name}" not found.` }] };
        }
        if (!state.voiceMapping) state.voiceMapping = {};
        state.voiceMapping[character_name] = {
          ...(state.voiceMapping[character_name] || {}),
          ...voice_settings
        };
        write_project_state(project_dir, state);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              character_name,
              updated_settings: state.voiceMapping[character_name]
            }, null, 2)
          }]
        };
      }

      case "audiobook_import_voice_anchor": {
        const { workspace_path, project_name, character_name, source_audio_file_path } = tool_arguments;
        const project_dir = resolve_project_directory(workspace_path, project_name);
        const state = read_project_state(project_dir);
        if (!state) {
          return { isError: true, content: [{ type: "text", text: `Project "${project_name}" not found.` }] };
        }
        if (!fs.existsSync(source_audio_file_path)) {
          return { isError: true, content: [{ type: "text", text: `Source audio file not found: ${source_audio_file_path}` }] };
        }

        const anchors_dir = path.join(project_dir, "audio", "anchors");
        if (!fs.existsSync(anchors_dir)) {
          fs.mkdirSync(anchors_dir, { recursive: true });
        }
        const sanitized_id = standardize_character_identifier(character_name);
        const destination_wav_path = path.join(anchors_dir, `anchor_${sanitized_id}.wav`);

        await transcode_or_copy_reference_audio(source_audio_file_path, destination_wav_path);

        const updated_mapping = create_imported_character_voice_record(
          state.voiceMapping || {},
          character_name,
          destination_wav_path
        );
        state.voiceMapping = updated_mapping;
        write_project_state(project_dir, state);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              character_name,
              anchor_file_path: destination_wav_path,
              voice_mapping: state.voiceMapping[character_name]
            }, null, 2)
          }]
        };
      }

      case "audiobook_get_lexicon": {
        const { workspace_path, project_name } = tool_arguments;
        const project_dir = resolve_project_directory(workspace_path, project_name);
        const lexicon_entries = load_project_lexicon_from_disk(project_dir);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, count: lexicon_entries.length, entries: lexicon_entries }, null, 2)
          }]
        };
      }

      case "audiobook_add_lexicon_entry": {
        const { workspace_path, project_name, target_word, replacement, type, case_sensitive } = tool_arguments;
        const project_dir = resolve_project_directory(workspace_path, project_name);
        const existing_entries = load_project_lexicon_from_disk(project_dir);
        
        // Remove existing entry for same word if present
        const filtered_entries = existing_entries.filter(e => e.target_word.toLowerCase() !== target_word.toLowerCase());
        filtered_entries.push({
          target_word,
          replacement,
          type: type || "respelling",
          case_sensitive: Boolean(case_sensitive)
        });

        save_project_lexicon_to_disk(project_dir, filtered_entries);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, target_word, replacement, total_entries: filtered_entries.length }, null, 2)
          }]
        };
      }

      case "audiobook_preview_pronunciation": {
        const { text, workspace_path, project_name, custom_entries } = tool_arguments;
        let entries = custom_entries || [];
        if (project_name) {
          const project_dir = resolve_project_directory(workspace_path, project_name);
          entries = [...load_project_lexicon_from_disk(project_dir), ...entries];
        }
        const transformation = apply_pronunciation_lexicon(text, entries);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              original_text: text,
              transformed_text: transformation.transformed_text,
              applied_replacements: transformation.applied_replacements_list
            }, null, 2)
          }]
        };
      }

      case "audiobook_enrich_directorial_staging": {
        const { script_segments, voice_mapping } = tool_arguments;
        const enriched = enrich_script_segments_with_directorial_staging(script_segments, voice_mapping || {});
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, enriched_segments: enriched }, null, 2)
          }]
        };
      }

      case "audiobook_extract_acoustic_cues": {
        const { text } = tool_arguments;
        const cues = extract_acoustic_cues_from_narrative_context(text);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, cues }, null, 2)
          }]
        };
      }

      case "audiobook_check_pipeline_health": {
        const comfyui_url = (tool_arguments && tool_arguments.comfyui_url) || "http://127.0.0.1:8188";
        const llama_url = (tool_arguments && tool_arguments.llama_url) || "http://127.0.0.1:8081";
        const laya_url = (tool_arguments && tool_arguments.laya_url) || "http://127.0.0.1:8765";

        const [comfy_ok, llama_ok, laya_ok] = await Promise.all([
          probe_service_health(`${comfyui_url}/system_stats`, 600),
          probe_service_health(`${llama_url}/props`, 600),
          probe_service_health(`${laya_url}/health`, 600)
        ]);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              services: {
                comfyui: { url: comfyui_url, online: comfy_ok },
                llama_server: { url: llama_url, online: llama_ok },
                laya_npu: { url: laya_url, online: laya_ok }
              }
            }, null, 2)
          }]
        };
      }

      case "audiobook_compile_master_timeline": {
        const { workspace_path, project_name } = tool_arguments;
        const project_dir = resolve_project_directory(workspace_path, project_name);
        const state = read_project_state(project_dir);
        if (!state) {
          return { isError: true, content: [{ type: "text", text: `Project "${project_name}" not found.` }] };
        }
        const master_segments = compile_master_book_timeline_segments(state);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              total_segments: master_segments.length,
              chapters_included: (state.chapters || []).length,
              segments: master_segments.map(s => ({
                global_index: s.global_segment_index,
                chapter_id: s.chapter_id,
                chapter_title: s.chapter_title,
                speaker: s.speaker,
                text: s.text,
                audioPath: s.audioPath || null
              }))
            }, null, 2)
          }]
        };
      }

      default:
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown MCP tool: ${name}` }]
        };
    }
  } catch (execution_error) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error executing tool ${name}: ${execution_error.message}` }]
    };
  }
});

// Start the server over stdio
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[AudioBooks MCP Server] Connected over stdio.");
}

run().catch((startup_error) => {
  console.error("[AudioBooks MCP Server] Fatal startup failure:", startup_error);
  process.exit(1);
});
