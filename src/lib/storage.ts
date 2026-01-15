import { toRomaji } from 'wanakana';
import type { AppState, Card, ExampleSentence } from './models';
import { makeSeedState, verbConjugationHintText } from './seed';

const DB_NAME = 'japanese_srs_db';
const STORE = 'kv';
const KEY = 'app_state_v1';

const safeRandomUUID = (): string => {
  try {
    const c = crypto as Crypto & { randomUUID?: () => string };
    if (typeof c.randomUUID === 'function') return c.randomUUID();

    if (typeof c.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      c.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
      return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex
        .slice(8, 10)
        .join('')}-${hex.slice(10, 16).join('')}`;
    }
  } catch {
    // ignore
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex
    .slice(8, 10)
    .join('')}-${hex.slice(10, 16).join('')}`;
};

const IDB_TIMEOUT_MS = 4000;

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`IndexedDB open timed out after ${IDB_TIMEOUT_MS}ms`)));
    }, IDB_TIMEOUT_MS);

    const req = indexedDB.open(DB_NAME, 1);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };

    req.onblocked = () => finish(() => reject(new Error('IndexedDB open was blocked. Close other tabs and retry.')));
    req.onsuccess = () => finish(() => resolve(req.result));
    req.onerror = () => finish(() => reject(req.error));
  });

const idbGet = async <T>(key: string): Promise<T | undefined> => {
  const db = await openDb();
  return await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.get(key);

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      db.close();
      fn();
    };

    const timer = setTimeout(() => {
      try {
        tx.abort();
      } catch {
        // ignore
      }
      finish(() => reject(new Error(`IndexedDB get timed out after ${IDB_TIMEOUT_MS}ms`)));
    }, IDB_TIMEOUT_MS);

    req.onsuccess = () => finish(() => resolve(req.result as T | undefined));
    req.onerror = () => finish(() => reject(req.error));
    tx.onabort = () => finish(() => reject(tx.error));
    tx.onerror = () => finish(() => reject(tx.error));
  });
};

const idbSet = async <T>(key: string, value: T): Promise<void> => {
  const db = await openDb();
  return await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.put(value, key);

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      db.close();
      fn();
    };

    const timer = setTimeout(() => {
      try {
        tx.abort();
      } catch {
        // ignore
      }
      finish(() => reject(new Error(`IndexedDB write timed out after ${IDB_TIMEOUT_MS}ms`)));
    }, IDB_TIMEOUT_MS);

    req.onerror = () => finish(() => reject(req.error));
    tx.oncomplete = () => finish(() => resolve());
    tx.onabort = () => finish(() => reject(tx.error));
    tx.onerror = () => finish(() => reject(tx.error));
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

const looksLikeVerbBaseKana = (s: string): boolean => {
  const kana = (s ?? '').trim();
  if (!kana) return false;
  return (
    kana.endsWith('る') ||
    kana.endsWith('う') ||
    kana.endsWith('く') ||
    kana.endsWith('ぐ') ||
    kana.endsWith('す') ||
    kana.endsWith('つ') ||
    kana.endsWith('ぬ') ||
    kana.endsWith('ぶ') ||
    kana.endsWith('む')
  );
};

