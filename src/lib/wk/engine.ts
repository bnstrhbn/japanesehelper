import type { QuestionKind, WkAssignment, WkContent, WkItemStats, WkProgress, WkSrsSystem, WkSubject } from './types';

const HOUR = 60 * 60 * 1000;
const UNIT_MS: Record<string, number> = { milliseconds: 1, seconds: 1000, minutes: 60_000, hours: HOUR, days: 24 * HOUR, weeks: 7 * 24 * HOUR };

const stages = (intervalsSec: number[]) => [
  { position: 0, interval: null, interval_unit: null },
  ...intervalsSec.map((interval, i) => ({ position: i + 1, interval, interval_unit: 'seconds' })),
  { position: intervalsSec.length + 1, interval: null, interval_unit: null },
];

/** WaniKani's published systems; used until the API copies have been synced. */
export const DEFAULT_SRS: Record<number, WkSrsSystem> = {
  1: {
    id: 1,
    name: 'Default system for dictionary subjects',
    unlocking_stage_position: 0,
    starting_stage_position: 1,
    passing_stage_position: 5,
    burning_stage_position: 9,
    stages: stages([14400, 28800, 82800, 169200, 601200, 1206000, 2588400, 10364400]),
  },
  2: {
    id: 2,
    name: 'Default system for kanji and radicals',
    unlocking_stage_position: 0,
    starting_stage_position: 1,
    passing_stage_position: 5,
    burning_stage_position: 9,
    stages: stages([14400, 28800, 82800, 169200, 601200, 1206000, 2588400, 10364400]),
  },
  3: {
    id: 3,
    name: 'Accelerated system for dictionary subjects',
    unlocking_stage_position: 0,
    starting_stage_position: 1,
    passing_stage_position: 5,
    burning_stage_position: 9,
    stages: stages([7200, 14400, 28800, 82800, 601200, 1206000, 2588400, 10364400]),
  },
  4: {
    id: 4,
    name: 'Accelerated system for kanji and radicals',
    unlocking_stage_position: 0,
    starting_stage_position: 1,
    passing_stage_position: 5,
    burning_stage_position: 9,
    stages: stages([7200, 14400, 28800, 82800, 601200, 1206000, 2588400, 10364400]),
  },
};

export const emptyProgress = (): WkProgress => ({
  version: 1,
  level: 1,
  levelStartedAt: {},
  assignments: {},
  stats: {},
  notes: {},
  settings: { lessonBatchSize: 5, maxLevel: 60, autoplayAudio: true, voice: 'female' },
});

export const srsFor = (content: WkContent, s: WkSubject): WkSrsSystem =>
  content.srsSystems[s.data.spaced_repetition_system_id] ?? DEFAULT_SRS[s.data.spaced_repetition_system_id] ?? DEFAULT_SRS[1];

export const stageName = (stage: number): string => {
  if (stage <= 0) return 'Lesson';
  if (stage <= 4) return `Apprentice ${stage}`;
  if (stage <= 6) return `Guru ${stage - 4}`;
  if (stage === 7) return 'Master';
  if (stage === 8) return 'Enlightened';
  return 'Burned';
};

export type StageGroup = 'apprentice' | 'guru' | 'master' | 'enlightened' | 'burned';
export const stageGroup = (stage: number): StageGroup | null =>
  stage <= 0 ? null : stage <= 4 ? 'apprentice' : stage <= 6 ? 'guru' : stage === 7 ? 'master' : stage === 8 ? 'enlightened' : 'burned';

/** next review = now + stage interval, rounded down to the top of the hour (WaniKani behaviour). */
export const nextAvailableAt = (sys: WkSrsSystem, stage: number, now: number): number | undefined => {
  const st = sys.stages.find((s) => s.position === stage);
  if (!st || st.interval == null) return undefined;
  const at = now + st.interval * (UNIT_MS[st.interval_unit ?? 'seconds'] ?? 1000);
  return Math.floor(at / HOUR) * HOUR;
};

export const isPassed = (a: WkAssignment | undefined, sys: WkSrsSystem = DEFAULT_SRS[1]): boolean =>
  !!a && (a.passedAt != null || a.stage >= sys.passing_stage_position);

