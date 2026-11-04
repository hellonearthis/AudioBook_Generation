#!/usr/bin/env python3
# =========================================================================
# WHISTLE SPEECH-TO-TEXT VALIDATION CLI & MODULE
# =========================================================================
# WHAT: Validates synthesized audiobook speech audio against expected script text
#       using Cactus Compute's lightweight Whistle engine (needle.transcribe).
# WHY: Catches TTS hallucinations, truncated sentences, omitted lines, and audio artifacts
#       on CPU in milliseconds (<15ms TTFT, 16.9 MB model) without consuming GPU VRAM.

import sys
import os
import json
import re
import difflib
import unicodedata

# WHAT: Suppress telemetry warning to keep stdout clean JSON.
# WHY: needle checks this environment variable at startup.
os.environ["NEEDLE_TELEMETRY"] = "0"


def normalize_text_for_comparison(input_text_string):
    """
    WHAT: Normalizes punctuation, casing, accents, and whitespace.
    WHY: Prevents false positives caused by smart quotes, hyphens, or minor punctuation
         differences that do not affect spoken pronunciation.
    """
    if not input_text_string:
        return ""
    
    # Normalize unicode accents/ligatures
    normalized_string = unicodedata.normalize("NFKD", input_text_string)
    
    # Lowercase
    normalized_string = normalized_string.lower()
    
    # Replace curly quotes and dashes with standard equivalents
    normalized_string = normalized_string.replace("’", "'").replace("‘", "'")
    normalized_string = normalized_string.replace("“", '"').replace("”", '"')
    normalized_string = normalized_string.replace("—", " ").replace("–", " ")
    
    # Strip punctuation except apostrophes in contractions
    cleaned_characters = []
    for char in normalized_string:
        if char.isalnum() or char.isspace() or char == "'":
            cleaned_characters.append(char)
        else:
            cleaned_characters.append(" ")
            
    # Collapse multiple whitespace
    return " ".join("".join(cleaned_characters).split())


def compute_levenshtein_similarity(source_string, target_string):
    """
    WHAT: Calculates normalized Levenshtein similarity ratio between 0.0 and 1.0.
    WHY: Provides a continuous similarity metric even when word boundary alignments vary.
    """
    matcher = difflib.SequenceMatcher(None, source_string, target_string)
    return matcher.ratio()


def compute_word_level_differences(expected_text_words, transcribed_text_words):
    """
    WHAT: Computes word-level diff and identifies missing words and hallucinations.
    WHY: Gives the voice director precise visibility into which words were omitted or added.
    """
    sequence_matcher = difflib.SequenceMatcher(None, expected_text_words, transcribed_text_words)
    detailed_diff_tokens_list = []
    missing_words_list = []
    hallucinated_words_list = []
    
    for tag, expected_start, expected_end, transcribed_start, transcribed_end in sequence_matcher.get_opcodes():
        if tag == "equal":
            for word_item in expected_text_words[expected_start:expected_end]:
                detailed_diff_tokens_list.append({"type": "match", "word": word_item})
        elif tag == "delete":
            for word_item in expected_text_words[expected_start:expected_end]:
                detailed_diff_tokens_list.append({"type": "omission", "word": word_item})
                missing_words_list.append(word_item)
        elif tag == "insert":
            for word_item in transcribed_text_words[transcribed_start:transcribed_end]:
                detailed_diff_tokens_list.append({"type": "insertion", "word": word_item})
                hallucinated_words_list.append(word_item)
        elif tag == "replace":
            for word_item in expected_text_words[expected_start:expected_end]:
                detailed_diff_tokens_list.append({"type": "omission", "word": word_item})
                missing_words_list.append(word_item)
            for word_item in transcribed_text_words[transcribed_start:transcribed_end]:
                detailed_diff_tokens_list.append({"type": "insertion", "word": word_item})
                hallucinated_words_list.append(word_item)
                
    return detailed_diff_tokens_list, missing_words_list, hallucinated_words_list


def compute_word_error_rate(reference_words_list, hypothesis_words_list):
    """
    WHAT: Computes standard Word Error Rate (WER).
    WHY: Industry standard metric for speech recognition accuracy: (S + D + I) / N.
    """
    ref_len = len(reference_words_list)
    hyp_len = len(hypothesis_words_list)
    
    if ref_len == 0:
        return 0.0 if hyp_len == 0 else 1.0
        
    distance_matrix = [[0] * (hyp_len + 1) for _ in range(ref_len + 1)]
    for i in range(ref_len + 1):
        distance_matrix[i][0] = i
    for j in range(hyp_len + 1):
        distance_matrix[0][j] = j
        
    for i in range(1, ref_len + 1):
        for j in range(1, hyp_len + 1):
            if reference_words_list[i - 1] == hypothesis_words_list[j - 1]:
                distance_matrix[i][j] = distance_matrix[i - 1][j - 1]
            else:
                substitution_cost = distance_matrix[i - 1][j - 1] + 1
                insertion_cost = distance_matrix[i][j - 1] + 1
                deletion_cost = distance_matrix[i - 1][j] + 1
                distance_matrix[i][j] = min(substitution_cost, insertion_cost, deletion_cost)
                
    edit_distance = distance_matrix[ref_len][hyp_len]
    return min(1.0, edit_distance / ref_len)


