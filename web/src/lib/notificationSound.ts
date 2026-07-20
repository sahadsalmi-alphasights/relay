/**
 * Notification sound — "Gong + tinggg" (chosen from the sound picker):
 * a small Chinese hand gong with a low bronze body under the strike and a
 * long bright ringing tail. Fully synthesized with the Web Audio API at
 * play time — no audio asset to load or license.
 *
 * Autoplay policy: browsers only allow sound after the user has interacted
 * with the page. `initSoundUnlock()` (called once at boot) pre-unlocks the
 * AudioContext on the first click/tap; until then plays are skipped silently.
 * The on/off preference is per-device, like the theme.
 */
const STORAGE_KEY = "captracker-sound";

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // private mode — preference just won't persist
  }
}

/** One-time, first-gesture unlock so later notification plays are allowed. */
export function initSoundUnlock(): void {
  if (typeof window === "undefined") return;
  const unlock = () => {
    const c = audioCtx();
    if (c && c.state === "suspended") void c.resume();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

function ring(c: AudioContext, t0: number, freq: number, dur: number, peak: number, waverHz?: number): void {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  if (waverHz) {
    // Subtle pitch waver — what makes the tail sound like struck bronze
    // rather than a pure test tone.
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = waverHz;
    lg.gain.value = freq * 0.004;
    lfo.connect(lg);
    lg.connect(o.frequency);
    lfo.start(t0);
    lfo.stop(t0 + dur);
  }
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.1);
}

function splash(c: AudioContext, t0: number, dur: number, peak: number, centerHz: number): void {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = centerHz;
  f.Q.value = 0.8;
  const g = c.createGain();
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(c.destination);
  src.start(t0);
}

function ting(c: AudioContext, t0: number, dur: number): void {
  splash(c, t0, 0.12, 0.3, 5200);
  ring(c, t0, 1319, dur, 0.42, 5.5);
  ring(c, t0, 1319 * 2.02, dur * 0.6, 0.16);
  ring(c, t0, 1319 * 2.96, dur * 0.35, 0.08);
  ring(c, t0 + 0.01, 1332, dur * 0.9, 0.12);
}

/** The chosen "Gong + tinggg". Skips silently when muted or not yet unlocked. */
export function playNotificationSound(): void {
  if (!isSoundEnabled()) return;
  const c = audioCtx();
  if (!c) return;
  if (c.state === "suspended") {
    // Not unlocked yet (no user gesture) — resume if allowed, else skip.
    void c.resume().catch(() => undefined);
    if (c.state === "suspended") return;
  }
  const t = c.currentTime + 0.02;
  splash(c, t, 0.3, 0.25, 3400);
  ring(c, t, 340, 0.7, 0.2);
  ring(c, t, 512, 0.5, 0.12);
  ting(c, t + 0.02, 1.6);
}
