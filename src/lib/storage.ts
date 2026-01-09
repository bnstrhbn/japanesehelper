import type { AppState, Card, ExampleSentence } from './models';
import { makeSeedState } from './seed';

const DB_NAME = 'japanese_srs_db';
const STORE = 'kv';
const KEY = 'app_state_v1';

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const idbGet = async <T>(key: string): Promise<T | undefined> => {
  const db = await openDb();
  return await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => db.close();
    tx.onerror = () => db.close();
  });
};

const idbSet = async <T>(key: string, value: T): Promise<void> => {
  const db = await openDb();
  return await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.put(value, key);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

const inferDirectionFromDeckName = (name: string): 'en-ja' | 'ja-en' => {
  const n = name.toLowerCase();
  if (n.includes('jp→en') || n.includes('jp->en') || n.includes('ja→en') || n.includes('ja->en')) return 'ja-en';
  return 'en-ja';
};

const cardSeedKey = (c: Pick<Card, 'type' | 'prompt' | 'answer'>): string => {
  return `${c.type}||${c.prompt.trim()}||${c.answer.trim()}`;
};

const looksLikeSentence = (s: string): boolean => {
  if (!s) return false;
  if (/[。？！\n]/.test(s)) return true;
  if (s.length < 10) return false;
  if (/\s/.test(s)) return true;

  const hasParticlePattern = /[ぁ-ゟ一-龯]+(を|が|に|で|へ|と)/.test(s);
  const hasVerbLikeEnding = /(る|た|て|ない|ます|でした|です)$/.test(s);
  return hasParticlePattern && hasVerbLikeEnding;
};

const looksLikeBadPos = (pos: string | undefined, kanji: string | undefined): boolean => {
  if (!pos) return false;
  if (/[A-Za-z]/.test(pos)) return false;
  if (!/[ぁ-ゟァ-ヿ一-龯]/.test(pos)) return false;
  if (kanji && pos.trim() === kanji.trim()) return true;
  return true;
};

const normalizeExample = (ex: unknown): ExampleSentence | undefined => {
  if (typeof ex === 'string') {
    const ja = ex.trim();
    if (!ja) return undefined;
    return { ja };
  }
  if (!ex || typeof ex !== 'object') return undefined;
  const o = ex as Record<string, unknown>;
  if (typeof o.ja !== 'string') return undefined;
  const ja = o.ja.trim();
  if (!ja) return undefined;
  const kana = typeof o.kana === 'string' ? o.kana.trim() : undefined;
  const en = typeof o.en === 'string' ? o.en.trim() : undefined;
  return { ja, kana: kana || undefined, en: en || undefined };
};

const normalizeExamples = (raw: unknown): ExampleSentence[] => {
  if (!Array.isArray(raw)) return [];
  const out: ExampleSentence[] = [];
  for (const ex of raw) {
    const n = normalizeExample(ex);
    if (n) out.push(n);
  }
  return out;
};

const dedupeExamples = (arr: ExampleSentence[]): ExampleSentence[] => {
  const seen = new Set<string>();
  const out: ExampleSentence[] = [];
  for (const ex of arr) {
    const key = ex.ja.trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ex);
  }
  return out;
};

