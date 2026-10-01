import csv
import json
import struct
import sys
import time
from datetime import datetime, date
from pathlib import Path

def parse_date(s):
    # E.g., '2013-09-17 02:42:33 UTC' or '2014-05-26'
    s = s.strip()
    if len(s) >= 10:
        return date.fromisoformat(s[:10])
    return None

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 csv2bin.py <input.csv> <output_dir>")
        sys.exit(1)

    input_csv = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)

    print("Reading CSV...")
    records = []
    skipped = 0
    row_count = 0
    
    with open(input_csv, 'r', newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_count += 1
            try:
                time_val = row.get('time_observed_at', '').strip()
                lat_str = row.get('latitude', '').strip()
                lng_str = row.get('longitude', '').strip()

                if not time_val or not lat_str or not lng_str:
                    skipped += 1
                    continue
                
                lat = float(lat_str)
                lng = float(lng_str)
                event_date = parse_date(time_val)
                if event_date is None:
                    skipped += 1
                    continue
                
                # Optional: Filter out dates before a certain threshold
                # Specifically for Bogong dataset to start from Aug 2020
                if event_date < date(2020, 8, 1):
                    skipped += 1
                    continue
                
                records.append((event_date, lng, lat))
            except Exception as e:
                skipped += 1
                continue

    print(f"Read {len(records)} valid records, skipped {skipped}")
    
    # Sort by date
    records.sort(key=lambda r: r[0])
    if not records:
        print("No valid records found.")
        sys.exit(1)
        
    start_date = records[0][0]
    end_date = records[-1][0]
    total_days = (end_date - start_date).days + 1

    print(f"Date range: {start_date} -> {end_date} ({total_days} days)")
    
    day_offsets = [0] * (total_days + 1)
    current_day_idx = 0

    for i, (d, lng, lat) in enumerate(records):
        day_idx = (d - start_date).days
        while current_day_idx <= day_idx:
            day_offsets[current_day_idx] = i
            current_day_idx += 1

    while current_day_idx <= total_days:
        day_offsets[current_day_idx] = len(records)
        current_day_idx += 1

    daily_counts = [day_offsets[i + 1] - day_offsets[i] for i in range(total_days)]

    bin_path = output_dir / 'data.bin'
    print(f"Writing {bin_path}...")
    with open(bin_path, 'wb') as f:
        # 9 bytes per record to match existing code, species 0 for all
        for event_date, lng, lat in records:
            f.write(struct.pack('<ffB', lng, lat, 0))

    meta_path = output_dir / 'metadata.json'
    print(f"Writing {meta_path}...")
    metadata = {
        'version': 1,
        'startDate': start_date.isoformat(),
        'endDate': end_date.isoformat(),
        'totalDays': total_days,
        'recordCount': len(records),
        'speciesCount': 1,
        'species': ['Bogong Moth'],
        'dayOffsets': day_offsets,
        'dailyCounts': daily_counts
    }
    with open(meta_path, 'w') as f:
        json.dump(metadata, f, separators=(',', ':'))

    print("Done.")

if __name__ == '__main__':
    main()
