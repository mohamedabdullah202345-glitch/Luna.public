import fs from 'node:fs';
import path from 'node:path';
import { CAIRO_TIMEZONE } from './config.ts';
import { getDb } from './memoryStore.ts';

export interface TaskItem {
  id: string;
  title: string;
  done: boolean;
  status: string;
  due: string;
  source: 'notion' | 'local';
}

const LEGACY_TASKS_FILE = path.resolve(process.cwd(), 'luna_tasks.json');

function getCairoDateOffset(daysAhead: number): string {
  const target = new Date(Date.now() + daysAhead * 86400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(target);
}

function ensureTasksTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Not started',
      due TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM tasks').get() as {
    cnt: number;
  };
  if (countRow.cnt === 0) {
    const insert = db.prepare(
      'INSERT OR IGNORE INTO tasks (id, title, done, status, due, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const today = getCairoDateOffset(0);
    const tomorrow = getCairoDateOffset(1);
    const now = new Date().toISOString();

    if (fs.existsSync(LEGACY_TASKS_FILE)) {
      try {
        const parsed = JSON.parse(
          fs.readFileSync(LEGACY_TASKS_FILE, 'utf-8')
        ) as Array<{
          id?: string;
          title?: string;
          done?: boolean;
          status?: string;
          due?: string;
        }>;
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsed.forEach((t, idx) => {
            const title = String(t.title ?? '').trim();
            if (!title) return;
            // Refresh outdated seed dates that are behind Cairo today
            let due = String(t.due ?? '');
            if (due && due < today && !t.done) {
              due = idx === 0 ? today : tomorrow;
            }
            insert.run(
              t.id || `local-${idx + 1}`,
              title,
              t.done ? 1 : 0,
              t.status || (t.done ? 'Done' : 'Not started'),
              due,
              now
            );
          });
          return;
        }
      } catch {
        // Fallback to default tasks
      }
    }

    insert.run(
      'local-1',
      'Revise soil science lecture notes',
      0,
      'Not started',
      today,
      now
    );
    insert.run(
      'local-2',
      'Practice 20 minutes of English speaking and coding',
      0,
      'In progress',
      tomorrow,
      now
    );
  }
}

function getNotionCredentials(): { token: string; databaseId: string } | null {
  const token = (process.env.NOTION_TOKEN ?? '').trim();
  const databaseId = (process.env.NOTION_DATABASE_ID ?? '').trim();
  if (!token || !databaseId) return null;
  return { token, databaseId };
}

async function fetchNotionTasks(
  token: string,
  databaseId: string
): Promise<TaskItem[]> {
  const res = await fetch(
    `https://api.notion.com/v1/databases/${databaseId}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 20 }),
    }
  );
  if (!res.ok) {
    throw new Error(`Notion query failed (${res.status})`);
  }
  const data = (await res.json()) as {
    results?: Array<{
      id: string;
      properties?: Record<
        string,
        {
          type?: string;
          title?: Array<{ plain_text?: string }>;
          checkbox?: boolean;
          status?: { name?: string };
          select?: { name?: string };
          date?: { start?: string };
        }
      >;
    }>;
  };

  return (data.results ?? []).map((page) => {
    const props = page.properties ?? {};
    let title = 'Untitled task';
    let done = false;
    let status = 'Not started';
    let due = '';

    for (const val of Object.values(props)) {
      if (val?.type === 'title' && val.title?.length) {
        title = val.title.map((t) => t.plain_text ?? '').join('') || title;
      } else if (val?.type === 'checkbox') {
        done = Boolean(val.checkbox);
      } else if (val?.type === 'status' && val.status?.name) {
        status = val.status.name;
        if (status.toLowerCase() === 'done') done = true;
      } else if (val?.type === 'date' && val.date?.start) {
        due = val.date.start;
      }
    }

    return {
      id: page.id,
      title,
      done,
      status: done ? 'Done' : status,
      due,
      source: 'notion',
    };
  });
}

async function createNotionTask(
  token: string,
  databaseId: string,
  title: string,
  due = ''
): Promise<TaskItem> {
  const properties: Record<string, unknown> = {
    Name: {
      title: [{ text: { content: title } }],
    },
  };
  if (due) {
    properties.Due = { date: { start: due } };
  }

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
    }),
  });
  if (!res.ok) {
    throw new Error(`Notion create failed (${res.status})`);
  }
  const page = (await res.json()) as { id: string };
  return {
    id: page.id,
    title,
    done: false,
    status: 'Not started',
    due,
    source: 'notion',
  };
}

export async function getTasks(): Promise<TaskItem[]> {
  const notion = getNotionCredentials();
  if (notion) {
    try {
      return await fetchNotionTasks(notion.token, notion.databaseId);
    } catch {
      // Fallback to local SQLite tasks if Notion fails
    }
  }

  ensureTasksTable();
  const rows = getDb()
    .prepare(
      'SELECT id, title, done, status, due FROM tasks ORDER BY done ASC, rowid DESC'
    )
    .all() as Array<{
    id: string;
    title: string;
    done: number;
    status: string;
    due: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    done: Boolean(r.done),
    status: r.status,
    due: r.due,
    source: 'local',
  }));
}

export async function createTask(
  title: string,
  due = ''
): Promise<TaskItem | null> {
  const clean = title.trim();
  if (!clean) return null;

  const notion = getNotionCredentials();
  if (notion) {
    try {
      return await createNotionTask(notion.token, notion.databaseId, clean, due);
    } catch {
      // Fallback to SQLite local task
    }
  }

  ensureTasksTable();
  const id = `local-${Date.now()}`;
  const dueDate = due || getCairoDateOffset(0);
  getDb()
    .prepare(
      'INSERT INTO tasks (id, title, done, status, due, created_at) VALUES (?, ?, 0, ?, ?, ?)'
    )
    .run(id, clean, 'Not started', dueDate, new Date().toISOString());

  return {
    id,
    title: clean,
    done: false,
    status: 'Not started',
    due: dueDate,
    source: 'local',
  };
}

export async function completeTask(identifier: string): Promise<{
  completed: boolean;
  title?: string;
  message: string;
}> {
  const clean = identifier.trim();
  if (!clean) {
    return { completed: false, message: 'Specify which task to complete.' };
  }

  ensureTasksTable();
  const db = getDb();

  const row = db
    .prepare(
      'SELECT id, title FROM tasks WHERE id = ? OR LOWER(title) LIKE ? ORDER BY done ASC LIMIT 1'
    )
    .get(clean, `%${clean.toLowerCase()}%`) as
    | { id: string; title: string }
    | undefined;

  if (row) {
    db.prepare('UPDATE tasks SET done = 1, status = ? WHERE id = ?').run(
      'Done',
      row.id
    );
    return {
      completed: true,
      title: row.title,
      message: `Marked "${row.title}" as done.`,
    };
  }

  const notion = getNotionCredentials();
  if (notion) {
    try {
      const notionTasks = await fetchNotionTasks(
        notion.token,
        notion.databaseId
      );
      const match = notionTasks.find(
        (t) =>
          t.id === clean || t.title.toLowerCase().includes(clean.toLowerCase())
      );
      if (match) {
        await fetch(`https://api.notion.com/v1/pages/${match.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${notion.token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: {
              Status: { status: { name: 'Done' } },
            },
          }),
        });
        return {
          completed: true,
          title: match.title,
          message: `Marked "${match.title}" as done in Notion.`,
        };
      }
    } catch {
      // Ignore Notion error
    }
  }

  return { completed: false, message: 'No matching open task was found.' };
}

