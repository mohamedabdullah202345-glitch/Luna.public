import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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

export interface CallSummary {
  id: number;
  summary: string;
  mood: string;
  createdAt: string;
}

export interface ForgetResult {
  deletedCount: number;
  deletedFact?: string;
  ambiguousCandidates?: Array<{ id: number; fact: string }>;
  message: string;
}

const VALID_CATEGORIES = new Set<MemoryCategory>([
  'study',
  'goals',
  'family',
  'habits',
  'general',
]);

export const MAX_FACTS = 300;
const LEGACY_MEMORY_FILE = path.resolve(process.cwd(), 'luna_memory.json');

export const SEED_FACTS: Array<{ fact: string; category: MemoryCategory }> = [
  { fact: 'His name is Mohamed. He is 18.', category: 'general' },
  {
    fact: 'He is a first-year agriculture student at Ain Shams University in Cairo.',
    category: 'study',
  },
  {
    fact: 'He is learning to code. He wants real skills, learning English, and small projects.',
    category: 'goals',
  },
];

let dbInstance: DatabaseSync | null = null;
let activeDbPath: string | null = null;

function resolveDbPath(overridePath?: string): string {
  if (overridePath) return overridePath;
  return (
    process.env.LUNA_DB_PATH ||
    path.resolve(process.cwd(), 'data', 'luna.db')
  );
}

export function inferCategory(text: string): MemoryCategory {
  const lower = text.toLowerCase();
  if (
    /\b(study|university|college|exam|lecture|soil|agriculture|ain shams|homework|english|class)\b/.test(
      lower
    )
  ) {
    return 'study';
  }
  if (
    /\b(goal|project|code|coding|career|learn|skill|build|future|plan|dream|job)\b/.test(
      lower
    )
  ) {
    return 'goals';
  }
  if (
    /\b(mom|dad|mother|father|sister|brother|family|friend|friends|mama|baba)\b/.test(
      lower
    )
  ) {
    return 'family';
  }
  if (
    /\b(sleep|wake|coffee|tea|gym|habit|routine|eat|music|like|love|hate|fear)\b/.test(
      lower
    )
  ) {
    return 'habits';
  }
  return 'general';
}

export function normalizeCategory(
  raw: unknown,
  fallbackText = ''
): MemoryCategory {
  const clean = String(raw ?? '')
    .trim()
    .toLowerCase() as MemoryCategory;
  if (VALID_CATEGORIES.has(clean)) return clean;
  return inferCategory(fallbackText);
}

export function getDb(customPath?: string): DatabaseSync {
  const targetPath = resolveDbPath(customPath);
  if (dbInstance && activeDbPath === targetPath) {
    return dbInstance;
  }
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }

  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const db = new DatabaseSync(targetPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fact TEXT NOT NULL UNIQUE COLLATE NOCASE,
      category TEXT NOT NULL DEFAULT 'general',
      saved TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS call_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      summary TEXT NOT NULL,
      mood TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  dbInstance = db;
  activeDbPath = targetPath;

  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM facts').get() as {
    cnt: number;
  };
  if (countRow.cnt === 0) {
    seedOrMigrateFacts(db, targetPath);
  }

  return db;
}

function seedOrMigrateFacts(db: DatabaseSync, targetPath: string): void {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO facts (fact, category, saved) VALUES (?, ?, ?)'
  );

  if (targetPath !== ':memory:' && fs.existsSync(LEGACY_MEMORY_FILE)) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(LEGACY_MEMORY_FILE, 'utf-8')
      ) as Array<{ fact?: string; category?: string; saved?: string }>;
      if (Array.isArray(parsed) && parsed.length > 0) {
        for (const item of parsed) {
          const text = String(item?.fact ?? '').trim();
          if (!text) continue;
          const cat = normalizeCategory(item?.category, text);
          const saved = String(item?.saved ?? 'start');
          insert.run(text, cat, saved);
        }
        return;
      }
    } catch {
      // Fall back to seed facts if legacy file is malformed
    }
  }

  for (const seed of SEED_FACTS) {
    insert.run(seed.fact, seed.category, 'start');
  }
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    activeDbPath = null;
  }
}

export function loadFacts(): MemoryFact[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, fact, category, saved FROM facts ORDER BY id ASC')
    .all() as Array<{
    id: number;
    fact: string;
    category: string;
    saved: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    fact: row.fact,
    category: normalizeCategory(row.category, row.fact),
    saved: row.saved,
  }));
}

export function addFact(
  text: string,
  category?: MemoryCategory | string
): boolean {
  const clean = text.trim();
  if (!clean) return false;

  const db = getDb();
  const cat = normalizeCategory(category, clean);
  const today = new Date().toISOString().slice(0, 10);

  const result = db
    .prepare(
      'INSERT OR IGNORE INTO facts (fact, category, saved) VALUES (?, ?, ?)'
    )
    .run(clean, cat, today);

  if (result.changes === 0) return false;

  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM facts').get() as {
    cnt: number;
  };
  if (countRow.cnt > MAX_FACTS) {
    const excess = countRow.cnt - MAX_FACTS;
    db.prepare(
      'DELETE FROM facts WHERE id IN (SELECT id FROM facts ORDER BY id ASC LIMIT ?)'
    ).run(excess);
  }
  return true;
}

