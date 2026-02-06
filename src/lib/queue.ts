import type { AppState, CardId, DeckId, VocabCategory } from './models';
import { defaultSrs } from './srs';
import { classifyVerb } from './seed';

const shuffled = <T>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const isVerbConjugationDeck = (state: AppState, deckId: DeckId): boolean => {
  const name = state.decks[deckId]?.name ?? '';
  return name.toLowerCase().includes('verb conjugation');
};

const looksLikeVerbBaseKana = (s: string): boolean => {
  const kana = (s ?? '').trim();
  if (!kana) return false;
  return kana.endsWith('る') || kana.endsWith('う') || kana.endsWith('く') || kana.endsWith('ぐ') || kana.endsWith('す') ||
    kana.endsWith('つ') || kana.endsWith('ぬ') || kana.endsWith('ぶ') || kana.endsWith('む');
};

const isKnownVerbForm = (form: string | undefined): boolean => {
  switch ((form ?? '').trim().toLowerCase()) {
    case 'dictionary':
    case 'polite_present':
    case 'polite_negative':
    case 'te':
    case 'progressive':
    case 'past':
    case 'negative':
    case 'past_negative':
    case 'want':
    case 'dont_want':
    case 'want_past':
    case 'dont_want_past':
      return true;
    default:
      return false;
  }
};

const isGeneratedVerbCard = (c: { type?: string; pos?: string; prompt?: string; verbBaseKana?: string; verbForm?: string } | undefined): boolean => {
  if (!c || c.type !== 'verb') return false;
  const baseKana = (c.verbBaseKana ?? '').trim();
  if (!baseKana) return false;
  if (!looksLikeVerbBaseKana(baseKana)) return false;
  if (!isKnownVerbForm(c.verbForm)) return false;
  const pos = (c.pos ?? '').toLowerCase();
  const cue = (c.prompt ?? '').trim().toLowerCase();
  return /\bverb\b/.test(pos) || cue.startsWith('to ');
};

export const isVocabOnlyDeck = (state: AppState, deckId: DeckId): boolean => {
  const deck = state.decks[deckId];
  if (!deck || deck.cardIds.length === 0) return false;
  return deck.cardIds.every((id) => state.cards[id]?.type === 'vocab');
};

export const vocabCategoryForPos = (posRaw: string | undefined): VocabCategory => {
  const pos = (posRaw ?? '').toLowerCase();
  if (/\badverb\b/.test(pos)) return 'adverb';
  if (/\bverb\b/.test(pos)) return 'verb';
  if (pos.includes('adjective')) return 'adjective';
  if (pos.includes('noun') || pos.includes('pronoun')) return 'noun';
  if (
    pos.includes('conjunction') ||
    pos.includes('particle') ||
    pos.includes('determiner') ||
    pos.includes('interjection') ||
    pos.includes('auxiliary') ||
    pos.includes('suffix') ||
    pos.includes('expression')
  ) {
    return 'connector';
  }
  return 'other';
};

export const defaultVocabPracticeCategories = (): Record<VocabCategory, boolean> => ({
  noun: true,
  verb: true,
  adjective: true,
  adverb: true,
  connector: true,
  other: true,
});

const getVocabPracticeFilteredIds = (state: AppState, deckId: DeckId, ids: CardId[]): CardId[] => {
  const filter = state.vocabPracticeFilters?.[deckId];
  if (!filter) return ids;

  const categories = filter.categories ?? defaultVocabPracticeCategories();
  const anyEnabled = Object.values(categories).some(Boolean);
  if (!anyEnabled) return [];

  return ids.filter((id) => {
    const c = state.cards[id];
    if (!c || c.type !== 'vocab') return true;
    const cat = vocabCategoryForPos(c.pos);
    return !!categories[cat];
  });
};

