export type SfxName =
  | 'shoot'
  | 'hit'
  | 'explode'
  | 'pickup'
  | 'levelup'
  | 'choose'
  | 'hurt'
  | 'boss'
  | 'emp'
  | 'death';

interface Voice {
  type: OscillatorType;
  from: number;
  to: number;
  duration: number;
  gain: number;
  delay?: number;
}

const VOICES: Record<SfxName, Voice[]> = {
  shoot: [{ type: 'square', from: 880, to: 520, duration: 0.06, gain: 0.035 }],
  hit: [{ type: 'triangle', from: 420, to: 260, duration: 0.05, gain: 0.03 }],
  explode: [
    { type: 'sawtooth', from: 220, to: 60, duration: 0.28, gain: 0.06 },
    { type: 'square', from: 90, to: 40, duration: 0.3, gain: 0.04 },
  ],
  pickup: [{ type: 'sine', from: 1180, to: 1760, duration: 0.06, gain: 0.025 }],
  levelup: [
    { type: 'square', from: 523, to: 523, duration: 0.09, gain: 0.05 },
    { type: 'square', from: 659, to: 659, duration: 0.09, gain: 0.05, delay: 0.09 },
    { type: 'square', from: 988, to: 988, duration: 0.16, gain: 0.05, delay: 0.18 },
  ],
  choose: [{ type: 'sine', from: 740, to: 990, duration: 0.08, gain: 0.04 }],
  hurt: [
    { type: 'sawtooth', from: 300, to: 110, duration: 0.16, gain: 0.06 },
    { type: 'square', from: 150, to: 70, duration: 0.2, gain: 0.035, delay: 0.02 },
  ],
  boss: [
    { type: 'sawtooth', from: 170, to: 38, duration: 1.15, gain: 0.09 },
    { type: 'square', from: 330, to: 60, duration: 0.85, gain: 0.05, delay: 0.04 },
    { type: 'sawtooth', from: 70, to: 32, duration: 1.4, gain: 0.07, delay: 0.14 },
  ],
  emp: [
    { type: 'square', from: 1800, to: 110, duration: 0.45, gain: 0.055 },
    { type: 'sine', from: 2600, to: 700, duration: 0.18, gain: 0.03 },
    { type: 'sawtooth', from: 90, to: 38, duration: 0.7, gain: 0.06, delay: 0.06 },
  ],
  death: [
    { type: 'sawtooth', from: 400, to: 40, duration: 1.1, gain: 0.08 },
    { type: 'square', from: 200, to: 30, duration: 1.2, gain: 0.05, delay: 0.05 },
  ],
};

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;
  private lastPlay = new Map<SfxName, number>();

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor =
      typeof window !== 'undefined'
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  unlock(): void {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  play(name: SfxName): void {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    if (ctx.state === 'suspended') return;
    const now = ctx.currentTime;
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < 0.03) return;
    this.lastPlay.set(name, now);

    for (const voice of VOICES[name]) {
      const start = now + (voice.delay ?? 0);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = voice.type;
      osc.frequency.setValueAtTime(voice.from, start);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, voice.to), start + voice.duration);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(voice.gain, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + voice.duration);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(start);
      osc.stop(start + voice.duration + 0.02);
    }
  }
}

export const sfx = new Sfx();