export const questionsFor = (s: WkSubject): QuestionKind[] =>
  s.object === 'kanji' || s.object === 'vocabulary' ? ['meaning', 'reading'] : ['meaning'];

/** SRS stage after a review: up one when perfect, otherwise down by ceil(wrong/2) × (2 if ≥ passing). */
export const reviewedStage = (sys: WkSrsSystem, stage: number, incorrect: number): number => {
  if (incorrect <= 0) return Math.min(stage + 1, sys.burning_stage_position);
  const factor = stage >= sys.passing_stage_position ? 2 : 1;
  return Math.max(sys.starting_stage_position, stage - Math.ceil(incorrect / 2) * factor);
};

export const applyReview = (
  sys: WkSrsSystem,
  a: WkAssignment,
  incorrectMeaning: number,
  incorrectReading: number,
  now: number,
): WkAssignment => {
  const stage = reviewedStage(sys, a.stage, incorrectMeaning + incorrectReading);
  const burned = stage >= sys.burning_stage_position;
  return {
    ...a,
    stage,
    passedAt: a.passedAt ?? (stage >= sys.passing_stage_position ? now : undefined),
    burnedAt: burned ? now : a.burnedAt,
    availableAt: burned ? undefined : nextAvailableAt(sys, stage, now),
  };
};

export const startAssignment = (sys: WkSrsSystem, a: WkAssignment, now: number): WkAssignment => ({
  ...a,
  stage: sys.starting_stage_position,
  startedAt: now,
  availableAt: nextAvailableAt(sys, sys.starting_stage_position, now),
});

export const recordStats = (prev: WkItemStats | undefined, kind: QuestionKind, correct: boolean): WkItemStats => {
  const s = prev ?? { meaningCorrect: 0, meaningIncorrect: 0, readingCorrect: 0, readingIncorrect: 0 };
  if (kind === 'meaning') return correct ? { ...s, meaningCorrect: s.meaningCorrect + 1 } : { ...s, meaningIncorrect: s.meaningIncorrect + 1 };
  return correct ? { ...s, readingCorrect: s.readingCorrect + 1 } : { ...s, readingIncorrect: s.readingIncorrect + 1 };
};

export const effectiveMaxLevel = (content: WkContent, p: WkProgress): number =>
  Math.max(1, Math.min(60, p.settings.maxLevel, content.maxLevelGranted || 60));

export const subjectsByLevel = (content: WkContent): Map<number, WkSubject[]> => {
  const m = new Map<number, WkSubject[]>();
  for (const s of Object.values(content.subjects)) {
    const arr = m.get(s.data.level);
    if (arr) arr.push(s);
    else m.set(s.data.level, [s]);
  }
  const typeOrder = { radical: 0, kanji: 1, vocabulary: 2, kana_vocabulary: 2 } as const;
  for (const arr of m.values()) arr.sort((a, b) => typeOrder[a.object] - typeOrder[b.object] || a.data.lesson_position - b.data.lesson_position || a.id - b.id);
  return m;
};

export const levelKanjiProgress = (content: WkContent, p: WkProgress, level: number) => {
  const kanji = Object.values(content.subjects).filter((s) => s.data.level === level && s.object === 'kanji' && !s.data.hidden_at);
  const passed = kanji.filter((s) => isPassed(p.assignments[s.id], srsFor(content, s))).length;
  return { passed, total: kanji.length, needed: Math.ceil(kanji.length * 0.9) };
};

/**
 * Unlocks subjects whose prerequisites are passed and advances the level when ≥ 90 % of the
 * current level's kanji are passed (WaniKani's level-up rule). Returns the same object if nothing changed.
 */
