import os
import re
import json
from collections import Counter
from pathlib import Path

def clean_vtt(text):
    lines = text.split('\n')
    cleaned_lines = []
    for line in lines:
        line = line.strip()
        # Skip header lines and empty lines
        if not line or line == 'WEBVTT' or line.startswith('Kind:') or line.startswith('Language:'):
            continue
        # Skip timestamp lines
        if '-->' in line:
            continue
        # Remove tags like <00:00:00.320> and <c> and </c>
        line = re.sub(r'<[^>]+>', '', line)
        # Skip weird lines or styling
        if 'align:start' in line or '&nbsp;' in line or line == '[&nbsp;__&nbsp;]':
            line = line.replace('[&nbsp;__&nbsp;]', ' ')
            line = line.replace('&nbsp;', ' ')
        cleaned_lines.append(line)
    
    # Join and normalize spaces
    full_text = ' '.join(cleaned_lines)
    full_text = re.sub(r'\s+', ' ', full_text).strip()
    return full_text

def get_ngrams(text, n):
    words = [w.lower() for w in re.findall(r'\b\w+\b', text) if len(w) > 2]
    ngrams = zip(*[words[i:] for i in range(n)])
    return [" ".join(ngram) for ngram in ngrams]

def process_comedian(name, vtt_dir, output_dir, role, traits, workflow):
    print(f"Processing {name}...")
    all_text = ""
    for file in os.listdir(vtt_dir):
        if file.endswith('.vtt'):
            with open(os.path.join(vtt_dir, file), 'r', encoding='utf-8') as f:
                content = f.read()
                cleaned = clean_vtt(content)
                all_text += cleaned + " "
    
    print(f"Extracted {len(all_text)} characters.")
    
    # Get frequent words (length > 4 to skip basic stopwords)
    words = [w.lower() for w in re.findall(r'\b\w+\b', all_text) if len(w) > 4]
    common_words = Counter(words).most_common(50)
    
    # Get frequent phrases (trigrams)
    phrases = get_ngrams(all_text, 3)
    common_phrases = Counter(phrases).most_common(30)
    
    # Ensure directories exist
    skill_dir = Path(output_dir) / f"{name.lower().replace(' ', '-')}-humor"
    ref_dir = skill_dir / "references"
    os.makedirs(ref_dir, exist_ok=True)
    
    # Write vocabulary reference
    with open(ref_dir / "mined_vocabulary.md", "w", encoding="utf-8") as f:
        f.write(f"# Mined Vocabulary & Recurring Tropes: {name}\n\n")
        f.write("## Top Characteristic Vocabulary / Keywords\n")
        for word, count in common_words:
            f.write(f"- `{word}` ({count} occurrences)\n")
        f.write("\n## Characteristic Phrasal Patterns\n")
        for phrase, count in common_phrases:
            f.write(f"- \"{phrase}\" ({count})\n")
            
    print(f"Written vocabulary analysis to {ref_dir / 'mined_vocabulary.md'}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Mine stand-up comedy VTT subtitles to extract voice patterns")
    parser.add_argument("--name", required=True, help="Comedian name")
    parser.add_argument("--vtt-dir", required=True, help="Directory containing .vtt subtitle files")
    parser.add_argument("--output-dir", default=".agents/skills", help="Output directory for generated skill")
    args = parser.parse_args()
    
    process_comedian(args.name, args.vtt_dir, args.output_dir, "", "", "")