def validate_audio_with_whistle(audio_file_path, expected_dialogue_text, options=None):
    """
    WHAT: Transcribes the audio file via Whistle and scores alignment with expected text.
    WHY: Executes sub-20ms CPU transcription and produces structured quality verdict.
    """
    if options is None:
        options = {}
        
    strict_threshold_percent = float(options.get("strict_threshold", 90.0))
    forced_language = options.get("language", "en")
    
    # Extract keywords from expected dialogue text to bias Whistle's Aho-Corasick automaton
    keywords_list = options.get("keywords")
    if keywords_list is None:
        # Generate keywords from words >= 4 letters
        cleaned_words = [w for w in re.findall(r"\b[A-Za-z]{4,}\b", expected_dialogue_text)]
        # Pick unique words (capped at 20)
        seen = set()
        keywords_list = []
        for w in cleaned_words:
            if w.lower() not in seen and len(keywords_list) < 20:
                seen.add(w.lower())
                keywords_list.append(w)
                
    try:
        import needle
    except ImportError:
        return {
            "success": False,
            "error": "The 'cactus-needle' Python package is not installed. Run 'pip install cactus-needle'."
        }

    if not os.path.exists(audio_file_path):
        return {
            "success": False,
            "error": f"Audio file not found at path: {audio_file_path}"
        }

    try:
        # Transcribe audio using Whistle
        transcription_result = needle.transcribe(
            audio_file_path,
            language=forced_language,
            keywords=keywords_list if keywords_list else None,
            word_timestamps=True
        )
    except Exception as transcription_exception:
        return {
            "success": False,
            "error": f"Whistle transcription failed: {str(transcription_exception)}"
        }

    raw_transcribed_text = transcription_result.get("text", "").strip()
    detected_language = transcription_result.get("language", "")
    time_to_first_token_ms = transcription_result.get("ttft_ms", 0.0)
    decode_tokens_per_sec = transcription_result.get("decode_tps", 0.0)
    word_timestamps_payload = transcription_result.get("words", [])

    # Text Normalization & Comparison
    normalized_expected = normalize_text_for_comparison(expected_dialogue_text)
    normalized_transcribed = normalize_text_for_comparison(raw_transcribed_text)

    expected_words = normalized_expected.split()
    transcribed_words = normalized_transcribed.split()

    # Similarity calculations
    similarity_ratio = compute_levenshtein_similarity(normalized_expected, normalized_transcribed)
    match_percentage = round(similarity_ratio * 100.0, 1)

    word_error_rate = compute_word_error_rate(expected_words, transcribed_words)

    # Word-level diff
    diff_tokens, missing_words, hallucinated_words = compute_word_level_differences(
        expected_words, transcribed_words
    )

    # Verdict determination
    # Strict threshold: >= 90% required for 'passed'
    if match_percentage >= strict_threshold_percent:
        validation_status = "passed"
    elif match_percentage >= (strict_threshold_percent - 10.0):
        validation_status = "warning"
    else:
        validation_status = "failed"

    return {
        "success": True,
        "status": validation_status,
        "match_percentage": match_percentage,
        "strict_threshold_percent": strict_threshold_percent,
        "word_error_rate": round(word_error_rate, 4),
        "expected_text": expected_dialogue_text,
        "transcribed_text": raw_transcribed_text,
        "detected_language": detected_language,
        "missing_words": missing_words,
        "hallucinated_words": hallucinated_words,
        "diff_tokens": diff_tokens,
        "word_count_expected": len(expected_words),
        "word_count_transcribed": len(transcribed_words),
        "word_timestamps": word_timestamps_payload,
        "telemetry": {
            "ttft_ms": time_to_first_token_ms,
            "decode_tps": decode_tokens_per_sec
        }
    }


def main():
    """
    WHAT: CLI entry point for Node.js child_process invocation.
    WHY: Reads JSON configuration from stdin or command arguments and prints output JSON to stdout.
    """
    try:
        if len(sys.argv) > 1 and sys.argv[1] == "--status":
            # Quick status check
            try:
                import needle
                model = needle.Whistle()
                print(json.dumps({"success": True, "available": True, "engine": "needle.Whistle"}))
            except Exception as e:
                print(json.dumps({"success": False, "available": False, "error": str(e)}))
            return

        # Read JSON payload from stdin or argument
        if len(sys.argv) > 1 and not sys.argv[1].startswith("-"):
            raw_input_data = sys.argv[1]
        else:
            raw_input_data = sys.stdin.read()

        request_payload = json.loads(raw_input_data)
        audio_path = request_payload.get("audio_path")
        expected_text = request_payload.get("expected_text", "")
        options = request_payload.get("options", {})

        result = validate_audio_with_whistle(audio_path, expected_text, options)
        print(json.dumps(result, ensure_ascii=False))

    except Exception as runtime_error:
        print(json.dumps({
            "success": False,
            "error": f"Internal validator error: {str(runtime_error)}"
        }))


if __name__ == "__main__":
    main()
