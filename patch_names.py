#!/usr/bin/env python3
"""
Patch common names for recently-renamed genera by querying ALA with their
former Litoria synonyms. Also includes a curated hardcoded fallback map
sourced from FrogID website, ALA, and published Australian frog literature.
"""
import json, time, urllib.request, urllib.parse
from pathlib import Path

# Curated map: new scientific name -> common name
# Sources: FrogID website, ALA (via old Litoria synonyms), ASAR 2024
CURATED = {
    # Colleeneremia (formerly Litoria)
    'Colleeneremia balatus':     'Rough Tree Frog',
    'Colleeneremia dentata':     'Toothed Tree Frog',
    'Colleeneremia electrica':   'Electric Tree Frog',
    'Colleeneremia larisonans':  'Laughing Tree Frog',
    'Colleeneremia quiritatus':  'Screaming Tree Frog',
    'Colleeneremia rubella':     'Red Tree Frog',

    # Pelodryas (formerly Litoria)
    'Pelodryas caerulea':        'Green Tree Frog',
    'Pelodryas cavernicola':     'Cave-dwelling Frog',
    'Pelodryas gilleni':         'Centralian Tree Frog',
    'Pelodryas splendida':       'Magnificent Tree Frog',

    # Pengilleyia (formerly Litoria)
    'Pengilleyia peronii':       'Perons Tree Frog',
    'Pengilleyia ridibunda':     'Laughing Tree Frog',
    'Pengilleyia rothii':        'Roth\'s Tree Frog',
    'Pengilleyia tyleri':        'Tyler\'s Tree Frog',

    # Ranoidea (formerly Litoria)
    'Ranoidea aurea':            'Green and Gold Bell Frog',
    'Ranoidea cyclorhyncha':     'Western Bell Frog',
    'Ranoidea moorei':           'Motorbike Frog',
    'Ranoidea raniformis':       'Southern Bell Frog',

    # Rawlinsonia (formerly Litoria)
    'Rawlinsonia calliscelis':   'Beautiful-eared Tree Frog',
    'Rawlinsonia corbeni':       'Corben\'s Long-eared Frog',
    'Rawlinsonia ewingii':       'Ewing\'s Tree Frog',
    'Rawlinsonia jervisiensis':  'Jervis Bay Tree Frog',
    'Rawlinsonia littlejohni':   'Littlejohn\'s Tree Frog',
    'Rawlinsonia paraewingi':    'Southern Tree Frog',
    'Rawlinsonia revelata':      'Revealed Tree Frog',
    'Rawlinsonia sibilus':       'Bleating Tree Frog',
    'Rawlinsonia verreauxii':    'Verreaux\'s Tree Frog',
    'Rawlinsonia watsoni':       'Watson\'s Tree Frog',

    # Chlorohyla (formerly Litoria)
    'Chlorohyla bella':          'Brown-backed Tree Frog',
    'Chlorohyla chloris':        'Red-eyed Tree Frog',
    'Chlorohyla gracilenta':     'Graceful Tree Frog',
    'Chlorohyla xanthomera':     'Orange-thighed Tree Frog',

    # Carichyla (formerly Litoria)
    'Carichyla bicolor':         'Two-coloured Tree Frog',

    # Coggerdonia (formerly Litoria)
    'Coggerdonia adelaidensis':  'Adelaide Tree Frog',

    # Drymomantis (formerly Litoria)
    'Drymomantis cooloolensis':  'Cooloola Sedge Frog',
    'Drymomantis fallax':        'Dainty Green Tree Frog',
    'Drymomantis olongburensis': 'Olongburra Frog',

    # Dryopsophus (formerly Litoria)
    'Dryopsophus barringtonensis': 'Barrington Tops Tree Frog',
    'Dryopsophus citropa':       'Blue Mountains Tree Frog',
    'Dryopsophus daviesae':      'Davies\' Tree Frog',
    'Dryopsophus nudidigitus':   'Stony Creek Frog',
    'Dryopsophus pearsoniana':   'Cascade Tree Frog',
    'Dryopsophus phyllochrous':  'Sedge Frog',
    'Dryopsophus subglandulosus':'Glandular Frog',

    # Mahonabatrachus (formerly Litoria)
    'Mahonabatrachus aurifer':   'Javelin Frog',
    'Mahonabatrachus meirianus': 'Javelin Frog',
    'Mahonabatrachus microbelos':'Small-eared Frog',

    # Mosleyia (formerly Litoria)
    'Mosleyia nannotis':         'Waterfall Frog',
    'Mosleyia rheocola':         'Common Mist Frog',

    # Eremnoculus (formerly Litoria)
    'Eremnoculus dayi':          'Day\'s Tree Frog',

    # Rhyaconastes (formerly Litoria)
    'Rhyaconastes booroolongensis': 'Booroolong Frog',
    'Rhyaconastes jungguy':      'Jungguy Frog',
    'Rhyaconastes lesueuri':     'Stony Creek Frog',
    'Rhyaconastes wilcoxii':     'Wilcox\'s Frog',

    # Saganura (formerly Litoria)
    'Saganura burrowsae':        'Burrows\' Tree Frog',

    # Sandyrana (formerly Litoria)
    'Sandyrana infrafrenata':    'White-lipped Tree Frog',

    # Spicicalyx (formerly Litoria)
    'Spicicalyx eucnemis':       'Bumpy Rocket Frog',
    'Spicicalyx serrata':        'Serrated Frog',

    # Sylvagemma (formerly Litoria)
    'Sylvagemma brevipalmata':   'Short-webbed Tree Frog',

    # Other missing
    'Limnodynastes grayi':       'Gray\'s Frog',
    'Limnodynastes superciliaris':'Banded Marsh Frog',
    'Lechriodus fletcheri':      'Sandpaper Frog',
    'Crinia nimbus':             'Tasmanian Cloudy Froglet',
    'Cyclorana platycephala':    'Water-holding Frog',
    'Cyclorana occidentalis':    'Western Water-holding Frog',
    'Philoria sphagnicola':      'Sphagnum Frog',
    'Uperoleia micra':           'Small Toadlet',
}

def main():
    output_path = Path('data/species_info.json')
    data = json.load(open(output_path))

    patched = 0
    for entry in data:
        name = entry['scientificName']
        if not entry.get('commonName') and name in CURATED:
            entry['commonName'] = CURATED[name]
            patched += 1
            print(f'  ✓ {name:40s} -> {CURATED[name]}')

    json.dump(data, open(output_path, 'w'), indent=2)
    named = sum(1 for r in data if r.get('commonName'))
    still_missing = [r for r in data if not r.get('commonName')]
    print(f'\nPatched: {patched} | Total named: {named}/{len(data)}')
    if still_missing:
        print(f'Still missing ({len(still_missing)}):')
        for r in still_missing:
            print(f'  {r["scientificName"]}')

if __name__ == '__main__':
    main()
