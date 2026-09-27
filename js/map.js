/**
 * FrogID v7 — Map Visualization Module
 *
 * deck.gl + MapLibre GL JS: three-layer rendering, hover-driven info updates,
 * species filtering, fade mode, map style switching.
 */

const DeckGL = globalThis.deck.DeckGL;
const ScatterplotLayer = globalThis.deck.ScatterplotLayer;

const MAP_STYLES = {
  dark:      'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  streets:   'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  satellite: 'data/satellite-style.json',   // served locally, URL change detected by deck.gl
};

const FADE_WINDOW = 60; // days

/**
 * Calculates conservative view state (center longitude/latitude + zoom level)
 * so all of Australia (including Tasmania & WA) fits comfortably on screen
 * with generous margins on any window size or device orientation.
 */
function calculateOptimalAustraliaViewport() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const isMobilePortrait = (w <= 600 && h > w);

  const centerLng = 133.5;
  // On mobile portrait, top controls occupy top ~210px of screen space.
  // Setting centerLat = -10.0 provides a perfectly balanced vertical centering
  // in the open space below the top-left controls stack.
  const centerLat = isMobilePortrait ? -10.0 : -28.8;

  let zoom;
  if (w <= 450) {
    zoom = 2.15; // Mobile portrait: WA to QLD to Tasmania all fit with wide margins
  } else if (w <= 650) {
    zoom = 2.45; // Mobile landscape / small tablet
  } else if (w <= 1000) {
    zoom = 3.0;  // Tablet / small window
  } else if (w <= 1350) {
    zoom = 3.35; // Laptop / medium screen
  } else {
    zoom = 3.6;  // 1080p / 4K Desktop
  }

  return {
    longitude: centerLng,
    latitude: centerLat,
    zoom: zoom,
  };
}

export class FrogMap {
  /**
   * @param {string} containerId
   * @param {object} data     — parsed FrogData
   * @param {function} onRecord — callback(recordIdx) fired when a new species is hovered
   */
  constructor(containerId, data, onRecord) {
    this.data = data;
    this.onRecord = onRecord;
    this.currentDay = 0;
    this.fadeMode = true;
    this.activeFilters = new Set();

    this._lastHoveredRecord = -1;
    this._hoverTimer = null;

    const initialView = calculateOptimalAustraliaViewport();

    this.deckgl = new DeckGL({
      container: containerId,
      mapLib: globalThis.maplibregl,
      mapStyle: MAP_STYLES.dark,
      initialViewState: {
        longitude: initialView.longitude,
        latitude:  initialView.latitude,
        zoom: initialView.zoom,
        minZoom: 2,
        maxZoom: 19,
        pitch: 0,
        bearing: 0,
      },
      controller: { dragRotate: false },
      layers: [],
      onHover:  (info) => this._handleHover(info),
      onClick:  () => {},   // no-op; click is unused
    });

    window.addEventListener('resize', () => {
      const v = calculateOptimalAustraliaViewport();
      const map = this.deckgl._map || this.deckgl.getMapboxMap?.() || null;
      if (map && typeof map.jumpTo === 'function') {
        map.jumpTo({ center: [v.longitude, v.latitude], zoom: v.zoom });
      } else {
        this.deckgl.setProps({
          initialViewState: {
            longitude: v.longitude,
            latitude:  v.latitude,
            zoom: v.zoom,
            minZoom: 2,
            maxZoom: 19,
            pitch: 0,
            bearing: 0,
          }
        });
      }
    });
  }

  // ─── Public API ──────────────────────────────────────────

  setDay(day) {
    this.currentDay = day;
    this._updateLayers();
  }

  setFadeMode(enabled) {
    this.fadeMode = enabled;
    this._updateLayers();
  }

  /**
   * Switch map base style. All styles are URL strings so deck.gl detects the change reliably.
   */
  setMapStyle(styleName) {
    const url = MAP_STYLES[styleName];
    if (!url) return;
    this.deckgl.setProps({ mapStyle: url });
  }

  setFilter(speciesIndices) {
    this.activeFilters = speciesIndices;
    this._rebuildFilteredData();
    this._updateLayers();
  }

  getVisibleCounts() {
    const active = this._getActiveData();
    const day = this.currentDay;
    const offsets = active.dayOffsets;
    const endIdx = (day + 1 < offsets.length) ? offsets[day + 1] : active.recordCount;
    return { total: endIdx, today: endIdx - (offsets[day] ?? 0) };
  }

  // ─── Hover ───────────────────────────────────────────────

  _handleHover(info) {
    const container = document.getElementById('map-container');

    if (!info || info.index < 0 || !info.layer || info.layer.id === 'glow') {
      container.style.cursor = '';
      // Debounce no-hover but do NOT call any hide callback —
      // popups persist until the user closes them with ✕
      return;
    }

    container.style.cursor = 'pointer';
    const recordIdx = this._resolveRecordIndex(info);
    if (recordIdx < 0) return;

    // Only fire callback when the hovered record changes (perf + prevents flicker)
    if (recordIdx === this._lastHoveredRecord) return;
    this._lastHoveredRecord = recordIdx;

    if (this.onRecord) this.onRecord(recordIdx);
  }

  // ─── Filter helpers ──────────────────────────────────────

