const fs = require('fs');
const path = require('path');
const { LayaQCPipeline, DEFAULT_LOG_PATH } = require('../laya_qc_pipeline');

async function runSampleGeneration() {
  console.log("Generating Phase 0 QC decisions against live Laya server (port 8765)...");
  const pipeline = new LayaQCPipeline({
    layaEndpoint: 'http://127.0.0.1:8765',
    logFilePath: DEFAULT_LOG_PATH,
    mode: 'log_only' // Phase 0 mode
  });

  // Clear previous log for fresh run
  if (fs.existsSync(DEFAULT_LOG_PATH)) {
    fs.unlinkSync(DEFAULT_LOG_PATH);
  }

  const bookId = "mccarthy_the_road";

  // 1. Character Existence (Pass 1A)
  console.log("Running Gate 1: Character Existence checks...");
  const charTests = [
    { name: "Anton Chigurh", intro: "Anton Chigurh took the quarter from the counter and held it in his hand.", gt: true },
    { name: "Anton Chigurh", intro: "The man looked at him. He took the quarter from the counter.", gt: false },
    { name: "Harry", intro: "Where have you been Harry? She stood by the stoop with her arms crossed.", gt: true },
    { name: "Marion", intro: "He turned the corner and felt the chill cut through his thin jacket.", gt: false },
    { name: "The Man", intro: "Can I ask you something? he said. Yes. Of course you can.", gt: true },
    { name: "The Doctor", intro: "Can I ask you something? he said. Yes. Of course you can.", gt: false }
  ];
  for (const c of charTests) {
    await pipeline.verifyCharacterPresence({
      characterName: c.name,
      citedIntro: c.intro,
      bookId,
      humanVerdict: c.gt
    });
  }

  // 2. Relationship Evidence Citation (Pass 1B)
  console.log("Running Gate 2: Relationship Evidence Citation checks...");
  const relTests = [
    { a: "Anton Chigurh", b: "Proprietor", rel: "adversarial", cite: "Step out of the car or I will shoot you, Anton said, leveling the pistol.", gt: true },
    { a: "Anton Chigurh", b: "Proprietor", rel: "romantic", cite: "Step out of the car or I will shoot you, Anton said, leveling the pistol.", gt: false },
    { a: "The Man", b: "The Boy", rel: "family", cite: "He reached out and smoothed the boy's matted hair. We're still the good guys, he whispered.", gt: true },
    { a: "The Man", b: "The Boy", rel: "professional", cite: "He reached out and smoothed the boy's matted hair. We're still the good guys, he whispered.", gt: false },
    { a: "Harry", b: "Marion", rel: "romantic", cite: "She wrapped her arms around his waist and rested her head on his shoulder.", gt: true },
    { a: "Harry", b: "Marion", rel: "adversarial", cite: "She wrapped her arms around his waist and rested her head on his shoulder.", gt: false }
  ];
  for (const r of relTests) {
    await pipeline.verifyRelationshipCitation({
      charA: r.a,
      charB: r.b,
      relationType: r.rel,
      citedEvidence: r.cite,
      bookId,
      humanVerdict: r.gt
    });
  }

  // 3. Emotion Verification (Pass 3)
  console.log("Running Gate 4: Emotion checks...");
  const emoTests = [
    { line: "Where have you been Harry?", ctx: "She slammed the glass down, her voice trembling with rage.", emo: "angry", gt: true },
    { line: "Where have you been Harry?", ctx: "She slammed the glass down, her voice trembling with rage.", emo: "calm", gt: false },
    { line: "We're going to die, aren't we?", ctx: "The boy huddled under the wet blanket, shivering in terror.", emo: "fearful", gt: true },
    { line: "We're going to die, aren't we?", ctx: "The boy huddled under the wet blanket, shivering in terror.", emo: "happy", gt: false },
    { line: "Don't make a sound. They are right outside.", ctx: "He leaned down close to her ear, barely breathing the words.", emo: "whisper", gt: true },
    { line: "Don't make a sound. They are right outside.", ctx: "He leaned down close to her ear, barely breathing the words.", emo: "excited", gt: false }
  ];
  for (const e of emoTests) {
    await pipeline.verifyEmotion({
      spokenText: e.line,
      contextText: e.ctx,
      qwenEmotion: e.emo,
      bookId,
      humanVerdict: e.gt
    });
  }

  // 4. Narrow-Window Speaker Attribution (Pass 2)
  console.log("Running Gate 3: Narrow-window Speaker Attribution checks...");
  const speakTests = [
    { line: "Can I ask you something?", pre: "The boy looked up from his sleeping roll.", cand: ["The Man", "The Boy", "Narrator"], qwen: "The Boy", gt: true },
    { line: "Yes. Of course you can.", pre: "The boy asked if he could speak.", cand: ["The Man", "The Boy", "Narrator"], qwen: "The Man", gt: true },
    { line: "Are we going to die?", pre: "He looked at his father with wide eyes.", cand: ["The Man", "The Boy", "Narrator"], qwen: "The Boy", gt: true },
    { line: "Sometime. Not now.", pre: "The man smiled gently and put his hand on his son's shoulder.", cand: ["The Man", "The Boy", "Narrator"], qwen: "The Man", gt: true },
    { line: "You need to put it up.", pre: "Chigurh set the coin flat on the wood.", cand: ["Anton Chigurh", "Proprietor", "Narrator"], qwen: "Anton Chigurh", gt: true },
    { line: "What's that?", pre: "The old man behind the counter blinked.", cand: ["Anton Chigurh", "Proprietor", "Narrator"], qwen: "Proprietor", gt: true }
  ];
  for (const s of speakTests) {
    await pipeline.verifySpeakerAttribution({
      spokenText: s.line,
      precedingText: s.pre,
      candidateCharacters: s.cand,
      qwenSpeaker: s.qwen,
      bookId,
      humanVerdict: s.gt
    });
  }

  console.log("\nDone! All Phase 0 decisions logged to:", DEFAULT_LOG_PATH);
}

runSampleGeneration().catch(console.error);
