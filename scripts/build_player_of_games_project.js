// =========================================================================
// THE PLAYER OF GAMES: MULTI-CHAPTER PROJECT CREATOR & SCENE CAST ANALYZER
// =========================================================================
// WHAT: Creates a complete multi-chapter audiobook project for "The Player of Games"
//       by Iain M. Banks. Processes all 115 scene files across all 4 parts, extracts
//       scene-level cast presence, constructs the unified global voice matrix,
//       relationship state timelines, pronunciation lexicon, and persists
//       the project structure to project_state.json and book.txt.
// WHY: Automates production onboarding for literary multi-scene novels, ensuring
//       character identities and acoustic profiles are consistently mapped
//       across the entire 115,000+ word manuscript.

const fs = require("fs");
const path = require("path");
const http = require("http");

// Pure word counter function adhering to zero-allocation regex pattern
function count_words_in_text(text_content) {
  if (!text_content || typeof text_content !== "string") {
    return 0;
  }
  const non_whitespace_regex = /\S+/g;
  let word_counter = 0;
  while (non_whitespace_regex.exec(text_content) !== null) {
    word_counter++;
  }
  return word_counter;
}

// Canonical parts configuration for The Player of Games
const PARTS_CONFIG = [
  {
    folder: "part_1_culture_plate",
    part_number: 1,
    part_title: "Part 1: Culture Plate",
    scene_prefix: "p1"
  },
  {
    folder: "part_2_imperium",
    part_number: 2,
    part_title: "Part 2: Imperium",
    scene_prefix: "p2"
  },
  {
    folder: "part_3_machina_ex_machina",
    part_number: 3,
    part_title: "Part 3: Machina Ex Machina",
    scene_prefix: "p3"
  },
  {
    folder: "part_4_the_passed_pawn",
    part_number: 4,
    part_title: "Part 4: The Passed Pawn",
    scene_prefix: "p4"
  }
];

// Master character alias definitions for exact entity matching
const CHARACTER_ALIASES = [
  {
    canonical: "Jernau Morat Gurgeh",
    short_name: "Gurgeh",
    patterns: [/\bGurgeh\b/i, /\bJernau\b/i, /\bMorat Gurgeh\b/i]
  },
  {
    canonical: "Yay Meristinoux",
    short_name: "Yay",
    patterns: [/\bYay\b/i, /\bMeristinoux\b/i]
  },
  {
    canonical: "Flere-Imsaho",
    short_name: "Flere-Imsaho",
    patterns: [/\bFlere[-–—]Imsaho\b/i, /\bFlere\b/i]
  },
  {
    canonical: "Mawhrin-Skel",
    short_name: "Mawhrin-Skel",
    patterns: [/\bMawhrin[-–—]Skel\b/i, /\bSkel\b/i]
  },
  {
    canonical: "Chamlis Amalk-an",
    short_name: "Chamlis",
    patterns: [/\bChamlis\b/i, /\bAmalk[-–—]an\b/i]
  },
  {
    canonical: "Shohobohaum Za",
    short_name: "Za",
    patterns: [/\bShohobohaum\b/i, /\bShohobohaum Za\b/i, /\bZa\b/i]
  },
  {
    canonical: "Nicosar",
    short_name: "Nicosar",
    patterns: [/\bNicosar\b/i, /\bNicosar 1st\b/i, /\bEmperor Nicosar\b/i]
  },
  {
    canonical: "Hamin",
    short_name: "Hamin",
    patterns: [/\bHamin\b/i, /\bTutor Hamin\b/i]
  },
  {
    canonical: "Pequil",
    short_name: "Pequil",
    patterns: [/\bPequil\b/i]
  },
  {
    canonical: "Worthil",
    short_name: "Worthil",
    patterns: [/\bWorthil\b/i]
  },
  {
    canonical: "Yomonul",
    short_name: "Yomonul",
    patterns: [/\bYomonul\b/i]
  },
  {
    canonical: "Boruelal",
    short_name: "Boruelal",
    patterns: [/\bBoruelal\b/i]
  },
  {
    canonical: "Inclate",
    short_name: "Inclate",
    patterns: [/\bInclate\b/i]
  },
  {
    canonical: "Olos",
    short_name: "Olos",
    patterns: [/\bOlos\b/i]
  },
  {
    canonical: "Limiting Factor",
    short_name: "Limiting Factor",
    patterns: [/\bLimiting Factor\b/i]
  },
  {
    canonical: "Little Rascal",
    short_name: "Little Rascal",
    patterns: [/\bLittle Rascal\b/i]
  }
];

