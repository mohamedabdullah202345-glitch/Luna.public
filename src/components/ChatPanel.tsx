import {
  ClipboardEvent,
  FormEvent,
  memo,
  RefObject,
  useRef,
} from 'react';
import { motion } from 'motion/react';
import {
  ImagePlus,
  Languages,
  Mic,
  MicOff,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { TranscriptEntry } from '../types';

interface AttachedImage {
  base64: string;
  previewUrl: string;
}

interface ChatPanelProps {
  transcript: TranscriptEntry[];
  inputText: string;
  attachedImage?: AttachedImage | null;
  onChangeInput: (val: string) => void;
  onAttachImage: (file: File) => void;
  onClearAttachment: () => void;
  onQuickPrompt: (prompt: string) => void;
  onSubmit: (e: FormEvent) => void;
  onClear: () => void;
  onToggleVoiceNote: () => void;
  isLive: boolean;
  isSendingText: boolean;
  isRecordingNote: boolean;
  transcriptEndRef: RefObject<HTMLDivElement | null>;
  onCloseDrawer?: () => void;
}

export const ChatPanel = memo(function ChatPanel({
  transcript,
  inputText,
  attachedImage,
  onChangeInput,
  onAttachImage,
  onClearAttachment,
  onQuickPrompt,
  onSubmit,
  onClear,
  onToggleVoiceNote,
  isLive,
  isSendingText,
  isRecordingNote,
  transcriptEndRef,
  onCloseDrawer,
}: ChatPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          onAttachImage(file);
          return;
        }
      }
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-3 shrink-0 bg-[#0A0F1E]/55">
        <div className="min-w-0">
          <h2 className="font-display text-base font-medium text-[#F8F4F6] truncate">
            Conversation
          </h2>
          <p className="text-xs text-[#A6B0C9] tabular-nums">
            {transcript.length}{' '}
            {transcript.length === 1 ? 'message' : 'messages'}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {transcript.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear conversation"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#A6B0C9] hover:text-[#F48FB1] hover:bg-white/5 transition-colors"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          {onCloseDrawer && (
            <button
              type="button"
              onClick={onCloseDrawer}
              aria-label="Close chat drawer"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#A6B0C9] hover:text-[#F8F4F6] hover:bg-white/5 transition-colors"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto luna-scroll px-4 py-4 space-y-4">
        {transcript.length === 0 ? (
          <div className="h-full min-h-[180px] flex flex-col items-center justify-center text-center px-6 space-y-2">
            <p className="font-display text-base text-[#F8F4F6]">
              Quiet &amp; ready
            </p>
            <p className="text-sm text-[#A6B0C9] leading-relaxed max-w-xs">
              Start a voice call, paste a Python screenshot or lecture photo, or
              message Luna below.
            </p>
          </div>
        ) : (
          transcript.map((entry) => {
            const isUser = entry.role === 'user';
            return (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  dir="auto"
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap space-y-2 ${
                    isUser
                      ? 'bg-[#F48FB1]/16 border border-[#F48FB1]/28 text-[#F8F4F6] rounded-br-sm'
                      : 'bg-[#121A31]/85 border border-white/10 text-[#F8F4F6] rounded-bl-sm'
                  }`}
                >
                  {entry.previewUrl ? (
                    <img
                      src={entry.previewUrl}
                      alt="Attached screenshot or photo"
                      className="max-h-44 rounded-xl border border-white/10 object-contain"
                    />
                  ) : entry.hasImage ? (
                    <span className="block text-[11px] font-mono text-[#F3C677]">
                      [Image attached]
                    </span>
                  ) : null}
                  {entry.text && <span>{entry.text}</span>}
                </div>

                {entry.toolEvents && entry.toolEvents.length > 0 && (
                  <div className="mt-1.5 px-1 space-y-0.5">
                    {entry.toolEvents.map((ev, idx) => (
                      <p
                        key={idx}
                        className="text-[11px] font-mono text-[#F3C677]/90"
                      >
                        {ev.name === 'remember'
                          ? `Remembered: ${String(ev.args.fact ?? '')}`
                          : ev.result}
                      </p>
                    ))}
                  </div>
                )}

                <span className="mt-1 px-1 text-[11px] font-mono text-[#7C88A6] tabular-nums">
                  {isUser ? 'You' : 'Luna'} · {entry.timestamp}
                </span>
              </motion.div>
            );
          })
        )}

        {isSendingText && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-start"
          >
            <div className="rounded-2xl rounded-bl-sm px-4 py-3 bg-[#121A31]/85 border border-white/10 flex items-center gap-1.5">
              {[0, 1, 2].map((dot) => (
                <motion.span
                  key={dot}
                  animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                  transition={{
                    duration: 0.9,
                    repeat: Infinity,
                    delay: dot * 0.16,
                  }}
                  className="w-1.5 h-1.5 rounded-full bg-[#F48FB1]"
                />
              ))}
            </div>
          </motion.div>
        )}

        <div ref={transcriptEndRef} />
      </div>

      {/* Attached image preview + quick Egyptian study simplify action */}
      {(attachedImage || inputText.trim().length > 35) && !isLive && (
        <div className="px-3 py-2 border-t border-white/10 bg-[#0A0F1E]/90 flex items-center justify-between gap-2 shrink-0">
          {attachedImage ? (
            <div className="flex items-center gap-2 min-w-0">
              <img
                src={attachedImage.previewUrl}
                alt="Attachment preview"
                className="w-10 h-10 rounded-lg object-cover border border-white/15 shrink-0"
              />
              <button
                type="button"
                onClick={onClearAttachment}
                aria-label="Remove attached image"
                className="min-h-[34px] min-w-[34px] rounded-lg bg-white/5 hover:bg-white/10 text-[#A6B0C9] hover:text-[#F48FB1] flex items-center justify-center shrink-0"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <span className="text-[11px] text-[#A6B0C9] truncate">
              Need a quick summary?
            </span>
          )}

          <button
            type="button"
            disabled={isSendingText}
            onClick={() =>
              onQuickPrompt(
                attachedImage
                  ? 'Explain what is in this image simply in Egyptian Arabic, and quiz me with 1 quick question at the end.'
                  : `Explain this simply in clear Egyptian Arabic in 2-3 short lines: ${inputText.trim()}`
              )
            }
            className="min-h-[36px] px-3 rounded-xl bg-[#F3C677]/15 hover:bg-[#F3C677]/25 border border-[#F3C677]/40 text-xs font-medium text-[#F3C677] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <Languages className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Explain in Egyptian</span>
          </button>
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="p-3 border-t border-white/10 bg-[#080C18]/80 flex items-center gap-2 shrink-0"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onAttachImage(file);
            e.target.value = '';
          }}
        />

        {!isLive && (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSendingText || isRecordingNote}
              aria-label="Attach photo or screenshot"
              title="Attach lecture photo or screenshot"
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border transition-all shrink-0 ${
                attachedImage
                  ? 'bg-[#F3C677]/20 border-[#F3C677]/50 text-[#F3C677]'
                  : 'bg-white/5 border-white/10 text-[#A6B0C9] hover:text-[#F8F4F6] hover:bg-white/10'
              }`}
            >
              <ImagePlus className="w-4 h-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={onToggleVoiceNote}
              disabled={isSendingText}
              aria-label={isRecordingNote ? 'Stop recording' : 'Record voice note'}
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border transition-all shrink-0 ${
                isRecordingNote
                  ? 'bg-[#F48FB1] border-[#F48FB1] text-[#0B1020]'
                  : 'bg-white/5 border-white/10 text-[#A6B0C9] hover:text-[#F8F4F6] hover:bg-white/10'
              }`}
            >
              {isRecordingNote ? (
                <MicOff className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Mic className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </>
        )}

        <input
          type="text"
          value={inputText}
          onChange={(e) => onChangeInput(e.target.value)}
          onPaste={handlePaste}
          disabled={isRecordingNote}
          placeholder={
            isRecordingNote
              ? 'Recording... tap mic to send'
              : isLive
                ? 'Send a note during call...'
                : attachedImage
                  ? 'Ask about this image (or tap Send)...'
                  : 'Message Luna or paste screenshot...'
          }
          className="flex-1 min-w-0 min-h-[44px] px-3.5 rounded-xl bg-[#0F1629] border border-white/10 text-sm text-[#F8F4F6] placeholder:text-[#7C88A6] focus:outline-none focus:border-[#F48FB1] transition-colors"
        />

        <button
          type="submit"
          disabled={
            (!inputText.trim() && !attachedImage) ||
            isSendingText ||
            isRecordingNote
          }
          aria-label="Send message"
          className="min-h-[44px] min-w-[44px] px-3.5 rounded-xl bg-gradient-to-br from-[#F48FB1] to-[#F3C677] hover:brightness-105 text-[#0B1020] flex items-center justify-center transition-all active:scale-95 disabled:opacity-35 shrink-0"
        >
          <Send className="w-4 h-4" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
});
