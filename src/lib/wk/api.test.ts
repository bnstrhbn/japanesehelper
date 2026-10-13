import { describe, expect, it, vi } from 'vitest';
import { importProgress, syncContent } from './api';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const page = (data: unknown[], next: string | null = null) => ({ data, pages: { next_url: next } });

describe('syncContent', () => {
  it('follows pagination, keeps only study fields, and passes updated_after on refresh', async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith('/user')) return json({ data: { level: 3, subscription: { max_level_granted: 60 } } });
      if (u.includes('/subjects') && !u.includes('page=2'))
        return json(page([{ id: 1, object: 'radical', data: { characters: '一', level: 1, meanings: [], url: 'x', created_at: 'y' } }], 'https://api.wanikani.com/v2/subjects?page=2'));
      if (u.includes('page=2')) return json(page([{ id: 2, object: 'kanji', data: { characters: '二', level: 1, meanings: [] } }]));
      if (u.includes('spaced_repetition_systems')) return json(page([{ id: 1, data: { name: 'x', stages: [] } }]));
      throw new Error(u);
    }) as unknown as typeof fetch;

    const c = await syncContent('t', undefined, undefined, f);
    expect(Object.keys(c.subjects)).toEqual(['1', '2']);
    expect(c.subjects[1].data).not.toHaveProperty('created_at');
    expect(c.subjects[1].data.auxiliary_meanings).toEqual([]);
    expect(c.maxLevelGranted).toBe(60);
    expect(c.srsSystems[1].id).toBe(1);

    calls.length = 0;
    await syncContent('t', c, undefined, f);
    expect(calls.some((u) => u.includes('subjects?updated_after='))).toBe(true);
  });

  it('waits and retries on 429', async () => {
    vi.useFakeTimers();
    let n = 0;
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/user') && n++ === 0) return json({}, 429, { 'RateLimit-Reset': String(Math.floor(Date.now() / 1000)) });
      if (u.endsWith('/user')) return json({ data: { level: 1 } });
      return json(page([]));
    }) as unknown as typeof fetch;
    const p = syncContent('t', undefined, undefined, f);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toMatchObject({ maxLevelGranted: 3 });
    vi.useRealTimers();
  });
});

describe('importProgress', () => {
  it('maps assignments, stats, notes and level, keeping local settings', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/user')) return json({ data: { level: 7 } });
      if (u.endsWith('/assignments'))
        return json(page([
          { data: { subject_id: 5, srs_stage: 6, unlocked_at: '2026-01-01T00:00:00Z', started_at: null, passed_at: '2026-01-02T00:00:00Z', burned_at: null, available_at: '2026-02-01T00:00:00Z' } },
          { data: { subject_id: 6, srs_stage: 1, hidden: true, unlocked_at: null, started_at: null, passed_at: null, burned_at: null, available_at: null } },
        ]));
      if (u.endsWith('/review_statistics')) return json(page([{ data: { subject_id: 5, meaning_correct: 4, meaning_incorrect: 1, reading_correct: 3, reading_incorrect: 2 } }]));
      if (u.endsWith('/study_materials')) return json(page([{ data: { subject_id: 5, meaning_note: 'n', reading_note: null, meaning_synonyms: ['alt'] } }]));
      if (u.endsWith('/level_progressions')) return json(page([{ data: { level: 7, unlocked_at: '2026-03-01T00:00:00Z', started_at: null, abandoned_at: null } }]));
      throw new Error(u);
    }) as unknown as typeof fetch;

    const cur = { settings: { lessonBatchSize: 10, maxLevel: 60, autoplayAudio: false, voice: 'male' as const } } as never;
    const p = await importProgress('t', cur, undefined, f);
    expect(p.level).toBe(7);
    expect(p.assignments[5]).toMatchObject({ stage: 6, passedAt: Date.parse('2026-01-02T00:00:00Z') });
    expect(p.assignments[6]).toBeUndefined();
    expect(p.stats[5].readingIncorrect).toBe(2);
    expect(p.notes[5]).toEqual({ meaningNote: 'n', synonyms: ['alt'] });
    expect(p.levelStartedAt[7]).toBe(Date.parse('2026-03-01T00:00:00Z'));
    expect(p.settings.lessonBatchSize).toBe(10);
  });
});
