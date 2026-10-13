import type { WkAssignment, WkContent, WkNotes, WkProgress, WkSrsSystem, WkSubject } from './types';
import { emptyProgress } from './engine';

const BASE = 'https://api.wanikani.com/v2';

type Fetch = typeof fetch;
type Resource<T> = { id: number; object: string; data_updated_at?: string; data: T };
type Collection<T> = { data: Resource<T>[]; pages?: { next_url?: string | null }; data_updated_at?: string | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const wkGet = async <T>(token: string, url: string, f: Fetch = fetch): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    const res = await f(url.startsWith('http') ? url : `${BASE}/${url}`, {
      headers: { Authorization: `Bearer ${token}`, 'Wanikani-Revision': '20170710' },
    });
    if (res.status === 429 && attempt < 5) {
      const reset = Number(res.headers.get('RateLimit-Reset'));
      const wait = reset ? Math.max(1000, reset * 1000 - Date.now() + 500) : 10_000;
      await sleep(Math.min(wait, 65_000));
      continue;
    }
    if (!res.ok) throw new Error(res.status === 401 ? 'Unauthorized (bad/expired WaniKani token).' : `WaniKani error: ${res.status}`);
    return (await res.json()) as T;
  }
};

export const wkGetAll = async <T>(
  token: string,
  path: string,
  f: Fetch = fetch,
  onPage?: (n: number) => void,
): Promise<Resource<T>[]> => {
  const out: Resource<T>[] = [];
  let next: string | null = path;
  while (next) {
    const body: Collection<T> = await wkGet<Collection<T>>(token, next, f);
    out.push(...(body.data ?? []));
    onPage?.(out.length);
    next = body.pages?.next_url ?? null;
  }
  return out;
};

type WkUser = { level: number; subscription?: { max_level_granted?: number } };

const SUBJECT_KEYS = [
  'characters', 'level', 'slug', 'lesson_position', 'hidden_at', 'document_url', 'meanings', 'auxiliary_meanings',
  'meaning_mnemonic', 'meaning_hint', 'readings', 'reading_mnemonic', 'reading_hint', 'component_subject_ids',
  'amalgamation_subject_ids', 'visually_similar_subject_ids', 'context_sentences', 'parts_of_speech',
  'pronunciation_audios', 'character_images', 'spaced_repetition_system_id',
] as const;

const slimSubject = (r: Resource<Record<string, unknown>>): WkSubject => {
  const data: Record<string, unknown> = {};
  for (const k of SUBJECT_KEYS) if (r.data[k] !== undefined) data[k] = r.data[k];
  if (Array.isArray(data.character_images)) {
    data.character_images = (data.character_images as Array<{ content_type: string }>).filter((i) => i.content_type === 'image/svg+xml');
  }
  if (!Array.isArray(data.auxiliary_meanings)) data.auxiliary_meanings = [];
  return { id: r.id, object: r.object as WkSubject['object'], data_updated_at: r.data_updated_at, data: data as WkSubject['data'] };
};

/** Downloads (or incrementally refreshes) every subject + SRS system into a local content snapshot. */
export const syncContent = async (
  token: string,
  prev: WkContent | undefined,
  onProgress?: (msg: string) => void,
  f: Fetch = fetch,
): Promise<WkContent> => {
  const startedAt = new Date().toISOString();
  const user = await wkGet<{ data: WkUser }>(token, 'user', f);
  const since = prev?.syncedAt && Object.keys(prev.subjects).length ? `?updated_after=${encodeURIComponent(prev.syncedAt)}` : '';
  const subjects: Record<number, WkSubject> = { ...(prev?.subjects ?? {}) };
  const raw = await wkGetAll<Record<string, unknown>>(token, `subjects${since}`, f, (n) => onProgress?.(`Subjects: ${n}…`));
  for (const r of raw) subjects[r.id] = slimSubject(r);

  const systems = await wkGetAll<Omit<WkSrsSystem, 'id'>>(token, 'spaced_repetition_systems', f);
  const srsSystems: Record<number, WkSrsSystem> = {};
  for (const s of systems) srsSystems[s.id] = { ...s.data, id: s.id };

  const radicalSvgs: Record<number, string> = { ...(prev?.radicalSvgs ?? {}) };
  const imageOnly = Object.values(subjects).filter((s) => s.object === 'radical' && !s.data.characters && !radicalSvgs[s.id]);
  for (const s of imageOnly) {
    const url = s.data.character_images?.[0]?.url;
    if (!url) continue;
    try {
      const res = await f(url);
      if (res.ok) radicalSvgs[s.id] = await res.text();
    } catch {
      // the <img> fallback still works online
    }
  }
  onProgress?.(`Synced ${raw.length} changed subject(s).`);
  return {
    version: 1,
    syncedAt: startedAt,
    subjects,
    srsSystems,
    maxLevelGranted: user.data.subscription?.max_level_granted ?? prev?.maxLevelGranted ?? 3,
    radicalSvgs,
  };
};

