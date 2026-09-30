const http = require("http");
const {
  extract_json_from_llm_response_text,
  dispatch_http_post_request,
  register_ai_pipeline_handlers
} = require("../services/ai_pipeline_service");
const { LayaQCPipeline } = require("../laya_qc_pipeline");

describe("AI Pipeline Orchestrator Integration Tests", () => {
  let mockServer;
  let serverPort;
  let serverBaseUrl;
  let serverHandler;

  beforeAll((done) => {
    mockServer = http.createServer((req, res) => {
      if (serverHandler) {
        serverHandler(req, res);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    mockServer.listen(0, "127.0.0.1", () => {
      serverPort = mockServer.address().port;
      serverBaseUrl = `http://127.0.0.1:${serverPort}`;
      done();
    });
  });

  afterAll((done) => {
    if (mockServer) {
      mockServer.close(done);
    } else {
      done();
    }
  });

  afterEach(() => {
    serverHandler = null;
  });

  // =========================================================================
  // Pass 1: Cast Discovery Integration Tests
  // =========================================================================
  describe("Pass 1: Cast Discovery (ai:extract-cast)", () => {
    let mockIpcHandlers = {};
    const mockIpcMain = {
      handle: (channel, handler) => {
        mockIpcHandlers[channel] = handler;
      }
    };

    beforeAll(() => {
      register_ai_pipeline_handlers(mockIpcMain, () => null);
    });

    test("handles malformed JSON from LLM by gracefully returning standard fallback cast", async () => {
      // Simulate LLM returning conversational prose with broken/unclosed JSON
      serverHandler = (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [
            {
              message: {
                content: "Here is your character analysis:\n```json\n{\"cast\": [{\"id\": \"broken\", \"name\": \"Broken\"" // truncated JSON
              }
            }
          ]
        }));
      };

      const result = await mockIpcHandlers["ai:extract-cast"]({}, {
        book_text_segment: "The traveler arrived at dusk.",
        lm_studio_api_url_address: `${serverBaseUrl}/v1/chat/completions`,
        workspace_directory_path: null,
        project_name: "test_book"
      });

      expect(result).toBeDefined();
      expect(result.cast).toBeDefined();
      expect(Array.isArray(result.cast)).toBe(true);
      // Fallback returns standard Narrator entry
      expect(result.cast.some(c => c.name === "Narrator")).toBe(true);
    });

    test("handles HTTP server error (502 Bad Gateway with HTML body) gracefully", async () => {
      serverHandler = (req, res) => {
        res.writeHead(502, { "Content-Type": "text/html" });
        res.end("<html><body>502 Bad Gateway</body></html>");
      };

      const result = await mockIpcHandlers["ai:extract-cast"]({}, {
        book_text_segment: "The traveler arrived at dusk.",
        lm_studio_api_url_address: `${serverBaseUrl}/v1/chat/completions`,
        workspace_directory_path: null,
        project_name: "test_book"
      });

      expect(result).toBeDefined();
      expect(result.cast).toBeDefined();
      expect(result.cast[0].name).toBe("Narrator");
    });

    test("handles immediate socket reset / ECONNRESET gracefully", async () => {
      serverHandler = (req, res) => {
        req.socket.destroy();
      };

      const result = await mockIpcHandlers["ai:extract-cast"]({}, {
        book_text_segment: "The traveler arrived at dusk.",
        lm_studio_api_url_address: `${serverBaseUrl}/v1/chat/completions`,
        workspace_directory_path: null,
        project_name: "test_book"
      });

      expect(result).toBeDefined();
      expect(result.cast).toBeDefined();
      expect(result.cast[0].name).toBe("Narrator");
    });
  });

  // =========================================================================
  // Pass 2: Dialogue Attribution Integration Tests
  // =========================================================================
  describe("Pass 2: Dialogue Attribution (ai:attribute-dialogue)", () => {
    let mockIpcHandlers = {};
    const mockIpcMain = {
      handle: (channel, handler) => {
        mockIpcHandlers[channel] = handler;
      }
    };

    beforeAll(() => {
      register_ai_pipeline_handlers(mockIpcMain, () => null);
    });

    test("recovers via rule-based regex fallback when LLM returns malformed JSON", async () => {
      serverHandler = (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [
            {
              message: {
                content: "Thinking process complete. Outputting segments:\n{ incomplete json object..."
              }
            }
          ]
        }));
      };

      const result = await mockIpcHandlers["ai:attribute-dialogue"]({}, {
        book_text_segment: `"Wait for me!" shouted David. Clara turned and smiled.`,
        lm_studio_api_url_address: `${serverBaseUrl}/v1/chat/completions`,
        voice_mapping_context: { David: {}, Clara: {} }
      });

      expect(result).toBeDefined();
      expect(result.script_segments).toBeDefined();
      expect(Array.isArray(result.script_segments)).toBe(true);
      expect(result.script_segments.length).toBeGreaterThan(0);
      // Rule-based parser should have detected quotation dialogue
      const dialogueSegments = result.script_segments.filter(s => s.type === "dialogue");
      expect(dialogueSegments.length).toBeGreaterThan(0);
      expect(dialogueSegments[0].text).toContain("Wait for me!");
    });

    test("recovers via rule-based fallback when LLM server endpoint times out or drops connection", async () => {
      serverHandler = (req, res) => {
        req.socket.destroy();
      };

      const result = await mockIpcHandlers["ai:attribute-dialogue"]({}, {
        book_text_segment: `"Stop right there," said the guard.`,
        lm_studio_api_url_address: `${serverBaseUrl}/v1/chat/completions`,
        voice_mapping_context: { Guard: {} }
      });

      expect(result).toBeDefined();
      expect(result.script_segments).toBeDefined();
      const dialogue = result.script_segments.find(s => s.type === "dialogue");
      expect(dialogue).toBeDefined();
      expect(dialogue.text).toContain("Stop right there");
    });
  });

  // =========================================================================
  // Pass 3: Directorial Script Generation Integration Tests
  // =========================================================================
  describe("Pass 3: Directorial Orchestration (ai:generate-directorial-script)", () => {
    let mockIpcHandlers = {};
    const mockIpcMain = {
      handle: (channel, handler) => {
        mockIpcHandlers[channel] = handler;
      }
    };

    beforeAll(() => {
      register_ai_pipeline_handlers(mockIpcMain, () => null);
    });

    test("falls back to rule-based directorial generation when LLM returns invalid JSON", async () => {
      serverHandler = (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [
            {
              message: {
                content: "Malformed directorial JSON payload without script_segments"
              }
            }
          ]
        }));
      };

      const result = await mockIpcHandlers["ai:generate-directorial-script"]({}, {
        book_text_segment: `"Halt!" warned the sentry. The gate creaked shut.`,
        voice_mapping_context: { Sentry: {} },
        lm_studio_api_url_address: `${serverBaseUrl}/v1/chat/completions`
      });

      expect(result).toBeDefined();
      expect(result.script_segments).toBeDefined();
      expect(Array.isArray(result.script_segments)).toBe(true);
      expect(result.script_segments.length).toBeGreaterThan(0);
    });

    test("falls back to rule-based directorial generation on connection error", async () => {
      serverHandler = (req, res) => {
        req.socket.destroy();
      };

      const result = await mockIpcHandlers["ai:generate-directorial-script"]({}, {
        book_text_segment: `The night was cold and silent.`,
        voice_mapping_context: {},
        lm_studio_api_url_address: `${serverBaseUrl}/v1/chat/completions`
      });

      expect(result).toBeDefined();
      expect(result.script_segments).toBeDefined();
      expect(result.script_segments[0].type).toBe("narrator");
    });
  });

  // =========================================================================
  // Pass 4: Relationship Timeline Delta Pass Integration Tests
  // =========================================================================
  describe("Pass 4: Relationship Delta (ai:run-relationship-delta-pass)", () => {
    let mockIpcHandlers = {};
    const mockIpcMain = {
      handle: (channel, handler) => {
        mockIpcHandlers[channel] = handler;
      }
    };

    beforeAll(() => {
      register_ai_pipeline_handlers(mockIpcMain, () => null);
    });

    test("preserves existing relationship states when LLM returns non-JSON text", async () => {
      serverHandler = (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [
            {
              message: {
                content: "I cannot determine relationship changes from this segment."
              }
            }
          ]
        }));
      };

      const existingRelationships = [
        {
          id: "alice_bob",
          a: "Alice",
          b: "Bob",
          states: [{ relation_type: "friendship", relation_tone: "warm", status: "current" }]
        }
      ];

      const result = await mockIpcHandlers["ai:run-relationship-delta-pass"]({}, {
        current_relationships: existingRelationships,
        scene_segments: [
          { type: "dialogue", index_position: 1, speaker: "Alice", text: "Are you ready?" }
        ],
        lm_studio_api_url_address: `${serverBaseUrl}/v1/chat/completions`
      });

      expect(result).toBeDefined();
      expect(result.updated_relationships).toEqual(existingRelationships);
      expect(result.changes).toEqual([]);
    });

    test("preserves existing relationships on server crash / disconnect", async () => {
      serverHandler = (req, res) => {
        req.socket.destroy();
      };

      const existingRelationships = [
        { id: "rel1", a: "John", b: "Mary", states: [] }
      ];

      const result = await mockIpcHandlers["ai:run-relationship-delta-pass"]({}, {
        current_relationships: existingRelationships,
        scene_segments: [
          { type: "dialogue", index_position: 1, speaker: "John", text: "Hello Mary" }
        ],
        lm_studio_api_url_address: `${serverBaseUrl}/v1/chat/completions`
      });

      expect(result.updated_relationships).toEqual(existingRelationships);
      expect(result.changes).toEqual([]);
    });
  });

  // =========================================================================
  // Pass 5: Emotional Staging Integration Tests
  // =========================================================================
  describe("Pass 5: Emotional Staging (ai:generate-emotional-staging)", () => {
    let mockIpcHandlers = {};
    const mockIpcMain = {
      handle: (channel, handler) => {
        mockIpcHandlers[channel] = handler;
      }
    };

    beforeAll(() => {
      register_ai_pipeline_handlers(mockIpcMain, () => null);
    });

    test("falls back to neutral narration direction when LLM fails or returns malformed response", async () => {
      serverHandler = (req, res) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Internal Model Error" } }));
      };

      const result = await mockIpcHandlers["ai:generate-emotional-staging"]({}, {
        preceding_context_lines: ["Line 1"],
        target_sentence_text: "Line 2",
        succeeding_context_lines: ["Line 3"],
        lm_studio_api_url_address: `${serverBaseUrl}/v1/chat/completions`
      });

      expect(result).toBeDefined();
      expect(result.direction).toBe("natural narration, standard pace");
    });
  });

  // =========================================================================
  // Laya QC Service Integration Tests
  // =========================================================================
  describe("Laya QC Pipeline Error & Timeout Handling", () => {
    test("handles Laya service HTTP 500 error gracefully by logging and returning safe gate fallback", async () => {
      serverHandler = (req, res) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Laya inference failure" }));
      };

      const qcPipeline = new LayaQCPipeline({ layaEndpoint: serverBaseUrl });
      const verdict = await qcPipeline.verifyCharacterPresence({
        characterName: "Arthur",
        citedIntro: "Arthur stood by the cliff.",
        bookId: "test_book"
      });

      expect(verdict).toBeDefined();
      expect(verdict.gate_status).toBe("needs_review");
      expect(verdict.decision).toBe("verified");
    });
  });
});
