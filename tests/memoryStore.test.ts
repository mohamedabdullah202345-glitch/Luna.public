import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  addCallSummary,
  addFact,
  closeDb,
  deleteFactAtIndex,
  factsAsText,
  forgetFact,
  getDb,
  getRecentCallSummaries,
  loadFacts,
} from '../server/memoryStore.ts';
import { getCairoTimeInfo } from '../server/lunaPrompt.ts';

let tempDir = '';

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-test-'));
  process.env.LUNA_DB_PATH = path.join(tempDir, 'luna.db');
  closeDb();
  getDb();
});

afterEach(() => {
  closeDb();
  delete process.env.LUNA_DB_PATH;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('memoryStore SQLite & safety rules', () => {
  it('seeds initial facts on fresh database', () => {
    const facts = loadFacts();
    assert.equal(facts.length, 3);
    assert.ok(facts.some((f) => f.category === 'study'));
    assert.ok(facts.some((f) => f.category === 'goals'));
  });

  it('adds categorized facts and prevents case-insensitive duplicates', () => {
    const first = addFact('He loves drinking mint tea at night.', 'habits');
    const duplicate = addFact('he loves drinking mint tea at night.');
    assert.equal(first, true);
    assert.equal(duplicate, false);

    const saved = loadFacts().find((f) => f.fact.includes('mint tea'));
    assert.equal(saved?.category, 'habits');
  });

  it('refuses overly short forget queries to protect memories', () => {
    const res = forgetFact('he');
    assert.equal(res.deletedCount, 0);
    assert.equal(loadFacts().length, 3);
  });

  it('asks confirmation instead of wiping multiple matching facts', () => {
    addFact('He likes Python programming.', 'goals');
    addFact('He likes TypeScript programming.', 'goals');

    const firstTry = forgetFact('programming', false);
    assert.equal(firstTry.deletedCount, 0);
    assert.ok((firstTry.ambiguousCandidates?.length ?? 0) >= 2);

    const confirmedTry = forgetFact('Python programming', true);
    assert.equal(confirmedTry.deletedCount, 1);
    assert.ok(
      loadFacts().some((f) => f.fact.includes('TypeScript programming'))
    );
  });

  it('deletes a specific fact by index', () => {
    const before = loadFacts().length;
    assert.equal(deleteFactAtIndex(0), true);
    assert.equal(loadFacts().length, before - 1);
  });

  it('stores and renders recent call summaries in categorized prompt output', () => {
    addCallSummary(
      'Talked about soil science midterm prep and staying hydrated.',
      'cheerful'
    );
    const summaries = getRecentCallSummaries(3);
    assert.equal(summaries.length, 1);

    const promptText = factsAsText();
    assert.ok(promptText.includes('[Study]'));
    assert.ok(promptText.includes('[Recent Conversations]'));
    assert.ok(promptText.includes('soil science midterm prep'));
  });
});

describe('Cairo timezone prompt timing', () => {
  it('computes Africa/Cairo local hour accurately', () => {
    // 23:30 UTC == 01:30 Africa/Cairo (UTC+2 in November)
    const lateUtc = new Date('2026-11-12T23:30:00Z');
    const cairo = getCairoTimeInfo(lateUtc);
    assert.equal(cairo.hour, 1);
    assert.ok(cairo.partOfDay.includes('very late at night'));
  });
});