// Global Master Cast Database
const GLOBAL_VOICE_MAPPING = {
  "Narrator": {
    voice: "Narrator",
    age: "Adult",
    gender: "Non-binary",
    voiceProfile: "Clear, cultured, neutral British storytelling cadence with balanced pitch, measured pauses, and smooth, steady literary delivery.",
    identityBackground: "The omniscient narrator recounting Jernau Morat Gurgeh's voyage to the Empire of Azad. Later revealed to be Flere-Imsaho writing the historical account.",
    physical_appearance: "No physical embodiment in narration; presence of an articulate, observant literary chronicler.",
    traits: "Articulate, observant, ironic, and measured.",
    currentEmotion: "neutral and observant",
    speed: 1.0,
    pitch: 1.0,
    aliases: ["Storyteller", "Chronicler"]
  },
  "Gurgeh": {
    voice: "Gurgeh",
    age: "Adult",
    gender: "Male",
    voiceProfile: "Deep, calm, resonant, and intellectual; measured, contemplative delivery with dry wit and subtle undercurrents of restlessness.",
    identityBackground: "Jernau Morat Gurgeh, master game player of the Culture. Resident of Ikroh on Chiark Orbital. Analytical, proud, easily bored by routine until challenged by Azad.",
    physical_appearance: "Bearded, dark-haired, distinguished posture, wearing unadorned Culture tunics and robes.",
    traits: "Intellectually competitive, proud, introspective, ethically anchored under extreme pressure.",
    currentEmotion: "contemplative and detached",
    speed: 1.0,
    pitch: 1.0,
    aliases: ["Jernau Morat Gurgeh", "Morat Gurgeh", "Jernau"]
  },
  "Yay": {
    voice: "Yay",
    age: "Adult",
    gender: "Female",
    voiceProfile: "Low-slung, knowing, roguish, deep and slow; warm, playful, confident, and direct.",
    identityBackground: "Yay Meristinoux, Culture landscape architect and terrain sculptor; Gurgeh's close friend, former lover, and frank confidante on Chiark Orbital.",
    physical_appearance: "Face of a beautiful child, athletic and vigorous build, short brown hair, wearing casual outdoor attire.",
    traits: "Playful, roguish, candid, uninhibited, physically expressive.",
    currentEmotion: "playful and energetic",
    speed: 1.0,
    pitch: 1.0,
    aliases: ["Yay Meristinoux", "Meristinoux"]
  },
  "Flere-Imsaho": {
    voice: "Flere-Imsaho",
    age: "Adult",
    gender: "Machine",
    voiceProfile: "Crisp, officious, fussy, and slightly high-pitched; precise enunciation, polite bureaucrat exterior masking razor-sharp efficiency.",
    identityBackground: "Special Circumstances operative drone disguised as a simple, pompous library and chaperone machine assigned to escort Gurgeh to Azad.",
    physical_appearance: "Plain, scratched, boxy grey casing with an iridescent protective aura; conceals devastating SC field weaponry.",
    traits: "Pedantic, fussy, watchful, fiercely protective, deadly and decisive when required.",
    currentEmotion: "officious and vigilant",
    speed: 1.05,
    pitch: 1.1,
    aliases: ["Flere", "the drone", "the library drone", "chaperone drone"]
  },
  "Mawhrin-Skel": {
    voice: "Mawhrin-Skel",
    age: "Adult",
    gender: "Machine",
    voiceProfile: "Grating, erratic, mocking, and sneering; mercurial shifts between fawning camaraderie and venomous, razor-sharp malice.",
    identityBackground: "Decommissioned Contact Special Circumstances drone rejected for psychological instability; bitter blackmailer who coerces Gurgeh into accepting the Azad assignment.",
    physical_appearance: "Stripped-down, rusty, battered casing, jagged erratic movements, harsh flickering field aura.",
    traits: "Bitter, manipulative, erratic, resentful, cunning.",
    currentEmotion: "taunting and bitter",
    speed: 0.95,
    pitch: 0.9,
    aliases: ["Skel", "the rogue drone"]
  },
  "Chamlis": {
    voice: "Chamlis",
    age: "Elderly",
    gender: "Machine",
    voiceProfile: "Gentle, venerable, warm, and slow; deep mellow resonance accompanied by a soothing pale yellow aura hum.",
    identityBackground: "Chamlis Amalk-an, ancient Culture drone four millennia old; Gurgeh's oldest, wisest friend and steady companion at Ikroh.",
    physical_appearance: "Large, archaic, rounded antique casing with soft-hued pale yellow aura fields.",
    traits: "Philosophical, compassionate, patient, deeply loyal.",
    currentEmotion: "gentle and reflective",
    speed: 0.95,
    pitch: 0.95,
    aliases: ["Chamlis Amalk-an", "Amalk-an", "the ancient drone"]
  },
  "Za": {
    voice: "Za",
    age: "Adult",
    gender: "Male",
    voiceProfile: "Gravelly, boisterous, raspy, and world-weary; loose, slurred camaraderie with sudden flashes of penetrating cynical clarity.",
    identityBackground: "Shohobohaum Za, Culture journalist and literary exile living in the Empire of Azad; dissolute, hedonistic, soaked in Azadian vices, Gurgeh's local guide.",
    physical_appearance: "Disheveled, rumpled luxury garments, heavy-set, flushed complexion, sardonic grin.",
    traits: "Cynical, hedonistic, warm-hearted, tragic, shrewdly observant.",
    currentEmotion: "boisterous and sardonic",
    speed: 1.0,
    pitch: 0.95,
    aliases: ["Shohobohaum Za", "Shohobohaum"]
  },
  "Nicosar": {
    voice: "Nicosar",
    age: "Adult",
    gender: "Male",
    voiceProfile: "Imperious, aristocratic, intense, and commanding; razor-edged diction, cold royal cadence escalating to frantic volatility under pressure.",
    identityBackground: "Nicosar 1st, Emperor of the Empire of Azad; supreme player of Azad whose supreme authority is legitimized by mastery of the game.",
    physical_appearance: "Imposing regal stature, ornate imperial vestments, dark penetrating gaze, apex Azadian build.",
    traits: "Authoritarian, proud, brilliant, ruthless, brittle under existential collapse.",
    currentEmotion: "imperious and calculating",
    speed: 1.0,
    pitch: 1.0,
    aliases: ["Nicosar 1st", "Emperor Nicosar", "the Emperor"]
  },
  "Hamin": {
    voice: "Hamin",
    age: "Elderly",
    gender: "Male",
    voiceProfile: "Wheezy, dry, raspy, and calculating; soft, whispering authority laden with ancient bureaucratic malice.",
    identityBackground: "Supreme Tutor of the Bureaucracy and elder statesman of the Empire of Azad; cunning master of political intrigue.",
    physical_appearance: "Frail, withered, carried in an anti-gravity litter, elaborate court velvet robes.",
    traits: "Shrewd, reactionary, cynical, protective of Azadian hierarchy.",
    currentEmotion: "shrewd and watchful",
    speed: 0.95,
    pitch: 0.9,
    aliases: ["Tutor Hamin", "the Judge", "Supreme Tutor"]
  },
  "Pequil": {
    voice: "Pequil",
    age: "Adult",
    gender: "Male",
    voiceProfile: "Stiff, formal, clipped, and anxious; deferential bureaucrat with nervous precision.",
    identityBackground: "Azadian arbiter and protocol official assigned to oversee Gurgeh's matches.",
    physical_appearance: "Meticulous uniform, neat posture, nervous demeanor.",
    traits: "Procedural, subservient to hierarchy, nervous.",
    currentEmotion: "nervous and respectful",
    speed: 1.0,
    pitch: 1.05,
    aliases: ["Arbiter Pequil"]
  },
  "Worthil": {
    voice: "Worthil",
    age: "Adult",
    gender: "Male",
    voiceProfile: "Smooth, diplomatic, polished, and persuasive; balanced, genial Culture diplomatic cadence.",
    identityBackground: "Culture Contact operative who recruits Gurgeh for the voyage to the Empire of Azad.",
    physical_appearance: "Impeccably tailored, relaxed, charismatic bearing.",
    traits: "Diplomatic, persuasive, discreet, composed.",
    currentEmotion: "diplomatic and persuasive",
    speed: 1.0,
    pitch: 1.0,
    aliases: ["Contact Operative Worthil"]
  },
  "Yomonul": {
    voice: "Yomonul",
    age: "Adult",
    gender: "Male",
    voiceProfile: "Harsh, booming, clipped, and aggressive; authoritative military cadence.",
    identityBackground: "High-ranking military marshal and aggressive player in the Azad tournament.",
    physical_appearance: "Broad-shouldered, military uniform, severe scowl.",
    traits: "Aggressive, combative, arrogant.",
    currentEmotion: "aggressive and contemptuous",
    speed: 1.0,
    pitch: 0.9,
    aliases: ["Marshal Yomonul"]
  },
  "Boruelal": {
    voice: "Boruelal",
    age: "Adult",
    gender: "Female",
    voiceProfile: "Crisp, cold, measured, and calculating.",
    identityBackground: "Azadian magistrate and skilled tournament player.",
    physical_appearance: "Severe, elegant Azadian robe, sharp calculating expression.",
    traits: "Analytical, ambitious, unyielding.",
    currentEmotion: "calculating and guarded",
    speed: 1.0,
    pitch: 1.0,
    aliases: ["Magistrate Boruelal"]
  },
  "Inclate": {
    voice: "Inclate",
    age: "Adult",
    gender: "Male",
    voiceProfile: "Intense, focused, clipped, and competitive.",
    identityBackground: "Azadian competitor in the Main Board tournament.",
    physical_appearance: "Focused, determined tournament competitor.",
    traits: "Competitive, sharp, guarded.",
    currentEmotion: "tense and focused",
    speed: 1.0,
    pitch: 1.0,
    aliases: []
  },
  "Olos": {
    voice: "Olos",
    age: "Adult",
    gender: "Male",
    voiceProfile: "Gentle, cultured, relaxed, and conversational.",
    identityBackground: "Culture friend and intellectual acquaintance of Gurgeh on Chiark Orbital.",
    physical_appearance: "Casual, relaxed Culture citizen attire.",
    traits: "Cultured, sociable, unhurried.",
    currentEmotion: "relaxed and pleasant",
    speed: 1.0,
    pitch: 1.0,
    aliases: []
  },
  "Limiting Factor": {
    voice: "Limiting Factor",
    age: "Adult",
    gender: "Machine",
    voiceProfile: "Vast, ironic, tranquil, and godlike; effortless authority with playful intellectual banter.",
    identityBackground: "Culture Superlifter warship Mind tasked with transporting Gurgeh across intergalactic space to Azad.",
    physical_appearance: "Gigantic starship; communicates through ambient audio, com-channels, and terminal interfaces.",
    traits: "Omnipotent intellect, humorous, fond of irony and grand scale.",
    currentEmotion: "amused and tranquil",
    speed: 1.0,
    pitch: 1.0,
    aliases: ["The Mind of the Limiting Factor", "Superlifter Mind"]
  },
  "Little Rascal": {
    voice: "Little Rascal",
    age: "Adult",
    gender: "Machine",
    voiceProfile: "Warm, vast, paternal, genial, and welcoming; benevolent superintelligence.",
    identityBackground: "Culture General Systems Vehicle (GSV) Mind; home to billions of happy souls, peaceful and vast.",
    physical_appearance: "Vast planetary-scale GSV vessel.",
    traits: "Benevolent, hospitable, vast, welcoming.",
    currentEmotion: "warm and welcoming",
    speed: 1.0,
    pitch: 1.0,
    aliases: ["The Mind of the Little Rascal", "GSV Mind"]
  }
};

