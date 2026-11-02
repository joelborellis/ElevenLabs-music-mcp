import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal audio controller around an HTMLAudioElement that never enters the
 * DOM (we draw our own timeline). Recreated whenever `src` changes.
 */
export function useAudio(src: string | null | undefined) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPlaying(false);
    setTimeMs(0);
    setDurationMs(0);
    setError(null);
    if (!src) return;

    const audio = new Audio(src);
    audio.preload = "metadata";
    ref.current = audio;

    const onTime = () => setTimeMs(audio.currentTime * 1000);
    const onMeta = () => setDurationMs(Number.isFinite(audio.duration) ? audio.duration * 1000 : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setTimeMs(audio.duration * 1000);
    };
    const onError = () => setError("Couldn't load the audio.");

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      ref.current = null;
    };
  }, [src]);

  const toggle = useCallback(() => {
    const audio = ref.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => setError("Playback was blocked. Tap play again."));
    } else {
      audio.pause();
    }
  }, []);

  const seek = useCallback((ms: number) => {
    const audio = ref.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, ms / 1000);
    setTimeMs(ms);
  }, []);

  return { playing, timeMs, durationMs, error, toggle, seek };
}
