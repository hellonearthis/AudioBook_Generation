import zipfile
import os
from pathlib import Path

skill_zip_path = Path(r"C:\Users\Desktop-Dev\Desktop\files\poetry-craft.skill")
target_skill_dir = Path(r"c:\Users\Desktop-Dev\Desktop\technical vocabulary  nomalizer\.agents\skills\poetry-craft")

print(f"Checking package: {skill_zip_path}")
if not skill_zip_path.exists():
    print(f"Error: {skill_zip_path} does not exist.")
    exit(1)

print(f"File size: {skill_zip_path.stat().st_size} bytes")

if not zipfile.is_zipfile(skill_zip_path):
    print("Not a zip file!")
    exit(1)

with zipfile.ZipFile(skill_zip_path, 'r') as z:
    print("\n--- Files in .skill package ---")
    for name in z.namelist():
        info = z.getinfo(name)
        print(f"{name} ({info.file_size} bytes)")
        
    print("\n--- Contents of SKILL.md in .skill package ---")
    skill_md_candidates = [n for n in z.namelist() if n.endswith("SKILL.md")]
    for candidate in skill_md_candidates:
        print(f"\n=== {candidate} ===")
        content = z.read(candidate).decode('utf-8', errors='replace')
        print(content)

    print("\n--- Other files in .skill package ---")
    for name in z.namelist():
        if not name.endswith("SKILL.md") and not name.endswith("/"):
            print(f"\n=== {name} ===")
            try:
                content = z.read(name).decode('utf-8', errors='replace')
                print(content[:2000])
            except Exception as e:
                print(f"Could not decode {name}: {e}")
