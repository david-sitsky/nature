/**
 * FrogID v7 — Map Visualization Module
 *
 * MapLibre GL JS + deck.gl MapboxOverlay: native mobile touch gestures,
 * three-layer rendering, hover-driven info updates, species filtering, fade mode.
 */

const maplibregl = globalThis.maplibregl;
const MapboxOverlay = globalThis.deck.MapboxOverlay || globalThis.deck.MapLibreOverlay;
const ScatterplotLayer = globalThis.deck.ScatterplotLayer;

const MAP_STYLES = {
  dark:      'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  streets:   'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  satellite: 'data/satellite-style.json',   // served locally
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

    // MapLibre GL JS handles 100% of native map touch gestures (pan, pinch-zoom, double-tap zoom)
    this.map = new maplibregl.Map({
      container: containerId,
      style: MAP_STYLES.dark,
      center: [initialView.longitude, initialView.latitude],
      zoom: initialView.zoom,
      minZoom: 1,
      maxZoom: 19,
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
      renderWorldCopies: true,
    });

    // Disable 2-finger map rotation so pinch gestures focus purely on smooth 2D zoom & pan
    if (this.map.touchZoomRotate) {
      this.map.touchZoomRotate.disableRotation();
    }

    // Safety touch reset: when fingers leave the screen, reset gesture state machine to prevent lockups
    const canvas = this.map.getCanvas();
    if (canvas) {
      const resetTouch = () => {
        if (this.map.touchZoomRotate && typeof this.map.touchZoomRotate.disable === 'function') {
          this.map.touchZoomRotate.disable();
          this.map.touchZoomRotate.enable();
          this.map.touchZoomRotate.disableRotation();
        }
      };
      canvas.addEventListener('touchend', (e) => {
        if (e.touches && e.touches.length === 0) resetTouch();
      }, { passive: true });
      canvas.addEventListener('touchcancel', resetTouch, { passive: true });
    }

    // DeckGL overlay manages high-performance WebGL scatterplot layers
    this.overlay = new MapboxOverlay({
      interleaved: true,
      pickingRadius: 15,
      onClick: (info) => this._handleClick(info),
      onHover: (info) => this._handleHover(info),
    });

    this.map.addControl(this.overlay);

    // Synchronize MapLibre viewport & deck.gl projection matrix on load, style change, and resize
    const syncMapAndDeck = () => {
      this.map.resize();
      this.map.triggerRepaint();
      this._updateLayers();
    };

    this.map.on('load', syncMapAndDeck);
    this.map.on('styledata', syncMapAndDeck);
    this.map.on('resize', () => {
      this._updateLayers();
      this.map.triggerRepaint();
    });
    this.map.on('move', () => {
      this.map.triggerRepaint();
    });

    // ResizeObserver watches the actual #map-container DOM element dimensions frame-by-frame
    const mapContainer = document.getElementById(containerId);
    if (mapContainer && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        syncMapAndDeck();
      });
      ro.observe(mapContainer);
    }

    let lastWidth = window.innerWidth;
    let hasUserMoved = false;

    this.map.on('movestart', (e) => {
      if (e.originalEvent) hasUserMoved = true;
    });

    window.addEventListener('resize', () => {
      syncMapAndDeck();
      const newWidth = window.innerWidth;
      if (!hasUserMoved && Math.abs(newWidth - lastWidth) > 80) {
        lastWidth = newWidth;
        const v = calculateOptimalAustraliaViewport();
        this.map.jumpTo({ center: [v.longitude, v.latitude], zoom: v.zoom });
        syncMapAndDeck();
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

  setMapStyle(styleName) {
    const url = MAP_STYLES[styleName];
    if (!url) return;
    this.map.setStyle(url);
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

  // ─── Hover & Tap ─────────────────────────────────────────

  _handleHover(info) {
    // If map is currently moving/panning/zooming, DO NOT trigger hover popups
    if (this.map && (this.map.isMoving() || this.map.isZooming())) return;

    // On touch devices, ignore hover events so touch start never pops open UI elements mid-gesture
    const src = info?.srcEvent;
    if (src && (src.pointerType === 'touch' || src.type?.startsWith('touch'))) {
      return;
    }

    const container = document.getElementById('map-container');
    if (!info || info.index < 0 || !info.layer || info.layer.id === 'glow') {
      if (container) container.style.cursor = '';
      return;
    }

    if (container) container.style.cursor = 'pointer';
    const recordIdx = this._resolveRecordIndex(info);
    if (recordIdx < 0) return;

    if (recordIdx === this._lastHoveredRecord) return;
    this._lastHoveredRecord = recordIdx;

    if (this.onRecord) this.onRecord(recordIdx);
  }

  _handleClick(info) {
    if (!info || info.index < 0 || !info.layer || info.layer.id === 'glow') {
      return;
    }
    const recordIdx = this._resolveRecordIndex(info);
    if (recordIdx < 0) return;

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
        getRadius: 3, radiusUnits: 'pixels', radiusMinPixels: 2.5, radiusMaxPixels: 9,
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
        getRadius: 20, radiusUnits: 'pixels', radiusMinPixels: 12,
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
        getRadius: 8, radiusUnits: 'pixels', radiusMinPixels: 5, radiusMaxPixels: 16,
        opacity: 0.9, pickable: true, parameters: { depthTest: false },
        _dayStart: dayStart,
      }));
    }

    this.overlay.setProps({ layers });
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