  _rebuildFilteredData() {
    if (this.activeFilters.size === 0) {
      this._filteredIndices = null;
      this._filteredPositions = null;
      this._filteredColors = null;
      this._filteredPulseColors = null;
      this._filteredSpeciesIndices = null;
      this._filteredDayOffsets = null;
      return;
    }

    const { speciesIndices, positions, colors, pulseColors, metadata } = this.data;
    const n = metadata.recordCount;
    const filtered = [];
    for (let i = 0; i < n; i++) {
      if (this.activeFilters.has(speciesIndices[i])) filtered.push(i);
    }

    const fn = filtered.length;
    this._filteredIndices       = filtered;
    this._filteredPositions     = new Float32Array(fn * 2);
    this._filteredColors        = new Uint8Array(fn * 4);
    this._filteredPulseColors   = new Uint8Array(fn * 4);
    this._filteredSpeciesIndices= new Uint8Array(fn);

    for (let j = 0; j < fn; j++) {
      const i = filtered[j];
      this._filteredPositions[j*2]   = positions[i*2];
      this._filteredPositions[j*2+1] = positions[i*2+1];
      for (let c = 0; c < 4; c++) {
        this._filteredColors[j*4+c]      = colors[i*4+c];
        this._filteredPulseColors[j*4+c] = pulseColors[i*4+c];
      }
      this._filteredSpeciesIndices[j] = speciesIndices[i];
    }

    this._filteredDayOffsets = new Array(metadata.dayOffsets.length);
    let fi = 0;
    for (let d = 0; d < metadata.dayOffsets.length; d++) {
      const origOffset = metadata.dayOffsets[d];
      while (fi < fn && filtered[fi] < origOffset) fi++;
      this._filteredDayOffsets[d] = fi;
    }
  }

  _getActiveData() {
    if (this._filteredIndices) {
      return {
        positions:      this._filteredPositions,
        colors:         this._filteredColors,
        pulseColors:    this._filteredPulseColors,
        speciesIndices: this._filteredSpeciesIndices,
        dayOffsets:     this._filteredDayOffsets,
        recordCount:    this._filteredIndices.length,
        originalIndices:this._filteredIndices,
      };
    }
    return {
      positions:      this.data.positions,
      colors:         this.data.colors,
      pulseColors:    this.data.pulseColors,
      speciesIndices: this.data.speciesIndices,
      dayOffsets:     this.data.metadata.dayOffsets,
      recordCount:    this.data.metadata.recordCount,
      originalIndices:null,
    };
  }

  // ─── Layer rendering ─────────────────────────────────────

  _updateLayers() {
    const active = this._getActiveData();
    const day = this.currentDay;
    const offsets = active.dayOffsets;
    const endIdx   = (day + 1 < offsets.length) ? offsets[day + 1] : active.recordCount;
    const dayStart = offsets[day] ?? 0;
    const dayEnd   = endIdx;
    const todayCount = dayEnd - dayStart;

    let histStart = 0;
    if (this.fadeMode && day > FADE_WINDOW) {
      histStart = offsets[day - FADE_WINDOW] ?? 0;
    }
    const histCount = endIdx - histStart;
    const layers = [];

    if (histCount > 0) {
      layers.push(new ScatterplotLayer({
        id: 'history',
        data: {
          length: histCount,
          attributes: {
            getPosition: { value: active.positions.subarray(histStart*2, endIdx*2), size: 2 },
            getFillColor:{ value: active.colors.subarray(histStart*4, endIdx*4),    size: 4 },
          },
        },
        getRadius: 3, radiusUnits: 'pixels', radiusMinPixels: 1.5, radiusMaxPixels: 8,
        opacity: this.fadeMode ? 0.35 : 0.55,
        pickable: true, autoHighlight: true, highlightColor: [255,255,255,80],
        parameters: { depthTest: false },
        _histStart: histStart,
      }));
    }

    if (todayCount > 0) {
      layers.push(new ScatterplotLayer({
        id: 'glow',
        data: {
          length: todayCount,
          attributes: {
            getPosition: { value: active.positions.subarray(dayStart*2, dayEnd*2), size: 2 },
          },
        },
        getRadius: 20, radiusUnits: 'pixels', radiusMinPixels: 10,
        getFillColor: [60, 220, 100, 35], opacity: 0.35,
        pickable: false, parameters: { depthTest: false },
      }));

      layers.push(new ScatterplotLayer({
        id: 'pulse',
        data: {
          length: todayCount,
          attributes: {
            getPosition: { value: active.positions.subarray(dayStart*2, dayEnd*2), size: 2 },
            getFillColor:{ value: active.pulseColors.subarray(dayStart*4, dayEnd*4), size: 4 },
          },
        },
        getRadius: 7, radiusUnits: 'pixels', radiusMinPixels: 3, radiusMaxPixels: 14,
        opacity: 0.9, pickable: true, parameters: { depthTest: false },
        _dayStart: dayStart,
      }));
    }

    this.deckgl.setProps({ layers });
  }

  _resolveRecordIndex(info) {
    const active = this._getActiveData();
    let activeIdx;
    if (info.layer.id === 'pulse') {
      const dayStart = info.layer.props._dayStart ?? active.dayOffsets[this.currentDay];
      activeIdx = dayStart + info.index;
    } else if (info.layer.id === 'history') {
      const histStart = info.layer.props._histStart ?? 0;
      activeIdx = histStart + info.index;
    } else {
      return -1;
    }
    if (active.originalIndices) {
      return (activeIdx >= 0 && activeIdx < active.originalIndices.length)
        ? active.originalIndices[activeIdx] : -1;
    }
    return activeIdx;
  }
}
