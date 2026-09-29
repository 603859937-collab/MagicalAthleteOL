let context: AudioContext | null = null;

function getContext() {
  if (typeof window === "undefined") return null;
  if (typeof AudioContext === "undefined") return null;
  try { context ??= new AudioContext(); } catch { return null; }
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
}

function tone(frequency: number, duration: number, start = 0, type: OscillatorType = "sine", volume = 0.045) {
  const audio = getContext();
  if (!audio) return;
  const now = audio.currentTime + start;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

export function playDiceImpactSound() {
  tone(170, 0.065, 0, "triangle", 0.016);
}

export function playMoveSound() {
  tone(260, 0.06, 0, "triangle", 0.018);
  tone(330, 0.08, 0.06, "triangle", 0.022);
}

export function unlockGameAudio() { getContext(); }
