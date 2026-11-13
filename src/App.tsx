import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bookmark,
  Check,
  CheckSquare,
  Lightbulb,
  Lock,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Pause,
  Phone,
  PhoneOff,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { AmbientBackdrop } from './components/AmbientBackdrop';
import { ChatPanel } from './components/ChatPanel';
import { EnglishCoachSheet } from './components/EnglishCoachSheet';
import { MemoriesSheet } from './components/MemoriesSheet';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OptionsSheet } from './components/OptionsSheet';
import { PomodoroSheet } from './components/PomodoroSheet';
import { PWAInstallButton } from './components/PWAInstallButton';
import { VoiceOrb } from './components/VoiceOrb';
import { useCameraVision } from './hooks/useCameraVision';
import { useLiveCall } from './hooks/useLiveCall';
import {
  formatPomodoroTime,
  PomodoroPhase,
  usePomodoro,
} from './hooks/usePomodoro';
import {
  LunaMode,
  MemoryCategory,
  MemoryFact,
  RoomScene,
  TaskItem,
  ToolEvent,
  TranscriptEntry,
  VoiceName,
} from './types';

const TRANSCRIPT_STORAGE_KEY = 'luna_transcript_v1';
const TOKEN_STORAGE_KEY = 'luna_access_token_v1';
const PREFS_STORAGE_KEY = 'luna_prefs_v1';

interface StoredPrefs {
  voiceName?: VoiceName;
  mode?: LunaMode;
  scene?: RoomScene;
  lampOn?: boolean;
  showCaptions?: boolean;
  speakTextReplies?: boolean;
}

function loadPrefs(): StoredPrefs {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredPrefs) : {};
  } catch {
    return {};
  }
}

function formatTime(): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

function formatCallDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function loadStoredTranscript(): TranscriptEntry[] {
  try {
    const raw = localStorage.getItem(TRANSCRIPT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-80) : [];
  } catch {
    return [];
  }
}

function mergeTranscriptChunk(existing: string, rawChunk: string): string {
  const chunk = rawChunk.replace(/<\/?noise>/gi, '');
  if (!chunk) return existing;
  if (!existing) return chunk.trimStart();

  const needsSpace =
    /[.!?,;:،؛]$/.test(existing) && /^[\p{L}\p{N}]/u.test(chunk);
  const combined = needsSpace ? `${existing} ${chunk}` : `${existing}${chunk}`;
  return combined.replace(/ {2,}/g, ' ');
}

function compressImageToJpeg(
  file: File,
  maxWidth = 1024,
  quality = 0.8
): Promise<{ base64: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / (img.naturalWidth || maxWidth));
        const w = Math.max(1, Math.round((img.naturalWidth || maxWidth) * scale));
        const h = Math.max(1, Math.round((img.naturalHeight || maxWidth) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas unavailable.'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.split(',')[1] ?? '';
        resolve({ base64, previewUrl: dataUrl });
      };
      img.src = String(reader.result ?? '');
    };
    reader.readAsDataURL(file);
  });
}

const MODES: Array<{ value: LunaMode; shortLabel: string; label: string }> = [
  { value: 'natural', shortLabel: 'Natural', label: 'Natural Mix' },
  { value: 'coach', shortLabel: 'English', label: 'English Coach' },
  { value: 'study', shortLabel: 'Study', label: 'Study Buddy' },
  { value: 'night', shortLabel: 'Night', label: 'Late Night' },
];