// Global Culture & Azad Pronunciation Lexicon
const GLOBAL_PRONUNCIATION_LEXICON = {
  "Gurgeh": { replacement: "GUR-geh", type: "respelling", case_sensitive: false },
  "Jernau": { replacement: "zher-NOH", type: "respelling", case_sensitive: false },
  "Morat": { replacement: "mor-AT", type: "respelling", case_sensitive: false },
  "Azad": { replacement: "ah-ZAHD", type: "respelling", case_sensitive: false },
  "Azadian": { replacement: "ah-ZAY-dee-an", type: "respelling", case_sensitive: false },
  "Chiark": { replacement: "CHEE-ark", type: "respelling", case_sensitive: false },
  "Ikroh": { replacement: "IK-roh", type: "respelling", case_sensitive: false },
  "Chamlis": { replacement: "CHAM-liss", type: "respelling", case_sensitive: false },
  "Amalk-an": { replacement: "ah-MALK-an", type: "respelling", case_sensitive: false },
  "Mawhrin-Skel": { replacement: "MAW-rin SKEL", type: "respelling", case_sensitive: false },
  "Flere-Imsaho": { replacement: "FLAIR-im-SAH-ho", type: "respelling", case_sensitive: false },
  "Meristinoux": { replacement: "meh-RISS-tin-oo", type: "respelling", case_sensitive: false },
  "Shohobohaum": { replacement: "shoh-hoh-boh-HAWM", type: "respelling", case_sensitive: false },
  "Nicosar": { replacement: "nee-koh-SAR", type: "respelling", case_sensitive: false },
  "Pequil": { replacement: "peh-KEEL", type: "respelling", case_sensitive: false },
  "Yomonul": { replacement: "yoh-moh-NUL", type: "respelling", case_sensitive: false },
  "Boruelal": { replacement: "boh-roo-eh-LAHL", type: "respelling", case_sensitive: false },
  "Ea": { replacement: "EE-ah", type: "respelling", case_sensitive: false },
  "Echronedal": { replacement: "ek-RON-eh-dahl", type: "respelling", case_sensitive: false },
  "GSV": { replacement: "G S V", type: "expansion", case_sensitive: true },
  "SC": { replacement: "Special Circumstances", type: "expansion", case_sensitive: true }
};