const ts = (s: unknown): number | undefined => (typeof s === 'string' && s ? Date.parse(s) : undefined);

type RawAssignment = {
  subject_id: number;
  srs_stage: number;
  unlocked_at: string | null;
  started_at: string | null;
  passed_at: string | null;
  burned_at: string | null;
  available_at: string | null;
  hidden?: boolean;
};
type RawStat = { subject_id: number; meaning_correct: number; meaning_incorrect: number; reading_correct: number; reading_incorrect: number };
type RawStudy = { subject_id: number; meaning_note: string | null; reading_note: string | null; meaning_synonyms: string[] };
type RawLevelProgression = { level: number; unlocked_at: string | null; started_at: string | null; abandoned_at: string | null };

/** Snapshot of the user's WaniKani progress (assignments, stats, notes, level) as local progress. */
export const importProgress = async (
  token: string,
  current: WkProgress | undefined,
  onProgress?: (msg: string) => void,
  f: Fetch = fetch,
): Promise<WkProgress> => {
  const user = await wkGet<{ data: WkUser }>(token, 'user', f);
  const rawA = await wkGetAll<RawAssignment>(token, 'assignments', f, (n) => onProgress?.(`Assignments: ${n}…`));
  const rawS = await wkGetAll<RawStat>(token, 'review_statistics', f, (n) => onProgress?.(`Review stats: ${n}…`));
  const rawM = await wkGetAll<RawStudy>(token, 'study_materials', f);
  const rawL = await wkGetAll<RawLevelProgression>(token, 'level_progressions', f);

  const base = emptyProgress();
  const p: WkProgress = { ...base, settings: { ...base.settings, ...(current?.settings ?? {}) }, level: user.data.level, importedAt: Date.now() };
  for (const { data: a } of rawA) {
    if (a.hidden) continue;
    const asg: WkAssignment = {
      subjectId: a.subject_id,
      stage: a.srs_stage,
      unlockedAt: ts(a.unlocked_at),
      startedAt: ts(a.started_at),
      passedAt: ts(a.passed_at),
      burnedAt: ts(a.burned_at),
      availableAt: ts(a.available_at),
    };
    p.assignments[a.subject_id] = asg;
  }
  for (const { data: s } of rawS) {
    p.stats[s.subject_id] = {
      meaningCorrect: s.meaning_correct,
      meaningIncorrect: s.meaning_incorrect,
      readingCorrect: s.reading_correct,
      readingIncorrect: s.reading_incorrect,
    };
  }
  for (const { data: m } of rawM) {
    const n: WkNotes = {};
    if (m.meaning_note) n.meaningNote = m.meaning_note;
    if (m.reading_note) n.readingNote = m.reading_note;
    if (m.meaning_synonyms?.length) n.synonyms = m.meaning_synonyms;
    p.notes[m.subject_id] = n;
  }
  for (const { data: l } of rawL) {
    const t = ts(l.unlocked_at) ?? ts(l.started_at);
    if (t && !l.abandoned_at) p.levelStartedAt[l.level] = t;
  }
  return p;
};