export const refreshUnlocks = (content: WkContent, p: WkProgress, now: number): WkProgress => {
  const maxLevel = effectiveMaxLevel(content, p);
  let assignments = p.assignments;
  let level = Math.min(p.level, maxLevel);
  let levelStartedAt = p.levelStartedAt;
  let changed = level !== p.level;
  const all = Object.values(content.subjects);

  for (;;) {
    let unlocked = false;
    for (const s of all) {
      if (s.data.level > level || assignments[s.id] || s.data.hidden_at) continue;
      const comps = s.object === 'radical' || s.object === 'kana_vocabulary' ? [] : (s.data.component_subject_ids ?? []);
      const ready = comps.every((id) => {
        const c = content.subjects[id];
        if (!c || c.data.hidden_at) return true;
        return isPassed(assignments[id], srsFor(content, c));
      });
      if (!ready) continue;
      if (assignments === p.assignments) assignments = { ...assignments };
      assignments[s.id] = { subjectId: s.id, stage: 0, unlockedAt: now };
      unlocked = true;
    }
    changed ||= unlocked;

    const next = { ...p, assignments, level };
    const prog = levelKanjiProgress(content, next, level);
    if (level < maxLevel && prog.total > 0 && prog.passed >= prog.needed) {
      level += 1;
      levelStartedAt = { ...levelStartedAt, [level]: now };
      changed = true;
      continue;
    }
    if (!unlocked) break;
  }

  if (levelStartedAt[level] == null) {
    levelStartedAt = { ...levelStartedAt, [level]: now };
    changed = true;
  }
  return changed ? { ...p, assignments, level, levelStartedAt } : p;
};

export const lessonQueue = (content: WkContent, p: WkProgress): WkSubject[] => {
  const maxLevel = effectiveMaxLevel(content, p);
  const typeOrder = { radical: 0, kanji: 1, vocabulary: 2, kana_vocabulary: 2 } as const;
  return Object.values(p.assignments)
    .filter((a) => a.stage === 0 && a.startedAt == null)
    .map((a) => content.subjects[a.subjectId])
    .filter((s): s is WkSubject => !!s && !s.data.hidden_at && s.data.level <= maxLevel)
    .sort((a, b) => a.data.level - b.data.level || typeOrder[a.object] - typeOrder[b.object] || a.data.lesson_position - b.data.lesson_position || a.id - b.id);
};

export const reviewQueue = (content: WkContent, p: WkProgress, now: number): WkSubject[] =>
  Object.values(p.assignments)
    .filter((a) => a.stage > 0 && a.burnedAt == null && a.availableAt != null && a.availableAt <= now)
    .map((a) => content.subjects[a.subjectId])
    .filter((s): s is WkSubject => !!s && !s.data.hidden_at && (p.assignments[s.id]?.stage ?? 0) < srsFor(content, s).burning_stage_position);

export const forecast = (p: WkProgress, now: number, hours = 24): Array<{ at: number; count: number; cumulative: number }> => {
  const start = Math.floor(now / HOUR) * HOUR;
  const buckets = Array.from({ length: hours }, (_, i) => ({ at: start + (i + 1) * HOUR, count: 0, cumulative: 0 }));
  for (const a of Object.values(p.assignments)) {
    if (a.stage <= 0 || a.burnedAt != null || a.availableAt == null || a.availableAt <= now) continue;
    const idx = Math.floor((a.availableAt - start) / HOUR) - 1;
    if (idx >= 0 && idx < hours) buckets[idx].count += 1;
  }
  let running = 0;
  for (const b of buckets) b.cumulative = running += b.count;
  return buckets;
};

export const stageCounts = (p: WkProgress): Record<StageGroup, number> => {
  const out: Record<StageGroup, number> = { apprentice: 0, guru: 0, master: 0, enlightened: 0, burned: 0 };
  for (const a of Object.values(p.assignments)) {
    const g = stageGroup(a.burnedAt != null ? 9 : a.stage);
    if (g) out[g] += 1;
  }
  return out;
};

export const primaryMeaning = (s: WkSubject): string => s.data.meanings.find((m) => m.primary)?.meaning ?? s.data.meanings[0]?.meaning ?? '';
export const primaryReading = (s: WkSubject): string =>
  s.data.readings?.find((r) => r.primary)?.reading ?? s.data.readings?.[0]?.reading ?? (s.object === 'kana_vocabulary' ? s.data.characters ?? '' : '');
