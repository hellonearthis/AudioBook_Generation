const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  CANONICAL_RELATIONSHIP_TYPES_LIST,
  CANONICAL_RELATIONSHIP_TONES_LIST
} = require('./services/relationship_state_service');

/**
 * Laya Quality Control (QC) Pipeline
 * 
 * Strict Phase 0-5 Implementation:
 * Phase 0: Log-only mode. Every Qwen/Laya call writes a standardized record
 *          with raw probabilities before any gating touches it.
 * Phase 1: Separate tracking by question_type (character_existence, relationship_evidence,
 *          speaker_attribution, emotion).
 * Phase 2: Capture human_verdict (true/false) as a natural byproduct of user review actions.
 * Phase 3: Fit 1-parameter temperature scaling per question_type.
 * Phase 4: Pick auto-approve and review thresholds empirically from calibrated-confidence vs. accuracy curves.
 * Phase 5: Re-calibrate dynamically as domains or manuscripts shift by loading config.
 */

const DEFAULT_LOG_PATH = path.join(__dirname, 'benchmarks', 'qc_calibration_log.jsonl');
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'benchmarks', 'calibrated_qc_config.json');

class LayaQCPipeline {
  /**
   * @param {Object} options
   * @param {string} [options.layaEndpoint='http://127.0.0.1:8765'] Base URL for Laya server
   * @param {string} [options.logFilePath] Path to append-only calibration JSONL log
   * @param {string} [options.configFilePath] Path to calibrated config JSON
   * @param {'log_only'|'active_gate'} [options.mode='log_only'] Operational mode
   */
  constructor(options = {}) {
    this.layaEndpoint = (options.layaEndpoint || 'http://127.0.0.1:8765').replace(/\/+$/, '');
    this.logFilePath = options.logFilePath || DEFAULT_LOG_PATH;
    this.configFilePath = options.configFilePath || DEFAULT_CONFIG_PATH;
    this.mode = options.mode || 'log_only'; // Phase 0 default: log-only mode

    // Ensure parent log directory exists
    const logDir = path.dirname(this.logFilePath);
    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
      } catch (err) {
        console.warn('LayaQCPipeline: Could not create log directory', err.message);
      }
    }

    // Load calibrated config if available (Phase 5)
    this.calibrationConfig = this.loadCalibrationConfig();
  }

  /**
   * Load calibrated temperatures and thresholds from disk if available.
   * @returns {Object}
   */
  loadCalibrationConfig() {
    if (fs.existsSync(this.configFilePath)) {
      try {
        const raw = fs.readFileSync(this.configFilePath, 'utf8');
        return JSON.parse(raw);
      } catch (err) {
        console.warn('LayaQCPipeline: Failed to load calibration config, using uncalibrated defaults.', err.message);
      }
    }
    return { tasks: {} };
  }

  /**
   * Log an uncalibrated QC decision matching Phase 0 exact schema.
   * 
   * Schema:
   * {
   *   "id": "uuid",
   *   "timestamp": "ISO string",
   *   "question_type": "character_existence | relationship_evidence | speaker_attribution | emotion",
   *   "qwen_claim": "...",
   *   "laya_state": "...",
   *   "laya_criteria": { "...": "..." },
   *   "laya_raw_probability": 0.7838,
   *   "laya_choice": "...",
   *   "human_verdict": null,
   *   "book_id": "...",
   *   "notes": null
   * }
   */
  logDecision(entry) {
    const record = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      question_type: entry.question_type,
      qwen_claim: entry.qwen_claim !== undefined ? entry.qwen_claim : null,
      laya_state: entry.laya_state || '',
      laya_criteria: entry.laya_criteria || {},
      laya_raw_probability: typeof entry.laya_raw_probability === 'number' ? entry.laya_raw_probability : 0.5,
      laya_choice: entry.laya_choice || null,
      human_verdict: entry.human_verdict !== undefined ? entry.human_verdict : null,
      book_id: entry.book_id || 'default_book',
      notes: entry.notes || null,
      // Metadata fields for debugging/runtime tracing
      elapsed_ms: entry.elapsed_ms || 0,
      is_agreement: entry.is_agreement !== undefined ? entry.is_agreement : null
    };

    try {
      fs.appendFileSync(this.logFilePath, JSON.stringify(record) + '\n', 'utf8');
    } catch (err) {
      console.warn('LayaQCPipeline: Failed to append to calibration log', err.message);
    }
    return record;
  }

  /**
   * Read all logged QC decisions from disk for calibration fitting (Phase 1-3).
   * @returns {Array<Object>} List of logged decision records
   */
  loadLoggedDecisions() {
    if (!fs.existsSync(this.logFilePath)) return [];
    try {
      const content = fs.readFileSync(this.logFilePath, 'utf8');
      return content
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => JSON.parse(line));
    } catch (err) {
      console.warn('LayaQCPipeline: Failed to read calibration log', err.message);
      return [];
    }
  }

  /**
   * Update a logged record with a human verdict (Phase 2).
   * Called automatically when a user reviews, approves, or edits a script line or character.
   * 
   * @param {string} recordId UUID of the decision record
   * @param {boolean} verdict True if Qwen/Laya was correct, false if user corrected it
   * @param {string|null} [notes=null] Optional notes from human editor
   * @returns {boolean} True if record was found and updated
   */
  recordHumanVerdict(recordId, verdict, notes = null) {
    if (!fs.existsSync(this.logFilePath)) return false;
    try {
      const lines = fs.readFileSync(this.logFilePath, 'utf8').split('\n').filter(Boolean);
      let updated = false;

      const newLines = lines.map(line => {
        const record = JSON.parse(line);
        if (record.id === recordId) {
          record.human_verdict = verdict;
          if (notes) record.notes = notes;
          updated = true;
        }
        return JSON.stringify(record);
      });

      if (updated) {
        fs.writeFileSync(this.logFilePath, newLines.join('\n') + '\n', 'utf8');
      }
      return updated;
    } catch (err) {
      console.warn('LayaQCPipeline: Failed to record human verdict', err.message);
      return false;
    }
  }

  /**
   * Dispatch raw question payload to Laya /decide endpoint.
   * @private
   */
  async _queryLaya(state, questions) {
    const t0 = performance.now();
    try {
      const cleanEndpoint = this.layaEndpoint.replace(/\/+$/, "");
      const targetUrl = cleanEndpoint.endsWith("/v1/systemone") || cleanEndpoint.endsWith("/decide")
        ? cleanEndpoint
        : (cleanEndpoint.includes("8700") || cleanEndpoint.endsWith("/v1")
            ? (cleanEndpoint.endsWith("/v1") ? `${cleanEndpoint}/systemone` : `${cleanEndpoint}/v1/systemone`)
            : `${cleanEndpoint}/decide`);

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, questions })
      });

      if (!response.ok) {
        throw new Error(`Laya HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const elapsed_ms = performance.now() - t0;
      return {
        answers: data.answers || {},
        elapsed_ms,
        usage: data.usage || null,
        error: null
      };
    } catch (err) {
      const elapsed_ms = performance.now() - t0;
      return {
        answers: {},
        elapsed_ms,
        usage: null,
        error: err.message
      };
    }
  }

  // WHAT: Applies empirical temperature scaling calibration and decision thresholds for a specific QC task.
  // WHY: Deep discriminative models often output uncalibrated probabilities that are over- or under-confident.
  //      Temperature scaling adjusts confidence without altering relative ranking. If a task was fitted on
  //      a small sample (N < 30) or landed on an optimizer search boundary, we treat it as provisional and apply
  //      conservative dampening so that premature extreme saturation does not compromise active quality gates.
  _applyCalibration(task_question_type_identifier, raw_input_probability_value) {
    const task_calibration_configuration = this.calibrationConfig.tasks?.[task_question_type_identifier];
    if (!task_calibration_configuration || !task_calibration_configuration.fitted_temperature) {
      // WHAT: Fallback path when no empirical calibration profile exists for this task.
      // WHY: Safe default prevents pipeline halting; passes through raw confidence with review flag.
      return {
        calibrated_probability: raw_input_probability_value,
        is_calibrated: false,
        is_provisional: true,
        boundary_pegged: false,
        gate_status: 'needs_review'
      };
    }

    const raw_fitted_temperature_scalar = task_calibration_configuration.fitted_temperature;
    const is_provisional_sample = Boolean(task_calibration_configuration.is_provisional);
    const has_hit_search_boundary = Boolean(task_calibration_configuration.boundary_pegged);

    // WHAT: Guarding against severe overfitting on small samples where temperature landed on boundary.
    // WHY: When samples are linearly separable with small N (e.g. N=6), T collapses to lower bound (e.g. 0.05),
    //      causing extreme probability polarization (0.0 or 1.0). In production gates, we dampen the temperature
    //      to a conservative bound [0.5, 2.0] until sufficient human verdicts (N >= 30) are logged.
    let effective_calibration_temperature_scalar = raw_fitted_temperature_scalar;
    if (has_hit_search_boundary && is_provisional_sample) {
      effective_calibration_temperature_scalar = Math.max(0.5, Math.min(2.0, raw_fitted_temperature_scalar));
    }

    const numerical_stability_epsilon = 1e-6;
    const clamped_probability_value = Math.max(
      numerical_stability_epsilon,
      Math.min(1 - numerical_stability_epsilon, raw_input_probability_value)
    );
    const calculated_log_odds_logit = Math.log(clamped_probability_value / (1 - clamped_probability_value));
    const calibrated_scaled_probability = 1 / (1 + Math.exp(-calculated_log_odds_logit / effective_calibration_temperature_scalar));

    const auto_approve_minimum_threshold = task_calibration_configuration.auto_approve_threshold || 0.90;
    const human_review_warning_threshold = task_calibration_configuration.review_threshold || 0.50;

    let evaluated_quality_gate_status = 'needs_review';
    if (calibrated_scaled_probability >= auto_approve_minimum_threshold) {
      evaluated_quality_gate_status = 'auto_approved';
    } else if (calibrated_scaled_probability < human_review_warning_threshold) {
      evaluated_quality_gate_status = 'flagged_disagreement';
    }

    return {
      calibrated_probability: Number(calibrated_scaled_probability.toFixed(4)),
      is_calibrated: true,
      is_provisional: is_provisional_sample,
      boundary_pegged: has_hit_search_boundary,
      effective_temperature: effective_calibration_temperature_scalar,
      gate_status: evaluated_quality_gate_status
    };
  }

  // =========================================================================
  // GATE 1: Character Existence Verification (Pass 1A)
  // =========================================================================
  /**
   * @param {Object} params
   * @param {string} params.characterName Name of the character
   * @param {string} params.citedIntro Sentence or short passage where character is introduced
   * @param {string} [params.bookId='default_book'] ID of the active book
   * @param {boolean|null} [params.humanVerdict=null] Ground truth if known
   * @returns {Promise<Object>} Verification result with raw uncalibrated probabilities
   */
  async verifyCharacterPresence({ characterName, citedIntro, bookId = 'default_book', humanVerdict = null }) {
    const questionKey = 'is_character_present';
    const instructions = `Does this passage feature, introduce, or mention a character named ${characterName}?`;
    const questions = {
      [questionKey]: {
        type: 'noul',
        instructions
      }
    };

    const layaRes = await this._queryLaya(citedIntro, questions);
    const answer = layaRes.answers[questionKey] || {};
    const raw_noul = typeof answer.noul === 'number' ? answer.noul : 0.5;

    const calInfo = this._applyCalibration('character_existence', raw_noul);

    const logEntry = this.logDecision({
      question_type: 'character_existence',
      qwen_claim: characterName,
      laya_state: citedIntro,
      laya_criteria: { instructions },
      laya_raw_probability: raw_noul,
      laya_choice: raw_noul >= 0.5 ? 'present' : 'absent',
      human_verdict: humanVerdict,
      book_id: bookId,
      elapsed_ms: layaRes.elapsed_ms
    });

    return {
      id: logEntry.id,
      question_type: 'character_existence',
      character_name: characterName,
      raw_probability: raw_noul,
      calibrated_probability: calInfo.calibrated_probability,
      is_provisional: calInfo.is_provisional,
      boundary_pegged: calInfo.boundary_pegged,
      decision: raw_noul >= 0.5 ? 'verified' : 'unverified',
      calibrated_gate_status: calInfo.gate_status,
      gate_status: this.mode === 'log_only' ? 'needs_review' : calInfo.gate_status,
      pipeline_mode: this.mode,
      elapsed_ms: layaRes.elapsed_ms,
      error: layaRes.error
    };
  }

  // =========================================================================
  // GATE 2: Relationship Evidence Citation Verification (Pass 1B)
  // =========================================================================
  /**
   * @param {Object} params
   * @param {string} params.charA First character
   * @param {string} params.charB Second character
   * @param {string} params.relationType Claimed relation from CANONICAL_RELATIONSHIP_TYPES_LIST
   * @param {string} [params.relationTone] Optional interpersonal tone from CANONICAL_RELATIONSHIP_TONES_LIST
   * @param {string} params.citedEvidence Exact 1-2 sentence excerpt cited as evidence
   * @param {string} [params.bookId='default_book'] ID of the active book
   * @param {boolean|null} [params.humanVerdict=null] Ground truth if known
   * @returns {Promise<Object>} Verification result
   */
  async verifyRelationshipCitation({ charA, charB, relationType, relationTone = null, citedEvidence, bookId = 'default_book', humanVerdict = null }) {
    // WHAT: Validating claimed relationship type against shared canonical taxonomy.
    // WHY: Prevents desynchronization with Pass 1 cast discovery and Pass 2.5 relationship state engine.
    const normalized_relation_type_candidate = (relationType || '').toLowerCase().trim();
    const normalizedType = CANONICAL_RELATIONSHIP_TYPES_LIST.includes(normalized_relation_type_candidate)
      ? normalized_relation_type_candidate
      : 'unknown';

    const normalizedTone = (relationTone && CANONICAL_RELATIONSHIP_TONES_LIST.includes(relationTone.toLowerCase().trim()))
      ? relationTone.toLowerCase().trim()
      : null;

    const questionKey = 'evidence_supports_relation';
    const toneDescription = normalizedTone ? ` with a ${normalizedTone} tone` : '';
    const instructions = `Does this cited passage provide direct evidence of a ${normalizedType} relationship${toneDescription} between ${charA} and ${charB}?`;
    const questions = {
      [questionKey]: {
        type: 'noul',
        instructions
      }
    };

    const layaRes = await this._queryLaya(citedEvidence, questions);
    const answer = layaRes.answers[questionKey] || {};
    const raw_noul = typeof answer.noul === 'number' ? answer.noul : 0.5;

    const calInfo = this._applyCalibration('relationship_evidence', raw_noul);

    const logEntry = this.logDecision({
      question_type: 'relationship_evidence',
      qwen_claim: `${charA} <-> ${charB}: ${normalizedType}${normalizedTone ? ` (${normalizedTone})` : ''}`,
      laya_state: citedEvidence,
      laya_criteria: { instructions },
      laya_raw_probability: raw_noul,
      laya_choice: raw_noul >= 0.5 ? 'supported' : 'unsupported',
      human_verdict: humanVerdict,
      book_id: bookId,
      elapsed_ms: layaRes.elapsed_ms
    });

    return {
      id: logEntry.id,
      question_type: 'relationship_evidence',
      char_a: charA,
      char_b: charB,
      relation_type: normalizedType,
      relation_tone: normalizedTone,
      raw_probability: raw_noul,
      calibrated_probability: calInfo.calibrated_probability,
      is_provisional: calInfo.is_provisional,
      boundary_pegged: calInfo.boundary_pegged,
      decision: raw_noul >= 0.5 ? 'citation_supported' : 'citation_unsupported',
      alert_status: raw_noul >= 0.5 ? 'ok' : 'unsupported_citation',
      calibrated_gate_status: calInfo.gate_status,
      gate_status: this.mode === 'log_only' ? 'needs_review' : calInfo.gate_status,
      pipeline_mode: this.mode,
      elapsed_ms: layaRes.elapsed_ms,
      error: layaRes.error
    };
  }

  // =========================================================================
  // GATE 3: Narrow-Window Dialogue Attribution Verification (Pass 2)
  // =========================================================================
  /**
   * @param {Object} params
   * @param {string} params.spokenText Spoken dialogue span
   * @param {string} params.precedingText Narrow 1-2 line window immediately preceding dialogue
   * @param {Array<string>} params.candidateCharacters Closed list of candidate character names
   * @param {string} params.qwenSpeaker Speaker predicted by Qwen/LLM
   * @param {string} [params.bookId='default_book'] ID of the active book
   * @param {boolean|null} [params.humanVerdict=null] Ground truth if known
   * @returns {Promise<Object>} Verification result with raw probabilities and agreement status
   */
  async verifySpeakerAttribution({ spokenText, precedingText, candidateCharacters, qwenSpeaker, bookId = 'default_book', humanVerdict = null }) {
    const questionKey = 'speaker_choice';
    const criteria = {};
    for (const char of candidateCharacters) {
      if (char.toLowerCase() === 'narrator') {
        criteria[char] = 'narrative exposition, scene description, setting, third-person commentary';
      } else {
        criteria[char] = `Spoken words spoken by ${char}`;
      }
    }

    const narrowState = `Preceding: ${precedingText || '(start of scene)'}\nSpoken: "${spokenText}"`;
    const instructions = `Who speaks the line "${spokenText}"?`;
    const questions = {
      [questionKey]: {
        type: 'choice',
        instructions,
        criteria
      }
    };

    const layaRes = await this._queryLaya(narrowState, questions);
    const answer = layaRes.answers[questionKey] || {};
    const laya_choice = answer.choice || candidateCharacters[0] || 'Narrator';
    const raw_confidence = typeof answer.confidence === 'number' ? answer.confidence : 0.5;

    const is_agreement = qwenSpeaker && laya_choice && 
      (qwenSpeaker.trim().toLowerCase() === laya_choice.trim().toLowerCase());

    const calInfo = this._applyCalibration('speaker_attribution', raw_confidence);

    const logEntry = this.logDecision({
      question_type: 'speaker_attribution',
      qwen_claim: qwenSpeaker,
      laya_state: narrowState,
      laya_criteria: criteria,
      laya_raw_probability: raw_confidence,
      laya_choice,
      is_agreement,
      human_verdict: humanVerdict,
      book_id: bookId,
      elapsed_ms: layaRes.elapsed_ms
    });

    return {
      id: logEntry.id,
      question_type: 'speaker_attribution',
      spoken_text: spokenText,
      qwen_speaker: qwenSpeaker,
      laya_choice,
      raw_probability: raw_confidence,
      calibrated_probability: calInfo.calibrated_probability,
      is_provisional: calInfo.is_provisional,
      boundary_pegged: calInfo.boundary_pegged,
      is_agreement,
      calibrated_gate_status: calInfo.gate_status,
      gate_status: this.mode === 'log_only' ? 'needs_review' : calInfo.gate_status,
      pipeline_mode: this.mode,
      elapsed_ms: layaRes.elapsed_ms,
      error: layaRes.error
    };
  }

  // =========================================================================
  // GATE 4: Decomposed Binary Emotion Verification (Pass 3)
  // =========================================================================
  /**
   * @param {Object} params
   * @param {string} params.spokenText Spoken dialogue span
   * @param {string} params.contextText Surrounding dialogue context / speech tag
   * @param {string} params.qwenEmotion Claimed emotion (e.g. angry, calm, whisper, fearful)
   * @param {string} [params.bookId='default_book'] ID of the active book
   * @param {boolean|null} [params.humanVerdict=null] Ground truth if known
   * @returns {Promise<Object>} Verification result with raw noul probability
   */
  async verifyEmotion({ spokenText, contextText, qwenEmotion, bookId = 'default_book', humanVerdict = null }) {
    const questionKey = 'emotion_check';
    const cleanEmotion = (qwenEmotion || 'calm').trim().toLowerCase();
    const instructions = `Does the speaker deliver the line "${spokenText}" with a ${cleanEmotion} tone or delivery?`;

    const questions = {
      [questionKey]: {
        type: 'noul',
        instructions
      }
    };

    const state = `${contextText || ''}\nLine: "${spokenText}"`.trim();
    const layaRes = await this._queryLaya(state, questions);
    const answer = layaRes.answers[questionKey] || {};
    const raw_noul = typeof answer.noul === 'number' ? answer.noul : 0.5;

    const calInfo = this._applyCalibration('emotion', raw_noul);

    const logEntry = this.logDecision({
      question_type: 'emotion',
      qwen_claim: cleanEmotion,
      laya_state: state,
      laya_criteria: { instructions },
      laya_raw_probability: raw_noul,
      laya_choice: raw_noul >= 0.5 ? cleanEmotion : 'other_tone',
      human_verdict: humanVerdict,
      book_id: bookId,
      elapsed_ms: layaRes.elapsed_ms
    });

    return {
      id: logEntry.id,
      question_type: 'emotion',
      spoken_text: spokenText,
      qwen_emotion: cleanEmotion,
      raw_probability: raw_noul,
      calibrated_probability: calInfo.calibrated_probability,
      is_provisional: calInfo.is_provisional,
      boundary_pegged: calInfo.boundary_pegged,
      decision: raw_noul >= 0.5 ? 'verified' : 'unverified',
      calibrated_gate_status: calInfo.gate_status,
      gate_status: this.mode === 'log_only' ? 'needs_review' : calInfo.gate_status,
      pipeline_mode: this.mode,
      elapsed_ms: layaRes.elapsed_ms,
      error: layaRes.error
    };
  }
}

module.exports = {
  LayaQCPipeline,
  DEFAULT_LOG_PATH,
  DEFAULT_CONFIG_PATH
};