// Global Relationship Timelines
const GLOBAL_RELATIONSHIPS = [
  {
    id: "gurgeh_yay",
    a: "Gurgeh",
    b: "Yay",
    states: [
      {
        from: { chapter: 1, segment: 1 },
        relation_type: "friend",
        relation_tone: "warm",
        status: "current",
        power_dynamic: "equal",
        trigger: null,
        transition: "instant",
        cited_evidence: "Yay Meristinoux stood looking at him and shaking her head with knowing warmth.",
        notes: "Longtime friends and former lovers on Chiark Orbital; easy, playful camaraderie."
      }
    ]
  },
  {
    id: "gurgeh_mawhrin_skel",
    a: "Gurgeh",
    b: "Mawhrin-Skel",
    states: [
      {
        from: { chapter: 3, segment: 1 },
        relation_type: "adversary",
        relation_tone: "hostile",
        status: "current",
        power_dynamic: "b_over_a",
        trigger: "Mawhrin-Skel blackmails Gurgeh with cheating recording",
        transition: "instant",
        cited_evidence: "'I want to get back into Special Circumstances,' Mawhrin-Skel told him, floating closer.",
        notes: "Bitter extortion dynamic; Skel holds Gurgeh's reputation hostage."
      }
    ]
  },
  {
    id: "gurgeh_chamlis",
    a: "Gurgeh",
    b: "Chamlis",
    states: [
      {
        from: { chapter: 2, segment: 1 },
        relation_type: "friend",
        relation_tone: "warm",
        status: "current",
        power_dynamic: "equal",
        trigger: null,
        transition: "instant",
        cited_evidence: "Chamlis Amalk-an drifted beside him, its ancient pale yellow aura pulsing with serene familiarity.",
        notes: "Four millennia of wisdom anchoring Gurgeh's philosophical doubts."
      }
    ]
  },
  {
    id: "gurgeh_flere_imsaho",
    a: "Gurgeh",
    b: "Flere-Imsaho",
    states: [
      {
        from: { chapter: 7, segment: 1 },
        relation_type: "ally",
        relation_tone: "tense",
        status: "current",
        power_dynamic: "equal",
        trigger: "Flere-Imsaho assigned as chaperone and minder",
        transition: "instant",
        cited_evidence: "Flere-Imsaho bobbed officiously in the air before Gurgeh, its casing looking deliberately modest.",
        notes: "Gurgeh finds the drone fussy and irritating; Flere plays the pompous bureaucrat."
      },
      {
        from: { chapter: 60, segment: 1 },
        relation_type: "ally",
        relation_tone: "warm",
        status: "current",
        power_dynamic: "equal",
        trigger: "Flere reveals its true SC combat lethality",
        transition: "instant",
        cited_evidence: "'I am Special Circumstances, Gurgeh,' the drone revealed without a trace of its former fussy manner.",
        notes: "Mutual trust forged through mortal danger and shared purpose."
      }
    ]
  },
  {
    id: "gurgeh_za",
    a: "Gurgeh",
    b: "Za",
    states: [
      {
        from: { chapter: 35, segment: 1 },
        relation_type: "friend",
        relation_tone: "warm",
        status: "current",
        power_dynamic: "equal",
        trigger: "Meeting in the Azadian capital",
        transition: "instant",
        cited_evidence: "Za embraced Gurgeh with alcoholic enthusiasm, delighted to meet another Culture native.",
        notes: "Exile camaraderie; Za provides the unvarnished truth about Azad's brutality."
      }
    ]
  },
  {
    id: "gurgeh_nicosar",
    a: "Gurgeh",
    b: "Nicosar",
    states: [
      {
        from: { chapter: 45, segment: 1 },
        relation_type: "adversary",
        relation_tone: "tense",
        status: "developing",
        power_dynamic: "equal",
        trigger: "Initial imperial audience",
        transition: "gradual",
        cited_evidence: "Emperor Nicosar eyed the alien game-player with cold, competitive appraisal.",
        notes: "Clash of civilizations embodied in two master players."
      },
      {
        from: { chapter: 95, segment: 1 },
        relation_type: "adversary",
        relation_tone: "hostile",
        status: "current",
        power_dynamic: "equal",
        trigger: "Final confrontation on the Fire Planet Board",
        transition: "instant",
        cited_evidence: "Nicosar stood staring at the board in disbelief, his empire crumbling under Gurgeh's pieces.",
        notes: "Total ideological and psychological victory of Culture philosophy over Azad hierarchy."
      }
    ]
  },
  {
    id: "gurgeh_hamin",
    a: "Gurgeh",
    b: "Hamin",
    states: [
      {
        from: { chapter: 40, segment: 1 },
        relation_type: "professional",
        relation_tone: "tense",
        status: "current",
        power_dynamic: "equal",
        trigger: "Tour of Azadian institutions",
        transition: "gradual",
        cited_evidence: "Tutor Hamin smiled with dry malice as he explained the brutal mechanics of Azad society.",
        notes: "Intellectual duel between ancient imperial tutor and foreign challenger."
      }
    ]
  }
];

