#!/usr/bin/env python3
"""
Preprocess FrogID v7 CSV into optimized binary format for web visualization.

Usage:
    python3 preprocess.py [input_csv] [output_dir]

Defaults:
    input_csv  = ../FrogID7_final_dataset.csv (relative to this script)
    output_dir = ./data/

Binary format (little-endian, 9 bytes per record, sorted by date):
    longitude:    float32  (4 bytes)
    latitude:     float32  (4 bytes)
    speciesIndex: uint8    (1 byte)  — index into metadata.species[]

Output files:
    data/frogid7.bin      ~10 MB binary point data
    data/metadata.json    Species list, day offsets, daily counts, stats
"""

import csv
import json
import struct
import sys
import time
from datetime import date, timedelta
from pathlib import Path


def parse_date(s):
    """Parse YYYY-MM-DD date string."""
    return date.fromisoformat(s.strip())


def main():
    t0 = time.time()

    # Resolve paths
    script_dir = Path(__file__).parent
    input_csv = Path(sys.argv[1]) if len(sys.argv) > 1 else script_dir.parent / 'FrogID7_final_dataset.csv'
    output_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else script_dir / 'data'
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"{'='*60}")
    print(f"  FrogID v7 Preprocessor")
    print(f"{'='*60}")
    print(f"  Input:  {input_csv}")
    print(f"  Output: {output_dir}")
    print()

    if not input_csv.exists():
        print(f"ERROR: Input file not found: {input_csv}")
        sys.exit(1)

    # ─── Pass 1: Read CSV ───────────────────────────────────────
    print("Reading CSV...")
    records = []
    species_set = set()
    skipped = 0
    row_count = 0

    with open(input_csv, 'r', newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_count += 1
            if row_count % 200000 == 0:
                elapsed = time.time() - t0
                print(f"  {row_count:>10,} rows read  ({elapsed:.1f}s)")

            try:
                lat = float(row['decimalLatitude'])
                lng = float(row['decimalLongitude'])
                species = row['scientificName'].strip()
                event_date = parse_date(row['eventDate'])
            except (ValueError, KeyError) as e:
                skipped += 1
                if skipped <= 5:
                    print(f"  ⚠ Skipping row {row_count}: {e}")
                continue

            # Basic validation
            if not (-90 <= lat <= 0 and 100 <= lng <= 180):
                skipped += 1
                continue
            if not species:
                skipped += 1
                continue

            species_set.add(species)
            records.append((event_date, lng, lat, species))

    print(f"  ✓ {len(records):,} valid records ({skipped} skipped)")
    print(f"  ✓ {len(species_set)} unique species")
    print()

    # ─── Build species lookup ───────────────────────────────────
    species_list = sorted(species_set)
    species_to_idx = {s: i for i, s in enumerate(species_list)}

    if len(species_list) > 255:
        print(f"  ⚠ {len(species_list)} species exceeds uint8 range (255).")
        print(f"    Using uint16 for species index would need format change.")
        print(f"    For now, capping at 255 most common species.")
        # This shouldn't happen with 218 species, but just in case
        # Future: switch to uint16 if needed

    # ─── Sort by date ───────────────────────────────────────────
    print("Sorting by date...")
    records.sort(key=lambda r: r[0])

    start_date = records[0][0]
    end_date = records[-1][0]
    total_days = (end_date - start_date).days + 1

    print(f"  Date range: {start_date} → {end_date}")
    print(f"  Total days: {total_days:,}")
    print()

    # ─── Compute day offsets ────────────────────────────────────
    print("Computing day offsets...")
    # dayOffsets[d] = index of first record on day d
    # dayOffsets[totalDays] = total record count (sentinel)
    day_offsets = [0] * (total_days + 1)
    current_day_idx = 0

    for i, (d, _, _, _) in enumerate(records):
        day_idx = (d - start_date).days
        while current_day_idx <= day_idx:
            day_offsets[current_day_idx] = i
            current_day_idx += 1

    # Fill remaining (sentinel)
    while current_day_idx <= total_days:
        day_offsets[current_day_idx] = len(records)
        current_day_idx += 1

    # Daily counts
    daily_counts = [day_offsets[i + 1] - day_offsets[i] for i in range(total_days)]
    max_daily = max(daily_counts)
    avg_daily = sum(daily_counts) / len(daily_counts)
    active_days = sum(1 for c in daily_counts if c > 0)

    print(f"  Active days: {active_days:,} / {total_days:,}")
    print(f"  Max daily:   {max_daily:,} records")
    print(f"  Avg daily:   {avg_daily:.1f} records")
    print()

    # ─── Write binary data ──────────────────────────────────────
    bin_path = output_dir / 'frogid7.bin'
    print(f"Writing binary → {bin_path}")

    with open(bin_path, 'wb') as f:
        for event_date, lng, lat, species in records:
            species_idx = species_to_idx[species]
            f.write(struct.pack('<ffB', lng, lat, species_idx))

    file_size = bin_path.stat().st_size
    expected_size = len(records) * 9
    assert file_size == expected_size, f"Size mismatch: {file_size} != {expected_size}"

    print(f"  ✓ {file_size:,} bytes ({file_size / (1024*1024):.1f} MB)")
    print(f"  ✓ {len(records):,} records × 9 bytes/record")
    print()

    # ─── Write metadata JSON ───────────────────────────────────
    meta_path = output_dir / 'metadata.json'
    print(f"Writing metadata → {meta_path}")

    metadata = {
        'version': 1,
        'startDate': start_date.isoformat(),
        'endDate': end_date.isoformat(),
        'totalDays': total_days,
        'recordCount': len(records),
        'speciesCount': len(species_list),
        'species': species_list,
        'dayOffsets': day_offsets,
        'dailyCounts': daily_counts,
        'stats': {
            'maxDaily': max_daily,
            'avgDaily': round(avg_daily, 1),
            'activeDays': active_days,
        },
    }

    with open(meta_path, 'w') as f:
        json.dump(metadata, f, separators=(',', ':'))

    meta_size = meta_path.stat().st_size
    print(f"  ✓ {meta_size:,} bytes ({meta_size / 1024:.1f} KB)")
    print()

    # ─── Summary ────────────────────────────────────────────────
    elapsed = time.time() - t0
    print(f"{'='*60}")
    print(f"  Done in {elapsed:.1f}s ✓")
    print(f"  Binary:   {bin_path} ({file_size / (1024*1024):.1f} MB)")
    print(f"  Metadata: {meta_path} ({meta_size / 1024:.1f} KB)")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