const migrateState = (state: AppState): { next: AppState; changed: boolean } => {
  let changed = false;
  let posRepairs = 0;
  let exampleRepairs = 0;
  let verbHintRepairs = 0;

  let decks = state.decks;
  let cards = state.cards;
  let srs = state.srs;
  let stats = state.stats;
  const wkApiToken = state.wkApiToken;
  const vocabPracticeFilters = state.vocabPracticeFilters;
  const repeatReviewLastAt = state.repeatReviewLastAt;

  for (const [cardId, card] of Object.entries(cards)) {
    const raw = (card as unknown as { exampleSentences?: unknown }).exampleSentences;
    const normalized = normalizeExamples(raw);
    const deduped = dedupeExamples(normalized);

    let nextCard: Card = card;
    let cardChanged = false;

    const deck = decks[nextCard.deckId];
    const isVerbConjugationDeck = (deck?.name ?? '').toLowerCase().includes('verb conjugation');
    const form = (nextCard.verbForm ?? '').trim().toLowerCase();
    const knownVerbForm =
      form === 'dictionary' ||
      form === 'polite_present' ||
      form === 'te' ||
      form === 'past' ||
      form === 'negative' ||
      form === 'past_negative' ||
      form === 'want' ||
      form === 'dont_want' ||
      form === 'want_past' ||
      form === 'dont_want_past';

    const isLegacyStrings = Array.isArray(raw) && raw.some((e) => typeof e === 'string');
    const needsExampleUpdate = isLegacyStrings || normalized.length !== deduped.length;
    if (needsExampleUpdate) {
      nextCard = { ...nextCard, exampleSentences: deduped.length ? deduped : undefined };
      cardChanged = true;
      exampleRepairs++;
    }

    if (isVerbConjugationDeck && nextCard.type === 'verb' && knownVerbForm) {
      const note = (nextCard.note ?? '').trim();
      const hasNewHint = note.includes('Forms:') && note.includes('Reminders:');
      const legacyRomaji = toRomaji(nextCard.answer).trim();
      const isLegacyRomajiOnly = !!note && note === legacyRomaji;
      const isMissing = !note;

      if (!hasNewHint && (isMissing || isLegacyRomajiOnly)) {
        nextCard = {
          ...nextCard,
          note: verbConjugationHintText(form as any, nextCard.answer),
        };
        cardChanged = true;
        verbHintRepairs++;
      }
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
      const newDeckId = `deck_${safeRandomUUID()}`;
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
        const newCardId = `card_${safeRandomUUID()}`;
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

      const newCardId = `card_${safeRandomUUID()}`;
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
    if (!nextCard.verbBaseKana && seedCard.verbBaseKana) {
      nextCard = { ...nextCard, verbBaseKana: seedCard.verbBaseKana };
      cardChanged = true;
    }
    if (!nextCard.verbBaseKanji && seedCard.verbBaseKanji) {
      nextCard = { ...nextCard, verbBaseKanji: seedCard.verbBaseKanji };
      cardChanged = true;
    }
    if (!nextCard.verbForm && seedCard.verbForm) {
      nextCard = { ...nextCard, verbForm: seedCard.verbForm };
      cardChanged = true;
    }
    if (!nextCard.background && seedCard.background) {
      nextCard = { ...nextCard, background: seedCard.background };
      cardChanged = true;
    }
    if (seedCard.exampleSentences?.length) {
      const existingEx = dedupeExamples(normalizeExamples((nextCard as unknown as { exampleSentences?: unknown }).exampleSentences));
      const seedEx = dedupeExamples(normalizeExamples((seedCard as unknown as { exampleSentences?: unknown }).exampleSentences));
      const merged = dedupeExamples([...existingEx, ...seedEx]);

      if (merged.length !== existingEx.length) {
        nextCard = { ...nextCard, exampleSentences: merged.length ? merged : undefined };
        cardChanged = true;
      }
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

  const removedBadVerbCards: string[] = [];
  for (const [deckId, deck] of Object.entries(decks)) {
    const name = deck.name.toLowerCase();
    if (!name.includes('verb conjugation')) continue;

    const keep: string[] = [];
    for (const cardId of deck.cardIds) {
      const c = cards[cardId];
      if (!c) continue;

      const pos = (c.pos ?? '').toLowerCase();
      const baseKana = (c.verbBaseKana || c.answer || '').trim();

      const isAdverb = pos.includes('adverb');
      const looksLikeVerb = looksLikeVerbBaseKana(baseKana);

      if (c.type === 'verb' && isAdverb) {
        removedBadVerbCards.push(cardId);
        continue;
      }

      keep.push(cardId);
    }

    if (keep.length !== deck.cardIds.length) {
      decks = {
        ...decks,
        [deckId]: {
          ...deck,
          cardIds: keep,
        },
      };
      changed = true;
    }
  }

  if (removedBadVerbCards.length) {
    const nextCards = { ...cards };
    const nextSrs = { ...srs };
    const nextStats = { ...(stats ?? {}) };

    for (const id of removedBadVerbCards) {
      delete nextCards[id];
      delete nextSrs[id];
      delete nextStats[id];
    }

    cards = nextCards;
    srs = nextSrs;
    stats = nextStats;
    console.info(
      `Removed ${removedBadVerbCards.length} invalid card(s) from Verb Conjugation deck (adverb misclassification cleanup).`,
    );
  }

  if (posRepairs > 0) {
    console.info(`Repaired ${posRepairs} card(s) with invalid part-of-speech metadata.`);
  }

  if (exampleRepairs > 0) {
    console.info(`Normalized example sentences on ${exampleRepairs} card(s) (dedupe/format upgrade).`);
  }

  if (verbHintRepairs > 0) {
    console.info(`Upgraded hint text on ${verbHintRepairs} Verb Conjugation card(s) (forms + reminders).`);
  }

  if (!changed) return { next: state, changed: false };
  return {
    next: {
      ...state,
      decks,
      cards,
      srs,
      stats,
      wkApiToken,
      vocabPracticeFilters,
      repeatReviewLastAt,
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
