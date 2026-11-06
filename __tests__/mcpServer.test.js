// =========================================================================
// TEST SUITE: AUDIOBOOKS MCP SERVER SPECIFICATION & TOOL DISPATCH
// =========================================================================

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

describe("AudioBooks MCP Server Protocol Specification", () => {
  const serverScriptPath = path.resolve(__dirname, "..", "mcp", "audiobook_mcp_server.mjs");

  /**
   * Helper function to execute a JSON-RPC session against the MCP server over stdio.
   */
  function executeMcpSession(messages) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [serverScriptPath], {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env }
      });

      let stdoutAccumulator = "";
      let stderrAccumulator = "";

      child.stdout.on("data", (chunk) => {
        stdoutAccumulator += chunk.toString("utf-8");
      });

      child.stderr.on("data", (chunk) => {
        stderrAccumulator += chunk.toString("utf-8");
      });

      child.on("close", (code) => {
        try {
          const lines = stdoutAccumulator
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          const parsedResponses = lines.map((line) => JSON.parse(line));
          resolve({ code, responses: parsedResponses, stderr: stderrAccumulator });
        } catch (parseError) {
          reject(new Error(`Failed to parse MCP JSON-RPC output: ${parseError.message}\nSTDOUT: ${stdoutAccumulator}\nSTDERR: ${stderrAccumulator}`));
        }
      });

      child.on("error", (err) => reject(err));

      for (const msg of messages) {
        child.stdin.write(JSON.stringify(msg) + "\n");
      }
      child.stdin.end();
    });
  }

  test("Initializes successfully and negotiates protocol capabilities", async () => {
    const session = await executeMcpSession([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" }
        }
      }
    ]);

    expect(session.code).toBe(0);
    expect(session.responses.length).toBe(1);
    expect(session.responses[0].result).toBeDefined();
    expect(session.responses[0].result.serverInfo.name).toBe("audiobooks-mcp-server");
    expect(session.responses[0].result.capabilities.tools).toBeDefined();
  });

  test("Lists all available tools with JSONSchema input specifications", async () => {
    const session = await executeMcpSession([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } }
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
      }
    ]);

    expect(session.responses.length).toBe(2);
    const tools = session.responses[1].result.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThanOrEqual(14);

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("audiobook_list_projects");
    expect(toolNames).toContain("audiobook_get_project_state");
    expect(toolNames).toContain("audiobook_split_manuscript");
    expect(toolNames).toContain("audiobook_switch_chapter");
    expect(toolNames).toContain("audiobook_get_cast");
    expect(toolNames).toContain("audiobook_import_voice_anchor");
    expect(toolNames).toContain("audiobook_get_lexicon");
    expect(toolNames).toContain("audiobook_preview_pronunciation");
    expect(toolNames).toContain("audiobook_enrich_directorial_staging");
    expect(toolNames).toContain("audiobook_extract_acoustic_cues");
  });

  test("Executes audiobook_split_manuscript tool call deterministically", async () => {
    const rawManuscript = `Chapter 1: The Beginning\n\nIt was a quiet night in the library.\n\nChapter 2: The Departure\n\nAt dawn, they boarded the shuttle.`;

    const session = await executeMcpSession([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } }
      },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "audiobook_split_manuscript",
          arguments: { raw_text: rawManuscript }
        }
      }
    ]);

    expect(session.responses.length).toBe(2);
    const callResult = session.responses[1].result;
    expect(callResult.content[0].type).toBe("text");
    const parsedPayload = JSON.parse(callResult.content[0].text);
    expect(parsedPayload.success).toBe(true);
    expect(parsedPayload.total_chapters).toBe(2);
    expect(parsedPayload.chapters[0].id).toBe("chapter_01");
    expect(parsedPayload.chapters[1].id).toBe("chapter_02");
  });

  test("Executes audiobook_preview_pronunciation tool call", async () => {
    const session = await executeMcpSession([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } }
      },
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "audiobook_preview_pronunciation",
          arguments: {
            text: "Doctor John spoke with Jernau Gurgeh about the CMBR signals.",
            custom_entries: [
              { target_word: "Gurgeh", replacement: "GUR-geh" },
              { target_word: "CMBR", replacement: "Cosmic Microwave Background Radiation" }
            ]
          }
        }
      }
    ]);

    const callResult = session.responses[1].result;
    const parsedPayload = JSON.parse(callResult.content[0].text);
    expect(parsedPayload.success).toBe(true);
    expect(parsedPayload.transformed_text).toContain("GUR-geh");
    expect(parsedPayload.transformed_text).toContain("Cosmic Microwave Background Radiation");
    expect(parsedPayload.applied_replacements.length).toBe(2);
  });

  test("Executes audiobook_extract_acoustic_cues tool call", async () => {
    const session = await executeMcpSession([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } }
      },
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "audiobook_extract_acoustic_cues",
          arguments: {
            text: "she whispered softly, her voice flat against the cold metal"
          }
        }
      }
    ]);

    const callResult = session.responses[1].result;
    const parsedPayload = JSON.parse(callResult.content[0].text);
    expect(parsedPayload.success).toBe(true);
    expect(parsedPayload.cues.is_whisper).toBe(true);
    expect(parsedPayload.cues.is_flat).toBe(true);
    expect(parsedPayload.cues.speech_verb).toBe("whispered");
    expect(parsedPayload.cues.speech_adverb).toBe("softly");
  });

  test("Returns error response gracefully for unknown tool", async () => {
    const session = await executeMcpSession([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } }
      },
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "non_existent_tool",
          arguments: {}
        }
      }
    ]);

    const callResult = session.responses[1].result;
    expect(callResult.isError).toBe(true);
    expect(callResult.content[0].text).toContain("Unknown MCP tool: non_existent_tool");
  });
});

