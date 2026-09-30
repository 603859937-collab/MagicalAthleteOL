import { describe, expect, it, vi } from 'vitest';
import { BackgroundMusic, MUSIC_LOOP_SECONDS, MUSIC_SAMPLE_RATE, renderMusicLoop } from './backgroundMusic';

describe('synthesized background music', () => {
  it('renders a finite stereo loop with continuous, audible audio across the seam', async () => {
    const channels = await renderMusicLoop();
    expect(channels).toHaveLength(2);
    for (const channel of channels) {
      expect(channel.length).toBe(MUSIC_LOOP_SECONDS * MUSIC_SAMPLE_RATE);
      let peak = 0, sum = 0, finite = true;
      for (const value of channel) {
        finite &&= Number.isFinite(value);
        peak = Math.max(peak, Math.abs(value)); sum += value * value;
      }
      expect(finite).toBe(true);
      expect(peak).toBeLessThanOrEqual(.821);
      expect(Math.sqrt(sum / channel.length)).toBeGreaterThan(.05);
      // No sample discontinuity or fade-to-silence at the loop boundary.
      expect(Math.abs(channel[0] - channel[channel.length - 1])).toBeLessThan(.03);
      for (const section of [channel.slice(0, 2205), channel.slice(-2205)]) {
        expect(Math.sqrt(section.reduce((n, x) => n + x * x, 0) / section.length)).toBeGreaterThan(.02);
      }
    }
    expect(channels[0]).not.toEqual(channels[1]);
  }, 20000);

  function setup(render: () => Promise<Float32Array[]> = async () => [new Float32Array(4), new Float32Array(4)]) {
    const source = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), loop: false, onended: null as null | (() => void) };
    const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelAndHoldAtTime: vi.fn() } };
    source.connect.mockReturnValue(gain);
    const audio = { resume: vi.fn().mockResolvedValue(undefined), state: 'running', currentTime: 3, destination: {},
      createBuffer: vi.fn(() => ({ getChannelData: () => new Float32Array(4) })),
      createBufferSource: vi.fn(() => source), createGain: vi.fn(() => gain) };
    return { player: new BackgroundMusic(audio as unknown as AudioContext, render), source, gain, audio };
  }
  it('uses one native loop despite repeated gestures and fades/disconnects on stop', async () => {
    const { player, source, gain, audio } = setup();
    await Promise.all([player.start(), player.start(), player.start()]);
    await player.start();
    expect(audio.createBufferSource).toHaveBeenCalledTimes(1);
    expect(source.loop).toBe(true);
    player.stop();
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 3.25);
    source.onended?.();
    expect(source.disconnect).toHaveBeenCalled();
    expect(gain.disconnect).toHaveBeenCalled();
  });
  it('does not start after being disabled while synthesis is pending', async () => {
    let resolve!: (value: Float32Array[]) => void;
    const { player, source } = setup(() => new Promise(r => { resolve = r; }));
    const pending = player.start();
    await Promise.resolve();
    player.stop();
    resolve([new Float32Array(4), new Float32Array(4)]);
    await pending;
    expect(source.start).not.toHaveBeenCalled();
  });
});
