import { useCallback, useEffect, useRef, useState } from 'react';
import { LunaMode, ToolEvent, VoiceName } from '../types';

export type CallStatus = 'idle' | 'connecting' | 'reconnecting' | 'live' | 'error';

interface UseLiveCallOptions {
  voiceName: VoiceName;
  mode: LunaMode;
  accessToken?: string;
  onUserTranscript: (textChunk: string) => void;
  onAssistantTranscript: (textChunk: string) => void;
  onTurnComplete: () => void;
  onToolEvent: (event: ToolEvent) => void;
  onCallEnded?: (mood: string | null) => void;
}

function downsampleTo16k(
  float32Data: Float32Array,
  inputSampleRate: number
): Int16Array {
  if (inputSampleRate === 16000) {
    const out = new Int16Array(float32Data.length);
    for (let i = 0; i < float32Data.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Data[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  const ratio = inputSampleRate / 16000;
  const outputLength = Math.max(1, Math.round(float32Data.length / ratio));
  const result = new Int16Array(outputLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (
      let i = offsetBuffer;
      i < nextOffsetBuffer && i < float32Data.length;
      i++
    ) {
      accum += float32Data[i];
      count++;
    }
    const sample = count > 0 ? accum / count : 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    result[offsetResult] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

function createAudioContext(preferredRate?: number): AudioContext {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  if (preferredRate) {
    try {
      return new AudioCtx({ sampleRate: preferredRate });
    } catch {
      return new AudioCtx();
    }
  }
  return new AudioCtx();
}

export function useLiveCall({
  voiceName,
  mode,
  accessToken,
  onUserTranscript,
  onAssistantTranscript,
  onTurnComplete,
  onToolEvent,
  onCallEnded,
}: UseLiveCallOptions) {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [mood, setMood] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [lunaLevel, setLunaLevel] = useState(0);
  const [isLunaSpeaking, setIsLunaSpeaking] = useState(false);

  const statusRef = useRef<CallStatus>('idle');
  const moodRef = useRef<string | null>(null);
  const modeRef = useRef<LunaMode>(mode);
  const liveReadyRef = useRef(false);
  const userEndedRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const resumeHandleRef = useRef<string>('');
  const lastMicUiUpdateRef = useRef(0);
  const lastLunaUiUpdateRef = useRef(0);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const zeroGainRef = useRef<GainNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const mutedRef = useRef(false);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const callbacksRef = useRef({
    onUserTranscript,
    onAssistantTranscript,
    onTurnComplete,
    onToolEvent,
    onCallEnded,
  });

  useEffect(() => {
    callbacksRef.current = {
      onUserTranscript,
      onAssistantTranscript,
      onTurnComplete,
      onToolEvent,
      onCallEnded,
    };
  }, [
    onUserTranscript,
    onAssistantTranscript,
    onTurnComplete,
    onToolEvent,
    onCallEnded,
  ]);

  const updateStatus = useCallback((next: CallStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const stopMeterLoop = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setLunaLevel(0);
  }, []);

  const startMeterLoop = useCallback(() => {
    if (rafIdRef.current !== null) return;
    const data = new Uint8Array(64);
    const tick = () => {
      const analyser = outputAnalyserRef.current;
      if (!analyser || activeSourcesRef.current.size === 0) {
        rafIdRef.current = null;
        setLunaLevel(0);
        return;
      }
      const now = performance.now();
      if (now - lastLunaUiUpdateRef.current >= 50) {
        lastLunaUiUpdateRef.current = now;
        analyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          const centered = (data[i] - 128) / 128;
          sumSq += centered * centered;
        }
        const rms = Math.sqrt(sumSq / data.length);
        setLunaLevel(Math.min(1, rms * 5.2));
      }
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
  }, []);

  const stopPlayback = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // Ignore already stopped sources
      }
    }
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
    stopMeterLoop();
    setIsLunaSpeaking(false);
  }, [stopMeterLoop]);

  const closeSocketOnly = useCallback(() => {
    liveReadyRef.current = false;
    if (wsRef.current) {
      try {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
      } catch {
        // Ignore
      }
      wsRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    closeSocketOnly();
    stopPlayback();

    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.port.onmessage = null;
        workletNodeRef.current.disconnect();
      } catch {
        // Ignore
      }
      workletNodeRef.current = null;
    }
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // Ignore
      }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // Ignore
      }
      sourceNodeRef.current = null;
    }
    if (zeroGainRef.current) {
      try {
        zeroGainRef.current.disconnect();
      } catch {
        // Ignore
      }
      zeroGainRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }
    outputAnalyserRef.current = null;
    if (outputCtxRef.current) {
      outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }

    setMicLevel(0);
    setLunaLevel(0);
    setIsLunaSpeaking(false);
    moodRef.current = null;
    setMood(null);
  }, [closeSocketOnly, stopPlayback]);

  const resumeAudioContexts = useCallback(() => {
    if (inputCtxRef.current?.state === 'suspended') {
      inputCtxRef.current.resume().catch(() => {});
    }
    if (outputCtxRef.current?.state === 'suspended') {
      outputCtxRef.current.resume().catch(() => {});
    }
  }, []);

  const playPcmChunk = useCallback(
    (base64Data: string) => {
      const ctx = outputCtxRef.current;
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const float32 = base64ToFloat32(base64Data);
      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      if (outputAnalyserRef.current) {
        source.connect(outputAnalyserRef.current);
      } else {
        source.connect(ctx.destination);
      }

      const now = ctx.currentTime;
      const startAt = Math.max(now + 0.02, nextStartTimeRef.current);
      source.start(startAt);
      nextStartTimeRef.current = startAt + buffer.duration;

      activeSourcesRef.current.add(source);
      setIsLunaSpeaking(true);
      startMeterLoop();

      source.onended = () => {
        activeSourcesRef.current.delete(source);
        if (activeSourcesRef.current.size === 0) {
          stopMeterLoop();
          setIsLunaSpeaking(false);
        }
      };
    },
    [startMeterLoop, stopMeterLoop]
  );

  const pushMicLevelThrottled = useCallback((level: number) => {
    const now = performance.now();
    if (now - lastMicUiUpdateRef.current >= 75) {
      lastMicUiUpdateRef.current = now;
      setMicLevel(level);
    }
  }, []);

  const openWebSocket = useCallback(
    (isReconnect = false) => {
      closeSocketOnly();

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams({
        voice: voiceName,
        mode: modeRef.current,
      });
      if (accessToken) params.set('token', accessToken);
      if (isReconnect && resumeHandleRef.current) {
        params.set('resumeHandle', resumeHandleRef.current);
      }

      const ws = new WebSocket(
        `${protocol}//${window.location.host}/live?${params.toString()}`
      );
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            data?: string;
            text?: string;
            mood?: string;
            handle?: string;
            error?: string;
            name?: string;
            args?: Record<string, unknown>;
            result?: string;
          };

          if (msg.type === 'ready') {
            liveReadyRef.current = true;
            reconnectAttemptsRef.current = 0;
            if (msg.mood) {
              moodRef.current = msg.mood;
              setMood(msg.mood);
            }
            updateStatus('live');
            resumeAudioContexts();
          } else if (msg.type === 'session_handle' && msg.handle) {
            resumeHandleRef.current = msg.handle;
          } else if (msg.type === 'go_away') {
            // Proactively refresh connection before server closes it
            if (!userEndedRef.current && resumeHandleRef.current) {
              updateStatus('reconnecting');
              openWebSocket(true);
            }
          } else if (msg.type === 'audio' && msg.data) {
            playPcmChunk(msg.data);
          } else if (msg.type === 'interrupted') {
            stopPlayback();
            callbacksRef.current.onTurnComplete();
          } else if (msg.type === 'input_transcript' && msg.text) {
            callbacksRef.current.onUserTranscript(msg.text);
          } else if (msg.type === 'output_transcript' && msg.text) {
            callbacksRef.current.onAssistantTranscript(msg.text);
          } else if (msg.type === 'turn_complete') {
            callbacksRef.current.onTurnComplete();
          } else if (msg.type === 'tool_event' && msg.name) {
            callbacksRef.current.onToolEvent({
              name: msg.name,
              args: msg.args ?? {},
              result: msg.result ?? '',
            });
          } else if (msg.type === 'error') {
            setError(msg.error ?? 'Voice session error.');
            updateStatus('error');
            cleanup();
          } else if (msg.type === 'closed') {
            if (!userEndedRef.current && reconnectAttemptsRef.current < 3) {
              reconnectAttemptsRef.current += 1;
              updateStatus('reconnecting');
              reconnectTimerRef.current = window.setTimeout(() => {
                openWebSocket(true);
              }, 700 * reconnectAttemptsRef.current);
            } else {
              updateStatus('idle');
              cleanup();
            }
          }
        } catch {
          // Ignore malformed server payload
        }
      };

      ws.onerror = () => {
        if (userEndedRef.current) return;
        if (reconnectAttemptsRef.current < 3) {
          reconnectAttemptsRef.current += 1;
          updateStatus('reconnecting');
          reconnectTimerRef.current = window.setTimeout(() => {
            openWebSocket(true);
          }, 800 * reconnectAttemptsRef.current);
        } else {
          setError('Could not connect to live voice server.');
          updateStatus('error');
          cleanup();
        }
      };

      ws.onclose = () => {
        if (userEndedRef.current || statusRef.current === 'error') return;
        if (reconnectAttemptsRef.current < 3) {
          reconnectAttemptsRef.current += 1;
          updateStatus('reconnecting');
          reconnectTimerRef.current = window.setTimeout(() => {
            openWebSocket(true);
          }, 800 * reconnectAttemptsRef.current);
        } else {
          updateStatus('idle');
          cleanup();
        }
      };
    },
    [
      accessToken,
      cleanup,
      closeSocketOnly,
      playPcmChunk,
      resumeAudioContexts,
      stopPlayback,
      updateStatus,
      voiceName,
    ]
  );

  const startCall = useCallback(async () => {
    if (
      statusRef.current === 'connecting' ||
      statusRef.current === 'reconnecting' ||
      statusRef.current === 'live'
    ) {
      return;
    }

    userEndedRef.current = false;
    reconnectAttemptsRef.current = 0;
    resumeHandleRef.current = '';
    setError(null);
    updateStatus('connecting');

    // Create & unlock AudioContexts synchronously inside the tap gesture
    const inputCtx = createAudioContext(16000);
    const outputCtx = createAudioContext(24000);
    inputCtxRef.current = inputCtx;
    outputCtxRef.current = outputCtx;

    inputCtx.resume().catch(() => {});
    outputCtx.resume().catch(() => {});

    const analyser = outputCtx.createAnalyser();
    analyser.fftSize = 128;
    analyser.connect(outputCtx.destination);
    outputAnalyserRef.current = analyser;
    nextStartTimeRef.current = outputCtx.currentTime;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      if (statusRef.current === 'idle' || userEndedRef.current) {
        for (const t of stream.getTracks()) t.stop();
        cleanup();
        return;
      }

      streamRef.current = stream;

      if (inputCtx.state === 'suspended') {
        await inputCtx.resume().catch(() => {});
      }
      if (outputCtx.state === 'suspended') {
        await outputCtx.resume().catch(() => {});
      }

      const source = inputCtx.createMediaStreamSource(stream);
      const zeroGain = inputCtx.createGain();
      zeroGain.gain.value = 0;
      sourceNodeRef.current = source;
      zeroGainRef.current = zeroGain;

      const sendBinaryPcm = (pcmBuffer: ArrayBuffer, level: number) => {
        if (
          !wsRef.current ||
          wsRef.current.readyState !== WebSocket.OPEN ||
          !liveReadyRef.current ||
          mutedRef.current
        ) {
          pushMicLevelThrottled(0);
          return;
        }
        pushMicLevelThrottled(level);
        wsRef.current.send(pcmBuffer);
      };

      if (inputCtx.audioWorklet) {
        try {
          await inputCtx.audioWorklet.addModule('/pcm-capture-processor.js');
          const workletNode = new AudioWorkletNode(
            inputCtx,
            'pcm-capture-processor'
          );
          workletNode.port.onmessage = (ev) => {
            const payload = ev.data as { pcm: ArrayBuffer; level: number };
            if (payload?.pcm) {
              sendBinaryPcm(payload.pcm, payload.level);
            }
          };
          workletNodeRef.current = workletNode;
          source.connect(workletNode);
          workletNode.connect(zeroGain);
          zeroGain.connect(inputCtx.destination);
        } catch {
          // Fall back to ScriptProcessorNode below if worklet load fails
        }
      }

      if (!workletNodeRef.current) {
        const bufferSize = inputCtx.sampleRate <= 24000 ? 1024 : 2048;
        const processor = inputCtx.createScriptProcessor(bufferSize, 1, 1);
        processorRef.current = processor;
        processor.onaudioprocess = (event) => {
          const channel = event.inputBuffer.getChannelData(0);
          let sumSq = 0;
          for (let i = 0; i < channel.length; i++) {
            sumSq += channel[i] * channel[i];
          }
          const level = Math.min(1, Math.sqrt(sumSq / channel.length) * 9);
          const pcm16 = downsampleTo16k(channel, inputCtx.sampleRate);
          sendBinaryPcm(pcm16.buffer as ArrayBuffer, level);
        };
        source.connect(processor);
        processor.connect(zeroGain);
        zeroGain.connect(inputCtx.destination);
      }

      openWebSocket(false);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Microphone access denied.';
      setError(msg);
      updateStatus('error');
      cleanup();
    }
  }, [cleanup, openWebSocket, pushMicLevelThrottled, updateStatus]);

  const endCall = useCallback(() => {
    const endedMood = moodRef.current;
    userEndedRef.current = true;
    resumeHandleRef.current = '';
    updateStatus('idle');
    cleanup();
    callbacksRef.current.onCallEnded?.(endedMood);
  }, [cleanup, updateStatus]);

  const toggleMute = useCallback(() => {
    resumeAudioContexts();
    setMuted((prev) => {
      const next = !prev;
      mutedRef.current = next;
      return next;
    });
  }, [resumeAudioContexts]);

  const sendTextDuringCall = useCallback((text: string) => {
    if (
      wsRef.current &&
      wsRef.current.readyState === WebSocket.OPEN &&
      liveReadyRef.current
    ) {
      wsRef.current.send(JSON.stringify({ text }));
      return true;
    }
    return false;
  }, []);

  const sendVideoFrame = useCallback(
    (base64Jpeg: string, gestureCheck = false) => {
      if (
        wsRef.current &&
        wsRef.current.readyState === WebSocket.OPEN &&
        liveReadyRef.current &&
        base64Jpeg
      ) {
        wsRef.current.send(
          JSON.stringify({
            video: base64Jpeg,
            mimeType: 'image/jpeg',
            ...(gestureCheck ? { gestureCheck: true } : {}),
          })
        );
        return true;
      }
      return false;
    },
    []
  );

  const updateMode = useCallback((nextMode: LunaMode) => {
    modeRef.current = nextMode;
    if (
      wsRef.current &&
      wsRef.current.readyState === WebSocket.OPEN &&
      liveReadyRef.current
    ) {
      wsRef.current.send(JSON.stringify({ mode: nextMode }));
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    return () => {
      userEndedRef.current = true;
      cleanup();
    };
  }, [cleanup]);

  return {
    status,
    mood,
    muted,
    error,
    micLevel,
    lunaLevel,
    isLunaSpeaking,
    startCall,
    endCall,
    toggleMute,
    sendTextDuringCall,
    sendVideoFrame,
    updateMode,
    resumeAudioContexts,
  };
}
