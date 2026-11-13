export type VoiceName = 'Sulafat' | 'Aoede' | 'Leda' | 'Kore' | 'Zephyr';

export type LunaMode = 'natural' | 'coach' | 'study' | 'night';

export type RoomScene = 'lamp' | 'moon' | 'dusk' | 'off';

export type MemoryCategory =
  | 'study'
  | 'goals'
  | 'family'
  | 'habits'
  | 'general';

export interface MemoryFact {
  id?: number;
  fact: string;
  category: MemoryCategory;
  saved: string;
}

export interface TaskItem {
  id: string;
  title: string;
  done: boolean;
  status: string;
  due: string;
  source: 'notion' | 'local';
}

export interface ToolEvent {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  hasImage?: boolean;
  previewUrl?: string;
  toolEvents?: ToolEvent[];
}

export interface EnglishUpgrade {
  insteadOf: string;
  sayNaturally: string;
  egyptianNote: string;
}

export interface EnglishSparkResponse {
  vibeNote: string;
  upgrades: EnglishUpgrade[];
  challengePrompt: string;
  roleplayTitle: string;
  roleplayStarter: string;
}

export interface EnglishCheckResponse {
  scoreLabel: string;
  reaction: string;
  polished: string;
  tip: string;
}

