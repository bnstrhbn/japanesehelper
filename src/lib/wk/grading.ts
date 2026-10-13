import { toHiragana } from 'wanakana';
import type { QuestionKind, WkNotes, WkSubject } from './types';

export type GradeResult =
  | { status: 'correct'; close?: boolean; matched: string }
  | { status: 'incorrect' }
  | { status: 'retry'; message: string };

const normalizeMeaning = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Edit distance where an adjacent transposition ("adlut") counts as one edit. */
export const editDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
};

/** WaniKani-style typo tolerance by answer length. */
export const typoTolerance = (len: number): number => (len <= 3 ? 0 : len <= 5 ? 1 : len <= 7 ? 2 : 2 + Math.floor(len / 7));

const hasJapanese = (s: string) => /[\u3040-\u30ff\u4e00-\u9faf]/.test(s);

export const acceptedMeanings = (s: WkSubject, notes?: WkNotes): string[] => [
  ...s.data.meanings.filter((m) => m.accepted_answer).map((m) => m.meaning),
  ...s.data.auxiliary_meanings.filter((m) => m.type === 'whitelist').map((m) => m.meaning),
  ...(notes?.synonyms ?? []),
];

export const gradeMeaning = (s: WkSubject, input: string, notes?: WkNotes): GradeResult => {
  if (hasJapanese(input)) return { status: 'retry', message: 'We want the English meaning, not the reading.' };
  const u = normalizeMeaning(input);
  if (!u) return { status: 'retry', message: 'Type an answer first.' };
  const accepted = acceptedMeanings(s, notes).map((m) => [m, normalizeMeaning(m)] as const);
  const blocked = s.data.auxiliary_meanings.filter((m) => m.type === 'blacklist').map((m) => normalizeMeaning(m.meaning));
  const exact = accepted.find(([, n]) => n === u);
  if (exact) return { status: 'correct', matched: exact[0] };
  if (blocked.includes(u)) return { status: 'incorrect' };

  let best: { m: string; d: number } | null = null;
  for (const [m, n] of accepted) {
    const d = editDistance(u, n);
    if (d <= typoTolerance(n.length) && (!best || d < best.d)) best = { m, d };
  }
  if (!best) return { status: 'incorrect' };
  const nearBlocked = blocked.some((b) => editDistance(u, b) <= best!.d);
  return nearBlocked ? { status: 'incorrect' } : { status: 'correct', close: true, matched: best.m };
};

export const kanaAnswer = (input: string): string => {
  const t = input.trim().replace(/\s+/g, '');
  const fixedN = /n$/i.test(t) && !/nn$/i.test(t) ? `${t.slice(0, -1)}ん` : t;
  return toHiragana(fixedN);
};

const READING_NAME = { onyomi: "on'yomi", kunyomi: "kun'yomi", nanori: 'nanori' } as const;

export const gradeReading = (s: WkSubject, input: string): GradeResult => {
  const u = kanaAnswer(input);
  if (!u) return { status: 'retry', message: 'Type an answer first.' };
  if (/[a-z]/i.test(u)) return { status: 'retry', message: 'Readings must be typed in kana.' };
  const readings = s.data.readings ?? [];
  const hit = readings.find((r) => r.accepted_answer && toHiragana(r.reading) === u);
  if (hit) return { status: 'correct', matched: hit.reading };
  const other = readings.find((r) => !r.accepted_answer && toHiragana(r.reading) === u);
  if (other && s.object === 'kanji') {
    const want = readings.find((r) => r.accepted_answer)?.type;
    return { status: 'retry', message: `That's a valid reading, but we're looking for the ${want ? READING_NAME[want] : 'other'} reading.` };
  }
  return { status: 'incorrect' };
};

export const grade = (s: WkSubject, kind: QuestionKind, input: string, notes?: WkNotes): GradeResult =>
  kind === 'meaning' ? gradeMeaning(s, input, notes) : gradeReading(s, input);
