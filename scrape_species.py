#!/usr/bin/env python3
"""
Fetch species common names + taxonomy from Atlas of Living Australia (ALA) API,
then augment with FrogID image/audio IDs from their Cloudinary CDN and JSON-LD.

Outputs: data/species_info.json

ALA API docs: https://bie.ala.org.au/ws/
"""

import json
import re
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
from html.parser import HTMLParser
from pathlib import Path


FAMILY_MAP = {
    'Assa': 'Myobatrachidae', 'Crinia': 'Myobatrachidae', 'Geocrinia': 'Myobatrachidae',
    'Metacrinia': 'Myobatrachidae', 'Myobatrachus': 'Myobatrachidae', 'Paracrinia': 'Myobatrachidae',
    'Pseudophryne': 'Myobatrachidae', 'Spicospina': 'Myobatrachidae', 'Taudactylus': 'Myobatrachidae',
    'Uperoleia': 'Myobatrachidae', 'Arenophryne': 'Myobatrachidae', 'Spicocalyx': 'Myobatrachidae',
    'Adelotus': 'Limnodynastidae', 'Heleioporus': 'Limnodynastidae', 'Lechriodus': 'Limnodynastidae',
    'Limnodynastes': 'Limnodynastidae', 'Neobatrachus': 'Limnodynastidae', 'Notaden': 'Limnodynastidae',
    'Philoria': 'Limnodynastidae', 'Platyplectrum': 'Limnodynastidae',
    'Carichyla': 'Pelodryadidae', 'Chlorohyla': 'Pelodryadidae', 'Coggerdonia': 'Pelodryadidae',
    'Colleeneremia': 'Pelodryadidae', 'Cyclorana': 'Pelodryadidae', 'Drymomantis': 'Pelodryadidae',
    'Dryopsophus': 'Pelodryadidae', 'Litoria': 'Pelodryadidae', 'Pelodryas': 'Pelodryadidae',
    'Pengilleyia': 'Pelodryadidae', 'Ranoidea': 'Pelodryadidae', 'Rawlinsonia': 'Pelodryadidae',
    'Sandyrana': 'Pelodryadidae', 'Anstisia': 'Pelodryadidae', 'Eremnoculus': 'Pelodryadidae',
    'Mahonabatrachus': 'Pelodryadidae', 'Mosleyia': 'Pelodryadidae', 'Rhyaconastes': 'Pelodryadidae',
    'Saganura': 'Pelodryadidae', 'Spicicalyx': 'Pelodryadidae', 'Sylvagemma': 'Pelodryadidae',
    'Austrochaperina': 'Microhylidae', 'Cophixalus': 'Microhylidae',
    'Papurana': 'Ranidae',
    'Rhinella': 'Bufonidae',
    'Mixophyes': 'Mixophyidae',
}


class JsonLdParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self._in = False
        self._buf = []
        self.blocks = []

    def handle_starttag(self, tag, attrs):
        if tag == 'script' and ('type', 'application/ld+json') in attrs:
            self._in = True
            self._buf = []

    def handle_data(self, data):
        if self._in:
            self._buf.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self._in:
            self._in = False
            try:
                self.blocks.append(json.loads(''.join(self._buf)))
            except Exception:
                pass


