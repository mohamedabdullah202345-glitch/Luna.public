export const GEMINI_MODELS = {
  CHAT: process.env.GEMINI_CHAT_MODEL || 'gemini-4-hydrogen',
  LIVE:
    process.env.GEMINI_LIVE_MODEL ||
    'gemini-2.5-flash-native-audio-preview-12-2025',
  TTS: process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts',
  TRANSCRIBE: process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe',
} as const;

export const ALLOWED_VOICES = new Set([
  'Sulafat',
  'Aoede',
  'Leda',
  'Kore',
  'Zephyr',
]);

export function normalizeVoice(input: unknown): string {
  const v = String(input ?? '').trim();
  return ALLOWED_VOICES.has(v) ? v : 'Sulafat';
}

export const CAIRO_TIMEZONE = 'Africa/Cairo';

export function getAccessToken(): string {
  return (process.env.LUNA_ACCESS_TOKEN ?? '').trim();
}
