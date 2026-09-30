/**
 * FrogID v7 — Main Application Controller
 *
 * Popup model:
 *  - Hover popup (#hover-panel): appears on first hover, stays until ✕ clicked.
 *    Updates (swaps content) when a different species is hovered. Does NOT
 *    disappear when mouse moves to empty map — only ✕ closes it.
 *  - Filter popups (.filter-popup): one per filter pill, persistent species cards
 *    that are completely unaffected by hover. ✕ removes both the popup and the pill.
 *  - Both types live in the #right-panels flex column.
 */

import { loadData } from './data.js?v=7';
import { FrogMap } from './map.js?v=13';
import { AudioManager } from './audio.js?v=11';

class FrogApp {
  constructor() {
    this.data = null;
    this.map  = null;
    this.currentDay  = 0;
    this.playing     = false;
    this.speed       = 10;
    this.tickTimer   = null;

    this.activeFilterIndices = new Set();  // idx → true
    this.filterPopups        = new Map();  // speciesIdx → DOM element

    this.dropdownItems = [];
    this.highlightIdx  = -1;
    this.dom = {};
  }

  // ─── Initialisation ──────────────────────────────────────

  async init() {
    this._cacheDom();
    try {
      this.data = await loadData(
        'data/metadata.json',
        'data/frogid7.bin',
        'data/species_info.json',
        (phase, pct) => this._updateLoading(phase, pct),
      );

      this.map = new FrogMap(
        'map-container',
        this.data,
        (recordIdx) => this._onHover(recordIdx),  // only fired on new species hover
      );

      this.audio = new AudioManager(this.data.speciesData);

      this._setupControls();
      this._setupFilter();
      this._setupMapStyleSwitcher();
      this._setupHoverPanelClose();
      this._setupGesturePrevention();

      this._hideLoading();
      ['statsBar','controls','speciesFilter','mapStyleSelector'].forEach(k =>
        this.dom[k].classList.remove('hidden'));

      this._setDay(0);

    } catch (err) {
      console.error('Init failed:', err);
      this.dom.loadingStatus.textContent = `Error: ${err.message}`;
      this.dom.loadingStatus.style.color = '#f87171';
    }
  }

  _cacheDom() {
    const $ = id => document.getElementById(id);
    this.dom = {
      loadingOverlay:   $('loading-overlay'),
      loadingStatus:    $('loading-status'),
      progressFill:     $('progress-fill'),
      statsBar:         $('stats-bar'),
      statDate:         $('stat-date'),
      statRecords:      $('stat-records'),
      controls:         $('controls'),
      btnRewind:        $('btn-rewind'),
      btnPlay:          $('btn-play'),
      btnSound:         $('btn-sound'),
      scrubber:         $('scrubber'),
      speedSlider:      $('speed'),
      speedVal:         $('speed-val'),
      dayInfo:          $('day-info'),
      todayInfo:        $('today-info'),
      fadeToggle:       $('fade-toggle'),
      speciesFilter:    $('species-filter'),
      filterInput:      $('filter-input'),
      filterClear:      $('filter-clear'),
      filterPills:      $('filter-pills'),
      filterDropdown:   $('filter-dropdown'),
      mapStyleSelector: $('map-style-selector'),
      rightPanels:      $('right-panels'),
      hoverPanel:       $('hover-panel'),
      hoverImg:         $('hover-img'),
      hoverCommon:      $('hover-common'),
      hoverSci:         $('hover-sci'),
      hoverFamily:      $('hover-family'),
      hoverAudio:       $('hover-audio'),
      hoverLink:        $('hover-link'),
      soundHint:        $('sound-hint'),
    };
  }

  // ─── Loading ─────────────────────────────────────────────

  _updateLoading(phase, pct) {
    const { loadingStatus: s, progressFill: p } = this.dom;
    switch (phase) {
      case 'cache-check': s.textContent = 'Checking local cache...';                          p.style.width='5%';               break;
      case 'cache-hit':   s.textContent = '✓ Loaded from cache';                              p.style.width='100%';             break;
      case 'download':    s.textContent = `Downloading data... ${Math.round(pct*100)}%`;      p.style.width=`${Math.round(pct*100)}%`; break;
      case 'parse':       s.textContent = 'Processing 1.18M records...';                      p.style.width='100%';             break;
    }
  }

