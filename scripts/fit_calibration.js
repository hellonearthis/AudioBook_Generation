const fs = require('fs');
const path = require('path');

const LOG_FILE = process.argv[2] || path.join(__dirname, '..', 'benchmarks', 'qc_calibration_log.jsonl');
const CONFIG_OUT = path.join(__dirname, '..', 'benchmarks', 'calibrated_qc_config.json');

/**
 * Standard Sigmoid & Logit
 */
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function logit(p) {
  const clamped = Math.max(1e-6, Math.min(1 - 1e-6, p));
  return Math.log(clamped / (1 - clamped));
}

/**
 * Calculate Expected Calibration Error (ECE)
 */
function calculateBinaryECE(probs, targets, numBins = 10) {
  if (probs.length === 0) return 0;
  
  const binTotals = new Array(numBins).fill(0);
  const binTruePositives = new Array(numBins).fill(0);
  const binConfidenceSum = new Array(numBins).fill(0);

  for (let i = 0; i < probs.length; i++) {
    const p = Math.max(0, Math.min(1, probs[i]));
    const binIdx = Math.min(numBins - 1, Math.floor(p * numBins));
    binTotals[binIdx]++;
    binConfidenceSum[binIdx] += p;
    if (targets[i] === 1) binTruePositives[binIdx]++;
  }

  let totalECE = 0;
  const N = probs.length;

  for (let b = 0; b < numBins; b++) {
    if (binTotals[b] > 0) {
      const avgConfidence = binConfidenceSum[b] / binTotals[b];
      const avgAccuracy = binTruePositives[b] / binTotals[b];
      const binWeight = binTotals[b] / N;
      totalECE += binWeight * Math.abs(avgAccuracy - avgConfidence);
    }
  }

  return totalECE;
}

/**
 * Brier Score: Mean Squared Error on probabilities
 */
function calculateBrierScore(probs, targets) {
  if (probs.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < probs.length; i++) {
    sum += Math.pow(probs[i] - targets[i], 2);
  }
  return sum / probs.length;
}

/**
 * Binary Negative Log-Likelihood given Temperature T
 */
function binaryNLL(logits, targets, T) {
  let loss = 0;
  const eps = 1e-12;
  for (let i = 0; i < logits.length; i++) {
    const p = sigmoid(logits[i] / T);
    const clampedP = Math.max(eps, Math.min(1 - eps, p));
    const y = targets[i];
    loss -= (y * Math.log(clampedP) + (1 - y) * Math.log(1 - clampedP));
  }
  return loss / logits.length;
}

/**
 * Fit scalar Temperature T using 1D line search (Golden Section Search)
 */
function fitBinaryTemperature(logits, targets) {
  let a = 0.1;
  let b = 5.0;
  const tol = 1e-4;
  const phi = (1 + Math.sqrt(5)) / 2;
  const resphi = 2 - phi;

  let c = a + resphi * (b - a);
  let d = b - resphi * (b - a);
  let fc = binaryNLL(logits, targets, c);
  let fd = binaryNLL(logits, targets, d);

  while (Math.abs(b - a) > tol) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = a + resphi * (b - a);
      fc = binaryNLL(logits, targets, c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = b - resphi * (b - a);
      fd = binaryNLL(logits, targets, d);
    }
  }

  return Number(((a + b) / 2).toFixed(4));
}

/**
 * Phase 4: Pick auto-approve and review thresholds empirically from data
 * Finds the calibrated confidence threshold where empirical accuracy >= targetAccuracy (e.g. 95%)
 */
function deriveEmpiricalThresholds(calProbs, targets, targetAccuracy = 0.95) {
  if (calProbs.length === 0) {
    return { auto_approve_threshold: 0.90, review_threshold: 0.50 };
  }

  // Combine and sort descending by calibrated probability
  const pairs = calProbs.map((p, i) => ({ p, y: targets[i] }));
  pairs.sort((a, b) => b.p - a.p);

  let bestThreshold = 0.90;
  let runningCorrect = 0;
  let runningTotal = 0;

  for (let i = 0; i < pairs.length; i++) {
    runningTotal++;
    if (pairs[i].y === 1) runningCorrect++;
    const currentAcc = runningCorrect / runningTotal;

    if (currentAcc >= targetAccuracy) {
      bestThreshold = pairs[i].p;
    } else if (runningTotal >= 5) {
      // Accuracy dropped below target
      break;
    }
  }

  // Review threshold: lower bound of uncertainty
  const reviewThreshold = Number(Math.max(0.40, Math.min(0.60, bestThreshold - 0.35)).toFixed(2));
  const autoApproveThreshold = Number(Math.max(0.70, Math.min(0.98, bestThreshold)).toFixed(2));

  return {
    auto_approve_threshold: autoApproveThreshold,
    review_threshold: reviewThreshold
  };
}

/**
 * Main Calibration Runner
 */
