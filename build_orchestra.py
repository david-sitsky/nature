import os
import sys
import json
import random
import urllib.request
import subprocess
from concurrent.futures import ThreadPoolExecutor

AUDIO_DIR = 'data/audio_cache'
OUTPUT_MP3 = 'data/frog_orchestra.mp3'

# Target starting frog species filenames
PERON_TREE_FROG = '166_234844.b2b1232.m4a'    # Perón's Tree Frog
COMMON_EASTERN  = '299_234566.d8cdf7b.m4a'    # Common Eastern Froglet

def download_file(item):
    url = item.get('audioUrl')
    if not url:
        return None
    fn = os.path.basename(url)
    path = os.path.join(AUDIO_DIR, fn)
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        try:
            urllib.request.urlretrieve(url, path)
        except Exception as e:
            print(f"Failed {url}: {e}")
            return None
    return path

def main():
    os.makedirs(AUDIO_DIR, exist_ok=True)
    with open('data/species_info.json') as f:
        species_list = json.load(f)

    print(f"Downloading {len(species_list)} species audio files...")
    with ThreadPoolExecutor(max_workers=16) as executor:
        results = list(executor.map(download_file, species_list))
    
    valid_files = [p for p in results if p and os.path.exists(p) and os.path.getsize(p) > 1000]
    print(f"Found {len(valid_files)} valid audio files.")

    if not valid_files:
        print("Error: No valid audio files downloaded.")
        sys.exit(1)

    # Separate priority starting frogs (Perón's Tree Frog & Common Eastern Froglet)
    priority_files = []
    remaining_files = []
    for filepath in valid_files:
        fn = os.path.basename(filepath)
        if fn in (PERON_TREE_FROG, COMMON_EASTERN):
            priority_files.append(filepath)
        else:
            remaining_files.append(filepath)

    random.seed(42)
    random.shuffle(remaining_files)

    # Place priority species at slot 0 (t=0s), then distribute all remaining 210 species
    ordered_files = priority_files + remaining_files
    num_files = len(ordered_files)
    print(f"Synthesizing 60-second Orchestra starting with Perón's Tree Frog & Common Eastern Froglet...")

    cmd = ['ffmpeg', '-y']
    filter_parts = []

    # Distribute all 212 species across 12 5-second windows
    for idx, filepath in enumerate(ordered_files):
        cmd.extend(['-i', filepath])
        slot = idx % 12  # distribute evenly across 12 5-second windows
        start_time = slot * 5.0
        # Play each call for 7.5s, delay start_time, volume=0.5 with fade
        filter_parts.append(
            f"[{idx}:a]aloop=loop=-1:size=2e+09,atrim=0:7.5,adelay={int(start_time*1000)}|{int(start_time*1000)},afade=t=in:st={start_time}:d=0.8,afade=t=out:st={start_time+6}:d=1.5,volume=0.5[a{idx}];"
        )

    mix_inputs = ''.join(f"[a{i}]" for i in range(num_files))
    # Mix all inputs and apply loudnorm (loudness normalization) + volume gain so orchestra volume matches single frog sounds
    filter_parts.append(f"{mix_inputs}amix=inputs={num_files}:duration=longest:dropout_transition=2,atrim=0:60,volume=3.5,loudnorm=I=-14:TP=-1.0:LRA=11,afade=t=in:st=0:d=1,afade=t=out:st=57:d=3[outa]")

    filter_complex = ''.join(filter_parts)
    cmd.extend(['-filter_complex', filter_complex, '-map', '[outa]', '-b:a', '192k', OUTPUT_MP3])

    print("Building ALL-SPECIES 60-second Frog Orchestra MP3 with loudness normalization...")
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode == 0 and os.path.exists(OUTPUT_MP3):
        size_mb = os.path.getsize(OUTPUT_MP3) / (1024 * 1024)
        print(f"Successfully generated loud, normalized 60s {OUTPUT_MP3} ({size_mb:.2f} MB)")
    else:
        print("FFmpeg error:", res.stderr[-500:])

if __name__ == '__main__':
    main()