const verbBaseKey = (state: AppState, cardId: CardId): string => {
  const c = state.cards[cardId];
  const baseKana = (c?.verbBaseKana || c?.answer || '').trim();
  const baseKanji = (c?.verbBaseKanji || '').trim();
  const raw = `${baseKanji}||${baseKana}`.trim();
  return raw && raw !== '||' ? raw : cardId;
};

type VerbBaseEntry = {
  baseKey: string;
  baseKana: string;
  baseKanji?: string;
  cls: 'ichidan' | 'godan';
  ending: string;
};

const normalizeVerbBaseKana = (s: string): string => {
  return (s ?? '').trim().replace(/\s+/g, '');
};

const verbEndingForBaseKana = (baseKana: string): string => {
  const b = normalizeVerbBaseKana(baseKana);
  if (!b) return '';
  if (b.endsWith('する')) return 'する';
  if (b.endsWith('くる')) return 'くる';
  return b.slice(-1);
};

const getVerbDictionaryBases = (state: AppState, deckId: DeckId): VerbBaseEntry[] => {
  const deck = state.decks[deckId];
  if (!deck) return [];

  const out = new Map<string, VerbBaseEntry>();
  for (const id of deck.cardIds) {
    const c = state.cards[id];
    if (!c || !isGeneratedVerbCard(c)) continue;

    const form = (c.verbForm ?? '').toLowerCase().trim();
    if (form !== 'dictionary') continue;

    const baseKana = normalizeVerbBaseKana(c.verbBaseKana ?? '');
    if (!baseKana) continue;
    const baseKanji = (c.verbBaseKanji ?? '').trim() || undefined;
    const baseKeyRaw = `${(baseKanji ?? '').trim()}||${baseKana}`.trim();
    const baseKey = baseKeyRaw && baseKeyRaw !== '||' ? baseKeyRaw : id;

    if (out.has(baseKey)) continue;

    out.set(baseKey, {
      baseKey,
      baseKana,
      baseKanji,
      cls: classifyVerb(baseKana, baseKanji),
      ending: verbEndingForBaseKana(baseKana),
    });
  }

  const list = [...out.values()];
  list.sort((a, b) => a.baseKana.localeCompare(b.baseKana));
  return list;
};

export const getVerbEndingsPresentForDeck = (state: AppState, deckId: DeckId): string[] => {
  const bases = getVerbDictionaryBases(state, deckId);
  const out = new Set<string>();
  for (const b of bases) {
    const e = (b.ending ?? '').trim();
    if (e) out.add(e);
  }
  return [...out.values()].sort((a, b) => a.localeCompare(b));
};

export const getVerbBaseKeysForVerbClass = (state: AppState, deckId: DeckId, cls: 'ichidan' | 'godan'): string[] => {
  return getVerbDictionaryBases(state, deckId)
    .filter((b) => b.cls === cls)
    .map((b) => b.baseKey);
};

export const getVerbBaseKeysForVerbEnding = (state: AppState, deckId: DeckId, ending: string): string[] => {
  const e = (ending ?? '').trim();
  if (!e) return [];
  return getVerbDictionaryBases(state, deckId)
    .filter((b) => b.ending === e)
    .map((b) => b.baseKey);
};

const verbFormRank = (form: string | undefined): number => {
  switch ((form ?? '').toLowerCase()) {
    case 'dictionary':
      return 0;
    case 'polite_present':
      return 1;
    case 'polite_negative':
      return 2;
    case 'te':
      return 3;
    case 'progressive':
      return 4;
    case 'past':
      return 5;
    case 'negative':
      return 6;
    case 'past_negative':
      return 7;
    case 'want':
      return 8;
    case 'dont_want':
      return 9;
    case 'want_past':
      return 10;
    case 'dont_want_past':
      return 11;
    default:
      return 100;
  }
};

