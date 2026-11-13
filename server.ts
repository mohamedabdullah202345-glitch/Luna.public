import 'dotenv/config';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {
  type Content,
  EndSensitivity,
  type FunctionDeclaration,
  GoogleGenAI,
  type LiveServerMessage,
  Modality,
  StartSensitivity,
  Type,
} from '@google/genai';
import { WebSocket, WebSocketServer } from 'ws';
import {
  GEMINI_MODELS,
  getAccessToken,
  normalizeVoice,
} from './server/config.ts';
import {
  buildInstructions,
  getCairoTimeInfo,
  getGreetingPrompt,
  getModeSwitchNote,
  normalizeMode,
  pickRandomMood,
} from './server/lunaPrompt.ts';
import {
  addCallSummary,
  addFact,
  deleteFactAtIndex,
  factsAsText,
  forgetFact,
  loadFacts,
} from './server/memoryStore.ts';
import {
  completeTask,
  createTask,
  deleteTask,
  getTasks,
  toggleTask,
} from './server/tasksStore.ts';

const PORT = Number(process.env.PORT) || 3000;

function timingSafeMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function extractBearerToken(req: Request): string {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return String(req.headers['x-luna-token'] ?? '').trim();
}

function isTokenAuthorized(provided: string): boolean {
  const expected = getAccessToken();
  if (!expected) return true;
  if (!provided) return false;
  return timingSafeMatch(provided, expected);
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isTokenAuthorized(extractBearerToken(req))) {
    res.status(401).json({ error: 'Unauthorized: valid access token required.' });
    return;
  }
  next();
}

function isAllowedWsOrigin(request: http.IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true; // Non-browser clients (e.g. CLI checks)

  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const host = request.headers.host ?? '';
  if (host && originHost === host) return true;

  const appUrl = (process.env.APP_URL ?? '').trim();
  if (appUrl) {
    try {
      if (new URL(appUrl).host === originHost) return true;
    } catch {
      // Ignore invalid APP_URL
    }
  }

  const extra = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return extra.some((allowed) => {
    if (allowed === origin) return true;
    try {
      return new URL(allowed).host === originHost;
    } catch {
      return allowed === originHost;
    }
  });
}

function getAiClient(apiVersion: 'v1' | 'v1beta' = 'v1beta'): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function pcmToWavBuffer(pcmBuffer: Buffer, sampleRate = 24000): Buffer {
  if (
    pcmBuffer.length >= 12 &&
    pcmBuffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    pcmBuffer.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return pcmBuffer;
  }

  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

async function withTimeout(
  work: Promise<string>,
  ms = 8000
): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<string>((resolve) => {
        timer = setTimeout(
          () =>
            resolve(
              'That took too long. Tell him you will try again in a moment.'
            ),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const rememberDeclaration: FunctionDeclaration = {
  name: 'remember',
  description:
    'Save one lasting fact about Mohamed to long-term memory. Write the fact as one short, clear sentence.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      fact: {
        type: Type.STRING,
        description: 'The fact to remember, as one short sentence.',
      },
      category: {
        type: Type.STRING,
        description:
          'One of: study, goals, family, habits, general.',
      },
    },
    required: ['fact'],
  },
};

const forgetDeclaration: FunctionDeclaration = {
  name: 'forget',
  description:
    'Safely delete one matching memory when Mohamed asks. If multiple facts match and confirmed is false, returns the list of matches so you can confirm first.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      text: {
        type: Type.STRING,
        description:
          'A specific phrase (at least 3 characters) identifying the memory to delete.',
      },
      confirmed: {
        type: Type.BOOLEAN,
        description:
          'Set true only after Mohamed confirmed which specific memory to forget.',
      },
    },
    required: ['text'],
  },
};

