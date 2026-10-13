import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SRS,
  applyReview,
  emptyProgress,
  forecast,
  lessonQueue,
  nextAvailableAt,
  refreshUnlocks,
  reviewQueue,
  reviewedStage,
  startAssignment,
} from './engine';
import type { WkContent, WkProgress, WkSubject } from './types';

const HOUR = 3600_000;
const sys = DEFAULT_SRS[1];

const subj = (id: number, object: WkSubject['object'], level: number, comps: number[] = [], pos = id): WkSubject => ({
  id,
  object,
  data: {
    characters: String(id),
    level,
    slug: String(id),
    lesson_position: pos,
    hidden_at: null,
    meanings: [{ meaning: `m${id}`, primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
    meaning_mnemonic: '',
    component_subject_ids: comps,
    spaced_repetition_system_id: 1,
  },
});

const content = (subjects: WkSubject[], maxLevelGranted = 60): WkContent => ({
  version: 1,
  subjects: Object.fromEntries(subjects.map((s) => [s.id, s])),
  srsSystems: {},
  maxLevelGranted,
});

const pass = (p: WkProgress, ids: number[]): WkProgress => {
  const assignments = { ...p.assignments };
  for (const id of ids) assignments[id] = { subjectId: id, stage: 5, passedAt: 1, availableAt: 0 };
  return { ...p, assignments };
};

describe('SRS timing', () => {
  it('rounds the next review down to the top of the hour', () => {
    const t = Date.UTC(2026, 0, 1, 15, 31);
    expect(nextAvailableAt(sys, 2, t)).toBe(Date.UTC(2026, 0, 1, 23, 0));
  });

  it('moves up one stage when perfect and burns at 9', () => {
    expect(reviewedStage(sys, 1, 0)).toBe(2);
    const burned = applyReview(sys, { subjectId: 1, stage: 8 }, 0, 0, 0);
    expect(burned.stage).toBe(9);
    expect(burned.burnedAt).toBe(0);
    expect(burned.availableAt).toBeUndefined();
  });

  it('drops by ceil(wrong/2), doubled from Guru up, never below Apprentice 1', () => {
    expect(reviewedStage(sys, 4, 1)).toBe(3);
    expect(reviewedStage(sys, 4, 3)).toBe(2);
    expect(reviewedStage(sys, 6, 1)).toBe(4);
    expect(reviewedStage(sys, 8, 3)).toBe(4);
    expect(reviewedStage(sys, 2, 9)).toBe(1);
  });

  it('records passedAt the first time Guru is reached', () => {
    const a = applyReview(sys, { subjectId: 1, stage: 4 }, 0, 0, 123);
    expect(a.passedAt).toBe(123);
    expect(applyReview(sys, { ...a, stage: 5 }, 2, 0, 999).passedAt).toBe(123);
  });

  it('starting a lesson puts the item at Apprentice 1 four hours out', () => {
    const a = startAssignment(sys, { subjectId: 1, stage: 0 }, 10 * HOUR + 5);
    expect(a.stage).toBe(1);
    expect(a.availableAt).toBe(14 * HOUR);
  });
});

describe('unlocks and levels', () => {
  const radical = subj(1, 'radical', 1);
  const radical2 = subj(2, 'radical', 1);
  const kanjiA = subj(10, 'kanji', 1, [1]);
  const kanjiB = subj(11, 'kanji', 1, [1, 2]);
  const vocab = subj(20, 'vocabulary', 1, [10]);
  const kana = subj(30, 'kana_vocabulary', 1);
  const lvl2Radical = subj(40, 'radical', 2);
  const c = content([radical, radical2, kanjiA, kanjiB, vocab, kana, lvl2Radical]);

  it('unlocks radicals and kana vocab of the current level only', () => {
    const p = refreshUnlocks(c, emptyProgress(), 0);
    expect(Object.keys(p.assignments).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 30]);
    expect(lessonQueue(c, p).map((s) => s.id)).toEqual([1, 2, 30]);
  });

  it('unlocks kanji once all radicals pass, vocab once its kanji pass', () => {
    let p = refreshUnlocks(c, pass(emptyProgress(), [1]), 0);
    expect(p.assignments[10]?.stage).toBe(0);
    expect(p.assignments[11]).toBeUndefined();
    p = refreshUnlocks(c, pass(p, [10]), 0);
    expect(p.assignments[20]?.stage).toBe(0);
  });

  it('levels up at 90 % of current-level kanji passed, unlocking the next level', () => {
    const p = refreshUnlocks(c, pass(emptyProgress(), [1, 2, 10, 11]), 5);
    expect(p.level).toBe(2);
    expect(p.levelStartedAt[2]).toBe(5);
    expect(p.assignments[40]?.stage).toBe(0);
  });

  it('respects the subscription level cap', () => {
    const p = refreshUnlocks(content([radical, kanjiA, lvl2Radical], 1), pass(emptyProgress(), [1, 10]), 0);
    expect(p.level).toBe(1);
    expect(p.assignments[40]).toBeUndefined();
  });

  it('is a no-op when nothing changes', () => {
    const p = refreshUnlocks(c, emptyProgress(), 0);
    expect(refreshUnlocks(c, p, 1)).toBe(p);
  });
});

describe('queues', () => {
  it('lists due reviews and an hourly forecast', () => {
    const c = content([subj(1, 'radical', 1), subj(2, 'radical', 1), subj(3, 'radical', 1)]);
    const p: WkProgress = {
      ...emptyProgress(),
      assignments: {
        1: { subjectId: 1, stage: 2, availableAt: 0 },
        2: { subjectId: 2, stage: 3, availableAt: 2 * HOUR },
        3: { subjectId: 3, stage: 9, burnedAt: 0 },
      },
    };
    expect(reviewQueue(c, p, HOUR).map((s) => s.id)).toEqual([1]);
    const f = forecast(p, HOUR + 1, 3);
    expect(f[0]).toMatchObject({ at: 2 * HOUR, count: 1, cumulative: 1 });
  });
});