// Pure function to detect characters present in a single scene's text
function detect_scene_characters(scene_text) {
  const characters_present = new Set();
  // Narrator is always present by default
  characters_present.add("Narrator");

  for (const char_def of CHARACTER_ALIASES) {
    for (const pattern of char_def.patterns) {
      if (pattern.test(scene_text)) {
        characters_present.add(char_def.short_name);
        break;
      }
    }
  }

  return Array.from(characters_present);
}

// Main execution function
async function build_project() {
  console.log("=========================================================================");
  console.log("BUILDING AUDIOBOOK PROJECT: THE PLAYER OF GAMES (IAIN M. BANKS)");
  console.log("=========================================================================\n");

  const project_dir = path.resolve(__dirname, "../workspace/the_player_of_games");
  const scenes_dir = path.join(project_dir, "scenes");
  const audio_dir = path.join(project_dir, "audio");
  const anchors_dir = path.join(audio_dir, "anchors");
  const takes_dir = path.join(audio_dir, "takes");

  // Verify scenes directory
  if (!fs.existsSync(scenes_dir)) {
    throw new Error(`Scenes directory not found at: ${scenes_dir}`);
  }

  // Ensure directories exist
  fs.mkdirSync(anchors_dir, { recursive: true });
  fs.mkdirSync(takes_dir, { recursive: true });

  const chapters_list = [];
  const full_book_text_chunks = [];
  let global_chapter_counter = 0;
  let total_words_count = 0;

  for (const part of PARTS_CONFIG) {
    const part_path = path.join(scenes_dir, part.folder);
    if (!fs.existsSync(part_path)) {
      console.warn(`Part directory ${part.folder} not found, skipping.`);
      continue;
    }

    const scene_files = fs.readdirSync(part_path)
      .filter(f => f.endsWith(".txt"))
      .sort((a, b) => {
        const num_a = parseInt(a.match(/\d+/)[0], 10);
        const num_b = parseInt(b.match(/\d+/)[0], 10);
        return num_a - num_b;
      });

    console.log(`Processing ${part.part_title}: ${scene_files.length} scenes...`);

    for (const scene_file of scene_files) {
      global_chapter_counter++;
      const scene_full_path = path.join(part_path, scene_file);
      const raw_scene_text = fs.readFileSync(scene_full_path, "utf-8").trim();
      const scene_number = parseInt(scene_file.match(/\d+/)[0], 10);
      const pad_scene_num = String(scene_number).padStart(2, "0");
      const pad_chapter_num = String(global_chapter_counter).padStart(3, "0");

      const word_count = count_words_in_text(raw_scene_text);
      total_words_count += word_count;

      const scene_cast = detect_scene_characters(raw_scene_text);

      const chapter_id = `${part.scene_prefix}_s${pad_scene_num}`;
      const chapter_title = `${part.part_title} - Scene ${pad_scene_num}`;

      const chapter_record = {
        chapter_id,
        chapter_number: global_chapter_counter,
        part_number: part.part_number,
        part_title: part.part_title,
        part_id: part.folder,
        scene_number,
        chapter_title,
        scene_file: `scenes/${part.folder}/${scene_file}`,
        raw_text: raw_scene_text,
        word_count,
        character_count: raw_scene_text.length,
        estimated_minutes: Number((word_count / 150.0).toFixed(1)),
        scene_cast,
        scriptSegments: [],
        directorialSegments: []
      };

      chapters_list.push(chapter_record);
      full_book_text_chunks.push(`\n\n### ${chapter_title}\n\n${raw_scene_text}`);
    }
  }

  console.log(`\nAll ${chapters_list.length} scenes processed! Total words: ${total_words_count}`);

  // Create consolidated book.txt
  const full_manuscript_text = full_book_text_chunks.join("").trim();
  const book_txt_path = path.join(project_dir, "book.txt");
  fs.writeFileSync(book_txt_path, full_manuscript_text, "utf-8");
  console.log(`Consolidated book.txt written (${(full_manuscript_text.length / 1024).toFixed(1)} KB).`);

  // Assemble project_state.json schema
  const project_state = {
    projectName: "the_player_of_games",
    createdTimestamp: Date.now(),
    is_multi_chapter: true,
    active_chapter_id: chapters_list[0].chapter_id,
    rawBookText: chapters_list[0].raw_text,
    scriptSegments: [],
    directorialSegments: [],
    chapters: chapters_list,
    voiceMapping: GLOBAL_VOICE_MAPPING,
    relationships: GLOBAL_RELATIONSHIPS,
    pronunciationDictionary: GLOBAL_PRONUNCIATION_LEXICON,
    calibrationProfiles: {}
  };

  const project_state_file_path = path.join(project_dir, "project_state.json");
  fs.writeFileSync(project_state_file_path, JSON.stringify(project_state, null, 2), "utf-8");
  console.log(`Project state successfully persisted to: ${project_state_file_path}`);
  console.log(`\nCast Roster Summary (${Object.keys(GLOBAL_VOICE_MAPPING).length} characters registered):`);
  for (const [name, meta] of Object.entries(GLOBAL_VOICE_MAPPING)) {
    console.log(`  - [${meta.gender}] ${name} (${meta.age}): ${meta.traits}`);
  }

  console.log(`\nRelationships Summary (${GLOBAL_RELATIONSHIPS.length} state timelines initialized):`);
  for (const rel of GLOBAL_RELATIONSHIPS) {
    console.log(`  - ${rel.a} <-> ${rel.b} (${rel.states.length} states)`);
  }

  console.log(`\nPronunciation Lexicon (${Object.keys(GLOBAL_PRONUNCIATION_LEXICON).length} phonetic entries configured).`);
  console.log("\n=========================================================================");
  console.log("PROJECT CREATION & INITIAL CAST EXTRACTION COMPLETE!");
  console.log("=========================================================================");
}

build_project().catch((err) => {
  console.error("Fatal project build error:", err);
  process.exit(1);
});

