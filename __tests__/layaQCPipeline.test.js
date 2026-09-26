const fs = require('fs');
const path = require('path');
const { LayaQCPipeline } = require('../laya_qc_pipeline');

describe('Laya Quality Control (QC) Pipeline (Phases 0-5)', () => {
  const TEST_LOG_PATH = path.join(__dirname, 'test_qc_log.jsonl');
  const TEST_CONFIG_PATH = path.join(__dirname, 'test_qc_config.json');

  beforeEach(() => {
    if (fs.existsSync(TEST_LOG_PATH)) fs.unlinkSync(TEST_LOG_PATH);
    if (fs.existsSync(TEST_CONFIG_PATH)) fs.unlinkSync(TEST_CONFIG_PATH);
  });

  afterAll(() => {
    if (fs.existsSync(TEST_LOG_PATH)) fs.unlinkSync(TEST_LOG_PATH);
    if (fs.existsSync(TEST_CONFIG_PATH)) fs.unlinkSync(TEST_CONFIG_PATH);
  });

  test('Phase 0 Schema: Character Existence verification logs exact schema with UUID and raw probability', async () => {
    const pipeline = new LayaQCPipeline({
      layaEndpoint: 'http://127.0.0.1:8765',
      logFilePath: TEST_LOG_PATH,
      mode: 'log_only'
    });

    pipeline._queryLaya = jest.fn().mockResolvedValue({
      answers: {
        is_character_present: {
          type: 'noul',
          noul: 0.7838,
          confidence: 0.7838
        }
      },
      elapsed_ms: 18,
      error: null
    });

    const result = await pipeline.verifyCharacterPresence({
      characterName: 'Anton Chigurh',
      citedIntro: 'Anton Chigurh took the quarter from the counter.',
      bookId: 'book_123',
      humanVerdict: null
    });

    expect(result.question_type).toBe('character_existence');
    expect(result.character_name).toBe('Anton Chigurh');
    expect(result.raw_probability).toBe(0.7838);
    expect(result.gate_status).toBe('needs_review'); // Phase 0 log-only mode

    // Verify logged to JSONL matching Phase 0 exact schema
    const logged = pipeline.loadLoggedDecisions();
    expect(logged.length).toBe(1);
    const rec = logged[0];
    expect(rec.id).toBeDefined();
    expect(rec.timestamp).toBeDefined();
    expect(rec.question_type).toBe('character_existence');
    expect(rec.qwen_claim).toBe('Anton Chigurh');
    expect(rec.laya_state).toBe('Anton Chigurh took the quarter from the counter.');
    expect(rec.laya_raw_probability).toBe(0.7838);
    expect(rec.laya_choice).toBe('present');
    expect(rec.human_verdict).toBeNull();
    expect(rec.book_id).toBe('book_123');
  });

  test('Gate 2: Relationship Citation Verification enforces taxonomy and flags unsupported citation', async () => {
    const pipeline = new LayaQCPipeline({
      layaEndpoint: 'http://127.0.0.1:8765',
      logFilePath: TEST_LOG_PATH,
      mode: 'log_only'
    });

    pipeline._queryLaya = jest.fn().mockResolvedValue({
      answers: {
        evidence_supports_relation: {
          type: 'noul',
          noul: 0.124,
          confidence: 0.876
        }
      },
      elapsed_ms: 19,
      error: null
    });

    const result = await pipeline.verifyRelationshipCitation({
      charA: 'Vera',
      charB: 'Veronika',
      relationType: 'family',
      citedEvidence: 'They looked at the sky together in silence.',
      bookId: 'book_456'
    });

    expect(result.question_type).toBe('relationship_evidence');
    expect(result.relation_type).toBe('family');
    expect(result.raw_probability).toBe(0.124);
    expect(result.decision).toBe('citation_unsupported');
    expect(result.alert_status).toBe('unsupported_citation');

    const logged = pipeline.loadLoggedDecisions();
    expect(logged.length).toBe(1);
    expect(logged[0].question_type).toBe('relationship_evidence');
    expect(logged[0].laya_choice).toBe('unsupported');
  });

  test('Gate 3: Speaker Attribution uses narrow window and hides Qwen label', async () => {
    const pipeline = new LayaQCPipeline({
      layaEndpoint: 'http://127.0.0.1:8765',
      logFilePath: TEST_LOG_PATH,
      mode: 'log_only'
    });

    pipeline._queryLaya = jest.fn().mockImplementation((state) => {
      expect(state).not.toContain('Qwen');
      expect(state).not.toContain('The Boy (claimed)');
      expect(state).toContain('Preceding:');
      expect(state).toContain('Spoken:');

      return Promise.resolve({
        answers: {
          speaker_choice: {
            type: 'choice',
            choice: 'The Boy',
            confidence: 0.65
          }
        },
        elapsed_ms: 22,
        error: null
      });
    });

    const result = await pipeline.verifySpeakerAttribution({
      spokenText: 'Are we going to die?',
      precedingText: 'He looked down at the dark road.',
      candidateCharacters: ['The Man', 'The Boy', 'Narrator'],
      qwenSpeaker: 'The Boy'
    });

    expect(result.question_type).toBe('speaker_attribution');
    expect(result.is_agreement).toBe(true);
    expect(result.laya_choice).toBe('The Boy');
    expect(result.raw_probability).toBe(0.65);
  });

  test('Gate 4: Emotion Verification decomposes into binary noul question', async () => {
    const pipeline = new LayaQCPipeline({
      layaEndpoint: 'http://127.0.0.1:8765',
      logFilePath: TEST_LOG_PATH,
      mode: 'log_only'
    });

    pipeline._queryLaya = jest.fn().mockImplementation((state, questions) => {
      expect(questions.emotion_check.type).toBe('noul');
      expect(questions.emotion_check.instructions).toContain('angry');

      return Promise.resolve({
        answers: {
          emotion_check: {
            type: 'noul',
            noul: 0.833,
            confidence: 0.833
          }
        },
        elapsed_ms: 17,
        error: null
      });
    });

    const result = await pipeline.verifyEmotion({
      spokenText: 'Where have you been Harry?',
      contextText: 'She slammed the glass down on the wooden counter.',
      qwenEmotion: 'angry'
    });

    expect(result.question_type).toBe('emotion');
    expect(result.qwen_emotion).toBe('angry');
    expect(result.raw_probability).toBe(0.833);
    expect(result.decision).toBe('verified');
  });

  test('Phase 2: recordHumanVerdict retroactively tags decision records for calibration', () => {
    const pipeline = new LayaQCPipeline({
      logFilePath: TEST_LOG_PATH,
      mode: 'log_only'
    });

    const logged = pipeline.logDecision({
      question_type: 'speaker_attribution',
      qwen_claim: 'The Boy',
      laya_choice: 'The Boy',
      laya_raw_probability: 0.72,
      is_agreement: true,
      human_verdict: null
    });

    expect(logged.human_verdict).toBeNull();

    // Human reviews and approves
    const updated = pipeline.recordHumanVerdict(logged.id, true, 'User verified card in Screenplay Editor');
    expect(updated).toBe(true);

    const reloaded = pipeline.loadLoggedDecisions();
    expect(reloaded[0].human_verdict).toBe(true);
    expect(reloaded[0].notes).toBe('User verified card in Screenplay Editor');
  });

  test('Phase 5: Dynamic config loading applies calibrated temperatures and thresholds', () => {
    // Write mock calibrated config
    fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      tasks: {
        character_existence: {
          fitted_temperature: 2.5,
          auto_approve_threshold: 0.85,
          review_threshold: 0.45
        }
      }
    }));

    const pipeline = new LayaQCPipeline({
      configFilePath: TEST_CONFIG_PATH,
      logFilePath: TEST_LOG_PATH,
      mode: 'active_gate'
    });

    const cal = pipeline._applyCalibration('character_existence', 0.99);
    expect(cal.is_calibrated).toBe(true);
    expect(cal.calibrated_probability).toBeLessThan(0.99); // Softened by T=2.5
    expect(cal.gate_status).toBe('auto_approved');
  });
});
