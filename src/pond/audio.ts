/**
 * Two recorded water sounds, played quietly:
 *
 *  - moving the cursor over the water lets a single drop and its spreading ripple fall, cut from
 *    "random water drop ripple" by Soul_Serenity_Sounds (public/assets/audio/water-drops.mp3). This only
 *    ever happens while the cursor is actually moving, and rarely;
 *  - a click plays "water drop" by freesound_community (public/assets/audio/water-drop.mp3).
 *
 * Both recordings are loud and sharp as supplied, so each is lowered a long way, rounded off with a
 * low-pass filter, faded in and out, and passed through a soft limiter. Browsers only allow audio
 * after a user gesture, so sound starts with the first press.
 */
import { assetUrl } from "./assets";

const STORAGE_KEY = "koi-pond-sound";

export function readStoredSound(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

/** The two drops (with their ripples) found in the long recording, in seconds. */
const DROP_CLIPS: Array<{ start: number; length: number }> = [
  { start: 1.95, length: 0.95 },
  { start: 14.8, length: 0.95 },
];

/** Linear gain applied to each recording (the hover recording peaks near 0.9, the click near 0.58). */
const LEVELS = {
  /** A drop under the cursor: very quiet, about -33 to -29 dBFS depending on how fast the cursor moves. */
  hoverMin: 0.025,
  hoverMax: 0.04,
  /** The click drop: about -18 dBFS. */
  click: 0.03,
};

/** The cursor counts as still once it has not moved for this long (ms). */
const STILL_AFTER_MS = 150;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class PondAudio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private raw: { drops: Promise<ArrayBuffer | null>; click: Promise<ArrayBuffer | null> };
  private drops: AudioBuffer | null = null;
  private click: AudioBuffer | null = null;
  private enabled = readStoredSound();
  private lastDrop = -10;
  /** performance.now() of the previous cursor-move event that reached drip(). */
  private lastMoveAt = -Infinity;
  private voices = 0;
  private level = 1;

  /** `level` scales every sound (e.g. 0.6 for reduced-motion users). */
  constructor(level = 1) {
    this.level = level;
    // Fetch the files now (no gesture needed); they are decoded when audio is unlocked.
    const get = (file: string) =>
      fetch(assetUrl(`audio/${file}`))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null);
    this.raw = { drops: get("water-drops.mp3"), click: get("water-drop.mp3") };
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try {
      window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch {
      /* private mode: the choice just will not persist */
    }
    if (on) this.unlock();
  }

  /** Call from inside a user gesture (pointerdown / keydown). Safe to call repeatedly. */
  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.build(new Ctor());
      } catch {
        return;
      }
    }
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  private build(ctx: AudioContext) {
    this.ctx = ctx;
    const out = ctx.createGain();
    out.gain.value = this.level;
    // A soft ceiling, so overlapping sounds can never get loud.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.knee.value = 20;
    comp.ratio.value = 8;
    out.connect(comp).connect(ctx.destination);
    this.out = out;

    const decode = async (raw: Promise<ArrayBuffer | null>) => {
      const data = await raw;
      if (!data) return null;
      try {
        // decodeAudioData detaches its input, so give it a copy (the same file may be needed again).
        return await ctx.decodeAudioData(data.slice(0));
      } catch {
        return null;
      }
    };
    void decode(this.raw.drops).then((b) => (this.drops = b));
    void decode(this.raw.click).then((b) => (this.click = b));
  }

  private ready() {
    return this.enabled && this.ctx !== null && this.ctx.state === "running" && this.out !== null;
  }

  /**
   * Play part of a buffer at a low level: faded in and out, rounded by a low-pass filter, panned.
   * `gain` is a linear level; `rate` shifts pitch and speed a little so repeats never sound identical.
   */
  private play(buffer: AudioBuffer, start: number, length: number, gain: number, rate: number, pan: number, lowpass: number, fadeIn: number, fadeOut: number) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + 0.005;
    const dur = Math.min(length, buffer.duration - start) / rate;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = lowpass;
    lp.Q.value = 0.5;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + fadeIn);
    env.gain.setValueAtTime(gain, t0 + Math.max(fadeIn, dur - fadeOut));
    env.gain.linearRampToValueAtTime(0.0001, t0 + dur);

    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));

    src.connect(lp).connect(env).connect(p).connect(this.out!);
    src.start(t0, start, length);
    src.stop(t0 + dur + 0.05);
    this.voices++;
    src.onended = () => {
      this.voices--;
      p.disconnect();
    };
  }

  /** A click or tap: one soft water drop. `pan` is -1 (left) to 1 (right). */
  tap(pan: number) {
    // The very first tap can arrive a moment before the context finishes waking up: wait for it.
    if (this.enabled && this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume().then(() => this.playTap(pan));
      return;
    }
    this.playTap(pan);
  }

  private playTap(pan: number) {
    if (!this.ready() || !this.click) return;
    // The whole 0.6 s recording: a drop and its short tail. Round the top off and fade the tail out slowly.
    this.play(this.click, 0, 0.6, LEVELS.click, rand(0.96, 1.04), pan, 6000, 0.005, 0.25);
  }

  /**
   * Called ONLY from the pointer-move handler, when the cursor has just moved more than a few pixels.
   * Now and then a single drop and its ripple fall, a little more often and a little louder when the
   * cursor is quicker. `speed` is about 0..1 (distance moved / 40 px). Never call this from a frame
   * loop: nothing here may sound while the cursor is still.
   */
  drip(speed: number, pan: number) {
    // Guard 1: the cursor must have been moving continuously. If the previous move event was more than
    // STILL_AFTER_MS ago the cursor had stopped, so this event is only the start of a new movement.
    const nowMs = performance.now();
    const sinceMove = nowMs - this.lastMoveAt;
    this.lastMoveAt = nowMs;
    if (sinceMove > STILL_AFTER_MS) return;

    if (!this.ready() || !this.drops || !this.ctx) return;
    const s = Math.min(1, speed);
    if (s < 0.2) return; // Guard 2: slow or tiny movements stay silent
    if (this.voices >= 1) return; // one drip at a time
    const now = this.ctx.currentTime;
    if (now - this.lastDrop < 5.0 - 1.0 * s) return; // at least 4-5 s between drops
    if (Math.random() > 0.12 + 0.2 * s) return; // and even then, only sometimes
    this.lastDrop = now;
    const clip = DROP_CLIPS[Math.floor(Math.random() * DROP_CLIPS.length)];
    const gain = LEVELS.hoverMin + (LEVELS.hoverMax - LEVELS.hoverMin) * s;
    this.play(this.drops, clip.start, clip.length, gain, rand(0.92, 1.1), pan, 4500, 0.01, 0.3);
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
