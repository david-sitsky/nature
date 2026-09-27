# 🐸 FrogID v7 — Interactive Australia Visualisation

An interactive, client-side web visualisation mapping **1,183,011 frog recording events** across Australia from the **FrogID v7 dataset** (covering 2017 to 2024). Built with **deck.gl v9**, **MapLibre GL JS**, and **HTML5/ES Modules**.

---

## 🌟 Key Features

- **⚡ Ultra-Fast Binary Data Format**: Preprocessed a 310MB raw dataset CSV into a packed **10.2MB binary buffer** (`9 bytes/record`), sorted chronologically with an $O(1)$ day offset lookup index for instant loading and $60\text{ fps}$ timeline playback.
- **🐸 218 Species Taxonomy & Common Names**: Curated taxonomy map covering all 218 species in the dataset with Australian common names, families (`Pelodryadidae`, `Myobatrachidae`, `Limnodynastidae`, `Microhylidae`, `Bufonidae`, `Ranidae`), audio call previews, and species profile links.
- **🔊 Inline Audio Call Previews**: Listen to authentic frog call recordings inline via HTML5 audio players without navigating away from the map.
- **🗺️ Multi-Basemap Modes**: Toggle between **Dark Matter** (CARTO), **Streets Voyager** (CARTO), and **High-Resolution Satellite** (ESRI World Imagery).
- **🎛️ Interactive Controls**: 
  - Play / Pause timeline scrubber with **10× default speed**.
  - **Fade Mode** switch (smooth 60-day fading window for historical recordings).
  - Search filter with tag pills, real-time dropdown highlighting, and persistent species cards.
- **📱 Fully Responsive Framing**: Mathematical Web Mercator camera framing that automatically centers Australia and Tasmania comfortably on both wide desktop monitors and narrow mobile portrait screens.
- **💾 Offline-First IndexedDB Cache**: Automatically caches binary buffers and metadata locally (`frogid7-v5`) for instant subsequent page reloads.

---

## 🏗️ Architecture & Data Pipeline

```
310MB Raw CSV ──► preprocess.py ──► 10.2MB frogid7.bin + 32KB metadata.json
                                ──► scrape_species.py + patch_names.py ──► 108KB species_info.json
                                                                            │
Browser Client ◄── HTML5 / deck.gl v9 / MapLibre GL ◄── IndexedDB Cache ◄──┘
```

### Binary File Specification (`data/frogid7.bin`)
Each record is packed into 9 little-endian bytes:
- `longitude` (`float32`, 4 bytes)
- `latitude` (`float32`, 4 bytes)
- `speciesIndex` (`uint8`, 1 byte)

The binary array is sorted chronologically by `eventDate`. `metadata.json` provides an array of `dayOffsets` where `dayOffsets[d]` gives the exact array index for day `d` (0 to 2,556), allowing zero-copy slice rendering via `Float32Array.subarray()`.

---

## 📁 Repository Structure

```
├── index.html                 # Main application markup & container layout
├── styles.css                 # Glassmorphism theme, controls & responsive CSS
├── js/
│   ├── app.js                 # Application controller, search filter & audio logic
│   ├── data.js                # Data loader, IndexedDB cache & color palette generator
│   └── map.js                 # deck.gl + MapLibre 3-layer map rendering module
├── data/
│   ├── frogid7.bin            # Packed binary dataset (10.2 MB)
│   ├── metadata.json          # Timeline metadata & O(1) day offset array
│   ├── species_info.json      # 218 species lookup (common names, audio, images)
│   └── satellite-style.json   # ESRI World Imagery raster basemap style
├── preprocess.py              # Python script converting raw CSV -> binary + metadata
├── scrape_species.py          # Python scraper fetching taxonomy & audio from ALA API
└── patch_names.py             # Curated common name patcher for renamed genera
```

---

## 📚 Data Sources & Attribution

1. **FrogID Dataset v7**:
   - Source: [FrogID Project](https://www.frogid.net.au/) (Australian Museum).
   - Data License: Used under scientific/educational research data provisions.
2. **Atlas of Living Australia (ALA API)**:
   - Source: [ALA Taxon API](https://bie.ala.org.au/) for species taxonomy, common names, and Cloudinary media assets.
3. **Map Basemaps**:
   - Dark & Streets: [CARTO Basemaps](https://carto.com/basemaps/).
   - Satellite Imagery: [ESRI World Imagery](https://www.esri.com/) & MapLibre GL JS.

---

## 🚀 Local Development

Since the app uses ES Modules and `fetch()`, run a local HTTP server:

```bash
# Clone or navigate to the repository directory
cd viz

# Start a local Python HTTP server
python3 -m http.server 8000
```

Open your browser and navigate to: **`http://localhost:8000`**
