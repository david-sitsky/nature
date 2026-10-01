const DB_NAME = 'engine-viz';
const DB_VERSION = 1;
const STORE_NAME = 'cache';
const RECORD_SIZE = 9;

export async function loadData(metaUrl, binUrl, cacheKey, palette, onProgress) {
  onProgress('cache-check', 0);
  try {
    const cached = await getFromCache(cacheKey);
    if (cached) {
      onProgress('cache-hit', 1);
      return parseBinary(cached.buffer, cached.metadata, palette);
    }
  } catch (e) {
    console.warn('Cache read failed:', e);
  }

  onProgress('download', 0);
  const metadata = await fetch(metaUrl).then(r => r.json());

  onProgress('download', 0.05);
  const buffer = await fetchWithProgress(binUrl, (p) => onProgress('download', 0.05 + p * 0.9));

  onProgress('parse', 0.95);
  const data = parseBinary(buffer, metadata, palette);

  try {
    await saveToCache(buffer, metadata, cacheKey);
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

function parseBinary(buffer, metadata, palette) {
  const { recordCount } = metadata;
  const view = new DataView(buffer);

  if (buffer.byteLength !== recordCount * RECORD_SIZE) {
    throw new Error(`Binary size mismatch: ${buffer.byteLength} != ${recordCount * RECORD_SIZE}`);
  }

  const positions = new Float32Array(recordCount * 2);
  const categoryIndices = new Uint8Array(recordCount);

  for (let i = 0; i < recordCount; i++) {
    const offset = i * RECORD_SIZE;
    positions[i * 2]     = view.getFloat32(offset, true);
    positions[i * 2 + 1] = view.getFloat32(offset + 4, true);
    categoryIndices[i]   = view.getUint8(offset + 8);
  }

  const colors = new Uint8Array(recordCount * 4);
  const pulseColors = new Uint8Array(recordCount * 4);
  
  for (let i = 0; i < recordCount; i++) {
    const catIdx = categoryIndices[i];
    const c = palette && palette[catIdx] ? palette[catIdx] : [240, 140, 50]; // fallback
    const r = c[0], g = c[1], b = c[2];
    
    colors[i * 4]     = r;
    colors[i * 4 + 1] = g;
    colors[i * 4 + 2] = b;
    colors[i * 4 + 3] = 190;

    pulseColors[i * 4]     = Math.min(255, r + 55);
    pulseColors[i * 4 + 1] = Math.min(255, g + 55);
    pulseColors[i * 4 + 2] = Math.min(255, b + 55);
    pulseColors[i * 4 + 3] = 255;
  }

  return { metadata, positions, categoryIndices, colors, pulseColors, palette };
}

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

async function getFromCache(cacheKey) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(cacheKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function saveToCache(buffer, metadata, cacheKey) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ buffer, metadata }, cacheKey);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