def fetch_url(url, timeout=12):
    req = urllib.request.Request(url, headers={
        'User-Agent': 'FrogID-Viz/1.0 (frog conservation visualisation; contact via github)',
        'Accept': 'application/json, text/html',
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode('utf-8', errors='replace'), r.status
    except urllib.error.HTTPError as e:
        return None, e.code
    except Exception as e:
        return None, str(e)


def query_ala(scientific_name):
    """Query ALA BIE for common name, family, image."""
    q = urllib.parse.quote(scientific_name)
    url = f'https://bie.ala.org.au/ws/search.json?q={q}&fq=idxtype:TAXON&pageSize=5'
    body, status = fetch_url(url)
    if not body:
        return {}

    try:
        data = json.loads(body)
    except Exception:
        return {}

    results = data.get('searchResults', {}).get('results', [])
    # Find best match (exact scientific name match)
    for r in results:
        name = r.get('scientificName', '') or r.get('name', '')
        if name.lower() == scientific_name.lower():
            return {
                'commonName': r.get('commonNameSingle') or r.get('commonName') or None,
                'family': r.get('family') or None,
                'thumbnailUrl': r.get('thumbnailUrl') or r.get('smallImageUrl') or None,
            }
    # Fall back to first result
    if results:
        r = results[0]
        return {
            'commonName': r.get('commonNameSingle') or r.get('commonName') or None,
            'family': r.get('family') or None,
            'thumbnailUrl': r.get('thumbnailUrl') or r.get('smallImageUrl') or None,
        }
    return {}


def fetch_frogid_page(scientific_name):
    """Scrape FrogID species page for image ID and audio URL from JSON-LD."""
    slug = scientific_name.lower().replace(' ', '-')
    url = f'https://www.frogid.net.au/frogs/{slug}/'
    body, status = fetch_url(url)
    if not body or status != 200:
        return {}

    parser = JsonLdParser()
    parser.feed(body)

    image_id = None
    audio_url = None
    common_name = None

    for block in parser.blocks:
        btype = block.get('@type', '')

        # Common name from ProfilePage: "name": "Genus species - Common Name"
        if btype == 'ProfilePage':
            name = block.get('name', '')
            if ' - ' in name:
                common_name = name.split(' - ', 1)[1].strip()

        # LearningResource: "alternateName": "Common Name - Species Profile"
        if btype == 'LearningResource':
            alt = block.get('alternateName', '')
            if alt and ' - ' in alt:
                common_name = common_name or alt.split(' - ')[0].strip()

            # Audio
            for a in block.get('audio', []):
                if isinstance(a, dict) and not audio_url:
                    audio_url = a.get('contentUrl')

            # Images — extract Cloudinary ID
            for img in block.get('image', []):
                if image_id:
                    break
                url_str = img.get('url', '') if isinstance(img, dict) else str(img)
                m = re.search(r'cloudinary\.com/ausmus/image/upload/[^/]+/([a-z0-9]+)$', url_str)
                if m:
                    image_id = m.group(1)

    # Fallback: scan raw HTML for audio .m4a
    if not audio_url:
        m = re.search(r'https://media\.frogid\.net\.au/media/[^\s"\'<>]+\.m4a', body)
        if m:
            audio_url = m.group(0)

    # Fallback image: scan raw HTML
    if not image_id:
        m = re.search(r'cloudinary\.com/ausmus/image/upload/[^/\s"\']+/([a-z0-9]{20,})(?:["\'\s])', body)
        if m:
            image_id = m.group(1)

    return {
        'commonName': common_name,
        'imageId': image_id,
        'audioUrl': audio_url,
        'slug': slug,
        'profileUrl': f'https://www.frogid.net.au/frogs/{slug}/',
    }


def main():
    script_dir = Path(__file__).parent
    output_dir = script_dir / 'data'
    meta_path = output_dir / 'metadata.json'
    output_path = output_dir / 'species_info.json'

    if not meta_path.exists():
        print("ERROR: Run preprocess.py first to create metadata.json")
        sys.exit(1)

    with open(meta_path) as f:
        species_list = json.load(f)['species']

    print(f"{'='*60}")
    print(f"  FrogID Species Info Fetcher (ALA + FrogID)")
    print(f"{'='*60}")
    print(f"  Species: {len(species_list)}")
    print()

    # Load existing results for resume support
    existing = {}
    if output_path.exists():
        try:
            for s in json.load(open(output_path)):
                if s.get('commonName') or s.get('imageId'):
                    existing[s['scientificName']] = s
            print(f"  Resuming: {len(existing)} already fetched")
        except Exception:
            pass

    results = []

    for i, name in enumerate(species_list):
        if name in existing:
            results.append(existing[name])
            continue

        genus = name.split()[0]
        print(f"  [{i+1:3d}/{len(species_list)}] {name}...", end=' ', flush=True)

        # 1. Query ALA for common name + family
        ala = query_ala(name)
        time.sleep(0.3)

        # 2. Fetch FrogID page for image + audio
        frogid = fetch_frogid_page(name)
        time.sleep(0.3)

        # Merge: ALA common name preferred (more complete), FrogID as fallback
        common_name = ala.get('commonName') or frogid.get('commonName')
        family = ala.get('family') or FAMILY_MAP.get(genus, 'Unknown')

        # Build thumbnail URL from Cloudinary ID
        image_id = frogid.get('imageId')
        thumbnail_url = None
        if image_id:
            thumbnail_url = f'https://res.cloudinary.com/ausmus/image/upload/c_fill,f_auto,h_80,w_80/{image_id}'
        elif ala.get('thumbnailUrl'):
            thumbnail_url = ala['thumbnailUrl']

        entry = {
            'scientificName': name,
            'commonName': common_name,
            'genus': genus,
            'family': family,
            'slug': frogid.get('slug', name.lower().replace(' ', '-')),
            'profileUrl': frogid.get('profileUrl', f'https://www.frogid.net.au/frogs/{name.lower().replace(" ", "-")}/'),
            'imageId': image_id,
            'thumbnailUrl': thumbnail_url,
            'audioUrl': frogid.get('audioUrl'),
        }
        results.append(entry)

        status = common_name or '(no common name)'
        img = '🖼' if thumbnail_url else ' '
        aud = '🔊' if entry['audioUrl'] else ' '
        print(f"{img}{aud} {status}")

        # Incremental save every 10 species
        if (i + 1) % 10 == 0:
            with open(output_path, 'w') as f:
                json.dump(results, f, indent=2)

    # Final save
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2)

    named = sum(1 for r in results if r.get('commonName'))
    imaged = sum(1 for r in results if r.get('thumbnailUrl'))
    audioed = sum(1 for r in results if r.get('audioUrl'))

    print()
    print(f"{'='*60}")
    print(f"  Common names: {named}/{len(results)}")
    print(f"  Thumbnails:   {imaged}/{len(results)}")
    print(f"  Audio URLs:   {audioed}/{len(results)}")
    print(f"  Output: {output_path}")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