const orderVerbCardsForLadder = (state: AppState, ids: CardId[]): CardId[] => {
  const sorted = [...ids];
  sorted.sort((a, b) => {
    const ca = state.cards[a];
    const cb = state.cards[b];
    const ra = verbFormRank(ca?.verbForm);
    const rb = verbFormRank(cb?.verbForm);
    if (ra !== rb) return ra - rb;
    const aa = (ca?.answer ?? '').localeCompare(cb?.answer ?? '');
    if (aa !== 0) return aa;
    return a.localeCompare(b);
  });
  return sorted;
};

export const getVerbMixedQueueForPractice = (state: AppState, deckId: DeckId, _now: number, limit: number): CardId[] => {
  const deck = state.decks[deckId];
  if (!deck) return [];
  if (limit <= 0) return [];

  const all: CardId[] = [];
  for (const id of deck.cardIds) {
    const c = state.cards[id];
    if (c && !isGeneratedVerbCard(c)) continue;
    all.push(id);
  }

  const mixed = shuffled(all);
  if (limit >= mixed.length) return mixed;
  return mixed.slice(0, limit);
};

export const getVerbLadderQueueForReview = (state: AppState, deckId: DeckId, now: number): CardId[] => {
  const deck = state.decks[deckId];
  if (!deck) return [];

  const dueIds: CardId[] = [];
  for (const cardId of deck.cardIds) {
    const c = state.cards[cardId];
    if (c && !isGeneratedVerbCard(c)) continue;
    const srs = state.srs[cardId] ?? defaultSrs(cardId, now);
    if (srs.due <= now) dueIds.push(cardId);
  }
  if (dueIds.length === 0) return [];

  const minDueByBase = new Map<string, number>();
  const byBase = new Map<string, CardId[]>();
  for (const id of dueIds) {
    const base = verbBaseKey(state, id);
    const due = (state.srs[id] ?? defaultSrs(id, now)).due;
    const prevMin = minDueByBase.get(base);
    if (prevMin === undefined || due < prevMin) minDueByBase.set(base, due);

    const bucket = byBase.get(base) ?? [];
    bucket.push(id);
    byBase.set(base, bucket);
  }

  const groups = [...byBase.entries()].map(([base, ids]) => ({
    base,
    ids: orderVerbCardsForLadder(state, ids),
    minDue: minDueByBase.get(base) ?? Number.POSITIVE_INFINITY,
  }));

  groups.sort((a, b) => a.minDue - b.minDue);
  return groups.flatMap((g) => g.ids);
};

export const getVerbLadderQueueForPractice = (state: AppState, deckId: DeckId, now: number, limit: number): CardId[] => {
  const deck = state.decks[deckId];
  if (!deck) return [];
  if (limit <= 0) return [];

  const byBase = new Map<string, CardId[]>();
  for (const id of deck.cardIds) {
    const c = state.cards[id];
    if (c && !isGeneratedVerbCard(c)) continue;
    const base = verbBaseKey(state, id);
    const bucket = byBase.get(base) ?? [];
    bucket.push(id);
    byBase.set(base, bucket);
  }

  const groups = [...byBase.entries()].map(([base, ids]) => {
    const ordered = orderVerbCardsForLadder(state, ids);
    const reviews = ordered.map((cid) => state.stats?.[cid]?.reviews ?? 0);
    const avgReviews = reviews.length ? reviews.reduce((a, b) => a + b, 0) / reviews.length : 0;
    const minDue = Math.min(...ordered.map((cid) => (state.srs[cid] ?? defaultSrs(cid, now)).due));
    return { base, ids: ordered, avgReviews, minDue };
  });

  groups.sort((a, b) => {
    if (a.avgReviews !== b.avgReviews) return a.avgReviews - b.avgReviews;
    return a.minDue - b.minDue;
  });

  const out: CardId[] = [];
  for (const g of groups) {
    if (out.length > 0 && out.length + g.ids.length > limit) break;
    out.push(...g.ids);
    if (out.length >= limit) break;
  }

  if (out.length === 0 && groups[0]) return groups[0].ids;
  return out;
};