export async function toggleTask(id: string): Promise<{
  toggled: boolean;
  done?: boolean;
  message: string;
}> {
  const clean = id.trim();
  if (!clean) return { toggled: false, message: 'Task ID is required.' };

  ensureTasksTable();
  const db = getDb();
  const row = db
    .prepare('SELECT id, title, done FROM tasks WHERE id = ? LIMIT 1')
    .get(clean) as { id: string; title: string; done: number } | undefined;

  if (row) {
    const nextDone = row.done ? 0 : 1;
    const nextStatus = nextDone ? 'Done' : 'Not started';
    db.prepare('UPDATE tasks SET done = ?, status = ? WHERE id = ?').run(
      nextDone,
      nextStatus,
      row.id
    );
    return {
      toggled: true,
      done: Boolean(nextDone),
      message: nextDone
        ? `Marked "${row.title}" as done.`
        : `Reopened "${row.title}".`,
    };
  }

  const notion = getNotionCredentials();
  if (notion) {
    try {
      const notionTasks = await fetchNotionTasks(
        notion.token,
        notion.databaseId
      );
      const match = notionTasks.find((t) => t.id === clean);
      if (match) {
        const nextDone = !match.done;
        await fetch(`https://api.notion.com/v1/pages/${match.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${notion.token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: {
              Status: { status: { name: nextDone ? 'Done' : 'Not started' } },
            },
          }),
        });
        return {
          toggled: true,
          done: nextDone,
          message: nextDone
            ? `Marked "${match.title}" as done in Notion.`
            : `Reopened "${match.title}" in Notion.`,
        };
      }
    } catch {
      // Ignore Notion error
    }
  }

  return { toggled: false, message: 'Task not found.' };
}

export async function deleteTask(identifier: string): Promise<{
  deleted: boolean;
  title?: string;
  message: string;
}> {
  const clean = identifier.trim();
  if (!clean) {
    return { deleted: false, message: 'Specify which task to remove.' };
  }

  ensureTasksTable();
  const db = getDb();
  const row = db
    .prepare(
      'SELECT id, title FROM tasks WHERE id = ? OR LOWER(title) LIKE ? LIMIT 1'
    )
    .get(clean, `%${clean.toLowerCase()}%`) as
    | { id: string; title: string }
    | undefined;

  if (row) {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(row.id);
    return {
      deleted: true,
      title: row.title,
      message: `Removed task "${row.title}".`,
    };
  }

  const notion = getNotionCredentials();
  if (notion) {
    try {
      const notionTasks = await fetchNotionTasks(
        notion.token,
        notion.databaseId
      );
      const match = notionTasks.find(
        (t) =>
          t.id === clean || t.title.toLowerCase().includes(clean.toLowerCase())
      );
      if (match) {
        await fetch(`https://api.notion.com/v1/pages/${match.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${notion.token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ archived: true }),
        });
        return {
          deleted: true,
          title: match.title,
          message: `Removed task "${match.title}" from Notion.`,
        };
      }
    } catch {
      // Ignore Notion error
    }
  }

  return { deleted: false, message: 'No matching task was found.' };
}
