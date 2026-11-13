import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Mic,
  MicOff,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import {
  EnglishCheckResponse,
  EnglishSparkResponse,
  TranscriptEntry,
} from '../types';

interface EnglishCoachSheetProps {
  open: boolean;
  transcript: TranscriptEntry[];
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onSpeakSample: (text: string) => void;
  onStartRoleplayWithLuna: (title: string, starter: string) => void;
}

const THEMES = [
  { id: 'everyday', label: 'Everyday' },
  { id: 'coding', label: 'Coding & Tech' },
  { id: 'coffee', label: 'Coffee & Travel' },
  { id: 'debate', label: 'Playful Debate' },
];

export function EnglishCoachSheet({
  open,
  transcript,
  apiFetch,
  onClose,
  onSpeakSample,
  onStartRoleplayWithLuna,
}: EnglishCoachSheetProps) {
  const [theme, setTheme] = useState('everyday');
  const [spark, setSpark] = useState<EnglishSparkResponse | null>(null);
  const [loadingSpark, setLoadingSpark] = useState(false);
  const [sparkError, setSparkError] = useState('');

  const [answer, setAnswer] = useState('');
  const [checking, setChecking] = useState(false);
  const [recordingReply, setRecordingReply] = useState(false);
  const [feedback, setFeedback] = useState<EnglishCheckResponse | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!open && recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
      setRecordingReply(false);
    }
  }, [open]);

  const loadSpark = useCallback(
    async (selectedTheme: string) => {
      setLoadingSpark(true);
      setSparkError('');
      setFeedback(null);
      setAnswer('');
      try {
        const res = await apiFetch('/api/english-coach/spark', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            theme: selectedTheme,
            messages: transcript.slice(-14).map((m) => ({
              role: m.role,
              text: m.text,
            })),
          }),
        });
        const data = (await res.json()) as EnglishSparkResponse & {
          error?: string;
        };
        if (!res.ok) {
          setSparkError(data.error || 'Could not load AI coach spark.');
          return;
        }
        setSpark(data);
      } catch {
        setSparkError('Network error loading English AI coach.');
      } finally {
        setLoadingSpark(false);
      }
    },
    [apiFetch, transcript]
  );

  useEffect(() => {
    if (open && !spark && !loadingSpark) {
      loadSpark(theme);
    }
  }, [loadSpark, loadingSpark, open, spark, theme]);

  const handleSelectTheme = (nextTheme: string) => {
    setTheme(nextTheme);
    loadSpark(nextTheme);
  };

  const evaluateReplyText = useCallback(
    async (rawText: string) => {
      const clean = rawText.trim();
      if (!clean || !spark || checking) return;
      setChecking(true);
      try {
        const res = await apiFetch('/api/english-coach/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: spark.challengePrompt,
            answer: clean,
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as EnglishCheckResponse;
        setFeedback(data);
      } finally {
        setChecking(false);
      }
    },
    [apiFetch, checking, spark]
  );

  const handleCheckAnswer = async (e: FormEvent) => {
    e.preventDefault();
    await evaluateReplyText(answer);
  };

  const handleToggleMicReply = async () => {
    if (recordingReply && recorderRef.current) {
      recorderRef.current.stop();
      setRecordingReply(false);
      return;
    }
    if (!spark || checking) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        for (const track of stream.getTracks()) track.stop();
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = String(reader.result ?? '').split(',')[1];
          if (!base64) return;
          setChecking(true);
          try {
            const res = await apiFetch('/api/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audioBase64: base64,
                mimeType: blob.type || 'audio/webm',
              }),
            });
            const data = (await res.json()) as { text?: string };
            const spoken = data.text?.trim();
            if (spoken) {
              setAnswer(spoken);
              const checkRes = await apiFetch('/api/english-coach/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  prompt: spark.challengePrompt,
                  answer: spoken,
                }),
              });
              if (checkRes.ok) {
                setFeedback((await checkRes.json()) as EnglishCheckResponse);
              }
            }
          } finally {
            setChecking(false);
          }
        };
        reader.readAsDataURL(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecordingReply(true);
    } catch {
      setRecordingReply(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="English Practice"
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
            className="w-full sm:max-w-lg max-h-[88dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-[#0D1324]/95 border border-white/12 overflow-hidden pb-safe shadow-2xl"
          >
            <div className="sm:hidden pt-3 pb-1 flex justify-center shrink-0">
              <span className="w-10 h-1.5 rounded-full bg-white/20" />
            </div>

            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-4 shrink-0">
              <div>
                <h2 className="font-display text-lg font-medium text-[#F8F4F6] flex items-center gap-2">
                  <Sparkles
                    className="w-4 h-4 text-[#F48FB1]"
                    aria-hidden="true"
                  />
                  <span>English Practice</span>
                </h2>
                <p className="text-xs text-[#A6B0C9]">
                  Natural phrases, quick voice challenge &amp; roleplay with Luna
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close English Practice"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#A6B0C9] hover:text-[#F8F4F6] hover:bg-white/5 transition-colors"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto luna-scroll p-5 space-y-5">
              {/* Theme selector + Refresh */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {THEMES.map((t) => {
                    const active = theme === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={loadingSpark}
                        onClick={() => handleSelectTheme(t.id)}
                        className={`min-h-[38px] px-3 rounded-xl border text-xs font-medium transition-colors whitespace-nowrap ${
                          active
                            ? 'bg-[#F48FB1]/15 border-[#F48FB1]/50 text-[#F8F4F6]'
                            : 'bg-[#080C18]/80 border-white/10 text-[#A6B0C9] hover:text-[#F8F4F6]'
                        }`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  disabled={loadingSpark}
                  onClick={() => loadSpark(theme)}
                  aria-label="Generate fresh English spark"
                  className="min-h-[38px] px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-[#F3C677] inline-flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${loadingSpark ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>New Mix</span>
                </button>
              </div>

              {sparkError && (
                <div className="rounded-2xl bg-[#F48FB1]/15 border border-[#F48FB1]/30 px-4 py-3 text-xs text-[#F8BBD0]">
                  {sparkError}
                </div>
              )}

              {loadingSpark && !spark ? (
                <div className="py-12 text-center text-sm text-[#A6B0C9]">
                  Luna is cooking up something fun for your English...
                </div>
              ) : (
                spark && (
                  <>
                    {/* Luna Vibe Note */}
                    <div className="rounded-2xl bg-[#F48FB1]/10 border border-[#F48FB1]/25 px-4 py-3.5 text-sm text-[#F8F4F6] leading-relaxed">
                      {spark.vibeNote}
                    </div>

                    {/* Say It Like a Native */}
                    {spark.upgrades.length > 0 && (
                      <section className="space-y-2.5">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#A6B0C9]">
                          Say It Naturally
                        </h3>
                        <div className="space-y-2.5">
                          {spark.upgrades.map((up, i) => (
                            <div
                              key={i}
                              className="rounded-2xl bg-[#080C18]/85 border border-white/10 p-3.5 space-y-1.5"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="space-y-1 min-w-0">
                                  <p className="text-xs text-[#7C88A6] line-through">
                                    {up.insteadOf}
                                  </p>
                                  <p className="text-sm font-medium text-[#F3C677]">
                                    “{up.sayNaturally}”
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => onSpeakSample(up.sayNaturally)}
                                  aria-label={`Hear "${up.sayNaturally}"`}
                                  className="min-h-[40px] min-w-[40px] rounded-xl bg-white/5 hover:bg-white/10 text-[#F48FB1] flex items-center justify-center shrink-0 transition-colors"
                                >
                                  <Volume2
                                    className="w-4 h-4"
                                    aria-hidden="true"
                                  />
                                </button>
                              </div>
                              <p
                                dir="auto"
                                className="text-xs text-[#A6B0C9] leading-relaxed"
                              >
                                {up.egyptianNote}
                              </p>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Quick AI Challenge */}
                    <section className="space-y-2.5 rounded-2xl bg-[#080C18]/85 border border-white/10 p-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#F3C677]">
                        Quick Reply Challenge
                      </h3>
                      <p className="text-sm text-[#F8F4F6] leading-relaxed">
                        {spark.challengePrompt}
                      </p>

                      <form
                        onSubmit={handleCheckAnswer}
                        className="flex items-center gap-2 pt-1"
                      >
                        <button
                          type="button"
                          onClick={handleToggleMicReply}
                          disabled={checking}
                          aria-label={
                            recordingReply
                              ? 'Stop recording English reply'
                              : 'Speak English reply'
                          }
                          className={`min-h-[44px] min-w-[44px] rounded-xl border flex items-center justify-center shrink-0 transition-colors ${
                            recordingReply
                              ? 'bg-[#F48FB1] border-[#F48FB1] text-[#0B1020]'
                              : 'bg-white/5 border-white/10 text-[#F3C677] hover:bg-white/10'
                          }`}
                        >
                          {recordingReply ? (
                            <MicOff className="w-4 h-4" aria-hidden="true" />
                          ) : (
                            <Mic className="w-4 h-4" aria-hidden="true" />
                          )}
                        </button>
                        <input
                          type="text"
                          value={answer}
                          disabled={recordingReply}
                          onChange={(e) => setAnswer(e.target.value)}
                          placeholder={
                            recordingReply
                              ? 'Listening... tap mic to check'
                              : 'Speak or type your reply...'
                          }
                          className="flex-1 min-w-0 min-h-[44px] px-3.5 rounded-xl bg-[#0F1629] border border-white/10 text-sm text-[#F8F4F6] placeholder:text-[#7C88A6] focus:outline-none focus:border-[#F48FB1]"
                        />
                        <button
                          type="submit"
                          disabled={!answer.trim() || checking || recordingReply}
                          aria-label="Check English reply"
                          className="min-h-[44px] min-w-[44px] px-3.5 rounded-xl bg-[#F48FB1] text-[#0B1020] flex items-center justify-center shrink-0 disabled:opacity-40"
                        >
                          <Send className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </form>

                      {checking && (
                        <p className="text-xs text-[#A6B0C9]">
                          Luna is checking your vibe...
                        </p>
                      )}

                      {feedback && (
                        <div className="mt-2 pt-3 border-t border-white/10 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-[#F3C677]">
                              {feedback.scoreLabel}
                            </span>
                            <button
                              type="button"
                              onClick={() => onSpeakSample(feedback.polished)}
                              className="min-h-[36px] px-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-[#F48FB1] inline-flex items-center gap-1.5"
                            >
                              <Volume2
                                className="w-3.5 h-3.5"
                                aria-hidden="true"
                              />
                              <span>Hear Smooth Version</span>
                            </button>
                          </div>
                          <p className="text-xs text-[#F8F4F6] leading-relaxed">
                            {feedback.reaction}
                          </p>
                          <p className="text-xs text-[#F3C677] font-medium">
                            Smoother: “{feedback.polished}”
                          </p>
                          <p
                            dir="auto"
                            className="text-xs text-[#A6B0C9] leading-relaxed"
                          >
                            {feedback.tip}
                          </p>
                        </div>
                      )}
                    </section>

                    {/* 60-Second Live Roleplay */}
                    <section className="rounded-2xl bg-gradient-to-br from-[#F48FB1]/12 to-[#F3C677]/10 border border-[#F3C677]/25 p-4 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#F3C677]">
                          60s Roleplay · {spark.roleplayTitle}
                        </h3>
                      </div>
                      <p className="text-sm text-[#F8F4F6] leading-relaxed">
                        “{spark.roleplayStarter}”
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          onStartRoleplayWithLuna(
                            spark.roleplayTitle,
                            spark.roleplayStarter
                          )
                        }
                        className="w-full min-h-[44px] px-4 rounded-xl bg-gradient-to-r from-[#F48FB1] to-[#F3C677] text-[#0B1020] text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap transition-transform active:scale-[0.98]"
                      >
                        <Play className="w-4 h-4" aria-hidden="true" />
                        <span>Play This Scene with Luna</span>
                      </button>
                    </section>
                  </>
                )
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
