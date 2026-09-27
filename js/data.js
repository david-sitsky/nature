/**
 * FrogID v7 — Data Loader Module
 *
 * Loads preprocessed binary data + species info, parses into typed arrays
 * for deck.gl, and caches in IndexedDB for instant subsequent loads.
 *
 * Binary format (9 bytes per record, little-endian):
 *   longitude:    float32  (4 bytes)
 *   latitude:     float32  (4 bytes)
 *   speciesIndex: uint8    (1 byte)
 */

const DB_NAME = 'frogid-viz';
const DB_VERSION = 2;
const STORE_NAME = 'cache';
const CACHE_KEY = 'frogid7-v5';
const RECORD_SIZE = 9;

// ─── Family → Color Hue Mapping ────────────────────────────
// Each family gets a distinct hue range so related species share colors
const FAMILY_HUES = {
  'Myobatrachidae':  30,    // warm amber/orange — ground frogs
  'Limnodynastidae': 60,    // yellow-gold — swamp frogs
  'Pelodryadidae':   150,   // green — tree frogs (largest group)
  'Microhylidae':    270,   // purple — narrow-mouthed frogs
  'Ranidae':         200,   // cyan — true frogs
  'Bufonidae':       0,     // red — cane toad (invasive!)
  'Mixophyidae':     100,   // lime-green — barred frogs
  'Unknown':         180,   // teal fallback
};

/**
 * Load all FrogID data, using IndexedDB cache if available.
 * @param {string} metaUrl       URL to metadata.json
 * @param {string} binUrl        URL to frogid7.bin
 * @param {string} speciesUrl    URL to species_info.json
 * @param {function} onProgress  Callback: (phase, progress)
 * @returns {Promise<FrogData>}
 */
export async function loadData(metaUrl, binUrl, speciesUrl, onProgress) {
  onProgress('cache-check', 0);

  // Try IndexedDB cache
  try {
    const cached = await getFromCache();
    if (cached) {
      onProgress('cache-hit', 1);
      return parseBinary(cached.buffer, cached.metadata, cached.speciesInfo);
    }
  } catch (e) {
    console.warn('Cache read failed:', e);
  }

  // Fetch metadata + species info in parallel
  onProgress('download', 0);
  const [metadata, speciesInfo] = await Promise.all([
    fetch(metaUrl).then(r => { if (!r.ok) throw new Error(`metadata: ${r.status}`); return r.json(); }),
    fetch(speciesUrl).then(r => { if (!r.ok) throw new Error(`species: ${r.status}`); return r.json(); }),
  ]);

  // Fetch binary with progress
  onProgress('download', 0.05);
  const buffer = await fetchWithProgress(binUrl, (p) => onProgress('download', 0.05 + p * 0.9));

  // Parse
  onProgress('parse', 0.95);
  const data = parseBinary(buffer, metadata, speciesInfo);

  // Cache
  try {
    await saveToCache(buffer, metadata, speciesInfo);
  } catch (e) {
    console.warn('Cache write failed:', e);
  }

  return data;
}