export const getVerbLadderQueueForBases = (state: AppState, deckId: DeckId, orderedBaseKeys: string[]): CardId[] => {
  const deck = state.decks[deckId];
  if (!deck) return [];

  const baseOrder = new Map<string, number>();
  for (let i = 0; i < orderedBaseKeys.length; i += 1) {
    const k = (orderedBaseKeys[i] ?? '').trim();
    if (!k) continue;
    if (!baseOrder.has(k)) baseOrder.set(k, i);
  }
  if (baseOrder.size === 0) return [];

  const byBase = new Map<string, CardId[]>();
  for (const id of deck.cardIds) {
    const c = state.cards[id];
    if (c && !isGeneratedVerbCard(c)) continue;
    const base = verbBaseKey(state, id);
    if (!baseOrder.has(base)) continue;
    const bucket = byBase.get(base) ?? [];
    bucket.push(id);
    byBase.set(base, bucket);
  }

  const groups = [...byBase.entries()].map(([base, ids]) => ({ base, ids: orderVerbCardsForLadder(state, ids) }));
  groups.sort((a, b) => (baseOrder.get(a.base) ?? 1e9) - (baseOrder.get(b.base) ?? 1e9));
  return groups.flatMap((g) => g.ids);
};

export const getVerbMixedQueueForBases = (state: AppState, deckId: DeckId, baseKeys: string[], limit: number): CardId[] => {
  const deck = state.decks[deckId];
  if (!deck) return [];
  if (limit <= 0) return [];

  const wanted = baseKeys.map((k) => (k ?? '').trim()).filter(Boolean);
  if (wanted.length === 0) return [];
  const wantedSet = new Set(wanted);

  const all: CardId[] = [];
  for (const id of deck.cardIds) {
    const c = state.cards[id];
    if (c && !isGeneratedVerbCard(c)) continue;
    const base = verbBaseKey(state, id);
    if (!wantedSet.has(base)) continue;
    all.push(id);
  }

  const mixed = shuffled(all);
  if (limit >= mixed.length) return mixed;
  return mixed.slice(0, limit);
};

export const getVerbLadderQueueForVerbClass = (state: AppState, deckId: DeckId, cls: 'ichidan' | 'godan'): CardId[] => {
  const bases = getVerbBaseKeysForVerbClass(state, deckId, cls);
  return getVerbLadderQueueForBases(state, deckId, bases);
};

export const getVerbMixedQueueForVerbClass = (
  state: AppState,
  deckId: DeckId,
  cls: 'ichidan' | 'godan',
  limit: number,
): CardId[] => {
  const bases = getVerbBaseKeysForVerbClass(state, deckId, cls);
  return getVerbMixedQueueForBases(state, deckId, bases, limit);
};

export const getVerbLadderQueueForVerbEnding = (state: AppState, deckId: DeckId, ending: string): CardId[] => {
  const bases = getVerbBaseKeysForVerbEnding(state, deckId, ending);
  return getVerbLadderQueueForBases(state, deckId, bases);
};

export const getVerbMixedQueueForVerbEnding = (
  state: AppState,
  deckId: DeckId,
  ending: string,
  limit: number,
): CardId[] => {
  const bases = getVerbBaseKeysForVerbEnding(state, deckId, ending);
  return getVerbMixedQueueForBases(state, deckId, bases, limit);
};

export const getDueCardIdsForDeck = (state: AppState, deckId: DeckId, now: number): CardId[] => {
  const deck = state.decks[deckId];
  if (!deck) return [];

  if (isVerbConjugationDeck(state, deckId)) {
    return getVerbLadderQueueForReview(state, deckId, now);
  }

  const due: { id: CardId; due: number }[] = [];
  for (const cardId of deck.cardIds) {
    const srs = state.srs[cardId] ?? defaultSrs(cardId, now);
    if (srs.due <= now) due.push({ id: cardId, due: srs.due });
  }

  due.sort((a, b) => a.due - b.due);
  return shuffled(due.map((d) => d.id));
};

