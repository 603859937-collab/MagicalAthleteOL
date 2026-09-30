// Original audition: 64 BPM, Dmaj9 – Aadd9/C# – Bm7 – Gmaj9.
// Render once in code; wrap note/reverb tails into the start of the buffer.
export const MUSIC_SAMPLE_RATE = 22050;
export const MUSIC_LOOP_SECONDS = 30;
const beat = 60 / 64;
const chords = [[54, 57, 61, 64, 69], [52, 57, 59, 61, 64], [54, 57, 59, 62, 66], [54, 57, 59, 62, 67]];
const melody = [[1, 78], [3, 76], [5.5, 73], [7, 71], [9, 74], [11.5, 73], [13.5, 71], [15, 69],
  [17, 73], [19, 76], [21.5, 78], [23, 76], [25, 74], [27, 73], [29, 71], [30.5, 69]];

export async function renderMusicLoop(sampleRate = MUSIC_SAMPLE_RATE): Promise<Float32Array[]> {
  const length = Math.round(MUSIC_LOOP_SECONDS * sampleRate);
  const dry = [new Float32Array(length), new Float32Array(length)];
  let seed = 17;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const add = (midi: number, start: number, duration: number, gain: number, pan: number, kind: 'pad' | 'bell' | 'bass') => {
    const f = 440 * 2 ** ((midi - 69) / 12);
    const phases = [random(), random(), random()].map(p => p * Math.PI * 2);
    const frequencies = [-.055, 0, .055].map(d => 2 * Math.PI * f * 2 ** (d / 12));
    const left = gain * Math.sqrt((1 - pan) / 2), right = gain * Math.sqrt((1 + pan) / 2);
    const offset = Math.round(start * sampleRate);
    for (let i = 0; i < Math.floor(duration * sampleRate); i++) {
      const t = i / sampleRate, p = 2 * Math.PI * f * t;
      let s = 0;
      if (kind === 'pad') {
        for (let j = 0; j < 3; j++) {
          const phase = frequencies[j] * t + phases[j] + .035 * Math.sin(2 * Math.PI * .17 * t);
          s += (Math.sin(phase) + .18 * Math.sin(2 * phase) + .045 * Math.sin(3 * phase)) / 3;
        }
        s *= Math.min(t / 1.25, 1) * Math.min((duration - t) / 1.8, 1) * (.94 + .06 * Math.sin(2 * Math.PI * .12 * t));
      } else if (kind === 'bell') {
        s = Math.sin(p + 1.1 * Math.exp(-t * 3) * Math.sin(2 * p)) + .13 * Math.sin(2 * p) * Math.exp(-t * 2);
        s *= (1 - Math.exp(-t * 70)) * Math.exp(-t / 1.15) * Math.min((duration - t) / .3, 1);
      } else {
        s = (Math.sin(p) + .12 * Math.sin(2 * p)) * Math.min(t / .3, 1) * Math.min((duration - t) / .8, 1);
      }
      const at = (offset + i) % length;
      dry[0][at] += s * left; dry[1][at] += s * right;
    }
  };
  for (let bar = 0; bar < 8; bar++) {
    const start = bar * 4 * beat;
    chords[bar % 4].forEach((m, j) => add(m, start, 4 * beat + 1.8, .078, (j - 2) * .29, 'pad'));
    add([38, 37, 35, 31][bar % 4], start, 4 * beat + .25, .095, 0, 'bass');
    for (let k = 0; k < 4; k++) add(chords[bar % 4][[1, 3, 2, 4][k]] + 12, start + (k + .5) * beat, 2.6, .024, (-1) ** k * .45, 'bell');
    // Yield between bars so synthesis does not monopolize the UI thread.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  melody.forEach(([b, m]) => add(m, b * beat, 3, .062, Math.sin(b) * .18, 'bell'));
  const wet = dry.map(channel => channel.slice());
  const taps = [[beat * .75, .14, 1], [beat * 1.5, .085, 1]];
  for (let k = 0; k < 26; k++) {
    const delay = .07 + k * .117 + random() * .027;
    taps.push([delay, .045 * Math.exp(-delay / 1.1), k % 2]);
  }
  for (const [delay, gain, swap] of taps) {
    const offset = Math.round(delay * sampleRate);
    for (let ch = 0; ch < 2; ch++) for (let i = 0; i < length; i++) {
      wet[ch][(i + offset) % length] += dry[swap ? 1 - ch : ch][i] * gain;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  let peak = 0;
  for (const channel of wet) for (let i = 0; i < length; i++) {
    channel[i] = Math.tanh(channel[i] * 1.2);
    peak = Math.max(peak, Math.abs(channel[i]));
  }
  for (const channel of wet) for (let i = 0; i < length; i++) channel[i] *= .82 / Math.max(peak, 1e-8);
  return wet;
}

let rendered: Promise<Float32Array[]> | undefined;
const cachedMusic = () => rendered ??= renderMusicLoop().catch(error => { rendered = undefined; throw error; });

export class BackgroundMusic {
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private pending = false;
  private generation = 0;
  constructor(private audio: AudioContext, private render = cachedMusic) {}

  async start() {
    if (this.source || this.pending) return;
    this.pending = true;
    const generation = ++this.generation;
    try {
      await this.audio.resume();
      const channels = await this.render();
      if (generation !== this.generation || this.audio.state !== 'running') return;
      const buffer = this.audio.createBuffer(2, channels[0].length, MUSIC_SAMPLE_RATE);
      channels.forEach((channel, i) => buffer.getChannelData(i).set(channel));
      const source = this.audio.createBufferSource(), gain = this.audio.createGain();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain).connect(this.audio.destination);
      gain.gain.setValueAtTime(0, this.audio.currentTime);
      gain.gain.linearRampToValueAtTime(.22, this.audio.currentTime + 1.2);
      source.start();
      this.source = source; this.gain = gain;
    } catch { /* Audio can be unavailable or blocked; retry on the next gesture. */ }
    finally { if (generation === this.generation) this.pending = false; }
  }

  stop() {
    this.generation++;
    this.pending = false;
    const source = this.source, gain = this.gain;
    this.source = null; this.gain = null;
    if (!source || !gain) return;
    const now = this.audio.currentTime;
    gain.gain.cancelAndHoldAtTime(now);
    gain.gain.linearRampToValueAtTime(0, now + .25);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    source.stop(now + .3);
  }
}
