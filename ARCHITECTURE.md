# Visualization Engine Architecture

This document serves as a knowledge base for the nature visualization engine, summarizing the architecture, lessons learned, and providing a starting point for adapting the engine for new datasets (e.g., the Bogong Moth visualizer).

## System Overview

The engine is a static HTML/JS/CSS application designed to render millions of data points over time on an interactive map. It uses:
- **MapLibre GL JS** for the base map rendering.
- **Deck.gl** (specifically `MapboxOverlay` with `interleaved: false`) to overlay WebGL data layers (e.g., `ScatterplotLayer`) on top of the map.
- **Vanilla JavaScript & CSS** for the UI components. No modern framework (React/Vue) is used, keeping the project lightweight and fast.

### Core Modules (`/js/`)
- `app.js`: The main controller. Handles DOM caching, UI event listeners (play, pause, rewind, filtering), and orchestrates the other modules.
- `data.js`: Responsible for fetching and parsing the dataset. For large datasets (like FrogID v7), data is fetched as a custom binary format (`data.bin`) and unpacked using a `DataView` for extreme memory efficiency and parsing speed.
- `map.js`: Manages the MapLibre instance and the Deck.gl overlay. Handles the `ScatterplotLayer`, hover tooltips, and rendering logic based on the current "day" in the timeline.
- `audio.js`: Manages audio playback. Supports a base "orchestra" track and dynamically handles audio for individual species when filters are applied.

### Preprocessing (`preprocess.py`)
Large raw datasets (e.g., CSVs) must be preprocessed into:
1. `data.bin`: A compact binary representation of the observations (e.g., x, y, day offset, species index).
2. `species.json`: Metadata about the species (names, audio URLs, image URLs).
3. `metadata.json`: General dataset metadata (start date, end date, bounding boxes).

## Critical Lessons Learned & Gotchas

1. **MapLibre vs Deck.gl Touch Events (Mobile):**
   - Deck.gl captures interactions by intercepting MapLibre's synthesized events. MapLibre MUST have exclusive control over the raw touch events. 
   - Invisible UI wrappers (e.g., flex containers stretching across the screen) MUST have `pointer-events: none` in CSS, while their interactive children get `pointer-events: auto`. Without this, invisible empty spaces will block the map from receiving touch/pan gestures.
   - Using `touch-action: pan-y` on full-width wrapper divs will strictly enforce vertical scrolling on mobile and completely break horizontal map panning beneath it.

2. **MapLibre Map Resize Infinite Loop:**
   - Never call `this.map.resize()` inside a callback bound to the `this.map.on('resize', ...)` event. This triggers an infinite recursion loop that crashes the browser with a Maximum Call Stack Size Exceeded error. Keep UI sync functions and resize triggers strictly separated.

3. **MapLibre Diagonal Pinch Zoom:**
   - If map rotation is disabled (`disableRotation()`), MapLibre sometimes ignores diagonal pinch zooms because the natural twist of fingers triggers the "rotate" threshold before the "zoom" threshold. Fix this by explicitly setting a low zoom threshold: `map.touchZoomRotate.setZoomThreshold(0.01)`.

4. **Testing Suite:**
   - Traditional unit tests are poorly suited for this WebGL-heavy app. We rely on **Playwright** (`tests/ui.spec.js`, `tests/visual.spec.js`).
   - Run tests via `npm run test`. Always ensure these pass before committing.

## Adapting for the Bogong Moth Visualizer

When starting the Bogong Moth visualizer in a new AI thread, follow these steps:
1. **Read this document** to understand the engine constraints.
2. **Review `preprocess.py`** to understand how to convert the raw moth data into the required binary format.
3. **Adapt `data.js`**: If the moth dataset has different fields (e.g., weather patterns instead of species), the binary unpacking logic in `data.js` and the Python preprocessor will need parallel adjustments.
4. **UI Refinements**: The UI is modular. You can strip out the `audio.js` logic if moths do not have audio recordings, or replace the "Species" filter with relevant moth metrics (e.g., life stages, tracking tags).