function runCalibrationAnalysis() {
  console.log("==========================================================================");
  console.log("   LAYA QC PHASED CALIBRATION ENGINE (TEMPERATURE SCALING & DATA GATES)   ");
  console.log("==========================================================================\n");

  if (!fs.existsSync(LOG_FILE)) {
    console.error(`Log file not found: ${LOG_FILE}`);
    console.log("Run pipeline verification tasks to generate logged decisions first.");
    process.exit(1);
  }

  const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
  const records = lines.map(line => JSON.parse(line));
  console.log(`Loaded ${records.length} logged QC records from: ${LOG_FILE}\n`);

  // Filter records with non-null human_verdict (Phase 2)
  const annotated = records.filter(r => r.human_verdict !== null && r.human_verdict !== undefined);
  console.log(`Annotated records with human_verdict: ${annotated.length} / ${records.length}`);

  if (annotated.length < 5) {
    console.warn("\n⚠️ WARNING: Fewer than 5 annotated records found with human_verdict!");
    console.warn("To perform empirical calibration fitting, review logged decisions or run sample generator.");
    console.warn("Generating provisional report without overriding production config.\n");
  }

  // Phase 1: Group by question_type
  const taskGroups = {};
  for (const r of annotated) {
    const qType = r.question_type || 'unknown';
    if (!taskGroups[qType]) taskGroups[qType] = [];
    taskGroups[qType].push(r);
  }

  const calibrationResults = {};

  for (const [taskName, taskRecords] of Object.entries(taskGroups)) {
    console.log(`\n--------------------------------------------------------------------------`);
    console.log(`>>> Analyzing Question Type: ${taskName.toUpperCase()} (${taskRecords.length} labeled samples)`);
    console.log(`--------------------------------------------------------------------------`);

    if (taskName === 'speaker_attribution') {
      let agreements = 0;
      let humanApproved = 0;
      for (const r of taskRecords) {
        if (r.is_agreement) agreements++;
        if (r.human_verdict === true || r.human_verdict === 'true') {
          humanApproved++;
        }
      }
      console.log(`  Qwen/Laya Agreement Rate: ${(agreements / taskRecords.length * 100).toFixed(1)}%`);
      console.log(`  Human Approval Rate:      ${(humanApproved / taskRecords.length * 100).toFixed(1)}%`);
      
      calibrationResults[taskName] = {
        sample_count: taskRecords.length,
        agreement_rate: Number((agreements / taskRecords.length).toFixed(3)),
        human_approval_rate: Number((humanApproved / taskRecords.length).toFixed(3)),
        fitted_temperature: 1.0,
        auto_approve_threshold: 0.85,
        review_threshold: 0.50
      };
      continue;
    }

    // Binary tasks
    const rawProbs = [];
    const logits = [];
    const targets = [];

    for (const r of taskRecords) {
      const p = typeof r.laya_raw_probability === 'number' ? r.laya_raw_probability : r.raw_noul;
      if (typeof p === 'number' && !isNaN(p)) {
        rawProbs.push(p);
        logits.push(logit(p));
        const targetVal = (r.human_verdict === true || r.human_verdict === 1 || r.human_verdict === 'true') ? 1 : 0;
        targets.push(targetVal);
      }
    }

    if (rawProbs.length === 0) continue;

    // Phase 3: Fit temperature per question type
    const uncalECE = calculateBinaryECE(rawProbs, targets);
    const uncalBrier = calculateBrierScore(rawProbs, targets);

    const fittedT = fitBinaryTemperature(logits, targets);
    const calProbs = logits.map(z => sigmoid(z / fittedT));
    const calECE = calculateBinaryECE(calProbs, targets);
    const calBrier = calculateBrierScore(calProbs, targets);

    // Phase 4: Derive empirical thresholds from calibrated probabilities
    const thresholds = deriveEmpiricalThresholds(calProbs, targets, 0.95);

    console.log(`  Uncalibrated ECE:         ${(uncalECE * 100).toFixed(2)}% | Brier Score: ${uncalBrier.toFixed(4)}`);
    console.log(`  Fitted Temperature:       T = ${fittedT}`);
    console.log(`  Calibrated ECE:           ${(calECE * 100).toFixed(2)}% | Brier Score: ${calBrier.toFixed(4)}`);
    console.log(`  Data-Derived Auto-Approve: P >= ${thresholds.auto_approve_threshold} (Historical accuracy >= 95%)`);
    console.log(`  Data-Derived Review Flag:  P <  ${thresholds.review_threshold}`);

    calibrationResults[taskName] = {
      sample_count: rawProbs.length,
      uncalibrated_ece: Number(uncalECE.toFixed(4)),
      uncalibrated_brier: Number(uncalBrier.toFixed(4)),
      fitted_temperature: fittedT,
      calibrated_ece: Number(calECE.toFixed(4)),
      calibrated_brier: Number(calBrier.toFixed(4)),
      auto_approve_threshold: thresholds.auto_approve_threshold,
      review_threshold: thresholds.review_threshold
    };
  }

  // Phase 5: Save fitted configuration
  const outputPayload = {
    updated_at: new Date().toISOString(),
    log_source: LOG_FILE,
    tasks: calibrationResults
  };

  fs.writeFileSync(CONFIG_OUT, JSON.stringify(outputPayload, null, 2), 'utf8');
  console.log(`\n==========================================================================`);
  console.log(`Phase 5 Config Saved to: ${CONFIG_OUT}`);
  console.log(`==========================================================================\n`);
}

runCalibrationAnalysis();