function fetchWithProgress(url, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    xhr.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else reject(new Error(`HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send();
  });
}

/**
 * Parse binary buffer + metadata + species info into deck.gl-ready data.
 */
function parseBinary(buffer, metadata, speciesInfo) {
  const { recordCount, species } = metadata;
  const view = new DataView(buffer);

  if (buffer.byteLength !== recordCount * RECORD_SIZE) {
    throw new Error(`Binary size mismatch: ${buffer.byteLength} != ${recordCount * RECORD_SIZE}`);
  }

  // Build species lookup map: scientific name → info object
  const speciesLookup = {};
  for (const info of speciesInfo) {
    speciesLookup[info.scientificName] = info;
  }

  // Validate family against known frog families; fall back to genus map for bad ALA results
  const VALID_FAMILIES = new Set([
    'Myobatrachidae','Limnodynastidae','Pelodryadidae',
    'Microhylidae','Ranidae','Bufonidae','Mixophyidae',
  ]);
  const GENUS_FAMILY = {
    'Assa':'Myobatrachidae','Crinia':'Myobatrachidae','Geocrinia':'Myobatrachidae',
    'Metacrinia':'Myobatrachidae','Myobatrachus':'Myobatrachidae','Paracrinia':'Myobatrachidae',
    'Pseudophryne':'Myobatrachidae','Spicospina':'Myobatrachidae','Taudactylus':'Myobatrachidae',
    'Uperoleia':'Myobatrachidae','Arenophryne':'Myobatrachidae',
    'Adelotus':'Limnodynastidae','Heleioporus':'Limnodynastidae','Lechriodus':'Limnodynastidae',
    'Limnodynastes':'Limnodynastidae','Neobatrachus':'Limnodynastidae','Notaden':'Limnodynastidae',
    'Philoria':'Limnodynastidae','Platyplectrum':'Limnodynastidae',
    'Carichyla':'Pelodryadidae','Chlorohyla':'Pelodryadidae','Coggerdonia':'Pelodryadidae',
    'Colleeneremia':'Pelodryadidae','Cyclorana':'Pelodryadidae','Drymomantis':'Pelodryadidae',
    'Dryopsophus':'Pelodryadidae','Litoria':'Pelodryadidae','Pelodryas':'Pelodryadidae',
    'Pengilleyia':'Pelodryadidae','Ranoidea':'Pelodryadidae','Rawlinsonia':'Pelodryadidae',
    'Sandyrana':'Pelodryadidae','Anstisia':'Pelodryadidae','Eremnoculus':'Pelodryadidae',
    'Mahonabatrachus':'Pelodryadidae','Mosleyia':'Pelodryadidae','Rhyaconastes':'Pelodryadidae',
    'Saganura':'Pelodryadidae','Spicicalyx':'Pelodryadidae','Sylvagemma':'Pelodryadidae',
    'Austrochaperina':'Microhylidae','Cophixalus':'Microhylidae',
    'Papurana':'Ranidae','Rhinella':'Bufonidae','Mixophyes':'Mixophyidae',
  };
  const resolveFamily = (raw, genus) => {
    if (raw) {
      const norm = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
      if (VALID_FAMILIES.has(norm)) return norm;
    }
    return GENUS_FAMILY[genus] || 'Unknown';
  };

  // Build enriched species array (indexed by speciesIdx)
  const speciesData = species.map((name, idx) => {
    const info = speciesLookup[name] || {};
    const genus = info.genus || name.split(' ')[0];
    return {
      idx,
      scientificName: name,
      commonName: info.commonName || null,
      genus,
      family: resolveFamily(info.family, genus),
      slug: info.slug || name.toLowerCase().replace(/ /g, '-'),
      profileUrl: info.profileUrl || `https://www.frogid.net.au/frogs/${name.toLowerCase().replace(/ /g, '-')}/`,
      imageId: info.imageId || null,
      thumbnailUrl: info.thumbnailUrl || null,
      audioUrl: info.audioUrl || null,
    };
  });

  // Generate family-grouped color palette
  const palette = generateFamilyPalette(speciesData);

  // Parse binary into typed arrays
  const positions = new Float32Array(recordCount * 2);
  const speciesIndices = new Uint8Array(recordCount);

  for (let i = 0; i < recordCount; i++) {
    const offset = i * RECORD_SIZE;
    positions[i * 2]     = view.getFloat32(offset, true);
    positions[i * 2 + 1] = view.getFloat32(offset + 4, true);
    speciesIndices[i]     = view.getUint8(offset + 8);
  }

  // Build per-record color arrays
  const colors = new Uint8Array(recordCount * 4);
  const pulseColors = new Uint8Array(recordCount * 4);

  for (let i = 0; i < recordCount; i++) {
    const c = palette[speciesIndices[i]];
    colors[i * 4]     = c[0];
    colors[i * 4 + 1] = c[1];
    colors[i * 4 + 2] = c[2];
    colors[i * 4 + 3] = 190;

    pulseColors[i * 4]     = Math.min(255, c[0] + 55);
    pulseColors[i * 4 + 1] = Math.min(255, c[1] + 55);
    pulseColors[i * 4 + 2] = Math.min(255, c[2] + 55);
    pulseColors[i * 4 + 3] = 255;
  }

  return { metadata, speciesData, positions, speciesIndices, colors, pulseColors, palette };
}

/**
 * Generate colors grouped by family, with within-family variation by genus.
 * Related frogs share a color "neighbourhood" while still being distinguishable.
 */
function generateFamilyPalette(speciesData) {
  // Group species by family
  const familyGroups = {};
  for (const sp of speciesData) {
    if (!familyGroups[sp.family]) familyGroups[sp.family] = [];
    familyGroups[sp.family].push(sp);
  }

  const palette = new Array(speciesData.length);

  for (const [family, members] of Object.entries(familyGroups)) {
    const baseHue = FAMILY_HUES[family] ?? 180;
    // Spread hues within ±25° of the family base
    const hueRange = Math.min(50, members.length * 2);

    // Sort by genus then species for consistent ordering
    members.sort((a, b) => a.scientificName.localeCompare(b.scientificName));

    for (let i = 0; i < members.length; i++) {
      const hueOffset = members.length > 1
        ? (i / (members.length - 1) - 0.5) * hueRange
        : 0;
      const hue = (baseHue + hueOffset + 360) % 360;
      const sat = 65 + (i % 4) * 8;
      const light = 52 + (i % 5) * 4;
      palette[members[i].idx] = hslToRgb(hue, sat, light);
    }
  }

  return palette;
}

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
}

// ─── IndexedDB ─────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function getFromCache() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(CACHE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function saveToCache(buffer, metadata, speciesInfo) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ buffer, metadata, speciesInfo }, CACHE_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
