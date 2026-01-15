export type DeckId = string;
export type CardId = string;

export type CardType = 'vocab' | 'verb' | 'sentence';

export type ExampleSentence = {
  ja: string;
  kana?: string;
  en?: string;
};

export type Deck = {
  id: DeckId;
  name: string;
  description?: string;
  direction?: 'en-ja' | 'ja-en';
  cardIds: CardId[];
};

export type Card = {
  id: CardId;
  deckId: DeckId;
  type: CardType;
  pos?: string;
  prompt: string;
  answer: string;
  note?: string;
  kanji?: string;
  verbBaseKana?: string;
  verbBaseKanji?: string;
  verbForm?: string;
  background?: string;
  exampleSentences?: ExampleSentence[];
};

export type CardSrs = {
  cardId: CardId;
  due: number;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  lastReviewed?: number;
};

export type CardStats = {
  reviews: number;
  correct: number;
};

export type VocabCategory = 'noun' | 'verb' | 'adjective' | 'adverb' | 'connector' | 'other';

export type VocabPracticeFilter = {
  categories: Record<VocabCategory, boolean>;
};

export type AppState = {
  version: 1;
  decks: Record<DeckId, Deck>;
  cards: Record<CardId, Card>;
  srs: Record<CardId, CardSrs>;
  stats?: Record<CardId, CardStats>;
  wkApiToken?: string;
  vocabPracticeFilters?: Record<DeckId, VocabPracticeFilter>;
  repeatReviewLastAt?: Record<DeckId, number>;
};
