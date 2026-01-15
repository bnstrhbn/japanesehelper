import type { AppState, CardId, DeckId, VocabCategory } from './models';
import { defaultSrs } from './srs';

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

export const isVocabOnlyDeck = (state: AppState, deckId: DeckId): boolean => {
  const deck = state.decks[deckId];
  if (!deck || deck.cardIds.length === 0) return false;
  return deck.cardIds.every((id) => state.cards[id]?.type === 'vocab');
};

export const vocabCategoryForPos = (posRaw: string | undefined): VocabCategory => {
  const pos = (posRaw ?? '').toLowerCase();
  if (pos.includes('verb')) return 'verb';
  if (pos.includes('adverb')) return 'adverb';
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

const verbFormRank = (form: string | undefined): number => {
  switch ((form ?? '').toLowerCase()) {
    case 'dictionary':
      return 0;
    case 'polite_present':
      return 1;
    case 'te':
      return 2;
    case 'past':
      return 3;
    case 'negative':
      return 4;
    case 'past_negative':
      return 5;
    case 'want':
      return 6;
    case 'dont_want':
      return 7;
    case 'want_past':
      return 8;
    case 'dont_want_past':
      return 9;
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

export const getVerbLadderQueueForReview = (state: AppState, deckId: DeckId, now: number): CardId[] => {
  const deck = state.decks[deckId];
  if (!deck) return [];

  const dueIds: CardId[] = [];
  for (const cardId of deck.cardIds) {
    const c = state.cards[cardId];
    if (c && !looksLikeVerbBaseKana(c.verbBaseKana || c.answer || '')) continue;
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
    if (c && !looksLikeVerbBaseKana(c.verbBaseKana || c.answer || '')) continue;
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
    if (c && !looksLikeVerbBaseKana(c.verbBaseKana || c.answer || '')) continue;
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
