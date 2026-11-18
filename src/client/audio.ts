/**
 * Background music (CC0 tracks in public/audio/music, see public/audio/CREDITS.md)
 * and synthesized sound effects (Web Audio). Client-only: never used by src/sim.
 */

export type Mood = 'peace' | 'war';
export type Sfx = 'command' | 'error' | 'war' | 'break' | 'alliance';

const BASE = import.meta.env.BASE_URL + 'audio/music/';
const PLAYLISTS: Record<Mood, string[]> = {
  peace: ['peace-exploration.mp3', 'peace-old-tower-inn.mp3', 'peace-minstrel-dance.mp3'],
  war: ['war-battle-theme-a.mp3', 'war-orcs-victorious.mp3'],
};

interface Settings {
  music: number;
  sfx: number;
  muted: boolean;
}

const KEY = 'slg.audio';

function load(): Settings {
  const fallback = { music: 0.4, sfx: 0.6, muted: false };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return fallback;
  }
}

class AudioManager {
  settings: Settings = load();
  private ctx: AudioContext | null = null;
  private el: HTMLAudioElement | null = null;
  private mood: Mood = 'peace';
  private index: Record<Mood, number> = { peace: 0, war: 0 };
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();

  /** Call from a user gesture (browsers block audio until then). */
  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
    if (!this.el) this.playTrack();
  }

  setMood(mood: Mood) {
    if (mood === this.mood) return;
    this.mood = mood;
    if (this.el) this.fadeTo(() => this.playTrack());
  }

  update(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      /* storage unavailable */
    }
    if (this.el) this.el.volume = this.musicVolume;
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  stopMusic() {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    this.el?.pause();
    this.el = null;
  }

  private get musicVolume() {
    return this.settings.muted ? 0 : this.settings.music;
  }

  private playTrack() {
    const list = PLAYLISTS[this.mood];
    const file = list[this.index[this.mood] % list.length];
    this.index[this.mood]++;
    this.el?.pause();
    const el = new Audio(BASE + file);
    el.volume = this.musicVolume;
    el.addEventListener('ended', () => {
      if (this.el === el) this.playTrack();
    });
    this.el = el;
    void el.play().catch(() => {
      /* autoplay blocked until the next gesture */
    });
  }

  private fadeTo(next: () => void) {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    const el = this.el;
    if (!el) return next();
    this.fadeTimer = setInterval(() => {
      el.volume = Math.max(0, el.volume - 0.05);
      if (el.volume <= 0.01) {
        clearInterval(this.fadeTimer!);
        this.fadeTimer = null;
        next();
      }
    }, 60);
  }

  // ---------- synthesized sound effects ----------

  play(sfx: Sfx) {
    const ctx = this.ctx;
    if (!ctx || this.settings.muted || this.settings.sfx <= 0) return;
    const out = ctx.createGain();
    out.gain.value = this.settings.sfx;
    out.connect(ctx.destination);
    const t = ctx.currentTime;
    switch (sfx) {
      case 'command':
        this.tone(out, 660, t, 0.06, 'triangle', 0.35);
        this.tone(out, 990, t + 0.05, 0.07, 'triangle', 0.25);
        break;
      case 'error':
        this.tone(out, 180, t, 0.15, 'square', 0.15);
        break;
      case 'war':
        // Three war-drum hits and a low horn.
        for (let i = 0; i < 3; i++) this.drum(out, t + i * 0.28);
        this.tone(out, 110, t + 0.9, 0.9, 'sawtooth', 0.22, 98);
        this.tone(out, 165, t + 0.9, 0.9, 'sawtooth', 0.12, 147);
        break;
      case 'break':
        // Falling, slightly dissonant pair.
        this.tone(out, 520, t, 0.5, 'sine', 0.3, 260);
        this.tone(out, 554, t, 0.5, 'sine', 0.2, 277);
        this.tone(out, 196, t + 0.45, 0.4, 'triangle', 0.25);
        break;
      case 'alliance':
        [523, 659, 784].forEach((f, i) => this.tone(out, f, t + i * 0.12, 0.35, 'triangle', 0.3));
        break;
    }
  }

  private tone(out: AudioNode, freq: number, start: number, dur: number, type: OscillatorType, gain: number, endFreq?: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(out);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  private drum(out: AudioNode, start: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, start);
    osc.frequency.exponentialRampToValueAtTime(45, start + 0.25);
    g.gain.setValueAtTime(0.9, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
    osc.connect(g).connect(out);
    osc.start(start);
    osc.stop(start + 0.35);
    // A short noise burst for the skin of the drum.
    const len = Math.floor(ctx.sampleRate * 0.08);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const noise = ctx.createBufferSource();
    const ng = ctx.createGain();
    ng.gain.value = 0.25;
    noise.buffer = buf;
    noise.connect(ng).connect(out);
    noise.start(start);
  }
}

export const audio = new AudioManager();
