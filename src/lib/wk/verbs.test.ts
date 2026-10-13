import { describe, expect, it, vi } from 'vitest';
import { emptyProgress } from './engine';
import { loadReachedVerbs, reachedLevel } from './verbs';
import type { WkContent, WkSubject } from './types';

const verb = (id: number, level: number, pos = ['godan verb']): WkSubject => ({
  id,
  object: 'vocabulary',
  data: {
    characters: `v${id}`, level, slug: '', lesson_position: 0, hidden_at: null, meanings: [], auxiliary_meanings: [],
    meaning_mnemonic: '', parts_of_speech: pos, spaced_repetition_system_id: 1,
  },
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('reachedLevel', () => {
  it('uses the higher of the WaniKani and local levels, within the subscription cap', () => {
    expect(reachedLevel(14, { ...emptyProgress(), level: 9 }, 60)).toBe(14);
    expect(reachedLevel(14, { ...emptyProgress(), level: 22 }, 60)).toBe(22);
    expect(reachedLevel(14, undefined, 3)).toBe(3);
  });
});

describe('loadReachedVerbs', () => {
  it('reads verbs above level 6 from local content up to the reached level', async () => {
    const content: WkContent = {
      version: 1, maxLevelGranted: 60, srsSystems: {},
      subjects: { 1: verb(1, 2), 2: verb(2, 12), 3: verb(3, 30), 4: verb(4, 5, ['noun']) },
    };
    const f = vi.fn(async () => json({ data: { level: 12, subscription: { max_level_granted: 60 } } })) as unknown as typeof fetch;
    const r = await loadReachedVerbs('t', f, { content, progress: undefined });
    expect(r).toMatchObject({ level: 12, source: 'local' });
    expect(r.verbs.map((s) => s.id)).toEqual([1, 2]);
  });

  it('works offline from local content when the API is unreachable', async () => {
    const content: WkContent = { version: 1, maxLevelGranted: 60, srsSystems: {}, subjects: { 1: verb(1, 20) } };
    const f = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const r = await loadReachedVerbs('t', f, { content, progress: { ...emptyProgress(), level: 25 } });
    expect(r.verbs.map((s) => s.id)).toEqual([1]);
  });

  it('fetches every reached level from the API when no content is downloaded', async () => {
    const urls: string[] = [];
    const f = vi.fn(async (u: string | URL | Request) => {
      urls.push(String(u));
      if (String(u).endsWith('/user')) return json({ data: { level: 9 } });
      return json({ data: [verb(5, 8), verb(6, 8, ['noun'])], pages: { next_url: null } });
    }) as unknown as typeof fetch;
    const r = await loadReachedVerbs('t', f, {});
    expect(r).toMatchObject({ level: 9, source: 'api' });
    expect(urls[1]).toContain('levels=1,2,3,4,5,6,7,8,9');
    expect(r.verbs.map((s) => s.id)).toEqual([5]);
  });
});
