import { useCallback, useEffect, useRef, useState } from 'react';

export type PomodoroPhase = 'focus' | 'break';
export type PomodoroStatus = 'idle' | 'running' | 'paused';

interface UsePomodoroOptions {
  onPhaseComplete?: (
    completedPhase: PomodoroPhase,
    minutes: number,
    linkedTaskId: string | null
  ) => void;
}

function playGentleChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = ctx.currentTime + idx * 0.14;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.48);
    });
    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1500);
  } catch {
    // Ignore audio context restriction errors
  }
}

export function formatPomodoroTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function usePomodoro({ onPhaseComplete }: UsePomodoroOptions = {}) {
  const [phase, setPhase] = useState<PomodoroPhase>('focus');
  const [status, setStatus] = useState<PomodoroStatus>('idle');
  const [durationMinutes, setDurationMinutes] = useState(25);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [linkedTaskId, setLinkedTaskId] = useState<string | null>(null);
  const [completedSprints, setCompletedSprints] = useState(0);

  const onCompleteRef = useRef(onPhaseComplete);
  useEffect(() => {
    onCompleteRef.current = onPhaseComplete;
  }, [onPhaseComplete]);

  useEffect(() => {
    if (status !== 'running') return;

    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (status !== 'running' || secondsLeft > 0) return;

    playGentleChime();
    const finishedPhase = phase;
    const finishedMinutes = durationMinutes;
    const finishedTask = linkedTaskId;

    if (finishedPhase === 'focus') {
      setCompletedSprints((c) => c + 1);
      setPhase('break');
      setDurationMinutes(5);
      setSecondsLeft(5 * 60);
    } else {
      setPhase('focus');
      setDurationMinutes(25);
      setSecondsLeft(25 * 60);
    }
    setStatus('idle');
    onCompleteRef.current?.(finishedPhase, finishedMinutes, finishedTask);
  }, [durationMinutes, linkedTaskId, phase, secondsLeft, status]);

  const startSession = useCallback(
    (minutes: number, nextPhase: PomodoroPhase = 'focus') => {
      setPhase(nextPhase);
      setDurationMinutes(minutes);
      setSecondsLeft(minutes * 60);
      setStatus('running');
    },
    []
  );

  const togglePause = useCallback(() => {
    setStatus((prev) => {
      if (prev === 'running') return 'paused';
      if (prev === 'paused') return 'running';
      return 'running';
    });
  }, []);

  const resetTimer = useCallback(() => {
    setStatus('idle');
    setPhase('focus');
    setDurationMinutes(25);
    setSecondsLeft(25 * 60);
  }, []);

  return {
    phase,
    status,
    durationMinutes,
    secondsLeft,
    linkedTaskId,
    completedSprints,
    setLinkedTaskId,
    startSession,
    togglePause,
    resetTimer,
  };
}
