import { useEffect, useRef, useState } from 'react';
import { BackgroundMusic } from './backgroundMusic';
import { getGameAudioContext } from './gameAudio';

const preferenceKey = 'magical-athlete-music';
export function useBackgroundMusic() {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(preferenceKey) !== 'off'; } catch { return true; }
  });
  const enabledRef = useRef(enabled);
  const player = useRef<BackgroundMusic | null>(null);
  const start = () => {
    if (!enabledRef.current || document.hidden) return;
    const audio = getGameAudioContext();
    if (audio) { player.current ??= new BackgroundMusic(audio); void player.current.start(); }
  };
  useEffect(() => {
    const visibility = () => { if (document.hidden) player.current?.stop(); else if (player.current) start(); };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      document.removeEventListener('visibilitychange', visibility);
      player.current?.stop(); player.current = null;
    };
  }, []);
  return <button type="button" className="music-toggle" aria-label="背景音乐" aria-pressed={enabled}
    title={enabled ? '关闭背景音乐' : '开启背景音乐'} onClick={() => {
      const next = !enabledRef.current;
      enabledRef.current = next; setEnabled(next);
      try { localStorage.setItem(preferenceKey, next ? 'on' : 'off'); } catch { /* Storage is optional. */ }
      if (next) start(); else player.current?.stop();
    }}>♪ 音乐{enabled ? '开' : '关'}</button>;
}
