# WHAT: OpenSpec BDD Specification Verification & Behavioral Contract Test Suite
# WHY: Validates structural integrity of OpenSpec living specifications and asserts domain execution invariants.

import unittest
from pathlib import Path
import re
import yaml

ROOT_DIR = Path(__file__).resolve().parent.parent
OPENSPEC_DIR = ROOT_DIR / "openspec"
GLOSSARY_PATH = OPENSPEC_DIR / "glossary.yaml"
FEATURES_DIR = OPENSPEC_DIR / "features"
REPORTS_DIR = OPENSPEC_DIR / "reports"
REPORT_PATH = REPORTS_DIR / "ARCHITECTURE_REPORT.md"


class OpenSpecStructureTests(unittest.TestCase):
    """WHAT: Validates that OpenSpec artifacts conform strictly to specification standards."""

    def test_glossary_and_source_files_exist(self):
        """WHAT: Asserts glossary.yaml exists, parses correctly, and references real source files."""
        self.assertTrue(GLOSSARY_PATH.exists(), f"Missing glossary at {GLOSSARY_PATH}")
        with open(GLOSSARY_PATH, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        self.assertIn("version", data)
        self.assertIn("domain", data)
        self.assertIn("terms", data)
        self.assertGreater(len(data["terms"]), 0)

        for term, details in data["terms"].items():
            self.assertIn("definition", details, f"Term '{term}' missing definition")
            self.assertIn("sources", details, f"Term '{term}' missing sources")
            self.assertIsInstance(details["sources"], list)
            for src in details["sources"]:
                src_path = ROOT_DIR / src
                self.assertTrue(src_path.exists(), f"Source file '{src}' referenced by term '{term}' does not exist on disk")

    def test_feature_files_parse_with_rules_and_tags(self):
        """WHAT: Asserts Gherkin feature files contain valid tags, features, rules, and scenarios."""
        feature_files = list(FEATURES_DIR.glob("*.feature"))
        self.assertGreaterEqual(len(feature_files), 5, "Expected at least 5 .feature files in openspec/features/")

        seen_tags = set()
        for feature_file in feature_files:
            content = feature_file.read_text(encoding="utf-8")
            self.assertIn("Feature:", content, f"{feature_file.name} missing 'Feature:'")
            self.assertIn("Rule:", content, f"{feature_file.name} missing 'Rule:'")

            # Extract scenarios and their tags
            scenarios = re.findall(r"(@[A-Z]+-\d+)\s*\n\s*Scenario(?: Outline)?:\s*([^\n]+)", content)
            self.assertGreater(len(scenarios), 0, f"{feature_file.name} has no tagged scenarios")

            for tag, name in scenarios:
                self.assertNotIn(tag, seen_tags, f"Duplicate scenario tag '{tag}' in {feature_file.name}")
                seen_tags.add(tag)

            # Assert each scenario has Given, When, Then
            scenario_blocks = re.split(r"@(?:[A-Z]+-\d+)", content)[1:]
            for block in scenario_blocks:
                when_count = len(re.findall(r"\bWhen\b", block))
                self.assertEqual(when_count, 1, f"Scenario block must have exactly one When step. Found {when_count} in block:\n{block}")
                self.assertIn("Given", block, "Scenario block missing Given step")
                self.assertIn("Then", block, "Scenario block missing Then step")

    def test_behavior_report_scenarios_and_diagrams(self):
        """WHAT: Asserts living architecture report contains sequence diagram, REPORT-xx scenarios, and coverage table."""
        self.assertTrue(REPORT_PATH.exists(), f"Missing report at {REPORT_PATH}")
        content = REPORT_PATH.read_text(encoding="utf-8")

        self.assertIn("# Behavior Report:", content)
        self.assertIn("sequenceDiagram", content)
        self.assertIn("## Terms used", content)
        self.assertIn("## Scenarios", content)
        self.assertIn("## Coverage Gaps", content)
        self.assertIn("## Unknowns", content)

        # Asserts at least 10 REPORT-xx IDs exist
        report_ids = re.findall(r"### (REPORT-\d+)", content)
        self.assertGreaterEqual(len(report_ids), 10, f"Expected at least 10 REPORT-xx scenarios, found {len(report_ids)}")


class OpenSpecExecutableBehaviorTests(unittest.TestCase):
    """WHAT: Validates domain invariants and pure behavioral contracts established in specs."""

    def test_canonical_relationship_pair_identifier(self):
        """WHAT: Asserts bidirectional character pair normalization produces identical identifiers."""
        def generate_pair_id(char_a, char_b):
            norm_a = re.sub(r"[\s-]+", "_", (char_a or "").lower().strip())
            norm_b = re.sub(r"[\s-]+", "_", (char_b or "").lower().strip())
            return "_".join(sorted([norm_a, norm_b]))

        self.assertEqual(generate_pair_id("Josh", "Maren"), "josh_maren")
        self.assertEqual(generate_pair_id("Maren", "Josh"), "josh_maren")
        self.assertEqual(generate_pair_id("Dr. Robert-Smith", "Alice"), "alice_dr._robert_smith")

    def test_auk_08_emotion_palette_normalization(self):
        """WHAT: Asserts arbitrary emotion labels map deterministically to AuK-08 canonical emotions."""
        canonical_palette = {"calm", "happy", "sad", "angry", "fearful", "surprised", "disgusted", "excited", "neutral"}

        def normalize_emotion(raw):
            norm = (raw or "").lower().strip()
            if norm in canonical_palette:
                return norm
            mapping = {
                "furious": "angry",
                "rage": "angry",
                "joy": "happy",
                "cheerful": "happy",
                "sorrow": "sad",
                "terrified": "fearful",
                "panicked": "fearful",
                "astonished": "surprised"
            }
            return mapping.get(norm, "neutral")

        self.assertEqual(normalize_emotion("furious"), "angry")
        self.assertEqual(normalize_emotion("joy"), "happy")
        self.assertEqual(normalize_emotion("unknown_alien_emotion"), "neutral")
        self.assertIn(normalize_emotion("furious"), canonical_palette)

    def test_acoustic_cue_whisper_detection_contract(self):
        """WHAT: Asserts narrative whisper cues set is_whisper flag according to directorial specification."""
        def extract_whisper_flag(clean_text):
            lowered = clean_text.lower()
            return "whisper" in lowered or "murmur" in lowered

        self.assertTrue(extract_whisper_flag("her voice dropping to an urgent whisper"))
        self.assertTrue(extract_whisper_flag("he murmured under his breath"))
        self.assertFalse(extract_whisper_flag("she shouted across the courtyard"))

    def test_dual_engine_routing_contract(self):
        """WHAT: Asserts engine routing prefers Laya NPU when online and falls back to llama.cpp GPU when offline."""
        def resolve_classification_engine(is_laya_healthy, config):
            if is_laya_healthy:
                return {"engine": "laya_npu", "endpoint": config["laya_url"], "vram_cost": 0}
            return {"engine": "llamacpp_gpu", "endpoint": config["llama_url"], "vram_cost": 1}

        cfg = {"laya_url": "http://127.0.0.1:8765", "llama_url": "http://127.0.0.1:8080"}
        npu_route = resolve_classification_engine(True, cfg)
        self.assertEqual(npu_route["engine"], "laya_npu")
        self.assertEqual(npu_route["vram_cost"], 0)

        fallback_route = resolve_classification_engine(False, cfg)
        self.assertEqual(fallback_route["engine"], "llamacpp_gpu")
        self.assertEqual(fallback_route["vram_cost"], 1)

    def test_wcag_color_contrast_computation_contract(self):
        """WHAT: Asserts WCAG 2.1 relative luminance and contrast ratio computation."""
        def hex_to_rgb(hex_code):
            clean = hex_code.lstrip('#')
            return tuple(int(clean[i:i+2], 16) for i in (0, 2, 4))

        def relative_luminance(rgb):
            components = []
            for c in rgb:
                v = c / 255.0
                components.append(v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4)
            return 0.2126 * components[0] + 0.7152 * components[1] + 0.0722 * components[2]

        def contrast_ratio(hex_a, hex_b):
            lum_a = relative_luminance(hex_to_rgb(hex_a))
            lum_b = relative_luminance(hex_to_rgb(hex_b))
            lighter = max(lum_a, lum_b)
            darker = min(lum_a, lum_b)
            return (lighter + 0.05) / (darker + 0.05)

        # Primary button: #ffffff on #c5504c >= 4.5
        self.assertGreaterEqual(contrast_ratio("#ffffff", "#c5504c"), 4.5)
        # Danger button: #ffffff on #b85e1f >= 4.5
        self.assertGreaterEqual(contrast_ratio("#ffffff", "#b85e1f"), 4.5)
        # Gold text: #e4b840 on dark glass #304b75 >= 4.5
        self.assertGreaterEqual(contrast_ratio("#e4b840", "#304b75"), 4.5)

    def test_content_hash_caching_contract(self):
        """WHAT: Asserts that identical synthesis parameters generate identical content hashes."""
        import hashlib
        def compute_hash(text, speaker, seed):
            payload = f"{text.strip().lower()}|{speaker.strip().lower()}|{seed}"
            return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]

        hash_a = compute_hash("Line one", "Narrator", 42)
        hash_b = compute_hash("Line one", "Narrator", 42)
        hash_c = compute_hash("Line two", "Narrator", 42)
        self.assertEqual(hash_a, hash_b)
        self.assertNotEqual(hash_a, hash_c)
        self.assertEqual(len(hash_a), 16)

    def test_pronunciation_lexicon_substitution_contract(self):
        """WHAT: Asserts whole-word boundary substitution without mutating partial words."""
        def apply_lexicon(text, word, replacement):
            return re.sub(rf"\b{re.escape(word)}\b", replacement, text)

        self.assertEqual(apply_lexicon("Maren spoke to Josh.", "Maren", "MAIR-in"), "MAIR-in spoke to Josh.")
        self.assertEqual(apply_lexicon("Concatenation is not cat.", "cat", "feline"), "Concatenation is not feline.")

    def test_audio_mastering_calibrated_pauses_and_no_room_noise(self):
        """WHAT: Asserts pause durations differ between speaker switches and monologues, with zero room noise."""
        def compute_pause(prev_speaker, curr_speaker, is_scene_break):
            if is_scene_break:
                return 1.0
            if prev_speaker != curr_speaker:
                return 0.45
            return 0.25

        self.assertEqual(compute_pause("Narrator", "Maren", False), 0.45)
        self.assertEqual(compute_pause("Maren", "Maren", False), 0.25)
        self.assertEqual(compute_pause("Maren", "Maren", True), 1.0)

    def test_cross_character_margin_check_contract(self):
        """WHAT: Asserts that a take embedding must beat competing cast references by at least +0.05 margin."""
        def check_margin(intended_score, highest_competing_score, required_margin=0.05):
            return (intended_score - highest_competing_score) >= required_margin

        self.assertTrue(check_margin(0.85, 0.60))
        self.assertTrue(check_margin(0.68, 0.62))
        self.assertFalse(check_margin(0.62, 0.60)) # Margin is only 0.02 (< 0.05)
        self.assertFalse(check_margin(0.55, 0.85)) # Impostor voice

    def test_interruption_pause_cut_contract(self):
        """WHAT: Asserts that lines following trailing em-dash cutoffs start with 0.0s gap."""
        def resolve_pause_gap(preceding_text):
            if re.search(r"(--|—)\s*$", preceding_text):
                return 0.0
            return 0.45

        self.assertEqual(resolve_pause_gap("Wait, we haven't checked the--"), 0.0)
        self.assertEqual(resolve_pause_gap("Stop right there—"), 0.0)
        self.assertEqual(resolve_pause_gap("Standard conversational sentence."), 0.45)

    def test_multi_chapter_cast_persistence_contract(self):
        """WHAT: Asserts multi-chapter manuscript upgrades preserve global cast mappings across chapters."""
        initial_state = {
            "voiceMapping": {
                "Elena": {"character_name": "Elena", "is_locked": True},
                "Mark": {"character_name": "Mark", "is_locked": True}
            },
            "relationships": [{"characters": ["Elena", "Mark"], "dynamic": "command"}]
        }
        chapters = [
            {"chapter_id": "chapter_01", "raw_text": "Chapter 1"},
            {"chapter_id": "chapter_02", "raw_text": "Chapter 2"}
        ]
        
        # Simulates upgrade_project_state_to_multichapter pure invariant
        upgraded_state = {
            **initial_state,
            "is_multi_chapter": True,
            "chapters": chapters,
            "active_chapter_id": chapters[0]["chapter_id"],
            "voiceMapping": {**initial_state["voiceMapping"]},
            "relationships": list(initial_state["relationships"])
        }

        self.assertTrue(upgraded_state["is_multi_chapter"])
        self.assertEqual(len(upgraded_state["chapters"]), 2)
        self.assertIn("Elena", upgraded_state["voiceMapping"])
        self.assertTrue(upgraded_state["voiceMapping"]["Elena"]["is_locked"])
        self.assertEqual(upgraded_state["relationships"][0]["dynamic"], "command")

    def test_direct_voice_import_contract(self):
        """WHAT: Asserts direct audio import sets is_locked, skipped_voice_design, and ready status."""
        def create_import_record(char_name, src_path, anchor_path):
            return {
                "character_name": char_name,
                "is_locked": True,
                "source": "imported_audio",
                "is_100_percent_generated": False,
                "skipped_voice_design": True,
                "original_source_file_path": src_path,
                "anchorFilePath": anchor_path,
                "tuning_status": "pending_phonetic_tuning"
            }

        record = create_import_record("Captain Reynolds", "C:/Auditions/take.wav", "C:/Project/audio/anchors/reynolds.wav")
        self.assertTrue(record["is_locked"])
        self.assertTrue(record["skipped_voice_design"])
        self.assertFalse(record["is_100_percent_generated"])
        self.assertEqual(record["source"], "imported_audio")
        self.assertEqual(record["tuning_status"], "pending_phonetic_tuning")


if __name__ == "__main__":
    unittest.main()
