import { AnimatePresence, motion } from 'motion/react';
import { Coffee, Pause, Play, RotateCcw, Timer, X } from 'lucide-react';
import { TaskItem } from '../types';
import {
  formatPomodoroTime,
  PomodoroPhase,
  PomodoroStatus,
} from '../hooks/usePomodoro';

interface PomodoroSheetProps {
  open: boolean;
  phase: PomodoroPhase;
  status: PomodoroStatus;
  durationMinutes: number;
  secondsLeft: number;
  completedSprints: number;
  linkedTaskId: string | null;
  tasks: TaskItem[];
  onClose: () => void;
  onSelectTask: (id: string | null) => void;
  onStartSession: (minutes: number, phase: PomodoroPhase) => void;
  onTogglePause: () => void;
  onReset: () => void;
}

const FOCUS_PRESETS = [
  { minutes: 15, label: '15m Sprint', note: 'Quick warm-up' },
  { minutes: 25, label: '25m Focus', note: 'Classic Pomodoro' },
  { minutes: 45, label: '45m Deep', note: 'Coding / lectures' },
];

export function PomodoroSheet({
  open,
  phase,
  status,
  durationMinutes,
  secondsLeft,
  completedSprints,
  linkedTaskId,
  tasks,
  onClose,
  onSelectTask,
  onStartSession,
  onTogglePause,
  onReset,
}: PomodoroSheetProps) {
  const openTasks = tasks.filter((t) => !t.done);
  const totalSecs = Math.max(1, durationMinutes * 60);
  const progress = Math.min(1, Math.max(0, 1 - secondsLeft / totalSecs));
  const isRunning = status === 'running';
  const isPaused = status === 'paused';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Study Timer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#040711]/75 backdrop-blur-sm sm:p-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md max-h-[86dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-[#0D1324]/95 border border-white/12 overflow-hidden pb-safe shadow-2xl"
          >
            <div className="sm:hidden pt-3 pb-1 flex justify-center shrink-0">
              <span className="w-10 h-1.5 rounded-full bg-white/20" />
            </div>

            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-4 shrink-0">
              <div>
                <h2 className="font-display text-lg font-medium text-[#F8F4F6] flex items-center gap-2">
                  <Timer className="w-4 h-4 text-[#F3C677]" aria-hidden="true" />
                  <span>Study Timer</span>
                </h2>
                <p className="text-xs text-[#A6B0C9]">
                  {completedSprints > 0
                    ? `${completedSprints} ${completedSprints === 1 ? 'sprint' : 'sprints'} finished today · Luna checks in when time is up`
                    : 'Focus sprints with Luna · she checks in when time is up'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close Study Timer"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#A6B0C9] hover:text-[#F8F4F6] hover:bg-white/5 transition-colors"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto luna-scroll p-5 space-y-5">
              {/* Timer Readout Card */}
              <div className="rounded-2xl bg-[#080C18]/85 border border-white/10 p-5 text-center space-y-3">
                <p className="text-xs font-medium tracking-wide uppercase text-[#A6B0C9]">
                  {phase === 'break' ? 'Break Time' : 'Focus Sprint'}
                </p>
                <p className="font-mono text-5xl font-semibold tracking-tight text-[#F8F4F6] tabular-nums">
                  {formatPomodoroTime(secondsLeft)}
                </p>
                <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      phase === 'break'
                        ? 'bg-[#F48FB1]'
                        : 'bg-gradient-to-r from-[#F48FB1] to-[#F3C677]'
                    }`}
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>

                <div className="pt-2 flex items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={
                      isRunning || isPaused
                        ? onTogglePause
                        : () => onStartSession(durationMinutes, phase)
                    }
                    className="min-h-[44px] px-5 rounded-xl bg-gradient-to-r from-[#F48FB1] to-[#F3C677] text-[#0B1020] text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-transform active:scale-[0.98]"
                  >
                    {isRunning ? (
                      <>
                        <Pause className="w-4 h-4" aria-hidden="true" />
                        <span>Pause</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" aria-hidden="true" />
                        <span>{isPaused ? 'Resume' : 'Start Focus'}</span>
                      </>
                    )}
                  </button>

                  {(isRunning || isPaused) && (
                    <button
                      type="button"
                      onClick={onReset}
                      aria-label="Reset timer"
                      className="min-h-[44px] min-w-[44px] rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[#A6B0C9] hover:text-[#F8F4F6] flex items-center justify-center transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              {/* Focus Presets */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[#A6B0C9]">
                  Quick Start Presets
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {FOCUS_PRESETS.map((preset) => {
                    const active =
                      phase === 'focus' && durationMinutes === preset.minutes;
                    return (
                      <button
                        key={preset.minutes}
                        type="button"
                        onClick={() => onStartSession(preset.minutes, 'focus')}
                        className={`min-h-[58px] px-2.5 py-2 rounded-2xl border text-center flex flex-col items-center justify-center transition-all ${
                          active
                            ? 'bg-[#F3C677]/15 border-[#F3C677]/50 text-[#F8F4F6]'
                            : 'bg-[#080C18]/80 border-white/10 text-[#A6B0C9] hover:text-[#F8F4F6] hover:border-white/20'
                        }`}
                      >
                        <span className="text-xs font-semibold whitespace-nowrap">
                          {preset.label}
                        </span>
                        <span className="text-[11px] text-[#7C88A6] mt-0.5 truncate max-w-full">
                          {preset.note}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => onStartSession(5, 'break')}
                  className="w-full min-h-[44px] px-4 rounded-xl bg-[#080C18]/80 hover:bg-white/5 border border-white/10 text-xs font-medium text-[#A6B0C9] hover:text-[#F8F4F6] flex items-center justify-center gap-2 transition-colors"
                >
                  <Coffee
                    className="w-3.5 h-3.5 text-[#F48FB1]"
                    aria-hidden="true"
                  />
                  <span>Take a 5-Minute Break</span>
                </button>
              </div>

              {/* Link an Open Task */}
              {openTasks.length > 0 && (
                <div className="space-y-2">
                  <label
                    htmlFor="pomodoro-task-select"
                    className="block text-xs font-semibold uppercase tracking-wide text-[#A6B0C9]"
                  >
                    Focusing On Task (Optional)
                  </label>
                  <select
                    id="pomodoro-task-select"
                    value={linkedTaskId ?? ''}
                    onChange={(e) => onSelectTask(e.target.value || null)}
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#080C18] border border-white/10 text-xs text-[#F8F4F6] focus:outline-none focus:border-[#F3C677]"
                  >
                    <option value="">General Study / Coding</option>
                    {openTasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
