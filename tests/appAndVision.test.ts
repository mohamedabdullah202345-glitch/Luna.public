import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { normalizeVoice } from '../server/config.ts';
import {
  buildInstructions,
  getGreetingPrompt,
  getModeSwitchNote,
  normalizeMode,
} from '../server/lunaPrompt.ts';
import { closeDb, getDb } from '../server/memoryStore.ts';
import {
  completeTask,
  createTask,
  deleteTask,
  getTasks,
  toggleTask,
} from '../server/tasksStore.ts';
import {
  analyzeMotionZones,
  MOTION_HEIGHT,
  MOTION_WIDTH,
} from '../src/lib/visionMotion.ts';

let tempDir = '';

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-suite-'));
  process.env.LUNA_DB_PATH = path.join(tempDir, 'luna.db');
  closeDb();
  getDb();
});

afterEach(() => {
  closeDb();
  delete process.env.LUNA_DB_PATH;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('visionMotion zone gesture detector', () => {
  const frameSize = MOTION_WIDTH * MOTION_HEIGHT;

  it('ignores idle stillness and tiny camera sensor noise', () => {
    const prev = new Uint8Array(frameSize).fill(100);
    const curr = new Uint8Array(frameSize).fill(102);
    const res = analyzeMotionZones(prev, curr);
    assert.equal(res.isGestureMotion, false);
  });

  it('detects subtle localized hand-near-mouth gestures (e.g. blowing a kiss)', () => {
    const prev = new Uint8Array(frameSize).fill(90);
    const curr = new Uint8Array(frameSize).fill(90);
    // Simulate a hand moving in a 10x10 patch in the middle face/mouth region
    for (let y = 14; y < 24; y++) {
      for (let x = 18; x < 28; x++) {
        curr[y * MOTION_WIDTH + x] = 175;
      }
    }
    const res = analyzeMotionZones(prev, curr);
    assert.ok(res.globalScore < 0.042, 'global frame change should remain subtle');
    assert.ok(res.peakZoneScore >= 0.068, 'localized zone delta should spike');
    assert.equal(res.isGestureMotion, true);
  });

  it('filters out sudden full-frame exposure or room light flashes', () => {
    const prev = new Uint8Array(frameSize).fill(40);
    const curr = new Uint8Array(frameSize).fill(210);
    const res = analyzeMotionZones(prev, curr);
    assert.ok(res.globalScore > 0.38);
    assert.equal(res.isGestureMotion, false);
  });
});

describe('Luna modes, sound/camera prompt rules & voice config', () => {
  it('normalizes valid modes and defaults safely', () => {
    assert.equal(normalizeMode('coach'), 'coach');
    assert.equal(normalizeMode('STUDY'), 'study');
    assert.equal(normalizeMode('night'), 'night');
    assert.equal(normalizeMode('unknown'), 'natural');
  });

  it('builds distinct greeting and mid-call switch prompts for all modes', () => {
    const coachGreeting = getGreetingPrompt('coach');
    const studyGreeting = getGreetingPrompt('study');
    assert.ok(coachGreeting.toLowerCase().includes('english'));
    assert.ok(studyGreeting.toLowerCase().includes('study'));
    assert.ok(getModeSwitchNote('coach').includes('English Coach'));
    assert.ok(getModeSwitchNote('study').includes('Study Buddy'));
  });

  it('includes natural audio/visual fusion instructions without robotic phrasing', () => {
    const instructions = buildInstructions('- He studies at Ain Shams.', 'warm', 'coach');
    assert.ok(instructions.includes('blowing a kiss'));
    assert.ok(instructions.includes('Never say mechanical phrases like "I heard a sound"'));
    assert.ok(instructions.includes('Ain Shams'));
  });

  it('normalizes supported voices safely', () => {
    assert.equal(normalizeVoice('Aoede'), 'Aoede');
    assert.equal(normalizeVoice('InvalidVoice'), 'Sulafat');
  });
});

describe('tasksStore SQLite CRUD lifecycle', () => {
  it('creates, toggles, completes, and deletes tasks reliably', async () => {
    const created = await createTask('Debug Python gesture detector', '2026-11-15');
    assert.ok(created);
    assert.equal(created.done, false);

    let all = await getTasks();
    assert.ok(all.some((t) => t.id === created.id));

    const toggled = await toggleTask(created.id);
    assert.equal(toggled.toggled, true);
    assert.equal(toggled.done, true);

    const toggledBack = await toggleTask(created.id);
    assert.equal(toggledBack.done, false);

    const completed = await completeTask('Python gesture');
    assert.equal(completed.completed, true);

    const deleted = await deleteTask(created.id);
    assert.equal(deleted.deleted, true);

    all = await getTasks();
    assert.equal(all.some((t) => t.id === created.id), false);
  });
});