export function forgetFact(text: string, confirmed = false): ForgetResult {
  const clean = text.trim();
  if (clean.length < 3) {
    return {
      deletedCount: 0,
      message:
        'Please specify a clearer phrase (at least 3 characters) so I do not erase unrelated memories.',
    };
  }

  const db = getDb();
  const lower = clean.toLowerCase();

  // Exact full-sentence match always deletes safely
  const exact = db
    .prepare('SELECT id, fact FROM facts WHERE LOWER(fact) = ? LIMIT 1')
    .get(lower) as { id: number; fact: string } | undefined;
  if (exact) {
    db.prepare('DELETE FROM facts WHERE id = ?').run(exact.id);
    return {
      deletedCount: 1,
      deletedFact: exact.fact,
      message: `Forgot: "${exact.fact}".`,
    };
  }

  const matches = db
    .prepare(
      'SELECT id, fact FROM facts WHERE LOWER(fact) LIKE ? ORDER BY LENGTH(fact) ASC, id DESC LIMIT 10'
    )
    .all(`%${lower}%`) as Array<{ id: number; fact: string }>;

  if (matches.length === 0) {
    return {
      deletedCount: 0,
      message: 'No saved memory matched that description.',
    };
  }

  if (matches.length === 1 || confirmed) {
    const target = matches[0];
    db.prepare('DELETE FROM facts WHERE id = ?').run(target.id);
    return {
      deletedCount: 1,
      deletedFact: target.fact,
      message: `Forgot: "${target.fact}".`,
    };
  }

  return {
    deletedCount: 0,
    ambiguousCandidates: matches.slice(0, 4),
    message: `Multiple memories matched (${matches
      .slice(0, 4)
      .map((m) => `"${m.fact}"`)
      .join(', ')}). Ask Mohamed to confirm which specific one to forget.`,
  };
}

export function deleteFactAtIndex(index: number): boolean {
  const facts = loadFacts();
  if (index < 0 || index >= facts.length) return false;
  const target = facts[index];
  if (!target?.id) return false;
  const res = getDb()
    .prepare('DELETE FROM facts WHERE id = ?')
    .run(target.id);
  return res.changes > 0;
}

export function addCallSummary(summary: string, mood = ''): boolean {
  const clean = summary.trim();
  if (!clean) return false;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      'INSERT INTO call_summaries (summary, mood, created_at) VALUES (?, ?, ?)'
    )
    .run(clean, mood, now);

  getDb()
    .prepare(
      'DELETE FROM call_summaries WHERE id NOT IN (SELECT id FROM call_summaries ORDER BY id DESC LIMIT 30)'
    )
    .run();
  return true;
}

export function getRecentCallSummaries(limit = 3): CallSummary[] {
  const rows = getDb()
    .prepare(
      'SELECT id, summary, mood, created_at FROM call_summaries ORDER BY id DESC LIMIT ?'
    )
    .all(limit) as Array<{
    id: number;
    summary: string;
    mood: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    summary: r.summary,
    mood: r.mood,
    createdAt: r.created_at,
  }));
}

export function factsAsText(): string {
  const facts = loadFacts();
  if (!facts.length) return '- Nothing yet.';

  // Group by category and keep prompt compact & focused (~45 most recent facts)
  const recent = facts.slice(-45);
  const grouped: Record<MemoryCategory, MemoryFact[]> = {
    study: [],
    goals: [],
    family: [],
    habits: [],
    general: [],
  };

  for (const item of recent) {
    grouped[item.category].push(item);
  }

  const sections: string[] = [];
  const labels: Array<[MemoryCategory, string]> = [
    ['general', 'Basics'],
    ['study', 'Study'],
    ['goals', 'Goals & Coding'],
    ['family', 'Family & Friends'],
    ['habits', 'Habits & Likes'],
  ];

  for (const [cat, label] of labels) {
    const items = grouped[cat];
    if (!items.length) continue;
    sections.push(
      `[${label}]\n${items
        .map((f) => `- ${f.fact} (saved ${f.saved})`)
        .join('\n')}`
    );
  }

  if (facts.length > recent.length) {
    sections.push(
      `(Showing latest ${recent.length} of ${facts.length} total saved facts.)`
    );
  }

  const summaries = getRecentCallSummaries(3);
  if (summaries.length > 0) {
    sections.push(
      `[Recent Conversations]\n${summaries
        .map((s) => `- (${s.createdAt.slice(0, 10)}) ${s.summary}`)
        .join('\n')}`
    );
  }

  return sections.join('\n\n');
}
