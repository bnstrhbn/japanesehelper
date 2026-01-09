import type { AppState, CardId, DeckId } from './models';
import { defaultSrs } from './srs';

const shuffled = <T>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const getDueCardIdsForDeck = (state: AppState, deckId: DeckId, now: number): CardId[] => {
  const deck = state.decks[deckId];
  if (!deck) return [];

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

  const due = getDueCardIdsForDeck(state, deckId, now);
  const dueSet = new Set(due);

  const others = deck.cardIds.filter((id) => !dueSet.has(id));

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