export const countDueForDeck = (state: AppState, deckId: DeckId, now: number): number => {
  return getDueCardIdsForDeck(state, deckId, now).length;
};

export const getPracticeCardIdsForDeck = (
  state: AppState,
  deckId: DeckId,
  now: number,
  limit: number,
): CardId[] => {
  const deck = state.decks[deckId];
  if (!deck) return [];

  if (isVerbConjugationDeck(state, deckId)) {
    return getVerbLadderQueueForPractice(state, deckId, now, limit);
  }

  const baseIds = isVocabOnlyDeck(state, deckId) ? getVocabPracticeFilteredIds(state, deckId, deck.cardIds) : deck.cardIds;
  const baseSet = new Set(baseIds);

  const due = getDueCardIdsForDeck(state, deckId, now).filter((id) => baseSet.has(id));
  const dueSet = new Set(due);

  const others = baseIds.filter((id) => !dueSet.has(id));

  const byReviews = new Map<number, CardId[]>();
  for (const id of others) {
    const r = state.stats?.[id]?.reviews ?? 0;
    const bucket = byReviews.get(r) ?? [];
    bucket.push(id);
    byReviews.set(r, bucket);
  }

  const reviewCounts = [...byReviews.keys()].sort((a, b) => a - b);
  const othersShuffled: CardId[] = [];
  for (const r of reviewCounts) {
    const bucket = byReviews.get(r) ?? [];
    bucket.sort((a, b) => {
      const ad = (state.srs[a] ?? defaultSrs(a, now)).due;
      const bd = (state.srs[b] ?? defaultSrs(b, now)).due;
      return ad - bd;
    });
    othersShuffled.push(...shuffled(bucket));
  }

  const merged = [...due, ...othersShuffled];
  if (limit <= 0 || limit >= merged.length) return merged;
  return merged.slice(0, limit);
};

export const getPracticeCardIdsForDeckByTags = (
  state: AppState,
  deckId: DeckId,
  now: number,
  limit: number,
  tags: string[],
): CardId[] => {
  const deck = state.decks[deckId];
  if (!deck) return [];
  if (limit <= 0) return [];
  const wanted = tags.map((t) => (t ?? '').trim()).filter(Boolean);
  if (wanted.length === 0) return getPracticeCardIdsForDeck(state, deckId, now, limit);

  const baseIds = deck.cardIds.filter((id) => {
    const c = state.cards[id];
    const ts = c?.tags ?? [];
    if (!Array.isArray(ts) || ts.length === 0) return false;
    return wanted.some((t) => ts.includes(t));
  });

  const baseSet = new Set(baseIds);
  const due = getDueCardIdsForDeck(state, deckId, now).filter((id) => baseSet.has(id));
  const dueSet = new Set(due);
  const others = baseIds.filter((id) => !dueSet.has(id));

  const byReviews = new Map<number, CardId[]>();
  for (const id of others) {
    const r = state.stats?.[id]?.reviews ?? 0;
    const bucket = byReviews.get(r) ?? [];
    bucket.push(id);
    byReviews.set(r, bucket);
  }

  const reviewCounts = [...byReviews.keys()].sort((a, b) => a - b);
  const othersShuffled: CardId[] = [];
  for (const r of reviewCounts) {
    const bucket = byReviews.get(r) ?? [];
    bucket.sort((a, b) => {
      const ad = (state.srs[a] ?? defaultSrs(a, now)).due;
      const bd = (state.srs[b] ?? defaultSrs(b, now)).due;
      return ad - bd;
    });
    othersShuffled.push(...shuffled(bucket));
  }

  const merged = [...due, ...othersShuffled];
  if (limit >= merged.length) return merged;
  return merged.slice(0, limit);
};