export default function App() {
  const initialPrefs = useRef<StoredPrefs>(loadPrefs());

  const [authChecking, setAuthChecking] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [accessToken, setAccessToken] = useState<string>(() => {
    try {
      return localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState('');

  const [voiceName, setVoiceName] = useState<VoiceName>(
    initialPrefs.current.voiceName ?? 'Sulafat'
  );
  const [mode, setMode] = useState<LunaMode>(
    initialPrefs.current.mode ?? 'natural'
  );
  const [scene, setScene] = useState<RoomScene>(
    initialPrefs.current.scene ?? 'lamp'
  );
  const [lampOn, setLampOn] = useState<boolean>(
    initialPrefs.current.lampOn ?? true
  );
  const [showCaptions, setShowCaptions] = useState<boolean>(
    initialPrefs.current.showCaptions ?? true
  );
  const [speakTextReplies, setSpeakTextReplies] = useState<boolean>(
    initialPrefs.current.speakTextReplies ?? true
  );

  const [notebookOpen, setNotebookOpen] = useState(false);
  const [notebookTab, setNotebookTab] = useState<'memories' | 'tasks'>(
    'memories'
  );
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [pomodoroOpen, setPomodoroOpen] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);

  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>(() =>
    loadStoredTranscript()
  );
  const [inputText, setInputText] = useState('');
  const [attachedImage, setAttachedImage] = useState<{
    base64: string;
    previewUrl: string;
  } | null>(null);
  const [finishedFocusTaskId, setFinishedFocusTaskId] = useState<string | null>(
    null
  );
  const [isSendingText, setIsSendingText] = useState(false);
  const [isPlayingTts, setIsPlayingTts] = useState(false);
  const [ttsLevel, setTtsLevel] = useState(0);
  const [isRecordingNote, setIsRecordingNote] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [callUserCaption, setCallUserCaption] = useState('');
  const [callLunaCaption, setCallLunaCaption] = useState('');
  const [chatLunaCaption, setChatLunaCaption] = useState('');

  const transcriptRef = useRef<TranscriptEntry[]>(transcript);
  const liveUserTurnIdRef = useRef<string | null>(null);
  const liveAssistantTurnIdRef = useRef<string | null>(null);
  const pendingToolsRef = useRef<ToolEvent[]>([]);
  const ttsCtxRef = useRef<AudioContext | null>(null);
  const ttsSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ttsRafRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(
        PREFS_STORAGE_KEY,
        JSON.stringify({
          voiceName,
          mode,
          scene,
          lampOn,
          showCaptions,
          speakTextReplies,
        })
      );
    } catch {
      // Ignore storage errors
    }
  }, [lampOn, mode, scene, showCaptions, speakTextReplies, voiceName]);

  useEffect(() => {
    transcriptRef.current = transcript;
    try {
      const compact = transcript.slice(-80).map(({ previewUrl: _drop, ...rest }) => rest);
      localStorage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify(compact));
    } catch {
      // Ignore storage quota errors
    }
  }, [transcript]);

  const apiFetch = useCallback(
    (input: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`);
      }
      return fetch(input, { ...init, headers });
    },
    [accessToken]
  );

  // Verify access token configuration on startup
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await apiFetch('/api/auth/status');
        const data = (await res.json()) as {
          authRequired?: boolean;
          authorized?: boolean;
        };
        if (!active) return;
        setAuthRequired(Boolean(data.authRequired));
        setAuthorized(Boolean(data.authorized ?? !data.authRequired));
      } catch {
        if (active) setAuthorized(true);
      } finally {
        if (active) setAuthChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [apiFetch]);

  const loadMemories = useCallback(async () => {
    if (!authorized) return;
    try {
      const res = await apiFetch('/api/memories');
      if (!res.ok) return;
      const data = (await res.json()) as { facts: MemoryFact[] };
      setFacts(data.facts ?? []);
    } catch {
      // Ignore transient network errors
    }
  }, [apiFetch, authorized]);

  const loadTasks = useCallback(async () => {
    if (!authorized) return;
    try {
      const res = await apiFetch('/api/tasks');
      if (!res.ok) return;
      const data = (await res.json()) as { tasks: TaskItem[] };
      setTasks(data.tasks ?? []);
    } catch {
      // Ignore transient network errors
    }
  }, [apiFetch, authorized]);

  useEffect(() => {
    if (authorized && !authChecking) {
      loadMemories();
      loadTasks();
    }
  }, [authChecking, authorized, loadMemories, loadTasks]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, chatDrawerOpen]);

  const stopTtsPlayback = useCallback(() => {
    if (ttsRafRef.current !== null) {
      cancelAnimationFrame(ttsRafRef.current);
      ttsRafRef.current = null;
    }
    if (ttsSourceRef.current) {
      try {
        ttsSourceRef.current.stop();
      } catch {
        // Ignore already stopped
      }
      ttsSourceRef.current = null;
    }
    setIsPlayingTts(false);
    setTtsLevel(0);
  }, []);

  const appendLiveTranscript = useCallback(
    (role: 'user' | 'assistant', rawChunk: string) => {
      const cleaned = rawChunk.replace(/<\/?noise>/gi, '');
      const ref =
        role === 'user' ? liveUserTurnIdRef : liveAssistantTurnIdRef;

      // Only let assistant speech close an open user turn; never let stray mic noise split Luna's sentence.
      if (role === 'assistant') {
        liveUserTurnIdRef.current = null;
      }

      if (!ref.current && !cleaned.trim()) {
        return;
      }

      const isNewTurn = !ref.current;
      const turnId =
        ref.current ??
        `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      ref.current = turnId;

      if (role === 'assistant') {
        setCallLunaCaption((prev) =>
          isNewTurn ? cleaned.trimStart() : mergeTranscriptChunk(prev, cleaned)
        );
      } else {
        setCallUserCaption((prev) =>
          isNewTurn ? cleaned.trimStart() : mergeTranscriptChunk(prev, cleaned)
        );
      }

      setTranscript((prev) => {
        const exists = prev.some((item) => item.id === turnId);
        if (exists) {
          return prev.map((item) =>
            item.id === turnId
              ? { ...item, text: mergeTranscriptChunk(item.text, cleaned) }
              : item
          );
        }
        const tools =
          role === 'assistant' && pendingToolsRef.current.length > 0
            ? [...pendingToolsRef.current]
            : undefined;
        if (role === 'assistant') {
          pendingToolsRef.current = [];
        }
        return [
          ...prev,
          {
            id: turnId,
            role,
            text: cleaned.trimStart(),
            timestamp: formatTime(),
            toolEvents: tools,
          },
        ];
      });
    },
    []
  );

  const handleTurnComplete = useCallback(() => {
    liveUserTurnIdRef.current = null;
    liveAssistantTurnIdRef.current = null;
  }, []);

  const handleLiveToolEvent = useCallback(
    (ev: ToolEvent) => {
      if (ev.name === 'remember' || ev.name === 'forget') {
        loadMemories();
      }
      if (
        ev.name === 'get_tasks' ||
        ev.name === 'create_task' ||
        ev.name === 'complete_task' ||
        ev.name === 'delete_task'
      ) {
        loadTasks();
      }
      if (liveAssistantTurnIdRef.current) {
        const targetId = liveAssistantTurnIdRef.current;
        setTranscript((prev) =>
          prev.map((item) =>
            item.id === targetId
              ? {
                  ...item,
                  toolEvents: [...(item.toolEvents ?? []), ev],
                }
              : item
          )
        );
      } else {
        pendingToolsRef.current.push(ev);
      }
    },
    [loadMemories, loadTasks]
  );

  const handleCallEnded = useCallback(
    (endedMood: string | null) => {
      const recent = transcriptRef.current.slice(-18);
      if (recent.length < 2) return;
      apiFetch('/api/session-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: recent.map((m) => ({ role: m.role, text: m.text })),
          mood: endedMood ?? '',
        }),
      }).catch(() => {});
    },
    [apiFetch]
  );

  const liveCall = useLiveCall({
    voiceName,
    mode,
    accessToken,
    onUserTranscript: (chunk) => appendLiveTranscript('user', chunk),
    onAssistantTranscript: (chunk) => appendLiveTranscript('assistant', chunk),
    onTurnComplete: handleTurnComplete,
    onToolEvent: handleLiveToolEvent,
    onCallEnded: handleCallEnded,
  });

  const isLive = liveCall.status === 'live';
  const isConnecting =
    liveCall.status === 'connecting' || liveCall.status === 'reconnecting';
  const isLunaSpeaking = liveCall.isLunaSpeaking || isPlayingTts;
  const activeLunaLevel = liveCall.isLunaSpeaking ? liveCall.lunaLevel : ttsLevel;
  const activeAmbientLevel = isLunaSpeaking
    ? activeLunaLevel
    : isLive && !liveCall.muted
      ? liveCall.micLevel
      : 0;

  const vision = useCameraVision({
    isLive,
    isLunaSpeaking,
    micLevel: liveCall.micLevel,
    onSendVideoFrame: liveCall.sendVideoFrame,
  });

  useEffect(() => {
    if (!isLive) {
      setCallSeconds(0);
      return;
    }
    const interval = window.setInterval(() => {
      setCallSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isLive]);

  const openTasksCount = tasks.filter((t) => !t.done).length;

  const handleToggleCall = useCallback(() => {
    if (isLive || isConnecting) {
      liveCall.endCall();
    } else {
      stopTtsPlayback();
      liveUserTurnIdRef.current = null;
      liveAssistantTurnIdRef.current = null;
      setCallUserCaption('');
      setCallLunaCaption('');
      setChatLunaCaption('');
      liveCall.startCall();
    }
  }, [isConnecting, isLive, liveCall, stopTtsPlayback]);

  // Real AudioContext + AnalyserNode playback for TTS so lip-sync matches actual speech
  const speakWithTts = useCallback(
    async (text: string) => {
      if (!speakTextReplies || !text.trim()) return;
      try {
        if (!ttsCtxRef.current) {
          ttsCtxRef.current = new AudioContext();
        }
        const ctx = ttsCtxRef.current;
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {});
        }

        const res = await apiFetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voiceName }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { audioBase64?: string };
        if (!data.audioBase64) return;

        stopTtsPlayback();

        const binary = atob(data.audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const decoded = await ctx.decodeAudioData(bytes.buffer.slice(0));

        const source = ctx.createBufferSource();
        source.buffer = decoded;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        source.connect(analyser);
        analyser.connect(ctx.destination);

        ttsSourceRef.current = source;
        setIsPlayingTts(true);

        const meterData = new Uint8Array(64);
        let lastTtsUiAt = 0;
        const tick = () => {
          if (!ttsSourceRef.current) return;
          const now = performance.now();
          if (now - lastTtsUiAt >= 50) {
            lastTtsUiAt = now;
            analyser.getByteTimeDomainData(meterData);
            let sumSq = 0;
            for (let i = 0; i < meterData.length; i++) {
              const c = (meterData[i] - 128) / 128;
              sumSq += c * c;
            }
            const rms = Math.sqrt(sumSq / meterData.length);
            setTtsLevel(Math.min(1, rms * 5.2));
          }
          ttsRafRef.current = requestAnimationFrame(tick);
        };
        ttsRafRef.current = requestAnimationFrame(tick);

        source.onended = () => {
          ttsSourceRef.current = null;
          if (ttsRafRef.current !== null) {
            cancelAnimationFrame(ttsRafRef.current);
            ttsRafRef.current = null;
          }
          setIsPlayingTts(false);
          setTtsLevel(0);
        };
        source.start();
      } catch {
        stopTtsPlayback();
      }
    },
    [apiFetch, speakTextReplies, stopTtsPlayback, voiceName]
  );

  const handleAttachImage = useCallback(async (file: File) => {
    try {
      const compressed = await compressImageToJpeg(file);
      if (compressed.base64) {
        setAttachedImage(compressed);
      }
    } catch {
      // Ignore unreadable image files
    }
  }, []);

  const handleClearAttachment = useCallback(() => {
    setAttachedImage(null);
  }, []);

  const handleSendMessage = useCallback(
    async (text: string) => {
      const pendingAttachment = attachedImage;
      const clean =
        text.trim() ||
        (pendingAttachment
          ? 'Please look at this image and help me with it clearly.'
          : '');
      if (!clean) return;

      if (isLive) {
        setTranscript((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            role: 'user',
            text: clean,
            timestamp: formatTime(),
          },
        ]);
        liveCall.sendTextDuringCall(clean);
        return;
      }

      if (pendingAttachment) {
        setAttachedImage(null);
      }

      const userEntry: TranscriptEntry = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: clean,
        timestamp: formatTime(),
        ...(pendingAttachment
          ? { hasImage: true, previewUrl: pendingAttachment.previewUrl }
          : {}),
      };
      const updated = [...transcript, userEntry];
      setTranscript(updated);
      setIsSendingText(true);

      const snapshot =
        pendingAttachment?.base64 ??
        (vision.visionMode !== 'off' ? vision.captureSnapshot() : null);

      try {
        const res = await apiFetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            messages: updated.map((m) => ({ role: m.role, text: m.text })),
            ...(snapshot
              ? { imageBase64: snapshot, imageMimeType: 'image/jpeg' }
              : {}),
          }),
        });
        const data = (await res.json()) as {
          reply?: string;
          toolEvents?: ToolEvent[];
          facts?: MemoryFact[];
          error?: string;
        };

        if (!res.ok) {
          setTranscript((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: 'assistant',
              text: data.error ?? 'Sorry babee, I could not reach the server.',
              timestamp: formatTime(),
            },
          ]);
          return;
        }

        if (data.facts) setFacts(data.facts);
        if (
          data.toolEvents?.some(
            (ev) =>
              ev.name === 'get_tasks' ||
              ev.name === 'create_task' ||
              ev.name === 'complete_task' ||
              ev.name === 'delete_task'
          )
        ) {
          loadTasks();
        }
        const replyText = data.reply ?? '';
        setTranscript((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            text: replyText,
            timestamp: formatTime(),
            toolEvents: data.toolEvents,
          },
        ]);

        if (replyText) {
          setChatLunaCaption(replyText);
          await speakWithTts(replyText);
        }
      } catch {
        setTranscript((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'assistant',
            text: 'Network error while reaching Luna.',
            timestamp: formatTime(),
          },
        ]);
      } finally {
        setIsSendingText(false);
      }
    },
    [
      apiFetch,
      attachedImage,
      isLive,
      liveCall,
      loadTasks,
      mode,
      speakWithTts,
      transcript,
      vision,
    ]
  );

  const handleSubmitForm = (e: FormEvent) => {
    e.preventDefault();
    if ((!inputText.trim() && !attachedImage) || isSendingText) return;
    const msg = inputText;
    setInputText('');
    handleSendMessage(msg);
  };

  const handleQuickPrompt = useCallback(
    (prompt: string) => {
      if (isSendingText) return;
      setInputText('');
      handleSendMessage(prompt);
    },
    [handleSendMessage, isSendingText]
  );

  const handleToggleVoiceNote = useCallback(async () => {
    if (isRecordingNote && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecordingNote(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        for (const t of stream.getTracks()) t.stop();
        const blob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const dataUrl = String(reader.result ?? '');
          const base64 = dataUrl.split(',')[1];
          if (!base64) return;
          setIsSendingText(true);
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
            if (data.text?.trim()) {
              await handleSendMessage(data.text.trim());
            } else {
              setIsSendingText(false);
            }
          } catch {
            setIsSendingText(false);
          }
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecordingNote(true);
    } catch {
      setIsRecordingNote(false);
    }
  }, [apiFetch, handleSendMessage, isRecordingNote]);

  const handleAddMemory = useCallback(
    async (fact: string, category: MemoryCategory) => {
      const res = await apiFetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fact, category }),
      });
      if (res.ok) {
        const data = (await res.json()) as { facts: MemoryFact[] };
        setFacts(data.facts ?? []);
      }
    },
    [apiFetch]
  );

  const handleDeleteMemory = useCallback(
    async (index: number) => {
      const res = await apiFetch(`/api/memories/${index}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = (await res.json()) as { facts: MemoryFact[] };
        setFacts(data.facts ?? []);
      }
    },
    [apiFetch]
  );

  const handleAddTask = useCallback(
    async (title: string, due = '') => {
      const res = await apiFetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, due }),
      });
      if (res.ok) {
        const data = (await res.json()) as { tasks: TaskItem[] };
        setTasks(data.tasks ?? []);
      }
    },
    [apiFetch]
  );

  const handleToggleTask = useCallback(
    async (id: string) => {
      const res = await apiFetch(
        `/api/tasks/${encodeURIComponent(id)}/toggle`,
        {
          method: 'PATCH',
        }
      );
      if (res.ok) {
        const data = (await res.json()) as { tasks: TaskItem[] };
        setTasks(data.tasks ?? []);
      }
    },
    [apiFetch]
  );

  const handleDeleteTask = useCallback(
    async (id: string) => {
      const res = await apiFetch(`/api/tasks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = (await res.json()) as { tasks: TaskItem[] };
        setTasks(data.tasks ?? []);
      }
    },
    [apiFetch]
  );

  const handlePasscodeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = passcodeInput.trim();
    if (!clean) return;
    setPasscodeError('');
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: clean }),
      });
      if (!res.ok) {
        setPasscodeError('Incorrect passcode.');
        return;
      }
      localStorage.setItem(TOKEN_STORAGE_KEY, clean);
      setAccessToken(clean);
      setAuthorized(true);
      setPasscodeInput('');
    } catch {
      setPasscodeError('Could not verify passcode.');
    }
  };

  const handleLockSession = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // Ignore
    }
    if (isLive || isConnecting) {
      liveCall.endCall();
    }
    vision.stopVision();
    setOptionsOpen(false);
    setAccessToken('');
    setAuthorized(false);
  }, [isConnecting, isLive, liveCall, vision]);

  const handleToggleLamp = useCallback(() => {
    if (scene === 'off') {
      setScene('lamp');
      setLampOn(true);
      return;
    }
    setLampOn((prev) => !prev);
  }, [scene]);

  const handleSelectScene = useCallback((nextScene: RoomScene) => {
    setScene(nextScene);
    setLampOn(nextScene !== 'off');
  }, []);

  const handleSelectMode = useCallback(
    (nextMode: LunaMode) => {
      setMode(nextMode);
      if (isLive && nextMode !== mode) {
        liveCall.updateMode(nextMode);
      }
    },
    [isLive, liveCall, mode]
  );

  const handlePomodoroComplete = useCallback(
    async (
      completedPhase: PomodoroPhase,
      minutes: number,
      linkedTaskId: string | null
    ) => {
      const linkedTask = linkedTaskId
        ? tasks.find((t) => t.id === linkedTaskId)
        : undefined;
      if (completedPhase === 'focus' && linkedTask && !linkedTask.done) {
        setFinishedFocusTaskId(linkedTask.id);
      }
      const taskTitle = linkedTask?.title;
      const cue =
        completedPhase === 'focus'
          ? `[Pomodoro timer update: Mohamed just finished a ${minutes}-minute focus sprint${taskTitle ? ` working on "${taskTitle}"` : ''}. Congratulate him warmly in 1-2 short sentences, suggest a 5-minute stretch/water break, and ask if he wants a quick 1-question quiz or to mark the task done.]`
          : `[Pomodoro timer update: Mohamed's ${minutes}-minute break just ended. Gently welcome him back in 1 short warm sentence and ask if he is ready for his next focus sprint.]`;

      if (isLive) {
        liveCall.sendTextDuringCall(cue);
        return;
      }

      try {
        const res = await apiFetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'study',
            messages: [
              ...transcriptRef.current
                .slice(-6)
                .map((m) => ({ role: m.role, text: m.text })),
              { role: 'user', text: cue },
            ],
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { reply?: string };
        const reply = data.reply?.trim();
        if (!reply) return;
        setTranscript((prev) => [
          ...prev,
          {
            id: `pomodoro-${Date.now()}`,
            role: 'assistant',
            text: reply,
            timestamp: formatTime(),
          },
        ]);
        setChatLunaCaption(reply);
        await speakWithTts(reply);
      } catch {
        // Ignore network errors on background timer chime
      }
    },
    [apiFetch, isLive, liveCall, speakWithTts, tasks]
  );

  const pomodoro = usePomodoro({
    onPhaseComplete: handlePomodoroComplete,
  });

  const handleStartRoleplayWithLuna = useCallback(
    async (title: string, starter: string) => {
      setCoachOpen(false);
      setMode('coach');
      if (isLive) {
        liveCall.updateMode('coach');
        liveCall.sendTextDuringCall(
          `[English Roleplay "${title}": start right away in character with this opening line to Mohamed: "${starter}"]`
        );
        return;
      }

      setTranscript((prev) => [
        ...prev,
        {
          id: `roleplay-${Date.now()}`,
          role: 'assistant',
          text: starter,
          timestamp: formatTime(),
        },
      ]);
      setChatLunaCaption(starter);
      await speakWithTts(starter);
    },
    [isLive, liveCall, speakWithTts]
  );

  const handleClearTranscript = useCallback(() => {
    setTranscript([]);
    setChatLunaCaption('');
    setCallLunaCaption('');
    setCallUserCaption('');
  }, []);

  if (authChecking) {
    return (
      <div className="relative min-h-[100dvh] bg-[#060913] text-[#A6B0C9] flex items-center justify-center text-sm">
        <AmbientBackdrop
          scene={scene}
          lampOn={lampOn}
          isLive={false}
          isLunaSpeaking={false}
          voiceLevel={0}
        />
        <span className="relative z-10">Connecting...</span>
      </div>
    );
  }

  if (authRequired && !authorized) {
    return (
      <div className="relative min-h-[100dvh] text-[#F8F4F6] flex items-center justify-center p-6">
        <AmbientBackdrop
          scene={scene}
          lampOn={lampOn}
          isLive={false}
          isLunaSpeaking={false}
          voiceLevel={0}
        />
        <motion.form
          onSubmit={handlePasscodeSubmit}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 w-full max-w-sm rounded-3xl bg-[#0D1324]/88 border border-white/12 p-6 space-y-4 shadow-2xl backdrop-blur-xl"
        >
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-[#F48FB1]/15 border border-[#F48FB1]/25 flex items-center justify-center text-[#F48FB1]">
              <Lock className="w-5 h-5" aria-hidden="true" />
            </span>
            <div>
              <h1 className="font-display text-xl font-medium">Luna</h1>
              <p className="text-xs text-[#A6B0C9]">
                Enter your private access passcode
              </p>
            </div>
          </div>

          <input
            type="password"
            value={passcodeInput}
            onChange={(e) => setPasscodeInput(e.target.value)}
            placeholder="Access passcode..."
            autoFocus
            className="w-full min-h-[46px] px-4 rounded-xl bg-[#080C18] border border-white/10 text-sm text-[#F8F4F6] placeholder:text-[#7C88A6] focus:outline-none focus:border-[#F48FB1]"
          />

          {passcodeError && (
            <p className="text-xs text-[#F48FB1]">{passcodeError}</p>
          )}

          <button
            type="submit"
            className="w-full min-h-[46px] rounded-xl bg-gradient-to-r from-[#F48FB1] to-[#F3C677] text-[#0B1020] text-sm font-semibold transition-transform active:scale-[0.98]"
          >
            Unlock
          </button>
        </motion.form>
      </div>
    );
  }

  const effectiveLamp = lampOn && scene !== 'off';

  const statusLabel =
    liveCall.status === 'reconnecting'
      ? 'Reconnecting'
      : liveCall.status === 'connecting'
        ? 'Connecting'
        : isLive
          ? isLunaSpeaking
            ? 'Speaking'
            : liveCall.muted
              ? 'Muted'
              : 'Listening'
          : isLunaSpeaking
            ? 'Speaking'
            : 'Ready';

  return (
    <div
      onPointerDown={() => {
        if (isLive || isConnecting) liveCall.resumeAudioContexts();
      }}
      className="relative min-h-[100dvh] flex flex-col text-[#F8F4F6] pt-safe pb-safe"
    >
      <AmbientBackdrop
        scene={scene}
        lampOn={lampOn}
        isLive={isLive}
        isLunaSpeaking={isLunaSpeaking}
        voiceLevel={activeAmbientLevel}
      />

      <OfflineIndicator />

      <header className="sticky top-0 z-30 h-14 bg-[#070B16]/65 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          <span className="font-display text-xl font-semibold tracking-tight text-[#F8F4F6] whitespace-nowrap shrink-0">
            Luna
          </span>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />

            <button
              type="button"
              onClick={handleToggleLamp}
              aria-label={
                effectiveLamp ? 'Turn room lamp off' : 'Turn room lamp on'
              }
              title={effectiveLamp ? 'Turn lamp off' : 'Turn lamp on'}
              className={`min-h-[40px] min-w-[40px] px-3 rounded-xl border inline-flex items-center justify-center gap-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                effectiveLamp
                  ? 'bg-[#F3C677]/15 border-[#F3C677]/40 text-[#F3C677]'
                  : 'bg-[#10172B]/80 border-white/10 text-[#A6B0C9] hover:text-[#F8F4F6]'
              }`}
            >
              <Lightbulb className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">
                {effectiveLamp ? 'Lamp' : 'Dim'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setOptionsOpen(true)}
              aria-label="Open room and voice settings"
              className="min-h-[40px] px-3.5 rounded-xl bg-[#10172B]/80 hover:bg-[#19233D] border border-white/10 text-xs font-medium text-[#F8F4F6] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              <SlidersHorizontal
                className="w-3.5 h-3.5 text-[#F48FB1]"
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Room &amp; Voice</span>
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-4 lg:py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <section
          aria-label="Voice Call Stage"
          className="relative lg:col-span-7 flex flex-col items-center justify-between py-2 lg:py-4"
        >
          <div className="w-full flex flex-col items-center text-center space-y-2.5">
            <div className="space-y-1">
              <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-tight text-[#F8F4F6]">
                Luna
              </h1>
              <p className="text-xs sm:text-sm text-[#A6B0C9] flex items-center justify-center flex-wrap gap-x-2">
                <span
                  className={
                    isLive
                      ? 'text-[#F3C677] font-medium'
                      : isLunaSpeaking
                        ? 'text-[#F48FB1] font-medium'
                        : 'text-[#A6B0C9]'
                  }
                >
                  {statusLabel}
                </span>
                {isLive && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-xs text-[#F3C677] tabular-nums">
                      {formatCallDuration(callSeconds)}
                    </span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span className="font-mono text-xs">{voiceName}</span>
              </p>
            </div>

            {/* Front-and-center Mode Switcher */}
            <div
              role="tablist"
              aria-label="Conversation mode"
              className="inline-flex items-center p-1 rounded-2xl bg-[#0D1324]/85 border border-white/10 backdrop-blur-md shadow-sm"
            >
              {MODES.map((m) => {
                const active = mode === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => handleSelectMode(m.value)}
                    className={`min-h-[36px] px-2.5 sm:px-3.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                      active
                        ? 'bg-[#F48FB1]/20 text-[#F8F4F6] border border-[#F48FB1]/45 shadow-sm'
                        : 'text-[#A6B0C9] hover:text-[#F8F4F6] border border-transparent'
                    }`}
                  >
                    <span className="sm:hidden">{m.shortLabel}</span>
                    <span className="hidden sm:inline">{m.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Contextual Tool Slot linked directly to the active mode (or live timer) */}
            {(pomodoro.status !== 'idle' ||
              mode === 'coach' ||
              mode === 'study') && (
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {pomodoro.status !== 'idle' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setPomodoroOpen(true)}
                      className="min-h-[36px] max-w-[240px] px-3 rounded-xl bg-[#0D1324]/85 border border-[#F3C677]/35 text-xs text-[#F3C677] inline-flex items-center gap-2 hover:bg-[#141D35] transition-colors"
                    >
                      <Timer className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        {pomodoro.phase === 'break'
                          ? 'Break'
                          : tasks.find((t) => t.id === pomodoro.linkedTaskId)
                              ?.title || 'Study Timer'}
                      </span>
                      <span className="font-mono tabular-nums font-semibold shrink-0">
                        {formatPomodoroTime(pomodoro.secondsLeft)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={pomodoro.togglePause}
                      aria-label={
                        pomodoro.status === 'running'
                          ? 'Pause Study Timer'
                          : 'Resume Study Timer'
                      }
                      className="min-h-[36px] min-w-[36px] rounded-xl bg-[#0D1324]/85 border border-white/10 text-[#F8F4F6] hover:bg-[#141D35] flex items-center justify-center transition-colors"
                    >
                      {pomodoro.status === 'running' ? (
                        <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <Play className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={pomodoro.resetTimer}
                      aria-label="Reset Study Timer"
                      className="min-h-[36px] min-w-[36px] rounded-xl bg-[#0D1324]/85 border border-white/10 text-[#A6B0C9] hover:text-[#F8F4F6] hover:bg-[#141D35] flex items-center justify-center transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </>
                ) : mode === 'study' ? (
                  <button
                    type="button"
                    onClick={() => setPomodoroOpen(true)}
                    className="min-h-[36px] px-3.5 rounded-xl bg-[#F3C677]/12 hover:bg-[#F3C677]/20 border border-[#F3C677]/35 text-xs font-medium text-[#F3C677] inline-flex items-center gap-2 transition-colors whitespace-nowrap"
                  >
                    <Timer className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Start Study Timer (25m)</span>
                  </button>
                ) : null}

                {mode === 'coach' && (
                  <button
                    type="button"
                    onClick={() => setCoachOpen(true)}
                    className="min-h-[36px] px-3.5 rounded-xl bg-[#F48FB1]/12 hover:bg-[#F48FB1]/20 border border-[#F48FB1]/35 text-xs font-medium text-[#F8BBD0] inline-flex items-center gap-2 transition-colors whitespace-nowrap"
                  >
                    <Sparkles
                      className="w-3.5 h-3.5 text-[#F48FB1]"
                      aria-hidden="true"
                    />
                    <span>Practice Phrases &amp; Roleplay</span>
                  </button>
                )}
              </div>
            )}

            {finishedFocusTaskId &&
              (() => {
                const doneTarget = tasks.find(
                  (t) => t.id === finishedFocusTaskId && !t.done
                );
                if (!doneTarget) return null;
                return (
                  <div className="flex items-center justify-center gap-1.5">
                    <button
                      type="button"
                      onClick={async () => {
                        await handleToggleTask(doneTarget.id);
                        setFinishedFocusTaskId(null);
                      }}
                      className="min-h-[36px] px-3 rounded-xl bg-[#F3C677] text-[#0B1020] text-xs font-semibold inline-flex items-center gap-1.5 max-w-[260px]"
                    >
                      <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">Done: {doneTarget.title}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFinishedFocusTaskId(null)}
                      aria-label="Dismiss task shortcut"
                      className="min-h-[36px] min-w-[36px] rounded-xl bg-white/5 text-[#A6B0C9] hover:text-[#F8F4F6] flex items-center justify-center"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                );
              })()}
          </div>

          <div className="relative my-1 w-full flex justify-center">
            <VoiceOrb
              status={isConnecting ? 'connecting' : liveCall.status}
              micLevel={liveCall.micLevel}
              lunaLevel={activeLunaLevel}
              isLunaSpeaking={isLunaSpeaking}
              muted={liveCall.muted}
              scene={scene}
              lampOn={lampOn}
              showCaptions={showCaptions}
              latestUserLine={isLive ? callUserCaption : undefined}
              latestCaption={
                isLive || isConnecting ? callLunaCaption : chatLunaCaption
              }
              onPress={handleToggleCall}
            />

            {/* Floating Camera / VS Code Screen Preview */}
            <AnimatePresence>
              {vision.visionMode !== 'off' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 10 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute right-1 sm:right-4 top-2 z-30 w-28 sm:w-36 aspect-[4/3] rounded-2xl overflow-hidden bg-[#080C18] border border-white/15 shadow-2xl"
                >
                  <video
                    ref={vision.videoElRef}
                    autoPlay
                    muted
                    playsInline
                    className={`w-full h-full object-cover ${
                      vision.visionMode === 'camera' ? 'scale-x-[-1]' : ''
                    }`}
                  />
                  <div className="absolute inset-x-0 bottom-0 px-2 py-1 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between">
                    <span className="text-[10px] font-medium text-[#F8F4F6] truncate">
                      {vision.visionMode === 'camera' ? 'Camera' : 'Screen'}
                    </span>
                    <button
                      type="button"
                      onClick={vision.stopVision}
                      aria-label="Turn off video"
                      className="w-5 h-5 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/80"
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {(liveCall.error || vision.visionError) && (
            <div
              role="alert"
              className="mb-2 px-4 py-2 rounded-2xl bg-[#F48FB1]/15 border border-[#F48FB1]/30 text-xs text-[#F8BBD0] text-center max-w-sm"
            >
              {liveCall.error || vision.visionError}
            </div>
          )}

          {/* Minimal, uncluttered control bar + subtle Tasks / Memories links */}
          <div className="w-full max-w-md space-y-3 px-1">
            <div className="flex items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={
                  isLive
                    ? liveCall.toggleMute
                    : () => setSpeakTextReplies((prev) => !prev)
                }
                aria-label={
                  isLive
                    ? liveCall.muted
                      ? 'Unmute microphone'
                      : 'Mute microphone'
                    : speakTextReplies
                      ? 'Disable spoken text replies'
                      : 'Enable spoken text replies'
                }
                title={
                  isLive
                    ? liveCall.muted
                      ? 'Unmute mic'
                      : 'Mute mic'
                    : speakTextReplies
                      ? 'Voice replies on'
                      : 'Voice replies off'
                }
                className={`min-h-[52px] min-w-[52px] flex items-center justify-center rounded-2xl border backdrop-blur-md transition-colors ${
                  isLive && liveCall.muted
                    ? 'bg-[#F48FB1]/20 border-[#F48FB1]/40 text-[#F48FB1]'
                    : 'bg-[#0D1324]/85 hover:bg-[#19233D] border-white/10 text-[#F8F4F6]'
                }`}
              >
                {isLive ? (
                  liveCall.muted ? (
                    <MicOff className="w-5 h-5" aria-hidden="true" />
                  ) : (
                    <Mic
                      className="w-5 h-5 text-[#F3C677]"
                      aria-hidden="true"
                    />
                  )
                ) : speakTextReplies ? (
                  <Volume2 className="w-5 h-5" aria-hidden="true" />
                ) : (
                  <VolumeX
                    className="w-5 h-5 text-[#A6B0C9]"
                    aria-hidden="true"
                  />
                )}
              </button>

              <button
                type="button"
                onClick={vision.toggleCamera}
                aria-label={
                  vision.visionMode === 'camera'
                    ? 'Turn off camera'
                    : 'Turn on camera so Luna can see you'
                }
                title="Camera"
                className={`min-h-[52px] min-w-[52px] flex items-center justify-center rounded-2xl border backdrop-blur-md transition-colors ${
                  vision.visionMode === 'camera'
                    ? 'bg-[#F3C677]/20 border-[#F3C677]/50 text-[#F3C677]'
                    : 'bg-[#0D1324]/85 hover:bg-[#19233D] border-white/10 text-[#A6B0C9] hover:text-[#F8F4F6]'
                }`}
              >
                {vision.visionMode === 'camera' ? (
                  <Video className="w-5 h-5" aria-hidden="true" />
                ) : (
                  <VideoOff className="w-5 h-5" aria-hidden="true" />
                )}
              </button>

              <button
                type="button"
                onClick={vision.toggleScreenShare}
                aria-label={
                  vision.visionMode === 'screen'
                    ? 'Stop sharing screen'
                    : 'Share VS Code or screen with Luna'
                }
                title="Share VS Code / Screen"
                className={`min-h-[52px] min-w-[52px] flex items-center justify-center rounded-2xl border backdrop-blur-md transition-colors ${
                  vision.visionMode === 'screen'
                    ? 'bg-[#F48FB1]/20 border-[#F48FB1]/50 text-[#F48FB1]'
                    : 'bg-[#0D1324]/85 hover:bg-[#19233D] border-white/10 text-[#A6B0C9] hover:text-[#F8F4F6]'
                }`}
              >
                {vision.visionMode === 'screen' ? (
                  <Monitor className="w-5 h-5" aria-hidden="true" />
                ) : (
                  <MonitorOff className="w-5 h-5" aria-hidden="true" />
                )}
              </button>

              <button
                type="button"
                onClick={handleToggleCall}
                className={`flex-1 min-h-[54px] px-5 rounded-2xl flex items-center justify-center gap-2.5 text-sm font-semibold transition-all active:scale-[0.98] whitespace-nowrap ${
                  isLive || isConnecting
                    ? 'bg-[#141D35]/90 hover:bg-[#1D2949] text-[#F8F4F6] border border-white/15 backdrop-blur-md'
                    : 'bg-gradient-to-r from-[#F48FB1] to-[#F3C677] hover:brightness-105 text-[#0B1020] shadow-lg shadow-[#F48FB1]/20'
                }`}
              >
                {isLive || isConnecting ? (
                  <>
                    <PhoneOff className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {liveCall.status === 'connecting' ? 'Cancel' : 'End Call'}
                    </span>
                  </>
                ) : (
                  <>
                    <Phone className="w-4 h-4" aria-hidden="true" />
                    <span>Call Luna</span>
                  </>
                )}
              </button>
            </div>

            {/* Quiet Chat, Tasks & Memories navigation */}
            <nav
              aria-label="Notebook and chat navigation"
              className="flex items-center justify-center gap-6 text-xs text-[#A6B0C9]"
            >
              <button
                type="button"
                onClick={() => setChatDrawerOpen(true)}
                className="lg:hidden min-h-[44px] inline-flex items-center gap-1.5 hover:text-[#F8F4F6] transition-colors whitespace-nowrap"
              >
                <MessageSquare
                  className="w-3.5 h-3.5 text-[#F48FB1]"
                  aria-hidden="true"
                />
                <span>Chat</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setNotebookTab('tasks');
                  setNotebookOpen(true);
                }}
                className="min-h-[44px] inline-flex items-center gap-1.5 hover:text-[#F8F4F6] transition-colors whitespace-nowrap"
              >
                <CheckSquare
                  className="w-3.5 h-3.5 text-[#F3C677]"
                  aria-hidden="true"
                />
                <span>
                  Tasks · <span className="tabular-nums">{openTasksCount}</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setNotebookTab('memories');
                  setNotebookOpen(true);
                }}
                className="min-h-[44px] inline-flex items-center gap-1.5 hover:text-[#F8F4F6] transition-colors whitespace-nowrap"
              >
                <Bookmark
                  className="w-3.5 h-3.5 text-[#F48FB1]"
                  aria-hidden="true"
                />
                <span>
                  Memories · <span className="tabular-nums">{facts.length}</span>
                </span>
              </button>
            </nav>
          </div>
        </section>

        <section
          aria-label="Conversation transcript"
          className="hidden lg:flex lg:col-span-5 flex-col bg-[#0B1020]/72 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden max-h-[calc(100dvh-6.75rem)] shadow-2xl"
        >
          <ChatPanel
            transcript={transcript}
            inputText={inputText}
            attachedImage={attachedImage}
            onChangeInput={setInputText}
            onAttachImage={handleAttachImage}
            onClearAttachment={handleClearAttachment}
            onQuickPrompt={handleQuickPrompt}
            onSubmit={handleSubmitForm}
            onClear={handleClearTranscript}
            onToggleVoiceNote={handleToggleVoiceNote}
            isLive={isLive}
            isSendingText={isSendingText}
            isRecordingNote={isRecordingNote}
            transcriptEndRef={transcriptEndRef}
          />
        </section>
      </main>

      <AnimatePresence>
        {chatDrawerOpen && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Conversation Drawer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setChatDrawerOpen(false)}
            className="lg:hidden fixed inset-0 z-50 flex items-end justify-center bg-[#040711]/75 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full h-[84dvh] flex flex-col rounded-t-3xl bg-[#0B1020]/95 backdrop-blur-xl border-t border-[#F48FB1]/20 overflow-hidden pb-safe shadow-2xl"
            >
              <div className="pt-3 pb-1 flex justify-center shrink-0">
                <span className="w-10 h-1.5 rounded-full bg-white/20" />
              </div>
              <ChatPanel
                transcript={transcript}
                inputText={inputText}
                attachedImage={attachedImage}
                onChangeInput={setInputText}
                onAttachImage={handleAttachImage}
                onClearAttachment={handleClearAttachment}
                onQuickPrompt={handleQuickPrompt}
                onSubmit={handleSubmitForm}
                onClear={handleClearTranscript}
                onToggleVoiceNote={handleToggleVoiceNote}
                isLive={isLive}
                isSendingText={isSendingText}
                isRecordingNote={isRecordingNote}
                transcriptEndRef={transcriptEndRef}
                onCloseDrawer={() => setChatDrawerOpen(false)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <MemoriesSheet
        open={notebookOpen}
        initialTab={notebookTab}
        facts={facts}
        tasks={tasks}
        onClose={() => setNotebookOpen(false)}
        onAddMemory={handleAddMemory}
        onDeleteMemory={handleDeleteMemory}
        onAddTask={handleAddTask}
        onToggleTask={handleToggleTask}
        onDeleteTask={handleDeleteTask}
      />

      <OptionsSheet
        open={optionsOpen}
        voiceName={voiceName}
        scene={scene}
        lampOn={lampOn}
        showCaptions={showCaptions}
        speakTextReplies={speakTextReplies}
        isCallActive={isLive || isConnecting}
        authRequired={authRequired}
        onClose={() => setOptionsOpen(false)}
        onChangeVoice={setVoiceName}
        onChangeScene={handleSelectScene}
        onToggleLamp={handleToggleLamp}
        onToggleCaptions={() => setShowCaptions((p) => !p)}
        onToggleSpeakReplies={() => setSpeakTextReplies((p) => !p)}
        onLockSession={handleLockSession}
      />

      <PomodoroSheet
        open={pomodoroOpen}
        phase={pomodoro.phase}
        status={pomodoro.status}
        durationMinutes={pomodoro.durationMinutes}
        secondsLeft={pomodoro.secondsLeft}
        completedSprints={pomodoro.completedSprints}
        linkedTaskId={pomodoro.linkedTaskId}
        tasks={tasks}
        onClose={() => setPomodoroOpen(false)}
        onSelectTask={pomodoro.setLinkedTaskId}
        onStartSession={pomodoro.startSession}
        onTogglePause={pomodoro.togglePause}
        onReset={pomodoro.resetTimer}
      />

      <EnglishCoachSheet
        open={coachOpen}
        transcript={transcript}
        apiFetch={apiFetch}
        onClose={() => setCoachOpen(false)}
        onSpeakSample={(text) => speakWithTts(text)}
        onStartRoleplayWithLuna={handleStartRoleplayWithLuna}
      />
    </div>
  );
}
