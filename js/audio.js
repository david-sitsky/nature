/**
 * FrogID v7 — Audio Manager Module
 *
 * Manages audio playback for timeline animation:
 *  - Orchestra Mode (no filters): plays data/frog_orchestra.mp3 on loop.
 *  - Filtered Mode (filters active): plays audio for active filter species on loop (up to 5 max).
 *  - Syncs play/pause/stop with timeline state.
 */

export class AudioManager {
  constructor(speciesData) {
    this.speciesData = speciesData;
    this.soundEnabled = false;
    this.isPlaying = false;
    this.activeFilterIndices = [];

    // Orchestra Audio (single mp3 loop)
    this.orchestraAudio = new Audio('data/frog_orchestra.mp3');
    this.orchestraAudio.loop = true;
    this.orchestraAudio.volume = 0.85;

    // Filter Audio Pool (Map speciesIdx -> HTMLAudioElement)
    this.filterAudios = new Map();
  }

  setSoundEnabled(enabled) {
    this.soundEnabled = enabled;
    if (!enabled) {
      this.pause();
    } else if (this.isPlaying) {
      this.play();
    }
  }

  setFilterIndices(filterIndicesSet) {
    this.activeFilterIndices = Array.from(filterIndicesSet);
    this._updateFilterAudios();
  }

  setPlaying(playing) {
    this.isPlaying = playing;
    if (playing) {
      this.play();
    } else {
      this.pause();
    }
  }

  play() {
    if (!this.soundEnabled || !this.isPlaying) return;

    if (this.activeFilterIndices.length === 0) {
      // Orchestra Mode
      this._pauseFilterAudios();
      this.orchestraAudio.play().catch(() => {});
    } else {
      // Filtered Mode
      this.orchestraAudio.pause();
      const targetIndices = this.activeFilterIndices.slice(0, 5); // limit to 5 active audio tracks
      targetIndices.forEach(idx => {
        const audio = this.filterAudios.get(idx);
        if (audio) {
          audio.play().catch(() => {});
        }
      });
    }
  }

  pause() {
    this.orchestraAudio.pause();
    this._pauseFilterAudios();
  }

  stop() {
    this.orchestraAudio.pause();
    this.orchestraAudio.currentTime = 0;
    this._pauseFilterAudios(true);
  }

  _updateFilterAudios() {
    const targetIndices = new Set(this.activeFilterIndices.slice(0, 5));

    // Remove old unused audios
    for (const [idx, audio] of this.filterAudios.entries()) {
      if (!targetIndices.has(idx)) {
        audio.pause();
        audio.currentTime = 0;
        this.filterAudios.delete(idx);
      }
    }

    // Add new audios
    for (const idx of targetIndices) {
      if (!this.filterAudios.has(idx)) {
        const sp = this.speciesData[idx];
        if (sp && sp.audioUrl) {
          const audio = new Audio(sp.audioUrl);
          audio.loop = true;
          audio.volume = 0.6;
          this.filterAudios.set(idx, audio);
          if (this.soundEnabled && this.isPlaying) {
            audio.play().catch(() => {});
          }
        }
      }
    }
  }

  _pauseFilterAudios(resetTime = false) {
    for (const audio of this.filterAudios.values()) {
      audio.pause();
      if (resetTime) audio.currentTime = 0;
    }
  }
}
