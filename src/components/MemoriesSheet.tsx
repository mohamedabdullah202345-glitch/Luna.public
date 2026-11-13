import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Plus, Search, Trash2, X } from 'lucide-react';
import { MemoryCategory, MemoryFact, TaskItem } from '../types';

interface MemoriesSheetProps {
  open: boolean;
  initialTab?: 'memories' | 'tasks';
  facts: MemoryFact[];
  tasks: TaskItem[];
  onClose: () => void;
  onAddMemory: (fact: string, category: MemoryCategory) => Promise<void>;
  onDeleteMemory: (index: number) => Promise<void>;
  onAddTask: (title: string, due?: string) => Promise<void>;
  onToggleTask: (id: string) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
}

const CATEGORIES: Array<{ value: MemoryCategory; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'study', label: 'Study' },
  { value: 'goals', label: 'Goals' },
  { value: 'family', label: 'Family' },
  { value: 'habits', label: 'Habits' },
];

export function MemoriesSheet({
  open,
  initialTab = 'memories',
  facts,
  tasks,
  onClose,
  onAddMemory,
  onDeleteMemory,
  onAddTask,
  onToggleTask,
  onDeleteTask,
}: MemoriesSheetProps) {
  const [tab, setTab] = useState<'memories' | 'tasks'>(initialTab);
  const [newFact, setNewFact] = useState('');
  const [category, setCategory] = useState<MemoryCategory>('general');
  const [newTask, setNewTask] = useState('');
  const [newDue, setNewDue] = useState('');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
    }
  }, [initialTab, open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return facts
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => (q ? item.fact.toLowerCase().includes(q) : true))
      .reverse();
  }, [facts, query]);

  const handleMemorySubmit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = newFact.trim();
    if (!clean || saving) return;
    setSaving(true);
    try {
      await onAddMemory(clean, category);
      setNewFact('');
    } finally {
      setSaving(false);
    }
  };

  const handleTaskSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = newTask.trim();
    if (!clean || saving) return;
    setSaving(true);
    try {
      await onAddTask(clean, newDue.trim());
      setNewTask('');
      setNewDue('');
    } finally {
      setSaving(false);
    }
  };

  const openTasksCount = tasks.filter((t) => !t.done).length;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Luna Notebook"
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
            className="w-full sm:max-w-lg max-h-[85dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-[#0D1324]/95 border border-white/12 overflow-hidden pb-safe shadow-2xl"
          >
            <div className="sm:hidden pt-3 pb-1 flex justify-center shrink-0">
              <span className="w-10 h-1.5 rounded-full bg-white/20" />
            </div>

            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-4 shrink-0">
              <div className="flex items-center gap-1 p-1 rounded-xl bg-[#080C18] border border-white/10">
                <button
                  type="button"
                  onClick={() => setTab('memories')}
                  className={`min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    tab === 'memories'
                      ? 'bg-[#F48FB1] text-[#0B1020]'
                      : 'text-[#A6B0C9] hover:text-[#F8F4F6]'
                  }`}
                >
                  Memories ·{' '}
                  <span className="tabular-nums">{facts.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab('tasks')}
                  className={`min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    tab === 'tasks'
                      ? 'bg-[#F3C677] text-[#0B1020]'
                      : 'text-[#A6B0C9] hover:text-[#F8F4F6]'
                  }`}
                >
                  Tasks ·{' '}
                  <span className="tabular-nums">{openTasksCount}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close notebook"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#A6B0C9] hover:text-[#F8F4F6] hover:bg-white/5 transition-colors"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {tab === 'memories' ? (
              <>
                <div className="p-4 border-b border-white/10 space-y-3 bg-white/[0.02]">
                  <form onSubmit={handleMemorySubmit} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newFact}
                        onChange={(e) => setNewFact(e.target.value)}
                        placeholder="Add something for Luna to remember..."
                        className="flex-1 min-w-0 min-h-[44px] px-3.5 rounded-xl bg-[#080C18] border border-white/10 text-sm text-[#F8F4F6] placeholder:text-[#7C88A6] focus:outline-none focus:border-[#F48FB1]"
                      />
                      <select
                        aria-label="Memory category"
                        value={category}
                        onChange={(e) =>
                          setCategory(e.target.value as MemoryCategory)
                        }
                        className="min-h-[44px] px-2.5 rounded-xl bg-[#080C18] border border-white/10 text-xs text-[#F8F4F6] focus:outline-none focus:border-[#F48FB1]"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        disabled={!newFact.trim() || saving}
                        aria-label="Save memory"
                        className="min-h-[44px] min-w-[44px] px-3.5 rounded-xl bg-[#F48FB1] hover:bg-[#F7A3C0] text-[#0B1020] flex items-center justify-center transition-colors disabled:opacity-40 shrink-0"
                      >
                        <Plus className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  </form>

                  <div className="relative">
                    <Search
                      className="w-4 h-4 text-[#7C88A6] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search memories..."
                      className="w-full min-h-[40px] pl-10 pr-3.5 rounded-xl bg-[#080C18] border border-white/10 text-xs text-[#F8F4F6] placeholder:text-[#7C88A6] focus:outline-none focus:border-[#F48FB1]"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto luna-scroll divide-y divide-white/5">
                  {filtered.length === 0 ? (
                    <div className="p-10 text-center text-sm text-[#A6B0C9]">
                      {query
                        ? 'No matching memories.'
                        : 'No memories saved yet.'}
                    </div>
                  ) : (
                    filtered.map(({ item, index }) => (
                      <div
                        key={`${item.fact}-${index}`}
                        className="px-5 py-3.5 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-[#F8F4F6] leading-snug">
                            {item.fact}
                          </p>
                          <p className="mt-1 text-xs font-mono text-[#A6B0C9] tabular-nums">
                            <span className="text-[#F3C677]">
                              {item.category}
                            </span>
                            <span aria-hidden="true"> · </span>
                            <span>saved {item.saved}</span>
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onDeleteMemory(index)}
                          aria-label={`Forget "${item.fact}"`}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#7C88A6] hover:text-[#F48FB1] hover:bg-[#F48FB1]/10 transition-colors shrink-0"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="p-4 border-b border-white/10 bg-white/[0.02]">
                  <form
                    onSubmit={handleTaskSubmit}
                    className="flex items-center gap-2"
                  >
                    <input
                      type="text"
                      value={newTask}
                      onChange={(e) => setNewTask(e.target.value)}
                      placeholder="Add a task..."
                      className="flex-1 min-w-0 min-h-[44px] px-3.5 rounded-xl bg-[#080C18] border border-white/10 text-sm text-[#F8F4F6] placeholder:text-[#7C88A6] focus:outline-none focus:border-[#F3C677]"
                    />
                    <input
                      type="date"
                      aria-label="Optional due date"
                      value={newDue}
                      onChange={(e) => setNewDue(e.target.value)}
                      className="min-h-[44px] w-[124px] px-2.5 rounded-xl bg-[#080C18] border border-white/10 text-xs text-[#A6B0C9] focus:outline-none focus:border-[#F3C677] [color-scheme:dark]"
                    />
                    <button
                      type="submit"
                      disabled={!newTask.trim() || saving}
                      aria-label="Add task"
                      className="min-h-[44px] min-w-[44px] px-3.5 rounded-xl bg-[#F3C677] hover:brightness-105 text-[#0B1020] flex items-center justify-center transition-colors disabled:opacity-40 shrink-0"
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </form>
                </div>

                <div className="flex-1 overflow-y-auto luna-scroll divide-y divide-white/5">
                  {tasks.length === 0 ? (
                    <div className="p-10 text-center text-sm text-[#A6B0C9]">
                      No tasks yet. Ask Luna to add one or type above.
                    </div>
                  ) : (
                    tasks.map((task) => (
                      <div
                        key={task.id}
                        className="px-5 py-3.5 flex items-center justify-between gap-3"
                      >
                        <button
                          type="button"
                          onClick={() => onToggleTask(task.id)}
                          aria-label={
                            task.done
                              ? `Mark "${task.title}" incomplete`
                              : `Complete "${task.title}"`
                          }
                          className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border transition-colors shrink-0 ${
                            task.done
                              ? 'bg-[#F3C677]/20 border-[#F3C677]/40 text-[#F3C677]'
                              : 'bg-[#080C18] border-white/15 text-transparent hover:border-[#F3C677]'
                          }`}
                        >
                          <Check className="w-4 h-4" aria-hidden="true" />
                        </button>
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm leading-snug ${
                              task.done
                                ? 'line-through text-[#7C88A6]'
                                : 'text-[#F8F4F6]'
                            }`}
                          >
                            {task.title}
                          </p>
                          <p className="mt-1 text-xs font-mono text-[#A6B0C9] tabular-nums">
                            {task.due ? `due ${task.due}` : task.status}
                            <span aria-hidden="true"> · </span>
                            <span>{task.source}</span>
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onDeleteTask(task.id)}
                          aria-label={`Delete "${task.title}"`}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#7C88A6] hover:text-[#F48FB1] hover:bg-[#F48FB1]/10 transition-colors shrink-0"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