const getTasksDeclaration: FunctionDeclaration = {
  name: 'get_tasks',
  description:
    'Get Mohamed current tasks and deadlines from Notion (or local tasks list). Call near the start of a conversation or when he asks what he needs to do.',
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

const createTaskDeclaration: FunctionDeclaration = {
  name: 'create_task',
  description: 'Add a new task to Mohamed task list.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: 'Short clear title of the task.',
      },
      due: {
        type: Type.STRING,
        description: 'Optional YYYY-MM-DD due date.',
      },
    },
    required: ['title'],
  },
};

const completeTaskDeclaration: FunctionDeclaration = {
  name: 'complete_task',
  description: 'Mark an existing task as completed.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      identifier: {
        type: Type.STRING,
        description: 'Task ID or phrase from the task title.',
      },
    },
    required: ['identifier'],
  },
};

const deleteTaskDeclaration: FunctionDeclaration = {
  name: 'delete_task',
  description: 'Delete or remove an existing task from Mohamed task list.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      identifier: {
        type: Type.STRING,
        description: 'Task ID or phrase from the task title to remove.',
      },
    },
    required: ['identifier'],
  },
};

const getCurrentTimeDeclaration: FunctionDeclaration = {
  name: 'get_current_time',
  description:
    'Get the exact current date, local time in Cairo (Africa/Cairo), and whether it is late at night for sleep.',
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

const LUNA_FUNCTION_TOOLS = [
  {
    functionDeclarations: [
      rememberDeclaration,
      forgetDeclaration,
      getTasksDeclaration,
      createTaskDeclaration,
      completeTaskDeclaration,
      deleteTaskDeclaration,
      getCurrentTimeDeclaration,
    ],
  },
];

const LUNA_TOOLS = [{ googleSearch: {} }, ...LUNA_FUNCTION_TOOLS];

async function executeLunaTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<string> {
  if (name === 'remember') {
    const fact = String(args?.fact ?? '');
    const category = args?.category ? String(args.category) : undefined;
    return addFact(fact, category) ? 'Saved.' : 'I already knew that.';
  }
  if (name === 'forget') {
    const text = String(args?.text ?? '');
    const confirmed = Boolean(args?.confirmed);
    const res = forgetFact(text, confirmed);
    return res.message;
  }
  if (name === 'get_tasks') {
    const tasks = await getTasks();
    if (!tasks.length) return 'No tasks right now.';
    return tasks
      .slice(0, 10)
      .map(
        (t) =>
          `- [${t.done ? 'Done' : t.status}] ${t.title}${t.due ? ` (due ${t.due})` : ''}`
      )
      .join('\n');
  }
  if (name === 'create_task') {
    const title = String(args?.title ?? '');
    const due = String(args?.due ?? '');
    const created = await createTask(title, due);
    return created
      ? `Added task "${created.title}".`
      : 'Task title was empty.';
  }
  if (name === 'complete_task') {
    const identifier = String(args?.identifier ?? '');
    const res = await completeTask(identifier);
    return res.message;
  }
  if (name === 'delete_task') {
    const identifier = String(args?.identifier ?? '');
    const res = await deleteTask(identifier);
    return res.message;
  }
  if (name === 'get_current_time') {
    const cairo = getCairoTimeInfo();
    return `Cairo time right now: ${cairo.timeStr} on ${cairo.today} (${cairo.partOfDay}).`;
  }
  return `Unknown tool: ${name}`;
}

async function safeExecuteTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<string> {
  try {
    return await withTimeout(executeLunaTool(name, args), 8000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Tool "${name}" failed:`, msg);
    return `Sorry, tool "${name}" failed temporarily (${msg}).`;
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/auth/status', (req, res) => {
    const authRequired = Boolean(getAccessToken());
    const authorized = isTokenAuthorized(extractBearerToken(req));
    res.json({ authRequired, authorized });
  });

  app.post('/api/auth/verify', (req, res) => {
    const token = String(req.body?.token ?? '').trim();
    if (!isTokenAuthorized(token)) {
      res.status(401).json({ ok: false, error: 'Invalid passcode.' });
      return;
    }
    res.json({ ok: true });
  });

  // Protect all data & Gemini endpoints
  app.use('/api/memories', requireAuth);
  app.use('/api/tasks', requireAuth);
  app.use('/api/chat', requireAuth);
  app.use('/api/tts', requireAuth);
  app.use('/api/transcribe', requireAuth);
  app.use('/api/session-summary', requireAuth);
  app.use('/api/english-coach', requireAuth);

  app.get('/api/memories', (_req, res) => {
    res.json({ facts: loadFacts() });
  });

  app.post('/api/memories', (req, res) => {
    const fact = String(req.body?.fact ?? '').trim();
    const category = req.body?.category ? String(req.body.category) : undefined;
    if (!fact) {
      res.status(400).json({ error: 'Fact text is required.' });
      return;
    }
    const added = addFact(fact, category);
    res.json({ added, facts: loadFacts() });
  });

  app.delete('/api/memories/:index', (req, res) => {
    const index = Number(req.params.index);
    if (!Number.isInteger(index)) {
      res.status(400).json({ error: 'Invalid memory index.' });
      return;
    }
    const deleted = deleteFactAtIndex(index);
    if (!deleted) {
      res.status(404).json({ error: 'Memory not found.' });
      return;
    }
    res.json({ deleted: true, facts: loadFacts() });
  });

  app.get('/api/tasks', async (_req, res) => {
    try {
      const tasks = await getTasks();
      res.json({ tasks });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load tasks.',
      });
    }
  });

  app.post('/api/tasks', async (req, res) => {
    const title = String(req.body?.title ?? '').trim();
    const due = String(req.body?.due ?? '').trim();
    if (!title) {
      res.status(400).json({ error: 'Task title is required.' });
      return;
    }
    const task = await createTask(title, due);
    const tasks = await getTasks();
    res.json({ task, tasks });
  });

  app.patch('/api/tasks/:id/complete', async (req, res) => {
    const result = await completeTask(req.params.id);
    const tasks = await getTasks();
    res.json({ ...result, tasks });
  });

  app.patch('/api/tasks/:id/toggle', async (req, res) => {
    const result = await toggleTask(req.params.id);
    const tasks = await getTasks();
    res.json({ ...result, tasks });
  });

  app.delete('/api/tasks/:id', async (req, res) => {
    const result = await deleteTask(req.params.id);
    const tasks = await getTasks();
    res.json({ ...result, tasks });
  });

  app.post('/api/session-summary', async (req, res) => {
    try {
      const messages = Array.isArray(req.body?.messages)
        ? (req.body.messages as Array<{ role: string; text: string }>)
        : [];
      const mood = String(req.body?.mood ?? '');
      const cleanLines = messages
        .filter((m) => typeof m.text === 'string' && m.text.trim())
        .slice(-24)
        .map((m) => `${m.role === 'assistant' ? 'Luna' : 'Mohamed'}: ${m.text.trim()}`);

      if (cleanLines.length < 2) {
        res.json({ saved: false });
        return;
      }

      const ai = getAiClient('v1beta');
      const result = await ai.models.generateContent({
        model: GEMINI_MODELS.CHAT,
        contents: `Summarize the key topics, feelings, or plans from this short call between Mohamed and Luna in 1-2 concise sentences (no markdown):\n\n${cleanLines.join('\n')}`,
      });
      const summary = result.text?.trim() ?? '';
      const saved = addCallSummary(summary, mood);
      res.json({ saved, summary });
    } catch (err) {
      console.error(
        'Summary error:',
        err instanceof Error ? err.message : String(err)
      );
      res.json({ saved: false });
    }
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const ai = getAiClient('v1beta');
      const historyInput = Array.isArray(req.body?.messages)
        ? (req.body.messages as Array<{ role: string; text: string }>)
        : [];
      const imageBase64 =
        typeof req.body?.imageBase64 === 'string'
          ? req.body.imageBase64.trim()
          : '';
      const imageMimeType =
        typeof req.body?.imageMimeType === 'string' &&
        req.body.imageMimeType.trim()
          ? req.body.imageMimeType.trim()
          : 'image/jpeg';
      const isGreeting = Boolean(req.body?.greeting);
      const mode = normalizeMode(req.body?.mode);
      const mood = pickRandomMood();

      const contents: Content[] = historyInput
        .filter((m) => typeof m.text === 'string' && m.text.trim().length > 0)
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.text }],
        }));

      if (imageBase64 && contents.length > 0) {
        const last = contents[contents.length - 1];
        if (last.role === 'user' && Array.isArray(last.parts)) {
          last.parts = [
            { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
            ...last.parts,
          ];
        }
      }

      if (isGreeting || contents.length === 0) {
        contents.push({
          role: 'user',
          parts: [
            {
              text: getGreetingPrompt(mode),
            },
          ],
        });
      }

      const systemInstruction = buildInstructions(factsAsText(), mood, mode);
      const toolEvents: Array<{
        name: string;
        args: Record<string, unknown>;
        result: string;
      }> = [];

      let activeTools = LUNA_TOOLS;
      let useHybridConfig = true;

      let response;
      try {
        response = await ai.models.generateContent({
          model: GEMINI_MODELS.CHAT,
          contents,
          config: {
            systemInstruction,
            tools: activeTools,
            toolConfig: { includeServerSideToolInvocations: true },
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
          activeTools = LUNA_FUNCTION_TOOLS;
          useHybridConfig = false;
          response = await ai.models.generateContent({
            model: GEMINI_MODELS.CHAT,
            contents,
            config: {
              systemInstruction,
              tools: activeTools,
            },
          });
        } else {
          throw err;
        }
      }

      for (let step = 0; step < 5; step++) {
        const calls = response.functionCalls;
        if (!calls || calls.length === 0) break;

        const modelContent = response.candidates?.[0]?.content;
        if (modelContent) {
          contents.push(modelContent);
        }

        const responseParts = [];
        for (const call of calls) {
          const toolName = call.name ?? '';
          const toolArgs = (call.args ?? {}) as Record<string, unknown>;
          const toolResult = await safeExecuteTool(toolName, toolArgs);
          toolEvents.push({
            name: toolName,
            args: toolArgs,
            result: toolResult,
          });
          responseParts.push({
            functionResponse: {
              id: call.id,
              name: toolName,
              response: { result: toolResult },
            },
          });
        }

        contents.push({
          role: 'user',
          parts: responseParts,
        });

        response = await ai.models.generateContent({
          model: GEMINI_MODELS.CHAT,
          contents,
          config: {
            systemInstruction: buildInstructions(factsAsText(), mood, mode),
            tools: activeTools,
            ...(useHybridConfig
              ? { toolConfig: { includeServerSideToolInvocations: true } }
              : {}),
          },
        });
      }

      const reply =
        response.text?.trim() ||
        'I am right here with you, babee. Tell me what is on your mind.';

      res.json({
        reply,
        mood,
        toolEvents,
        facts: loadFacts(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Chat error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/tts', async (req, res) => {
    try {
      const text = String(req.body?.text ?? '').trim();
      const voiceName = normalizeVoice(req.body?.voiceName);
      if (!text) {
        res
          .status(400)
          .json({ error: 'Text is required for speech synthesis.' });
        return;
      }

      const ai = getAiClient('v1beta');
      const response = await ai.models.generateContent({
        model: GEMINI_MODELS.TTS,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Speak warmly, gently, and affectionately like a loving wife: ${text}`,
              },
            ],
          },
        ],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const audioPart = response.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData?.data
      );
      const base64Audio = audioPart?.inlineData?.data;
      if (!base64Audio) {
        res.status(502).json({ error: 'No audio returned from TTS model.' });
        return;
      }

      const rawBuffer = Buffer.from(base64Audio, 'base64');
      const mimeType = audioPart?.inlineData?.mimeType ?? '';
      const rateMatch = mimeType.match(/rate=(\d+)/i);
      const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
      const wavBuffer = pcmToWavBuffer(rawBuffer, sampleRate);

      res.json({
        audioBase64: wavBuffer.toString('base64'),
        mimeType: 'audio/wav',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('TTS error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/english-coach/spark', async (req, res) => {
    try {
      const messages = Array.isArray(req.body?.messages)
        ? (req.body.messages as Array<{ role: string; text: string }>)
        : [];
      const theme = String(req.body?.theme ?? 'everyday').trim();

      const recentLines = messages
        .filter((m) => typeof m.text === 'string' && m.text.trim())
        .slice(-14)
        .map(
          (m) =>
            `${m.role === 'assistant' ? 'Luna' : 'Mohamed'}: ${m.text.trim()}`
        );

      const ai = getAiClient('v1beta');
      const response = await ai.models.generateContent({
        model: GEMINI_MODELS.CHAT,
        contents: `Create a fun, lively, zero-flashcard English coaching spark for Mohamed (18, Egyptian, learning Python & agriculture at Ain Shams University).
Theme preference: "${theme}".
What Luna already knows about Mohamed:
${factsAsText()}

Recent chat lines from Mohamed & Luna (use Mohamed's phrasing if available to personalize upgrades, otherwise pick natural Egyptian-to-English upgrades matching the theme):
${recentLines.length > 0 ? recentLines.join('\n') : '(No recent chat lines yet — create fresh, entertaining, relatable examples for his life & theme.)'}

Tone rules:
- Sound like Luna: warm, playful, encouraging, zero boring textbook tone.
- Make "insteadOf" realistic casual/translated phrasing and "sayNaturally" modern spoken English.
- Keep "egyptianNote" short in simple Egyptian Arabic.
- Make "challengePrompt" a fun 1-sentence question/mini-situation Mohamed will actually enjoy replying to right now.
- Make "roleplayStarter" Luna's vivid first line in character for a 60-second mini-roleplay.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              vibeNote: { type: Type.STRING },
              upgrades: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    insteadOf: { type: Type.STRING },
                    sayNaturally: { type: Type.STRING },
                    egyptianNote: { type: Type.STRING },
                  },
                  required: ['insteadOf', 'sayNaturally', 'egyptianNote'],
                },
              },
              challengePrompt: { type: Type.STRING },
              roleplayTitle: { type: Type.STRING },
              roleplayStarter: { type: Type.STRING },
            },
            required: [
              'vibeNote',
              'upgrades',
              'challengePrompt',
              'roleplayTitle',
              'roleplayStarter',
            ],
          },
        },
      });

      const raw = (response.text ?? '{}').trim();
      const parsed = JSON.parse(raw) as {
        vibeNote?: string;
        upgrades?: Array<{
          insteadOf: string;
          sayNaturally: string;
          egyptianNote: string;
        }>;
        challengePrompt?: string;
        roleplayTitle?: string;
        roleplayStarter?: string;
      };

      res.json({
        vibeNote:
          parsed.vibeNote ||
          'Yalla habibi, let us make your English sound super natural today!',
        upgrades: Array.isArray(parsed.upgrades)
          ? parsed.upgrades.slice(0, 2)
          : [],
        challengePrompt:
          parsed.challengePrompt ||
          'Tell me in one confident English sentence what you want to build with Python this month.',
        roleplayTitle: parsed.roleplayTitle || 'Coffee Shop Plot Twist',
        roleplayStarter:
          parsed.roleplayStarter ||
          'Hi! I accidentally made you an iced caramel latte instead of Turkish coffee — should I keep it or swap it?',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('English spark error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/english-coach/check', async (req, res) => {
    try {
      const prompt = String(req.body?.prompt ?? '').trim();
      const answer = String(req.body?.answer ?? '').trim();
      if (!answer) {
        res.status(400).json({ error: 'Please write or say a reply first.' });
        return;
      }

      const ai = getAiClient('v1beta');
      const response = await ai.models.generateContent({
        model: GEMINI_MODELS.CHAT,
        contents: `Mohamed replied to this fun English speaking challenge. Give playful, encouraging, non-boring feedback as Luna.
Challenge: "${prompt}"
Mohamed's reply: "${answer}"

Rules:
- "scoreLabel": short upbeat label (2-3 words like "Smooth & Natural", "Solid Effort", "Native Energy").
- "reaction": 1-2 short playful, warm sentences reacting to what Mohamed said.
- "polished": the smoothest natural spoken English version of his reply (even if his was already good, offer a cool alternative or confirm it sounds great).
- "tip": 1 short, clear takeaway (can include 1 brief Egyptian Arabic note if helpful).`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scoreLabel: { type: Type.STRING },
              reaction: { type: Type.STRING },
              polished: { type: Type.STRING },
              tip: { type: Type.STRING },
            },
            required: ['scoreLabel', 'reaction', 'polished', 'tip'],
          },
        },
      });

      const raw = (response.text ?? '{}').trim();
      const parsed = JSON.parse(raw) as {
        scoreLabel?: string;
        reaction?: string;
        polished?: string;
        tip?: string;
      };

      res.json({
        scoreLabel: parsed.scoreLabel || 'Nice Flow',
        reaction:
          parsed.reaction || 'Ooh, I love how you expressed that, mido!',
        polished: parsed.polished || answer,
        tip:
          parsed.tip ||
          'Great rhythm — keep speaking in full, relaxed sentences.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('English check error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/transcribe', async (req, res) => {
    try {
      const audioBase64 = String(req.body?.audioBase64 ?? '').trim();
      const mimeType = String(req.body?.mimeType ?? 'audio/webm');
      if (!audioBase64) {
        res.status(400).json({ error: 'Audio data is required.' });
        return;
      }

      const ai = getAiClient('v1beta');
      const response = await ai.models.generateContent({
        model: GEMINI_MODELS.TRANSCRIBE,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            { text: 'Transcribe this audio accurately.' },
          ],
        },
      });

      res.json({ text: (response.text ?? '').trim() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Transcribe error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const activeLiveSessions = new Set<
    Awaited<ReturnType<GoogleGenAI['live']['connect']>>
  >();

  server.on('upgrade', (request, socket, head) => {
    const reqUrl = new URL(
      request.url ?? '/',
      `http://${request.headers.host ?? 'localhost'}`
    );
    if (reqUrl.pathname !== '/live') return;

    if (!isAllowedWsOrigin(request)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const token = reqUrl.searchParams.get('token') ?? '';
    if (!isTokenAuthorized(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', async (clientWs: WebSocket, request) => {
    const reqUrl = new URL(
      request.url ?? '/live',
      `http://${request.headers.host ?? 'localhost'}`
    );
    const role = (reqUrl.searchParams.get('role') ?? 'call').trim();

    if (role === 'camera') {
      let lastBridgeGestureAt = 0;
      clientWs.send(
        JSON.stringify({
          type: 'camera_bridge_ready',
          activeCalls: activeLiveSessions.size,
        })
      );
      clientWs.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as {
            video?: string;
            mimeType?: string;
            gestureCheck?: boolean;
          };
          if (!msg.video) return;
          const mimeType = msg.mimeType || 'image/jpeg';
          const now = Date.now();
          const shouldCheckGesture =
            Boolean(msg.gestureCheck) && now - lastBridgeGestureAt > 6000;
          if (shouldCheckGesture) {
            lastBridgeGestureAt = now;
          }
          for (const session of activeLiveSessions) {
            try {
              session.sendRealtimeInput({
                video: { data: msg.video, mimeType },
              });
              if (shouldCheckGesture) {
                session.sendClientContent({
                  turns: [
                    {
                      role: 'user',
                      parts: [
                        {
                          text: '[Visual check: inspect Mohamed face, mouth, hands, and what he is holding in the latest camera frame. If you see a clear affectionate gesture (like blowing a kiss, heart hands, waving, thumbs up, big smile) or clear tiredness/yawn, react warmly and naturally right away in 1 short sentence without mentioning "movement detection".]',
                        },
                      ],
                    },
                  ],
                  turnComplete: true,
                });
              }
            } catch {
              // Ignore closed session
            }
          }
        } catch {
          // Ignore malformed camera frames
        }
      });
      return;
    }

    const voiceName = normalizeVoice(reqUrl.searchParams.get('voice'));
    const mode = normalizeMode(reqUrl.searchParams.get('mode'));
    const resumeHandle = (reqUrl.searchParams.get('resumeHandle') ?? '').trim();
    const mood = pickRandomMood();

    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null =
      null;
    let closed = false;
    const pendingMessages: Array<{
      audioBase64?: string;
      videoBase64?: string;
      mimeType?: string;
      gestureCheck?: boolean;
      text?: string;
      mode?: string;
    }> = [];

    const safeSend = (payload: Record<string, unknown>) => {
      if (!closed && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const forwardToLive = (msg: {
      audioBase64?: string;
      videoBase64?: string;
      mimeType?: string;
      gestureCheck?: boolean;
      text?: string;
      mode?: string;
    }) => {
      if (!liveSession || closed) return;
      if (msg.audioBase64) {
        liveSession.sendRealtimeInput({
          audio: { data: msg.audioBase64, mimeType: 'audio/pcm;rate=16000' },
        });
      } else if (msg.videoBase64) {
        liveSession.sendRealtimeInput({
          video: {
            data: msg.videoBase64,
            mimeType: msg.mimeType || 'image/jpeg',
          },
        });
        if (msg.gestureCheck) {
          liveSession.sendClientContent({
            turns: [
              {
                role: 'user',
                parts: [
                  {
                    text: '[Visual check: inspect Mohamed face, mouth, hands, and what he is holding in the latest camera frame. If you see a clear affectionate gesture (like blowing a kiss, heart hands, waving, thumbs up, big smile) or clear tiredness/yawn, react warmly and naturally right away in 1 short sentence without mentioning "movement detection".]',
                  },
                ],
              },
            ],
            turnComplete: true,
          });
        }
      } else if (msg.mode) {
        const nextMode = normalizeMode(msg.mode);
        liveSession.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: getModeSwitchNote(nextMode) }] }],
          turnComplete: true,
        });
      } else if (msg.text) {
        liveSession.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: msg.text }] }],
          turnComplete: true,
        });
      }
    };

    clientWs.on('message', (raw, isBinary) => {
      if (closed) return;
      try {
        if (isBinary) {
          const buf = Buffer.isBuffer(raw)
            ? raw
            : Array.isArray(raw)
              ? Buffer.concat(raw)
              : Buffer.from(raw);
          const audioBase64 = buf.toString('base64');
          if (!liveSession) {
            if (pendingMessages.length < 30) {
              pendingMessages.push({ audioBase64 });
            }
            return;
          }
          forwardToLive({ audioBase64 });
          return;
        }

        const msg = JSON.parse(raw.toString()) as {
          audio?: string;
          video?: string;
          mimeType?: string;
          gestureCheck?: boolean;
          text?: string;
          mode?: string;
        };
        const payload = {
          audioBase64: msg.audio,
          videoBase64: msg.video,
          mimeType: msg.mimeType,
          gestureCheck: Boolean(msg.gestureCheck),
          text: msg.text,
          mode: msg.mode,
        };
        if (!liveSession) {
          if (pendingMessages.length < 30) {
            pendingMessages.push(payload);
          }
          return;
        }
        forwardToLive(payload);
      } catch {
        // Ignore malformed client frames
      }
    });

    clientWs.on('close', () => {
      closed = true;
      if (liveSession) {
        activeLiveSessions.delete(liveSession);
      }
      try {
        liveSession?.close();
      } catch {
        // Ignore close errors
      }
    });

    const connectLive = async (
      toolsConfig: typeof LUNA_TOOLS | typeof LUNA_FUNCTION_TOOLS
    ) => {
      const ai = getAiClient('v1beta');
      return ai.live.connect({
        model: GEMINI_MODELS.LIVE,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          realtimeInputConfig: {
            automaticActivityDetection: {
              startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
              endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
              prefixPaddingMs: 100,
              silenceDurationMs: 360,
            },
          },
          contextWindowCompression: {
            slidingWindow: {},
          },
          sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [{ text: buildInstructions(factsAsText(), mood, mode) }],
          },
          tools: toolsConfig,
        },
        callbacks: {
          onopen: () => {
            safeSend({
              type: 'ready',
              voiceName,
              mood,
              resumed: Boolean(resumeHandle),
            });
          },
          onmessage: async (message: LiveServerMessage) => {
            if (
              message.sessionResumptionUpdate?.resumable &&
              message.sessionResumptionUpdate.newHandle
            ) {
              safeSend({
                type: 'session_handle',
                handle: message.sessionResumptionUpdate.newHandle,
              });
            }

            if (message.goAway) {
              safeSend({
                type: 'go_away',
                timeLeft: message.goAway.timeLeft ?? '',
              });
            }

            const content = message.serverContent;

            if (content?.inputTranscription?.text) {
              safeSend({
                type: 'input_transcript',
                text: content.inputTranscription.text,
              });
            }
            if (content?.outputTranscription?.text) {
              safeSend({
                type: 'output_transcript',
                text: content.outputTranscription.text,
              });
            }

            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                safeSend({
                  type: 'audio',
                  data: part.inlineData.data,
                });
              }
            }

            if (content?.interrupted) {
              safeSend({ type: 'interrupted' });
            }

            if (content?.turnComplete) {
              safeSend({ type: 'turn_complete' });
            }

            const calls = message.toolCall?.functionCalls;
            if (calls && calls.length > 0 && liveSession) {
              const responses = [];
              for (const call of calls) {
                const name = call.name ?? '';
                const args = (call.args ?? {}) as Record<string, unknown>;
                const result = await safeExecuteTool(name, args);
                safeSend({
                  type: 'tool_event',
                  name,
                  args,
                  result,
                });
                responses.push({
                  id: call.id,
                  name,
                  response: { result },
                });
              }
              try {
                liveSession.sendToolResponse({
                  functionResponses: responses,
                });
              } catch (err) {
                console.error(
                  'sendToolResponse error:',
                  err instanceof Error ? err.message : String(err)
                );
              }
            }
          },
          onerror: (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('Live session error:', msg);
            safeSend({ type: 'error', error: msg });
          },
          onclose: () => {
            safeSend({ type: 'closed' });
          },
        },
      });
    };

    try {
      try {
        liveSession = await connectLive(LUNA_TOOLS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
          liveSession = await connectLive(LUNA_FUNCTION_TOOLS);
        } else {
          throw err;
        }
      }

      if (closed) {
        liveSession.close();
        return;
      }

      activeLiveSessions.add(liveSession);

      while (pendingMessages.length > 0) {
        const queued = pendingMessages.shift();
        if (queued) forwardToLive(queued);
      }

      if (!resumeHandle) {
        liveSession.sendClientContent({
          turns: [
            {
              role: 'user',
              parts: [
                {
                  text: getGreetingPrompt(mode),
                },
              ],
            },
          ],
          turnComplete: true,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Live API connection error:', msg);
      safeSend({ type: 'error', error: msg });
      clientWs.close();
      return;
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: { server },
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Luna Voice Agent listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