  _hideLoading() {
    this.dom.loadingOverlay.classList.add('fade-out');
    setTimeout(() => {
      this.dom.loadingOverlay.classList.add('hidden');
      if (this.map && this.map.map) {
        this.map.map.resize();
        this.map._updateLayers();
      }
      this._showSoundHint();
    }, 500);
  }

  _showSoundHint() {
    if (!this.dom.soundHint || (this.audio && this.audio.soundEnabled)) return;

    // Check sessionStorage so hint is only shown ONCE per tab session
    try {
      if (sessionStorage.getItem('frogid_sound_hint_shown') === 'true') return;
    } catch (_) {}

    setTimeout(() => {
      if (this.audio && !this.audio.soundEnabled && this.dom.soundHint) {
        try {
          sessionStorage.setItem('frogid_sound_hint_shown', 'true');
        } catch (_) {}

        this.dom.soundHint.classList.remove('hidden');

        const timer = setTimeout(() => {
          this.dom.soundHint.classList.add('hidden');
        }, 8000);

        const closeBtn = document.getElementById('sound-hint-close');
        if (closeBtn) {
          closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearTimeout(timer);
            this.dom.soundHint.classList.add('hidden');
          });
        }

        this.dom.soundHint.addEventListener('click', (e) => {
          if (e.target === closeBtn) return;
          clearTimeout(timer);
          this.dom.soundHint.classList.add('hidden');
          this._toggleSound();
        });
      }
    }, 1000);
  }

  // ─── Hover popup ─────────────────────────────────────────
  //
  // Called only when a DIFFERENT species is hovered.
  // The popup stays visible; ✕ is the only way to close it.
  // If the species is ALREADY showing in filter popups, we do not show a duplicate popup.

  _onHover(recordIdx) {
    const { speciesData, speciesIndices } = this.data;
    const spIdx = speciesIndices[recordIdx];

    // If this species is already active in filter popups, don't show a duplicate hover popup
    if (this.filterPopups.has(spIdx) || this.activeFilterIndices.has(spIdx)) {
      return;
    }

    const sp = speciesData[spIdx];

    // Populate hover panel
    this.dom.hoverCommon.textContent = sp.commonName || sp.scientificName;
    this.dom.hoverSci.textContent    = sp.commonName ? sp.scientificName : '';
    this.dom.hoverFamily.textContent = sp.family || '';

    if (sp.thumbnailUrl) {
      this.dom.hoverImg.src = sp.thumbnailUrl;
      this.dom.hoverImg.alt = sp.commonName || sp.scientificName;
      this.dom.hoverImg.classList.remove('no-img');
    } else {
      this.dom.hoverImg.src = '';
      this.dom.hoverImg.classList.add('no-img');
    }

    // Audio: only reload if it's a different track
    if (sp.audioUrl) {
      const file = sp.audioUrl.split('/').pop();
      if (!this.dom.hoverAudio.src.endsWith(file)) {
        this._stopAudio(this.dom.hoverAudio);
        this.dom.hoverAudio.src = sp.audioUrl;
        this.dom.hoverAudio.load();
      }
      this.dom.hoverAudio.classList.remove('hidden');
    } else {
      this._stopAudio(this.dom.hoverAudio);
      this.dom.hoverAudio.classList.add('hidden');
    }

    this.dom.hoverLink.href = sp.profileUrl;

    // Show the panel (no-op if already visible)
    this.dom.hoverPanel.classList.remove('hidden');
  }

  _setupHoverPanelClose() {
    // ✕ on the hover panel
    this.dom.hoverPanel.querySelector('.panel-close').addEventListener('click', () => {
      this.dom.hoverPanel.classList.add('hidden');
      this._stopAudio(this.dom.hoverAudio);
      // Reset so next hover re-fires even if same record
      this.map._lastHoveredRecord = -1;
    });
  }

  _stopAudio(el) {
    if (el && !el.paused) { el.pause(); el.currentTime = 0; }
  }

  // ─── Playback ────────────────────────────────────────────

  _setupControls() {
    this.dom.btnRewind.addEventListener('click', () => {
      this._pause();
      this._setDay(0);
    });
    this.dom.btnPlay.addEventListener('click', () => this._togglePlay());
    this.dom.btnSound.addEventListener('click', () => this._toggleSound());

    this.dom.scrubber.max = this.data.metadata.totalDays - 1;
    this.dom.scrubber.addEventListener('input', () => {
      this._pause();
      this._setDay(parseInt(this.dom.scrubber.value, 10));
    });

    this.dom.speedSlider.addEventListener('input', () => {
      this.speed = parseInt(this.dom.speedSlider.value, 10);
      this.dom.speedVal.textContent = `${this.speed}×`;
      if (this.playing) { clearTimeout(this.tickTimer); this._scheduleTick(); }
    });

    this.dom.fadeToggle.addEventListener('change', () =>
      this.map.setFadeMode(this.dom.fadeToggle.checked));

    document.addEventListener('keydown', (e) => {
      if (e.target === this.dom.filterInput || e.target.tagName === 'INPUT') return;
      const max = this.data.metadata.totalDays - 1;
      switch (e.code) {
        case 'Space':      e.preventDefault(); this._togglePlay(); break;
        case 'KeyM':       e.preventDefault(); this._toggleSound(); break;
        case 'ArrowLeft':  e.preventDefault(); this._pause(); this._setDay(Math.max(0,   this.currentDay - (e.shiftKey?7:1))); break;
        case 'ArrowRight': e.preventDefault(); this._pause(); this._setDay(Math.min(max, this.currentDay + (e.shiftKey?7:1))); break;
        case 'Home':       e.preventDefault(); this._pause(); this._setDay(0); break;
        case 'End':        e.preventDefault(); this._pause(); this._setDay(max); break;
        case 'ArrowUp':    e.preventDefault(); this.speed = Math.min(10, this.speed+1); this.dom.speedSlider.value=this.speed; this.dom.speedVal.textContent=`${this.speed}×`; break;
        case 'ArrowDown':  e.preventDefault(); this.speed = Math.max(1,  this.speed-1); this.dom.speedSlider.value=this.speed; this.dom.speedVal.textContent=`${this.speed}×`; break;
      }
    });
  }

  _setupGesturePrevention() {
    // Prevent iOS Safari / Chrome page zoom gestures on HTML UI elements AND the map container
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(eventType => {
      document.addEventListener(eventType, (e) => {
        e.preventDefault();
      }, { passive: false });
    });
  }

  _toggleSound() {
    const enabled = !this.audio.soundEnabled;
    this.audio.setSoundEnabled(enabled);
    this.dom.btnSound.textContent = enabled ? '🔊' : '🔇';
    this.dom.btnSound.classList.toggle('active', enabled);
    if (this.dom.soundHint) {
      this.dom.soundHint.classList.add('hidden');
    }
  }

  _togglePlay() { this.playing ? this._pause() : this._play(); }
  _play() {
    if (this.currentDay >= this.data.metadata.totalDays - 1) this._setDay(0);
    this.playing = true;
    this.dom.btnPlay.textContent = '⏸';
    this.audio.setPlaying(true);
    this._scheduleTick();
  }
  _pause() {
    this.playing = false;
    this.dom.btnPlay.textContent = '▶';
    this.audio.setPlaying(false);
    clearTimeout(this.tickTimer); this.tickTimer = null;
  }
  _scheduleTick() {
    if (!this.playing) return;
    const ms = Math.max(16, Math.round(600 * Math.pow(0.65, this.speed - 1)));
    this.tickTimer = setTimeout(() => this._tick(), ms);
  }
  _tick() {
    if (!this.playing) return;
    if (this.currentDay >= this.data.metadata.totalDays - 1) { this._pause(); return; }
    this._setDay(this.currentDay + 1);
    this._scheduleTick();
  }
  _setDay(day) {
    this.currentDay = day;
    this.map.setDay(day);
    this._updateUI();
  }
  _updateUI() {
    const { metadata } = this.data;
    const d = new Date(metadata.startDate + 'T00:00:00');
    d.setDate(d.getDate() + this.currentDay);
    this.dom.statDate.textContent   = d.toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' });
    const counts = this.map.getVisibleCounts();
    this.dom.statRecords.textContent = counts.total.toLocaleString();
    this.dom.todayInfo.textContent   = `${counts.today.toLocaleString()} today`;
    this.dom.dayInfo.textContent     = `Day ${(this.currentDay+1).toLocaleString()} of ${metadata.totalDays.toLocaleString()}`;
    this.dom.scrubber.value          = this.currentDay;
  }

  // ─── Map Style ───────────────────────────────────────────

  _setupMapStyleSwitcher() {
    this.dom.mapStyleSelector.querySelectorAll('.style-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.mapStyleSelector.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.map.setMapStyle(btn.dataset.style);
      });
    });
  }

  // ─── Species Filter ──────────────────────────────────────

  _setupFilter() {
    const { filterInput, filterDropdown, filterClear } = this.dom;

    filterInput.addEventListener('input', () => {
      this._updateDropdown();
      filterClear.classList.toggle('hidden', !filterInput.value.trim());
    });
    filterInput.addEventListener('focus', () => {
      if (filterInput.value.trim()) this._updateDropdown();
    });
    filterClear.addEventListener('click', () => {
      filterInput.value = '';
      filterClear.classList.add('hidden');
      this._closeDropdown();
    });
    filterInput.addEventListener('keydown', (e) => {
      if (filterDropdown.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown')  { e.preventDefault(); this.highlightIdx = Math.min(this.highlightIdx+1, this.dropdownItems.length-1); this._highlightDropdownItem(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.highlightIdx = Math.max(this.highlightIdx-1, 0); this._highlightDropdownItem(); }
      else if (e.key === 'Enter')   { e.preventDefault(); if (this.highlightIdx >= 0) this._addFilter(this.dropdownItems[this.highlightIdx]); }
      else if (e.key === 'Escape')  { this._closeDropdown(); }
    });
    document.addEventListener('click', (e) => {
      if (!this.dom.speciesFilter.contains(e.target)) this._closeDropdown();
    });
  }

  _updateDropdown() {
    const query = this.dom.filterInput.value.trim().toLowerCase();
    if (!query) { this._closeDropdown(); return; }

    const matches = this.data.speciesData.filter(sp => {
      if (this.activeFilterIndices.has(sp.idx)) return false;
      return (sp.commonName||'').toLowerCase().includes(query)
          || sp.scientificName.toLowerCase().includes(query);
    }).sort((a, b) => (a.commonName || a.scientificName).localeCompare(b.commonName || b.scientificName))
      .slice(0, 50);

    if (!matches.length) { this._closeDropdown(); return; }

    this.dropdownItems = matches;
    this.highlightIdx  = -1;
    this.dom.filterDropdown.innerHTML = '';
    matches.forEach(sp => {
      const c = this.data.palette[sp.idx];
      const el = document.createElement('div');
      el.className = 'filter-option';
      const q = this.dom.filterInput.value.trim();
      el.innerHTML = `
        <div class="filter-option-color" style="background:rgb(${c[0]},${c[1]},${c[2]})"></div>
        <div class="filter-option-names">
          <div class="filter-option-common">${this._hl(sp.commonName||sp.scientificName,q)}</div>
          <div class="filter-option-scientific">${sp.commonName?this._hl(sp.scientificName,q):''}</div>
        </div>
        <div class="filter-option-family">${sp.family}</div>
      `;
      el.addEventListener('mousedown', (e) => { e.preventDefault(); this._addFilter(sp); });
      this.dom.filterDropdown.appendChild(el);
    });
    this.dom.filterDropdown.classList.remove('hidden');
  }

  _hl(text, query) {
    if (!text || !query) return text || '';
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`(${esc})`, 'gi'), '<mark style="background:rgba(34,197,94,0.3);border-radius:2px;padding:0 1px">$1</mark>');
  }

  _highlightDropdownItem() {
    this.dom.filterDropdown.querySelectorAll('.filter-option').forEach((el, i) =>
      el.classList.toggle('highlighted', i === this.highlightIdx));
  }

  _closeDropdown() {
    this.dom.filterDropdown.classList.add('hidden');
    this.highlightIdx = -1;
  }

  _addFilter(species) {
    if (this.activeFilterIndices.has(species.idx)) return;

    // If hover panel is currently showing this species, hide it so we don't have duplicate popups
    if (this.dom.hoverCommon.textContent === (species.commonName || species.scientificName)) {
      this.dom.hoverPanel.classList.add('hidden');
      this._stopAudio(this.dom.hoverAudio);
    }

    this.activeFilterIndices.add(species.idx);
    this.dom.filterInput.value = '';
    this.dom.filterClear.classList.add('hidden');
    this._closeDropdown();
    this._renderPills();
    this._applyFilter();
    this._addFilterPopup(species.idx);
  }

  _removeFilter(idx) {
    this.activeFilterIndices.delete(idx);
    this._renderPills();
    this._applyFilter();
    this._removeFilterPopup(idx);
  }

  _renderPills() {
    this.dom.filterPills.innerHTML = '';
    for (const idx of this.activeFilterIndices) {
      const sp = this.data.speciesData[idx];
      const c  = this.data.palette[idx];
      const label = sp.commonName || sp.scientificName;
      const pill = document.createElement('div');
      pill.className = 'filter-pill';
      pill.innerHTML = `
        <div class="pill-color" style="background:rgb(${c[0]},${c[1]},${c[2]})"></div>
        <span title="${label}">${label}</span>
        <button class="pill-remove" title="Remove">×</button>
      `;
      pill.querySelector('.pill-remove').addEventListener('click', () => this._removeFilter(idx));
      this.dom.filterPills.appendChild(pill);
    }
  }

  _applyFilter() {
    this.map.setFilter(new Set(this.activeFilterIndices));
    if (this.audio) this.audio.setFilterIndices(this.activeFilterIndices);
    this._updateUI();
  }

  // ─── Filter Species Popups ───────────────────────────────
  //
  // Each filter pill gets a persistent species popup in #right-panels.
  // These are immune to hover — they only close when their ✕ is clicked
  // (which also removes the pill).

  _addFilterPopup(speciesIdx) {
    if (this.filterPopups.has(speciesIdx)) return;

    const sp = this.data.speciesData[speciesIdx];
    const c  = this.data.palette[speciesIdx];
    const rgb = `rgb(${c[0]},${c[1]},${c[2]})`;

    const panel = document.createElement('div');
    panel.className = 'species-panel filter-popup glass';
    panel.style.borderLeftColor = rgb;

    panel.innerHTML = `
      <button class="panel-close" title="Close panel">✕</button>
      <div class="panel-header">
        <img class="panel-img${sp.thumbnailUrl?'':' no-img'}"
             src="${sp.thumbnailUrl||''}"
             alt="${sp.commonName||sp.scientificName}"
             loading="lazy">
        <div class="panel-names">
          <div class="panel-common">${sp.commonName||sp.scientificName}</div>
          <div class="panel-sci">${sp.commonName?sp.scientificName:''}</div>
          <div class="panel-family">${sp.family}</div>
        </div>
      </div>
      ${sp.audioUrl?`<audio class="panel-audio" controls preload="none" src="${sp.audioUrl}"></audio>`:''}
      <a class="panel-link" href="${sp.profileUrl}" target="_blank" rel="noopener">View frog profile ↗</a>
    `;

    panel.querySelector('.panel-close').addEventListener('click', () =>
      this._removeFilterPopup(speciesIdx));

    // Append AFTER the hover panel so hover panel stays first
    this.dom.rightPanels.appendChild(panel);
    this.filterPopups.set(speciesIdx, panel);
  }

  _removeFilterPopup(speciesIdx) {
    const panel = this.filterPopups.get(speciesIdx);
    if (!panel) return;
    const audio = panel.querySelector('audio');
    if (audio && !audio.paused) audio.pause();
    panel.style.transition = 'opacity 0.15s, transform 0.15s';
    panel.style.opacity = '0';
    panel.style.transform = 'translateX(12px)';
    setTimeout(() => { panel.remove(); this.filterPopups.delete(speciesIdx); }, 160);
  }
}

const app = new FrogApp();
app.init();