const migrateState = (state: AppState): { next: AppState; changed: boolean } => {
  let changed = false;
  let posRepairs = 0;
  let exampleRepairs = 0;

  let decks = state.decks;
  let cards = state.cards;
  let stats = state.stats;
  const wkApiToken = state.wkApiToken;

  for (const [cardId, card] of Object.entries(cards)) {
    const raw = (card as unknown as { exampleSentences?: unknown }).exampleSentences;
    const normalized = normalizeExamples(raw);
    const deduped = dedupeExamples(normalized);

    let nextCard: Card = card;
    let cardChanged = false;

    const isLegacyStrings = Array.isArray(raw) && raw.some((e) => typeof e === 'string');
    const needsExampleUpdate = isLegacyStrings || normalized.length !== deduped.length;
    if (needsExampleUpdate) {
      nextCard = { ...nextCard, exampleSentences: deduped.length ? deduped : undefined };
      cardChanged = true;
      exampleRepairs++;
    }

    if (nextCard.type === 'vocab' && nextCard.kanji && looksLikeSentence(nextCard.kanji)) {
      const has = (nextCard.exampleSentences ?? []).some((e) => e.ja === nextCard.kanji);
      const nextExamples = has
        ? nextCard.exampleSentences
        : [...(nextCard.exampleSentences ?? []), { ja: nextCard.kanji }];

      nextCard = {
        ...nextCard,
        kanji: undefined,
        exampleSentences: nextExamples && nextExamples.length ? nextExamples : undefined,
      };
      cardChanged = true;
    }

    if (cardChanged) {
      cards = {
        ...cards,
        [cardId]: nextCard,
      };
      changed = true;
    }
  }

  for (const [deckId, deck] of Object.entries(decks)) {
    if (deck.direction) continue;
    const direction = inferDirectionFromDeckName(deck.name);
    decks = {
      ...decks,
      [deckId]: {
        ...deck,
        direction,
      },
    };
    changed = true;
  }

  const hasJaEnDeck = Object.values(decks).some((d) => d.direction === 'ja-en');
  if (!hasJaEnDeck) {
    const vocabDeck = Object.values(decks).find((d) => d.name.toLowerCase().includes('common vocab'));
    if (vocabDeck) {
      const newDeckId = `deck_${crypto.randomUUID()}`;
      const newDeck = {
        id: newDeckId,
        name: 'Common Vocab (Non-WK) — JP→EN',
        description: 'Japanese → English (type meaning)',
        direction: 'ja-en' as const,
        cardIds: [] as string[],
      };

      const newCards: Record<string, Card> = {};
      for (const srcId of vocabDeck.cardIds) {
        const src = cards[srcId];
        if (!src || src.type !== 'vocab') continue;
        const newCardId = `card_${crypto.randomUUID()}`;
        newCards[newCardId] = {
          ...src,
          id: newCardId,
          deckId: newDeckId,
          prompt: src.answer,
          answer: src.prompt,
        };
        newDeck.cardIds.push(newCardId);
      }

      decks = {
        ...decks,
        [newDeckId]: newDeck,
      };
      cards = {
        ...cards,
        ...newCards,
      };
      changed = true;
    }
  }

  const seed = makeSeedState();
  const deckIdByName = new Map<string, string>();
  for (const [deckId, deck] of Object.entries(decks)) {
    deckIdByName.set(deck.name, deckId);
  }

  for (const seedDeck of Object.values(seed.decks)) {
    const existingDeckId = deckIdByName.get(seedDeck.name);
    if (!existingDeckId) continue;
    const existingDeck = decks[existingDeckId];
    if (!existingDeck) continue;

    const existingKeys = new Set<string>();
    for (const id of existingDeck.cardIds) {
      const c = cards[id];
      if (!c) continue;
      existingKeys.add(cardSeedKey(c));
    }

    let existingDeckCardIds = existingDeck.cardIds;
    for (const seedCardId of seedDeck.cardIds) {
      const seedCard = seed.cards[seedCardId];
      if (!seedCard) continue;
      const key = cardSeedKey(seedCard);
      if (existingKeys.has(key)) continue;

      const newCardId = `card_${crypto.randomUUID()}`;
      cards = {
        ...cards,
        [newCardId]: {
          ...seedCard,
          id: newCardId,
          deckId: existingDeckId,
        },
      };

      existingDeckCardIds = [...existingDeckCardIds, newCardId];
      decks = {
        ...decks,
        [existingDeckId]: {
          ...existingDeck,
          cardIds: existingDeckCardIds,
        },
      };
      existingKeys.add(key);
      changed = true;
    }
  }

  const seedByKey = new Map<string, Card>();
  for (const sc of Object.values(seed.cards)) {
    seedByKey.set(cardSeedKey(sc), sc);
  }

  for (const [cardId, card] of Object.entries(cards)) {
    const seedCard = seedByKey.get(cardSeedKey(card));
    if (!seedCard) continue;

    let nextCard = card;
    let cardChanged = false;

    if (!nextCard.kanji && seedCard.kanji) {
      nextCard = { ...nextCard, kanji: seedCard.kanji };
      cardChanged = true;
    }
    if (seedCard.pos && (!nextCard.pos || looksLikeBadPos(nextCard.pos, nextCard.kanji))) {
      nextCard = { ...nextCard, pos: seedCard.pos };
      cardChanged = true;
      posRepairs++;
    }
    if (!nextCard.note && seedCard.note) {
      nextCard = { ...nextCard, note: seedCard.note };
      cardChanged = true;
    }
    if (!nextCard.background && seedCard.background) {
      nextCard = { ...nextCard, background: seedCard.background };
      cardChanged = true;
    }
    if ((!nextCard.exampleSentences || nextCard.exampleSentences.length === 0) && seedCard.exampleSentences?.length) {
      nextCard = { ...nextCard, exampleSentences: seedCard.exampleSentences };
      cardChanged = true;
    }

    if (cardChanged) {
      cards = {
        ...cards,
        [cardId]: nextCard,
      };
      changed = true;
    }
  }

  if (!stats) {
    stats = {};
    changed = true;
  }

  if (posRepairs > 0) {
    console.info(`Repaired ${posRepairs} card(s) with invalid part-of-speech metadata.`);
  }

  if (exampleRepairs > 0) {
    console.info(`Normalized example sentences on ${exampleRepairs} card(s) (dedupe/format upgrade).`);
  }

  if (!changed) return { next: state, changed: false };
  return {
    next: {
      ...state,
      decks,
      cards,
      stats,
      wkApiToken,
    },
    changed: true,
  };
};

export const loadState = async (): Promise<AppState> => {
  try {
    const existing = await idbGet<AppState>(KEY);
    if (existing && existing.version === 1) {
      const { next, changed } = migrateState(existing);
      if (changed) await idbSet(KEY, next);
      return next;
    }
    const seed = makeSeedState();
    await idbSet(KEY, seed);
    return seed;
  } catch (err) {
    console.error('Failed to load state from IndexedDB. Falling back to seed state.', err);
    return makeSeedState();
  }
};

export const saveState = async (state: AppState): Promise<void> => {
  try {
    await idbSet(KEY, state);
  } catch (err) {
    console.error('Failed to save state to IndexedDB.', err);
  }
};

export const resetState = async (): Promise<AppState> => {
  const seed = makeSeedState();
  await saveState(seed);
  return seed;
};
