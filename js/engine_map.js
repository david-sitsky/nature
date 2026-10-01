const maplibregl = globalThis.maplibregl;
const MapboxOverlay = globalThis.deck.MapboxOverlay || globalThis.deck.MapLibreOverlay;
const ScatterplotLayer = globalThis.deck.ScatterplotLayer;

const MAP_STYLES = {
  dark:      'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  streets:   'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  satellite: 'data/satellite-style.json',
};

const FADE_WINDOW = 60; // days

function calculateOptimalAustraliaViewport() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const isMobilePortrait = (w <= 600 && h > w);
  const centerLng = 133.5;
  const centerLat = isMobilePortrait ? -10.0 : -28.8;
  let zoom;
  if (w <= 450) zoom = 2.15;
  else if (w <= 650) zoom = 2.45;
  else if (w <= 1000) zoom = 3.0;
  else if (w <= 1350) zoom = 3.35;
  else zoom = 3.6;
  
  return { longitude: centerLng, latitude: centerLat, zoom };
}

export class EngineMap {
  constructor(containerId, data, onRecord = null) {
    this.data = data;
    this.onRecord = onRecord;
    this.currentDay = 0;
    this.fadeMode = true;
    this.activeFilters = new Set();
    
    this._lastHoveredRecord = -1;
    this._hoverTimer = null;

    const initialView = calculateOptimalAustraliaViewport();

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

    if (this.map.touchZoomRotate) {
      this.map.touchZoomRotate.disableRotation();
      if (typeof this.map.touchZoomRotate.setZoomThreshold === 'function') {
        this.map.touchZoomRotate.setZoomThreshold(0.01);
      }
    }

    this.overlay = new MapboxOverlay({
      interleaved: false,
      pickingRadius: 15,
      onClick: (info) => this._handleClick(info),
      onHover: (info) => this._handleHover(info),
    });

    this.map.addControl(this.overlay);

    const syncDeck = () => {
      this._updateLayers();
    };

    this.map.on('load', syncDeck);
    this.map.on('styledata', syncDeck);
    this.map.on('resize', syncDeck);

    const mapContainer = document.getElementById(containerId);
    if (mapContainer && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        this.map.resize();
      });
      ro.observe(mapContainer);
    }
    window.addEventListener('resize', () => {
      this.map.resize();
    });
  }

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

  setFilter(categoryIndices) {
    this.activeFilters = categoryIndices;
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

  _handleHover(info) {
    if (this.map && (this.map.isMoving() || this.map.isZooming())) return;
    
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

  _rebuildFilteredData() {
    if (this.activeFilters.size === 0) {
      this._filteredIndices = null;
      this._filteredPositions = null;
      this._filteredColors = null;
      this._filteredPulseColors = null;
      this._filteredCategoryIndices = null;
      this._filteredDayOffsets = null;
      return;
    }

    const { categoryIndices, positions, colors, pulseColors, metadata } = this.data;
    const n = metadata.recordCount;
    const filtered = [];
    for (let i = 0; i < n; i++) {
      if (this.activeFilters.has(categoryIndices[i])) filtered.push(i);
    }

    const fn = filtered.length;
    this._filteredIndices       = filtered;
    this._filteredPositions     = new Float32Array(fn * 2);
    this._filteredColors        = new Uint8Array(fn * 4);
    this._filteredPulseColors   = new Uint8Array(fn * 4);
    this._filteredCategoryIndices = new Uint8Array(fn);

    for (let j = 0; j < fn; j++) {
      const i = filtered[j];
      this._filteredPositions[j*2]   = positions[i*2];
      this._filteredPositions[j*2+1] = positions[i*2+1];
      for (let c = 0; c < 4; c++) {
        this._filteredColors[j*4+c]      = colors[i*4+c];
        this._filteredPulseColors[j*4+c] = pulseColors[i*4+c];
      }
      this._filteredCategoryIndices[j] = categoryIndices[i];
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
        positions:       this._filteredPositions,
        colors:          this._filteredColors,
        pulseColors:     this._filteredPulseColors,
        categoryIndices: this._filteredCategoryIndices,
        dayOffsets:      this._filteredDayOffsets,
        recordCount:     this._filteredIndices.length,
        originalIndices: this._filteredIndices,
      };
    }
    return {
      positions:       this.data.positions,
      colors:          this.data.colors,
      pulseColors:     this.data.pulseColors,
      categoryIndices: this.data.categoryIndices,
      dayOffsets:      this.data.metadata.dayOffsets,
      recordCount:     this.data.metadata.recordCount,
      originalIndices: null,
    };
  }

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
