import { loadData } from './engine_data.js?v=1';
import { EngineMap } from './engine_map.js?v=1';

class EngineApp {
  constructor() {
    this.data = null;
    this.map  = null;
    this.currentDay  = 0;
    this.playing     = false;
    this.speed       = 10;
    this.tickTimer   = null;
    this.dom = {};
  }

  async init() {
    this._cacheDom();
    try {
      this.data = await loadData(
        'data_bogong/metadata.json',
        'data_bogong/data.bin',
        'bogong-v2',
        [[240, 140, 50]],
        (phase, pct) => this._updateLoading(phase, pct),
      );

      this.map = new EngineMap(
        'map-container',
        this.data
      );

      this._setupControls();
      this._setupMapStyleSwitcher();
      this._setupGesturePrevention();

      this._hideLoading();
      ['statsBar','controls','mapStyleSelector'].forEach(k => {
        if(this.dom[k]) this.dom[k].classList.remove('hidden');
      });

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
      scrubber:         $('scrubber'),
      speedSlider:      $('speed'),
      speedVal:         $('speed-val'),
      dayInfo:          $('day-info'),
      todayInfo:        $('today-info'),
      fadeToggle:       $('fade-toggle'),
      mapStyleSelector: $('map-style-selector'),
    };
  }

  _updateLoading(phase, pct) {
    const { loadingStatus: s, progressFill: p } = this.dom;
    switch (phase) {
      case 'cache-check': s.textContent = 'Checking local cache...';                          p.style.width='5%';               break;
      case 'cache-hit':   s.textContent = '✓ Loaded from cache';                              p.style.width='100%';             break;
      case 'download':    s.textContent = `Downloading data... ${Math.round(pct*100)}%`;      p.style.width=`${Math.round(pct*100)}%`; break;
      case 'parse':       s.textContent = 'Processing records...';                            p.style.width='100%';             break;
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
    }, 500);
  }

  _setupControls() {
    this.dom.btnRewind.addEventListener('click', () => {
      this._pause();
      this._setDay(0);
    });
    this.dom.btnPlay.addEventListener('click', () => this._togglePlay());

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
      if (e.target.tagName === 'INPUT') return;
      const max = this.data.metadata.totalDays - 1;
      switch (e.code) {
        case 'Space':      e.preventDefault(); this._togglePlay(); break;
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
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(eventType => {
      document.addEventListener(eventType, (e) => {
        e.preventDefault();
      }, { passive: false });
    });
  }

  _togglePlay() { this.playing ? this._pause() : this._play(); }
  _play() {
    if (this.currentDay >= this.data.metadata.totalDays - 1) this._setDay(0);
    this.playing = true;
    this.dom.btnPlay.textContent = '⏸';
    this._scheduleTick();
  }
  _pause() {
    this.playing = false;
    this.dom.btnPlay.textContent = '▶';
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

  _setupMapStyleSwitcher() {
    if (!this.dom.mapStyleSelector) return;
    this.dom.mapStyleSelector.querySelectorAll('.style-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.mapStyleSelector.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.map.setMapStyle(btn.dataset.style);
      });
    });
  }
}

const app = new EngineApp();
app.init();
