import { useEffect, useMemo, useState } from 'react';
import { toHiragana, toKatakana, toRomaji } from 'wanakana';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { AppState, Card, CardId, Deck, DeckId, ExampleSentence, VocabCategory, VocabPracticeFilter } from './lib/models';
import { isCorrect, isCorrectEnglish, normalizeEnglish, normalizeJapanese, normalizeKatakana } from './lib/grading';
import {
  countDueForDeck,
  defaultVocabPracticeCategories,
  getDueCardIdsForDeck,
  getPracticeCardIdsForDeck,
  getPracticeCardIdsForDeckByTags,
  getVerbEndingsPresentForDeck,
  getVerbLadderQueueForVerbClass,
  getVerbLadderQueueForVerbEnding,
  getVerbMixedQueueForVerbClass,
  getVerbMixedQueueForVerbEnding,
  getVerbMixedQueueForPractice,
  getVerbLadderQueueForBases,
  isVocabOnlyDeck,
  vocabCategoryForPos,
} from './lib/queue';
import { applySm2, defaultSrs } from './lib/srs';
import { loadState, resetState, saveState } from './lib/storage';
import { conjugateVerb as seedConjugateVerb, verbConjugationHintText, verbFormLabel as seedVerbFormLabel } from './lib/seed';

type Screen =
  | { name: 'home' }
  | { name: 'review'; deckId: DeckId; queue: CardId[]; idx: number; verbMode?: 'ladder' | 'mixed' }
  | { name: 'verb_rules'; deckId: DeckId }
  | { name: 'verb_browser'; deckId: DeckId }
  | { name: 'vocab_practice_settings'; deckId: DeckId }
  | { name: 'manage' }
  | { name: 'vocab' };

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

const makeId = (prefix: string): string => `${prefix}_${safeRandomUUID()}`;

type VerbClass = 'ichidan' | 'godan';

const lastKana = (s: string): string => (s ? s.slice(-1) : '');
const dropLastKana = (s: string): string => (s ? s.slice(0, -1) : '');

const classifyVerb = (baseKana: string, baseKanji?: string): VerbClass => {
  const kana = baseKana.trim();
  if (kana === 'ある') return 'godan';
  if (kana === 'いく') return 'godan';
  if (baseKanji && baseKanji.trim() === '要る') return 'godan';

  const ruExceptions = new Set(['はいる', 'かえる']);
  if (ruExceptions.has(kana)) return 'godan';

  if (kana.endsWith('る')) {
    const r = toRomaji(kana);
    if (r.endsWith('ru')) {
      const pre = r.slice(0, -2);
      const v = pre.slice(-1);
      if (v === 'i' || v === 'e') return 'ichidan';
    }
  }

  return 'godan';
};

const nowMs = () => Date.now();

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
    const k = ex.ja.trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(ex);
  }
  return out;
};

type WkMeaning = { meaning: string; primary: boolean; accepted_answer: boolean };
type WkReading = { reading: string; primary: boolean; accepted_answer: boolean };
type WkContextSentence = { ja: string; en: string };
type WkSubject = {
  id: number;
  object: 'kanji' | 'vocabulary' | 'radical' | string;
  data: {
    characters: string | null;
    level: number;
    meanings: WkMeaning[];
    readings?: WkReading[];
    parts_of_speech?: string[];
    context_sentences?: WkContextSentence[];
  };
};

type WkLookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; subject: WkSubject };

const wkSearchUrl = (q: string): string => `https://www.wanikani.com/search?query=${encodeURIComponent(q)}`;

const wkSubjectUrl = (s: WkSubject): string | undefined => {
  const chars = s.data.characters;
  if (!chars) return undefined;
  if (s.object === 'kanji') return `https://www.wanikani.com/kanji/${encodeURIComponent(chars)}`;
  if (s.object === 'vocabulary') return `https://www.wanikani.com/vocabulary/${encodeURIComponent(chars)}`;
  return undefined;
};

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadSlow, setLoadSlow] = useState(false);
  const [nowTick, setNowTick] = useState(nowMs());

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(nowMs()), 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setLoadSlow(false);

    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setLoadSlow(true);
    }, 3000);

    (async () => {
      try {
        const st = await loadState();
        if (!cancelled) setState(st);
      } catch (err) {
        console.error('Failed to initialize app state.', err);
        const message = err instanceof Error ? err.message : String(err);
        if (!cancelled) setLoadError(message);
      } finally {
        window.clearTimeout(slowTimer);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    void saveState(state);
  }, [state]);

  const decks = useMemo<Deck[]>(() => {
    if (!state) return [];
    const vals = Object.values(state.decks) as Deck[];
    return [...vals].sort((a, b) => a.name.localeCompare(b.name));
  }, [state]);

  if (!state) {
    return (
      <div className="container">
        <div className="header">
          <div className="brand">
            <div className="logo" />
            <div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Japanese SRS</div>
              <div className="small">Local-only. Stored in your browser.</div>
            </div>
          </div>
        </div>
        <div className="card">
          {loadError ? (
            <div>
              <div style={{ fontWeight: 700 }}>Failed to load.</div>
              <div className="small" style={{ marginTop: 6 }}>
                {loadError}
              </div>
              <div className="row" style={{ marginTop: 10, gap: 8 }}>
                <button
                  onClick={async () => {
                    const st = await resetState();
                    setState(st);
                  }}
                >
                  Reset (seed)
                </button>
                <button onClick={() => window.location.reload()}>Reload</button>
              </div>
              <div className="small" style={{ marginTop: 10 }}>
                If you’re on a phone, try Chrome/Safari and ensure you’re not in private mode.
              </div>
            </div>
          ) : (
            <div>
              <div>Loading…</div>
              {loadSlow ? (
                <div className="small" style={{ marginTop: 8 }}>
                  Still loading. This can happen if your browser blocks storage (IndexedDB) or if another tab is holding the database.
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (screen.name === 'vocab_practice_settings') {
    return (
      <VocabPracticeSettingsScreen
        state={state}
        setState={setState}
        deckId={screen.deckId}
        onBack={() => setScreen({ name: 'home' })}
        onStartPractice={(queue: CardId[]) => setScreen({ name: 'review', deckId: screen.deckId, queue, idx: 0 })}
      />
    );
  }

  const onStartReview = (deckId: DeckId) => {
    const now = nowTick;
    const queue = getDueCardIdsForDeck(state, deckId, now);
    if (queue.length === 0) {
      alert('No cards due right now for this deck.');
      return;
    }
    const d = state.decks[deckId];
    const isVerb = (d?.name ?? '').toLowerCase().includes('verb conjugation');
    setScreen({ name: 'review', deckId, queue, idx: 0, verbMode: isVerb ? 'ladder' : undefined });
  };

  const startPractice = (
    deckId: DeckId,
    queueOverride?: CardId[],
    opts?: {
      bypassCooldown?: boolean;
      recordRepeatReview?: boolean;
      verbMode?: 'ladder' | 'mixed';
    },
  ) => {
    const now = nowMs();

    const queue = queueOverride ?? getPracticeCardIdsForDeck(state, deckId, now, 20);
    if (queue.length === 0) {
      alert(queueOverride ? 'No cards match this selection.' : 'No cards found in this deck.');
      return;
    }

    const deck = state.decks[deckId];
    const isVerb = (deck?.name ?? '').toLowerCase().includes('verb conjugation');
    const verbMode = isVerb ? (opts?.verbMode ?? 'ladder') : undefined;
    setScreen({ name: 'review', deckId, queue, idx: 0, verbMode });
  };

  const startPracticeByTags = (deckId: DeckId, tags: string[]) => {
    const now = nowMs();
    const queue = getPracticeCardIdsForDeckByTags(state, deckId, now, 20, tags);
    if (queue.length === 0) {
      alert('No cards match this selection.');
      return;
    }
    startPractice(deckId, queue);
  };

  const onStartPractice = (deckId: DeckId) => startPractice(deckId);

  const onStartVerbMix = (deckId: DeckId) => {
    const deck = state.decks[deckId];
    if (!deck) return;
    const isVerb = deck.name.toLowerCase().includes('verb conjugation');
    if (!isVerb) return;

    const now = nowMs();
    const queue = getVerbMixedQueueForPractice(state, deckId, now, 20);
    if (queue.length === 0) {
      alert('No cards found in this deck.');
      return;
    }
    startPractice(deckId, queue, { verbMode: 'mixed' });
  };

  const startVerbQuickQueue = (deckId: DeckId, queue: CardId[], verbMode: 'ladder' | 'mixed', emptyMsg: string) => {
    if (queue.length === 0) {
      alert(emptyMsg);
      return;
    }
    startPractice(deckId, queue, { verbMode });
  };

  const onOpenVerbRules = (deckId: DeckId) => {
    const deck = state.decks[deckId];
    if (!deck) return;
    const isVerb = deck.name.toLowerCase().includes('verb conjugation');
    if (!isVerb) return;
    setScreen({ name: 'verb_rules', deckId });
  };

  const onOpenVerbBrowser = (deckId: DeckId) => {
    const deck = state.decks[deckId];
    if (!deck) return;
    const isVerb = deck.name.toLowerCase().includes('verb conjugation');
    if (!isVerb) return;
    setScreen({ name: 'verb_browser', deckId });
  };

  const onReset = async () => {
    const ok = confirm('Reset all progress and restore the seed decks?');
    if (!ok) return;
    const st = await resetState();
    setState(st);
    setScreen({ name: 'home' });
  };

  if (screen.name === 'review') {
    return (
      <ReviewScreen
        state={state}
        setState={setState}
        deckId={screen.deckId}
        queue={screen.queue}
        idx={screen.idx}
        verbMode={screen.verbMode}
        setIdx={(idx) => setScreen({ ...screen, idx })}
        onExit={() => setScreen({ name: 'home' })}
      />
    );
  }

  if (screen.name === 'verb_rules') {
    return (
      <VerbConjugationRulesScreen
        deckName={state.decks[screen.deckId]?.name ?? 'Verb Conjugation'}
        onBack={() => setScreen({ name: 'home' })}
      />
    );
  }

  if (screen.name === 'verb_browser') {
    return (
      <VerbConjugationBrowserScreen
        state={state}
        deckId={screen.deckId}
        onBack={() => setScreen({ name: 'home' })}
        onStartPractice={(queue) => startPractice(screen.deckId, queue, { bypassCooldown: true, recordRepeatReview: false })}
      />
    );
  }

  if (screen.name === 'manage') {
    return (
      <ManageScreen
        state={state}
        setState={setState}
        onBack={() => setScreen({ name: 'home' })}
        onReset={onReset}
      />
    );
  }

  if (screen.name === 'vocab') {
    return <VocabBrowserScreen state={state} onBack={() => setScreen({ name: 'home' })} />;
  }

  const now = nowMs();

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <div className="logo" />
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Japanese SRS</div>
            <div className="small">Kana-only answers. Romaji auto-converts to ひらがな.</div>
          </div>
        </div>
        <div className="row">
          <button onClick={() => setScreen({ name: 'vocab' })}>Vocab</button>
          <button onClick={() => setScreen({ name: 'manage' })}>Manage</button>
        </div>
      </div>

      <div className="grid">
        {decks.map((d: Deck) => {
          const due = countDueForDeck(state, d.id, now);
          const isVerbConjugation = d.name.toLowerCase().includes('verb conjugation');
          const isPhrasesAndSentences = d.name.toLowerCase().includes('phrases') && d.name.toLowerCase().includes('sentenc');
          const isVocabOnly = isVocabOnlyDeck(state, d.id);
          const verbEndings = isVerbConjugation ? getVerbEndingsPresentForDeck(state, d.id) : [];
          const orderedVerbEndings = (() => {
            if (!verbEndings.length) return [] as string[];
            const order = ['う', 'く', 'ぐ', 'す', 'つ', 'ぬ', 'ぶ', 'む', 'る', 'する', 'くる'];
            const idx = (e: string) => {
              const i = order.indexOf(e);
              return i === -1 ? 1e9 : i;
            };
            return [...verbEndings].sort((a, b) => idx(a) - idx(b) || a.localeCompare(b));
          })();
          const totals = d.cardIds.reduce(
            (acc, id) => {
              const st = state.stats?.[id];
              acc.reviews += st?.reviews ?? 0;
              acc.correct += st?.correct ?? 0;
              return acc;
            },
            { reviews: 0, correct: 0 },
          );
          const accuracy = totals.reviews ? Math.round((totals.correct / totals.reviews) * 100) : 0;
          return (
            <div className="card" key={d.id}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>{d.name}</div>
              {d.description ? <div className="small">{d.description}</div> : null}
              <div style={{ marginTop: 10 }} className="row">
                <div className="small">
                  Due now: <b>{due}</b>
                </div>
                <div className="small">
                  Attempts: <b>{totals.reviews}</b>
                  {totals.reviews ? <span> ({accuracy}% correct)</span> : null}
                </div>
                <div style={{ flex: 1 }} />
                <button className="primary" onClick={() => onStartReview(d.id)} disabled={due === 0}>
                  Review
                </button>
                <button
                  onClick={() => onStartPractice(d.id)}
                  disabled={d.cardIds.length === 0}
                >
                  Practice
                </button>
                {isVerbConjugation ? (
                  <button
                    onClick={() => onStartVerbMix(d.id)}
                    disabled={d.cardIds.length === 0}
                    title={'Randomized conjugation forms across all verbs'}
                  >
                    Mix
                  </button>
                ) : null}
                {isVocabOnly ? <button onClick={() => setScreen({ name: 'vocab_practice_settings', deckId: d.id })}>Types</button> : null}
                {isVerbConjugation ? <button onClick={() => onOpenVerbRules(d.id)}>Rules</button> : null}
                {isVerbConjugation ? <button onClick={() => onOpenVerbBrowser(d.id)}>Verbs</button> : null}
              </div>


              {isVerbConjugation ? (
                <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <div className="small" style={{ fontWeight: 800 }}>
                      Verb subsets
                    </div>
                    <button
                      onClick={() =>
                        startVerbQuickQueue(
                          d.id,
                          getVerbLadderQueueForVerbClass(state, d.id, 'ichidan'),
                          'ladder',
                          'No Ichidan verbs found.',
                        )
                      }
                      title="Ichidan-only ladders"
                    >
                      Ichidan · Ladder
                    </button>
                    <button
                      onClick={() =>
                        startVerbQuickQueue(
                          d.id,
                          getVerbMixedQueueForVerbClass(state, d.id, 'ichidan', 20),
                          'mixed',
                          'No Ichidan verbs found.',
                        )
                      }
                      title="Ichidan-only mixed (random forms)"
                    >
                      Ichidan · Mixed
                    </button>
                    <button
                      onClick={() =>
                        startVerbQuickQueue(
                          d.id,
                          getVerbLadderQueueForVerbClass(state, d.id, 'godan'),
                          'ladder',
                          'No Godan verbs found.',
                        )
                      }
                      title="Godan-only ladders"
                    >
                      Godan · Ladder
                    </button>
                    <button
                      onClick={() =>
                        startVerbQuickQueue(
                          d.id,
                          getVerbMixedQueueForVerbClass(state, d.id, 'godan', 20),
                          'mixed',
                          'No Godan verbs found.',
                        )
                      }
                      title="Godan-only mixed (random forms)"
                    >
                      Godan · Mixed
                    </button>
                  </div>

                  {orderedVerbEndings.length ? (
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <div className="small" style={{ fontWeight: 800 }}>
                        By ending
                      </div>
                      {orderedVerbEndings.map((e) => (
                        <div key={`ending_${e}`} className="row" style={{ gap: 6 }}>
                          <button
                            onClick={() =>
                              startVerbQuickQueue(
                                d.id,
                                getVerbLadderQueueForVerbEnding(state, d.id, e),
                                'ladder',
                                `No verbs found ending with ${e}.`,
                              )
                            }
                            title={`Ending ${e} ladders`}
                          >
                            {e} · Ladder
                          </button>
                          <button
                            onClick={() =>
                              startVerbQuickQueue(
                                d.id,
                                getVerbMixedQueueForVerbEnding(state, d.id, e, 20),
                                'mixed',
                                `No verbs found ending with ${e}.`,
                              )
                            }
                            title={`Ending ${e} mixed (random forms)`}
                          >
                            {e} · Mixed
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {isPhrasesAndSentences ? (
                <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => startPracticeByTags(d.id, ['greeting'])}>Greeting</button>
                  <button onClick={() => startPracticeByTags(d.id, ['restaurant'])}>Restaurants</button>
                  <button onClick={() => startPracticeByTags(d.id, ['shopping'])}>Shopping</button>
                  <button onClick={() => startPracticeByTags(d.id, ['skiing'])}>Skiing</button>
                  <button onClick={() => startPracticeByTags(d.id, ['advanced'])}>Advanced</button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 16 }} className="card">
        <div style={{ fontWeight: 900 }}>How answers work</div>
        <div className="small" style={{ marginTop: 6 }}>
          Type in romaji and it will convert as you type (example: <kbd>taberu</kbd> → たべる). Your
          input is normalized (whitespace/punctuation ignored) before grading.
        </div>
      </div>
    </div>
  );
}

function VocabPracticeSettingsScreen(props: {
  state: AppState;
  setState: (s: AppState) => void;
  deckId: DeckId;
  onBack: () => void;
  onStartPractice: (queue: CardId[]) => void;
}) {
  const { state, setState, deckId, onBack, onStartPractice } = props;
  const deck = state.decks[deckId];

  const initial: VocabPracticeFilter = useMemo(() => {
    const existing = state.vocabPracticeFilters?.[deckId];
    if (existing?.categories) return existing;
    return { categories: defaultVocabPracticeCategories() };
  }, [deckId, state.vocabPracticeFilters]);

  const [cats, setCats] = useState<Record<VocabCategory, boolean>>(initial.categories);

  useEffect(() => {
    setCats(initial.categories);
  }, [initial]);

  const counts = useMemo(() => {
    const out: Record<VocabCategory, number> = { noun: 0, verb: 0, adjective: 0, adverb: 0, connector: 0, other: 0 };
    if (!deck) return out;
    for (const id of deck.cardIds) {
      const c = state.cards[id];
      if (!c || c.type !== 'vocab') continue;
      out[vocabCategoryForPos(c.pos)] += 1;
    }
    return out;
  }, [deck, state.cards]);

  const setAll = (v: boolean) => {
    setCats({ noun: v, verb: v, adjective: v, adverb: v, connector: v, other: v });
  };

  const save = (): AppState => {
    const next: AppState = {
      ...state,
      vocabPracticeFilters: {
        ...(state.vocabPracticeFilters ?? {}),
        [deckId]: { categories: cats },
      },
    };
    setState(next);
    return next;
  };

  const start = () => {
    const anyEnabled = Object.values(cats).some(Boolean);
    if (!anyEnabled) {
      alert('Select at least one category.');
      return;
    }
    const nextState = save();
    const now = nowMs();
    const queue = getPracticeCardIdsForDeck(nextState, deckId, now, 20);
    if (queue.length === 0) {
      alert('No cards match these settings.');
      return;
    }
    onStartPractice(queue);
  };

  if (!deck) {
    return (
      <div className="container">
        <div className="header">
          <div className="brand">
            <div className="logo" />
            <div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Vocab practice</div>
              <div className="small">Missing deck.</div>
            </div>
          </div>
          <div className="row">
            <button onClick={onBack}>Back</button>
          </div>
        </div>
      </div>
    );
  }

  if (!isVocabOnlyDeck(state, deckId)) {
    return (
      <div className="container">
        <div className="header">
          <div className="brand">
            <div className="logo" />
            <div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Vocab practice</div>
              <div className="small">This deck is not vocab-only.</div>
            </div>
          </div>
          <div className="row">
            <button onClick={onBack}>Back</button>
          </div>
        </div>
      </div>
    );
  }

  const rows: Array<{ key: VocabCategory; label: string; help: string }> = [
    { key: 'noun', label: 'Nouns', help: 'Nouns + pronouns' },
    { key: 'verb', label: 'Verbs', help: 'Verb vocab (not conjugation cards)' },
    { key: 'adjective', label: 'Adjectives', help: 'i-adj / na-adj' },
    { key: 'adverb', label: 'Adverbs', help: '' },
    { key: 'connector', label: 'Connectors', help: 'Particles, conjunctions, determiners, expressions, etc.' },
    { key: 'other', label: 'Other', help: 'Anything not recognized above' },
  ];

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <div className="logo" />
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Vocab practice types</div>
            <div className="small">{deck.name}</div>
          </div>
        </div>
        <div className="row">
          <button onClick={onBack}>Back</button>
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 900 }}>Choose what to practice</div>
        <div className="small" style={{ marginTop: 6 }}>
          This filters <b>Practice</b> for this deck. Review (due) is unchanged.
        </div>

        <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setAll(true)}>All</button>
          <button onClick={() => setAll(false)}>None</button>
          <div style={{ flex: 1 }} />
          <button onClick={() => save()}>Save</button>
          <button className="primary" onClick={start}>
            Start practice
          </button>
        </div>

        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {rows.map((r) => (
            <label key={r.key} className="row" style={{ gap: 10, margin: 0, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={!!cats[r.key]}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setCats((prev) => ({
                    ...prev,
                    [r.key]: e.target.checked,
                  }))
                }
                style={{ width: 'auto' }}
              />
              <div style={{ fontWeight: 800 }}>{r.label}</div>
              <div className="small" style={{ opacity: 0.85 }}>
                ({counts[r.key]})
                {r.help ? ` · ${r.help}` : ''}
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function VerbConjugationBrowserScreen(props: {
  state: AppState;
  deckId: DeckId;
  onBack: () => void;
  onStartPractice: (queue: CardId[]) => void;
}) {
  const { state, deckId, onBack, onStartPractice } = props;
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'kana' | 'english' | 'ending' | 'class' | 'irregular'>('kana');
  const [onlyIrregular, setOnlyIrregular] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const deck = state.decks[deckId];

  const entries = useMemo(() => {
    if (!deck) return [] as Array<{
      key: string;
      baseKana: string;
      baseKanji?: string;
      english: string;
      cls: VerbClass;
      ending: string;
      irregular: boolean;
    }>;

    const byKey = new Map<
      string,
      {
        key: string;
        baseKana: string;
        baseKanji?: string;
        english: string;
        cls: VerbClass;
        ending: string;
        irregular: boolean;
      }
    >();

    for (const id of deck.cardIds) {
      const c = state.cards[id];
      if (!c || c.type !== 'verb') continue;

      const form = (c.verbForm ?? '').toLowerCase().trim();
      if (form !== 'dictionary') continue;

      const baseKana = (c.verbBaseKana ?? '').trim();
      const baseKanji = (c.verbBaseKanji || '').trim() || undefined;
      if (!baseKana) continue;

      const pos = (c.pos ?? '').toLowerCase();
      const cue = (c.prompt ?? '').trim().toLowerCase();
      const hasVerbPos = /\bverb\b/.test(pos);
      const hasVerbCue = cue.startsWith('to ');
      if (!hasVerbPos && !hasVerbCue) continue;

      const raw = `${(baseKanji ?? '').trim()}||${baseKana}`.trim();
      const key = raw && raw !== '||' ? raw : id;

      const cls = classifyVerb(baseKana, baseKanji);
      const ending = lastKana(baseKana);
      const irregular = baseKana === 'いく' || baseKana === 'ある' || baseKanji === '要る' || (baseKana.endsWith('る') && cls === 'godan');

      byKey.set(key, {
        key,
        baseKana,
        baseKanji,
        english: c.prompt,
        cls,
        ending,
        irregular,
      });
    }

    const list = [...byKey.values()];
    list.sort((a, b) => {
      if (sort === 'english') {
        const c = a.english.localeCompare(b.english);
        if (c !== 0) return c;
        return a.baseKana.localeCompare(b.baseKana);
      }
      if (sort === 'ending') {
        const c = a.ending.localeCompare(b.ending);
        if (c !== 0) return c;
        return a.baseKana.localeCompare(b.baseKana);
      }
      if (sort === 'class') {
        const c = a.cls.localeCompare(b.cls);
        if (c !== 0) return c;
        return a.baseKana.localeCompare(b.baseKana);
      }
      if (sort === 'irregular') {
        const c = Number(b.irregular) - Number(a.irregular);
        if (c !== 0) return c;
        return a.baseKana.localeCompare(b.baseKana);
      }
      return a.baseKana.localeCompare(b.baseKana);
    });
    return list;
  }, [deck, state.cards, sort]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (onlyIrregular && !e.irregular) return false;
      if (!qq) return true;
      if (e.english.toLowerCase().includes(qq)) return true;
      if (e.baseKana.includes(qq)) return true;
      if (e.baseKanji && e.baseKanji.includes(qq)) return true;
      return false;
    });
  }, [entries, onlyIrregular, q]);

  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);

  const practiceSelected = () => {
    const ordered = filtered.filter((e) => selected[e.key]).map((e) => e.key);
    if (ordered.length === 0) {
      alert('Select at least one verb.');
      return;
    }
    const queue = getVerbLadderQueueForBases(state, deckId, ordered);
    if (queue.length === 0) {
      alert('No cards found for the selected verbs.');
      return;
    }
    onStartPractice(queue);
  };

  const selectAllFiltered = () => {
    const next = { ...selected };
    for (const e of filtered) next[e.key] = true;
    setSelected(next);
  };

  const clearSelection = () => setSelected({});

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <div className="logo" />
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Verb Browser</div>
            <div className="small">Pick specific verbs to practice as a ladder.</div>
          </div>
        </div>
        <div className="row">
          <button onClick={onBack}>Back</button>
          <button className="primary" onClick={practiceSelected} disabled={selectedCount === 0}>
            Practice selected ({selectedCount})
          </button>
        </div>
      </div>

      <div className="card">
        <label>Search</label>
        <input value={q} onChange={(e: ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} placeholder="search…" />
        <div style={{ marginTop: 10 }} className="row">
          <div style={{ flex: 1, minWidth: 220 }}>
            <label>Sort</label>
            <select value={sort} onChange={(e: ChangeEvent<HTMLSelectElement>) => setSort(e.target.value as typeof sort)}>
              <option value="kana">Kana (base)</option>
              <option value="english">English</option>
              <option value="ending">Ending kana</option>
              <option value="class">Verb class</option>
              <option value="irregular">Irregular first</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label>Filters</label>
            <div className="row" style={{ gap: 10 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
                <input
                  type="checkbox"
                  checked={onlyIrregular}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setOnlyIrregular(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                Irregular only
              </label>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={selectAllFiltered} disabled={filtered.length === 0}>
            Select all
          </button>
          <button onClick={clearSelection} disabled={selectedCount === 0}>
            Clear
          </button>
        </div>
        <div className="small" style={{ marginTop: 8 }}>
          Showing <b>{filtered.length}</b> verbs.
        </div>
      </div>

      <div style={{ marginTop: 12 }} className="grid">
        {filtered.map((e) => {
          const tag = e.irregular ? 'irregular' : e.cls;
          return (
            <div key={e.key} className="card" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <label style={{ display: 'flex', gap: 10, alignItems: 'center', margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={!!selected[e.key]}
                    onChange={(ev: ChangeEvent<HTMLInputElement>) =>
                      setSelected((prev) => ({ ...prev, [e.key]: ev.target.checked }))
                    }
                    style={{ width: 'auto' }}
                  />
                  <div style={{ fontWeight: 900 }}>{e.english}</div>
                </label>
                <div className="small">
                  {tag} · ends with <b>{e.ending || '—'}</b>
                </div>
              </div>

              <div className="jpText" style={{ marginTop: 6, fontWeight: 800 }}>
                {e.baseKana}
              </div>
              {e.baseKanji ? (
                <div className="jpKanji" style={{ marginTop: 6 }}>
                  {e.baseKanji}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VerbConjugationRulesScreen(props: { deckName: string; onBack: () => void }) {
  const { deckName, onBack } = props;
  const smallStyle = { fontSize: 15, lineHeight: 1.7 } as const;

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <div className="logo" />
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Rules &amp; Irregulars</div>
            <div className="small">{deckName}</div>
          </div>
        </div>
        <div className="row">
          <button onClick={onBack}>Back</button>
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 900 }}>Verb classes</div>
        <div className="small" style={{ marginTop: 6, ...smallStyle }}>
          This deck uses two classes:
        </div>
        <div className="small" style={{ marginTop: 8, ...smallStyle }}>
          <b>Ichidan (る-verb)</b>: stem = drop final <b>る</b>.
          <br />
          Example: たべ<b>る</b> → たべ-
        </div>
        <div className="small" style={{ marginTop: 8, ...smallStyle }}>
          <b>Godan (う-verb)</b>: stem depends on the last kana.
          <br />
          Example: の<b>む</b> → のみ- (i-row)
        </div>
        <div className="small" style={{ marginTop: 8, ...smallStyle }}>
          Notes:
          <br />
          - Some 〜る verbs are godan (e.g. はいる, かえる).
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 900 }}>Polite present (〜ます)</div>
        <div className="small" style={{ marginTop: 8, ...smallStyle }}>
          - Ichidan: stem + ます (たべる → たべます)
          <br />
          - Godan: change last kana to i-row + ます (のむ → のみます)
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 900 }}>Negative (〜ない) / Past negative (〜なかった)</div>
        <div className="small" style={{ marginTop: 8, ...smallStyle }}>
          - Ichidan: stem + ない / なかった (たべる → たべない / たべなかった)
          <br />
          - Godan: change last kana to a-row + ない / なかった (う → わ)
          <br />
          Example: のむ → のまない / のまなかった
        </div>
        <div className="small" style={{ marginTop: 8, ...smallStyle }}>
          Irregular:
          <br />
          - ある → ない / なかった
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 900 }}>Te-form (〜て) / Past (〜た)</div>
        <div className="small" style={{ marginTop: 8, ...smallStyle }}>
          - Ichidan: stem + て / た (たべる → たべて / たべた)
        </div>
        <div className="small" style={{ marginTop: 8, ...smallStyle }}>
          - Godan patterns by last kana:
          <br />
          う/つ/る → って / った
          <br />
          む/ぶ/ぬ → んで / んだ
          <br />
          く → いて / いた (exception: いく)
          <br />
          ぐ → いで / いだ
          <br />
          す → して / した
        </div>
        <div className="small" style={{ marginTop: 8, ...smallStyle }}>
          Irregular:
          <br />
          - いく → いって / いった
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 900 }}>Irregular verbs</div>
        <div className="small" style={{ marginTop: 8, ...smallStyle }}>
          <b>する</b>:
          <br />
          - polite: します
          <br />
          - te/past: して / した
          <br />
          - negative/past neg: しない / しなかった
          <br />
          - want family: したい / したくない / したかった / したくなかった
        </div>
        <div className="small" style={{ marginTop: 10, ...smallStyle }}>
          <b>くる / 来る</b>:
          <br />
          - polite: きます
          <br />
          - te/past: きて / きた
          <br />
          - negative/past neg: こない / こなかった
          <br />
          - want family: きたい / きたくない / きたかった / きたくなかった
        </div>
        <div className="small" style={{ marginTop: 10, ...smallStyle }}>
          Special cases also worth memorizing:
          <br />
          - <b>いく / 行く</b> te/past is irregular: いって / いった
          <br />
          - <b>ある</b> negative is irregular: ない / なかった
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 900 }}>Want (〜たい) family</div>
        <div className="small" style={{ marginTop: 8, ...smallStyle }}>
          Attach to the verb stem (ます-stem). 〜たい behaves like an i-adjective.
        </div>
        <div className="small" style={{ marginTop: 8, ...smallStyle }}>
          Examples:
          <br />
          - たべる → たべたい (want)
          <br />
          - たべる → たべたくない (don’t want)
          <br />
          - たべる → たべたかった (wanted)
          <br />
          - たべる → たべたくなかった (didn’t want)
        </div>
      </div>
    </div>
  );
}

function ReviewScreen(props: {
  state: AppState;
  setState: (s: AppState) => void;
  deckId: DeckId;
  queue: CardId[];
  idx: number;
  setIdx: (idx: number) => void;
  onExit: () => void;
  verbMode?: 'ladder' | 'mixed';
}) {
  const { state, setState, deckId, queue, idx, setIdx, onExit, verbMode } = props;
  const cardId = queue[idx];
  const card = state.cards[cardId];
  const deck = state.decks[deckId];
  const direction = deck?.direction ?? 'en-ja';
  const answerIsJapanese = direction !== 'ja-en';
  const promptIsJapanese = direction === 'ja-en';

  const deckName = (deck?.name ?? '').toLowerCase();
  const isPhrasesAndSentencesDeck = deckName.includes('phrases') && deckName.includes('sentenc');

  const isKatakanaDeck = (deck?.name ?? '').toLowerCase().includes('katakana');

  const isVerbConjugationDeck = (deck?.name ?? '').toLowerCase().includes('verb conjugation');
  const verbFormLabel = (form: string | undefined): string => {
    const f = (form ?? '').toLowerCase();
    const known =
      f === 'dictionary' ||
      f === 'polite_present' ||
      f === 'polite_negative' ||
      f === 'te' ||
      f === 'progressive' ||
      f === 'past' ||
      f === 'negative' ||
      f === 'past_negative' ||
      f === 'want' ||
      f === 'dont_want' ||
      f === 'want_past' ||
      f === 'dont_want_past';
    if (known) return seedVerbFormLabel(f as any);
    return form ? form : '—';
  };

  const verbTargetEnglishGloss = (formRaw: string | undefined, englishPrompt: string): string => {
    const form = (formRaw ?? '').trim().toLowerCase();
    const firstMeaning = (englishPrompt ?? '').split(';')[0]?.trim() ?? '';
    const base = firstMeaning.replace(/^to\s+/i, '').trim();
    if (!base) return '';
    const baseTitle = base ? `${base[0].toUpperCase()}${base.slice(1)}` : '';

    const pastIrregular: Record<string, string> = {
      go: 'went',
      eat: 'ate',
      drink: 'drank',
      buy: 'bought',
      read: 'read',
      write: 'wrote',
      speak: 'spoke',
      sleep: 'slept',
      leave: 'left',
      have: 'had',
      be: 'was',
      do: 'did',
      'wake up': 'woke up',
    };

    const pastOf = (v: string): string => {
      const key = v.toLowerCase();
      if (pastIrregular[key]) return pastIrregular[key];
      if (key.endsWith('e')) return `${v}d`;
      if (key.endsWith('y') && !/[aeiou]y$/i.test(v)) return `${v.slice(0, -1)}ied`;
      return `${v}ed`;
    };

    const ingIrregular: Record<string, string> = {
      be: 'being',
      do: 'doing',
      go: 'going',
      have: 'having',
    };

    const ingOf = (v: string): string => {
      const parts = v.trim().split(/\s+/);
      const head = parts[0] ?? '';
      const tail = parts.slice(1).join(' ');
      const key = head.toLowerCase();
      const ingHead =
        ingIrregular[key] ??
        key.endsWith('ie')
          ? `${head.slice(0, -2)}ying`
          : key.endsWith('e') && !key.endsWith('ee')
            ? `${head.slice(0, -1)}ing`
            : `${head}ing`;
      return tail ? `${ingHead} ${tail}` : ingHead;
    };

    const ingTitleOf = (v: string): string => {
      const ing = ingOf(v);
      return ing ? `${ing[0].toUpperCase()}${ing.slice(1)}` : '';
    };

    if (form === 'dictionary') return baseTitle;
    if (form === 'polite_present') return `${baseTitle} (polite)`;
    if (form === 'polite_negative') return `don't ${baseTitle} (polite)`;
    if (form === 'te') return `${baseTitle} (and then…)`;
    if (form === 'progressive') return `is ${ingTitleOf(base)}`;
    if (form === 'past') return pastOf(baseTitle);
    if (form === 'negative') return `don't ${baseTitle}`;
    if (form === 'past_negative') return `didn't ${baseTitle}`;
    if (form === 'want') return `want to ${baseTitle}`;
    if (form === 'dont_want') return `don't want to ${baseTitle}`;
    if (form === 'want_past') return `wanted to ${baseTitle}`;
    if (form === 'dont_want_past') return `didn't want to ${baseTitle}`;
    return baseTitle;
  };

  const hintText =
    direction === 'ja-en' && card?.type === 'vocab'
      ? card.answer
      : card?.note;

  const kanjiLooksLikeSentence = !!card?.kanji && /[。？！\n]/.test(card.kanji);
  const legacyKanjiExample = !promptIsJapanese && card?.kanji && kanjiLooksLikeSentence ? card.kanji : undefined;
  const infoKanji = !promptIsJapanese && card?.kanji && !kanjiLooksLikeSentence ? card.kanji : undefined;
  const baseExamples = dedupeExamples(normalizeExamples((card as unknown as { exampleSentences?: unknown }).exampleSentences));
  const infoExamples = legacyKanjiExample
    ? baseExamples.some((e) => e.ja === legacyKanjiExample)
      ? baseExamples
      : dedupeExamples([...baseExamples, { ja: legacyKanjiExample }])
    : baseExamples;

  const verbGroupKeyForCardId = (cid: CardId): string => {
    const c = state.cards[cid];
    if (!c || c.type !== 'verb') return '';
    const bk = (c.verbBaseKanji || '').trim();
    const ba = (c.verbBaseKana || '').trim();
    if (bk || ba) return `${bk}||${ba}`;
    const p = (c.prompt || '').trim().toLowerCase();
    if (p) return `prompt||${p}`;
    return `answer||${(c.answer || '').trim()}`;
  };

  const [value, setValue] = useState('');
  const [checked, setChecked] = useState<null | { correct: boolean; expected: string; got: string }>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [showVerbSuffixHint, setShowVerbSuffixHint] = useState(false);
  const [showVerbClassRules, setShowVerbClassRules] = useState(false);
  const [wkByCardId, setWkByCardId] = useState<Record<string, WkLookupState>>({});
  const [skippedVerbGroupKeys, setSkippedVerbGroupKeys] = useState<Record<string, true>>({});

  useEffect(() => {
    setValue('');
    setChecked(null);
    setShowDetails(false);
    setShowHint(false);
    setShowVerbSuffixHint(false);
    setShowVerbClassRules(false);
  }, [cardId]);

  if (!card) {
    return (
      <div className="container">
        <div className="card">
          Missing card. <button onClick={onExit}>Back</button>
        </div>
      </div>
    );
  }

  const remaining = queue.length - idx;

  const verbBaseKana = (card?.verbBaseKana || card?.answer || '').trim();
  const verbBaseKanji = (card?.verbBaseKanji || '').trim();
  const verbBaseKey = `${verbBaseKanji}||${verbBaseKana}`;
  const effectiveVerbMode: 'ladder' | 'mixed' | null =
    isVerbConjugationDeck && card?.type === 'verb' ? (verbMode ?? 'ladder') : null;
  const showVerbHeader = effectiveVerbMode !== null && verbBaseKey !== '||' && !!card?.verbForm;
  const showVerbLadder = showVerbHeader && effectiveVerbMode === 'ladder';
  const verbTargetGloss = showVerbHeader ? verbTargetEnglishGloss(card.verbForm, card.prompt) : '';
  const verbGroupKey = isVerbConjugationDeck && card?.type === 'verb' ? verbGroupKeyForCardId(cardId) : '';
  const isVerbGroupSkipped = !!verbGroupKey && !!skippedVerbGroupKeys[verbGroupKey];

  const isSentenceWriting =
    card.type === 'sentence' && direction === 'en-ja' && (deckName.includes('sentence writing') || isPhrasesAndSentencesDeck);

  const sentenceTextForParticleNotes = card.type === 'sentence' ? (card.kanji || card.answer || '').trim() : '';
  const hasParticleWa = sentenceTextForParticleNotes.includes('は');
  const hasParticleGa = sentenceTextForParticleNotes.includes('が');
  const hasParticleWo = sentenceTextForParticleNotes.includes('を');
  const hasParticleNi = sentenceTextForParticleNotes.includes('に');
  const hasParticleDe = sentenceTextForParticleNotes.includes('で');
  const showSentenceParticleNotes =
    card.type === 'sentence' &&
    (hasParticleWa || hasParticleGa || hasParticleWo);
  const sentenceParticleNotes = (() => {
    if (!showSentenceParticleNotes) return '';
    const lines: string[] = [];

    const detected: string[] = [];
    if (hasParticleWa) detected.push('は');
    if (hasParticleGa) detected.push('が');
    if (hasParticleWo) detected.push('を');
    if (hasParticleNi) detected.push('に');
    if (hasParticleDe) detected.push('で');
    if (detected.length) lines.push(`Detected in this answer: ${detected.join(' ')}`);

    lines.push('Rule-of-thumb: particles are chosen by grammatical role + what’s new/contrast, not by animacy.');
    lines.push('Animacy affects いる vs ある, but は/が/を are not “animate vs inanimate” markers.');

    if (hasParticleWa) {
      lines.push('は (topic/contrast): “as for …”. Often sets context, contrasts options, or marks something already in context.');
      lines.push('Common: X は Y です / X は (…verb…) / X は…が… (topic X, but …).');
    }
    if (hasParticleGa) {
      lines.push('が (subject/identifier): points out/identifies the subject. Common for new info, answering “who/what?”, and in many subordinate clauses.');
      lines.push('Common patterns: X が すき / X が ほしい / X が できる (these typically take が, not を).');
      lines.push('Also common with existence/state: ここに ねこが いる, じかんが ある, あめが ふっている.');
      lines.push('Tip: question-words often use が (だれが/なにが/どれが).');
    }
    if (hasParticleWo) {
      lines.push('を (direct object): marks what the verb acts on (買う/食べる/見る/する/etc.).');
      lines.push('Also used with some movement verbs: いえを でる (leave home), みちを あるく (walk along the road).');
      lines.push('Transitive vs intransitive often shows up as を vs が: ドアをあける (open [something]) vs ドアがあく (opens/is open).');
    }
    if (hasParticleWa && hasParticleGa) {
      lines.push('は vs が: both can appear with “subjects”, but は sets the topic/contrast while が identifies/focuses the subject.');
    }
    if (hasParticleNi) {
      lines.push('に: common for destination/time/indirect object (e.g. 店に行く, ３時に, 友だちにあげる).');
    }
    if (hasParticleDe) {
      lines.push('で: common for location of action/means (e.g. 店で買う, バスで行く).');
    }

    lines.push('Sources:');
    lines.push('- Tae Kim (particles / は & が): https://guidetojapanese.org/particles.html');
    lines.push('- Tae Kim (topic particles): https://guidetojapanese.org/learn/complete/topic_particles');
    lines.push('- Tae Kim (を/に/で): https://www.guidetojapanese.org/particles2.html');
    lines.push('- Wasabi (は vs が): https://wasabi-jpn.com/magazine/japanese-grammar/subjects-of-japanese-verbs-with-the-particles-wa-and-ga/');
    lines.push('- Wasabi (を/に/と objects): https://wasabi-jpn.com/magazine/japanese-grammar/objects-of-japanese-verbs-with-particles-o-ni-and-to/');
    lines.push('- IMABI (は topic/contrast): https://imabi.org/the-particle-wa-%e3%81%af-i-the-topic-contrast-marker/');
    return lines.join('\n');
  })();

  const breakdownText = (() => {
    const base = (card.background ?? '').trim();
    if (card.type !== 'sentence') return base;
    if (!showSentenceParticleNotes || !sentenceParticleNotes) return base;
    if (!base) return `Particle notes:\n${sentenceParticleNotes}`;
    return `${base}\n\nParticle notes:\n${sentenceParticleNotes}`;
  })();

  const sentenceStructure = (() => {
    if (card.type !== 'sentence') return '';
    const bg = card.background ?? '';
    const m = bg.match(/(?:^|\n)Structure:\s*(.+?)\s*(?:\n|$)/);
    return (m?.[1] ?? '').trim();
  })();

  const verbBaseEnglish = (() => {
    if (!showVerbHeader) return '';
    const raw = ((card.prompt ?? '').split(';')[0] ?? '').trim();
    if (!raw) return '';
    const m = raw.match(/^to\s+(.+)$/i);
    if (!m) return raw;
    const rest = (m[1] ?? '').trim();
    if (!rest) return 'To';
    return `To ${rest[0].toUpperCase()}${rest.slice(1)}`;
  })();

  const verbHeaderTarget = (() => {
    if (!showVerbHeader) return { label: '', suffix: '' };
    const full = verbFormLabel(card.verbForm);
    const m = full.match(/^(.*)\s+\((〜[^)]+)\)\s*$/);
    if (!m) return { label: full, suffix: '' };
    return { label: (m[1] ?? '').trim(), suffix: (m[2] ?? '').trim() };
  })();

  const verbHeaderClass = (() => {
    if (!showVerbHeader) return { label: '', rules: '' };
    const baseKana = (card.verbBaseKana || '').trim();
    const baseKanji = (card.verbBaseKanji || '').trim() || undefined;
    const cls = classifyVerb(baseKana, baseKanji);
    const label = cls === 'ichidan' ? 'Ichidan (る-verb)' : 'Godan (う-verb)';
    const rules =
      cls === 'ichidan'
        ? 'Drop る to get the stem, then attach endings (ます/ません/ない/て/た/etc.).'
        : 'Change the last kana based on the ending pattern (i-row for ます/ません, a-row for ない/なかった, and te/ta patterns for て/た).';
    return { label, rules };
  })();

  const verbRuleText = (() => {
    if (!showVerbHeader) return '';
    const baseKana = (card.verbBaseKana || '').trim();
    const baseKanji = (card.verbBaseKanji || '').trim() || undefined;
    const form = (card.verbForm || '').trim().toLowerCase();
    const answerDisp = (card?.kanji || card?.answer || '').trim();
    const baseDisp = baseKanji || baseKana || (card?.kanji || card?.answer || '').trim();
    const cls = classifyVerb(baseKana || (card?.kanji || card?.answer || '').trim(), baseKanji);

    const suruLike = !!baseKana && baseKana.endsWith('する');
    const kuruLike = !!baseKana && baseKana.endsWith('くる');
    const dropSuruOrKuru = (s: string): string => {
      if (!s) return s;
      if (s.endsWith('する')) return s.slice(0, -2);
      if (s.endsWith('くる') || s.endsWith('来る')) return s.slice(0, -2);
      return s;
    };

    const iRow: Record<string, string> = {
      う: 'い',
      く: 'き',
      ぐ: 'ぎ',
      す: 'し',
      つ: 'ち',
      ぬ: 'に',
      ぶ: 'び',
      む: 'み',
      る: 'り',
    };
    const aRow: Record<string, string> = {
      う: 'わ',
      く: 'か',
      ぐ: 'が',
      す: 'さ',
      つ: 'た',
      ぬ: 'な',
      ぶ: 'ば',
      む: 'ま',
      る: 'ら',
    };

    const baseEnd = lastKana(baseDisp);
    const baseStem = dropLastKana(baseDisp);
    const godanStem = `${baseStem}${iRow[baseEnd] ?? ''}`;
    const ichidanStem = dropLastKana(baseDisp);
    const stem = cls === 'ichidan' ? ichidanStem : godanStem;

    const header = `Base: ${baseDisp}\nClass: ${cls === 'ichidan' ? 'Ichidan (る-verb)' : 'Godan (う-verb)'}\nTarget: ${verbFormLabel(card.verbForm)}\n`;

    if (form === 'dictionary') {
      if (suruLike) return `${header}\nRule: する is irregular. (Use します/して/した/しない...)`;
      if (kuruLike || (baseKanji && baseKanji.endsWith('来る'))) return `${header}\nRule: くる/来る is irregular. (Use きます/きて/きた/こない...)`;
      return `${header}\nRule: dictionary form is the base form.`;
    }

    if (form === 'polite_present') {
      if (suruLike) {
        const prefix = dropSuruOrKuru(baseDisp);
        return `${header}\nRule: する → します (compound: …する → …します)\n${baseDisp} → ${prefix}します\nResult: ${answerDisp}`;
      }
      if (kuruLike || (baseKanji && baseKanji.endsWith('来る'))) {
        const prefix = dropSuruOrKuru(baseDisp);
        return `${header}\nRule: くる → きます (compound: …くる → …きます)\n${baseDisp} → ${prefix}きます\nResult: ${answerDisp}`;
      }
      if (cls === 'ichidan') return `${header}\nRule: drop る + ます\n${baseDisp} → ${stem}ます\nResult: ${answerDisp}`;
      return `${header}\nRule: change final kana to the i-row + ます\n${baseDisp} → ${stem}ます\nResult: ${answerDisp}`;
    }

    if (form === 'polite_negative') {
      if (suruLike) {
        const prefix = dropSuruOrKuru(baseDisp);
        return `${header}\nRule: する → しません (compound: …する → …しません)\n${baseDisp} → ${prefix}しません\nResult: ${answerDisp}`;
      }
      if (kuruLike || (baseKanji && baseKanji.endsWith('来る'))) {
        const prefix = dropSuruOrKuru(baseDisp);
        return `${header}\nRule: くる → きません (compound: …くる → …きません)\n${baseDisp} → ${prefix}きません\nResult: ${answerDisp}`;
      }
      if (baseKana === 'ある') return `${header}\nRule: ある polite negative is irregular\nある → ありません\nResult: ${answerDisp}`;
      if (cls === 'ichidan') return `${header}\nRule: drop る + ません\n${baseDisp} → ${stem}ません\nResult: ${answerDisp}`;
      return `${header}\nRule: change final kana to the i-row + ません\n${baseDisp} → ${stem}ません\nResult: ${answerDisp}`;
    }

    if (form === 'negative' || form === 'past_negative') {
      const tail = form === 'negative' ? 'ない' : 'なかった';
      if (suruLike) {
        const prefix = dropSuruOrKuru(baseDisp);
        return `${header}\nRule: する → し${tail} (compound: …する → …し${tail})\n${baseDisp} → ${prefix}し${tail}\nResult: ${answerDisp}`;
      }
      if (kuruLike || (baseKanji && baseKanji.endsWith('来る'))) {
        const prefix = dropSuruOrKuru(baseDisp);
        const alt = form === 'negative' ? 'こない' : 'こなかった';
        return `${header}\nRule: くる → ${alt} (compound: …くる → …${alt})\n${baseDisp} → ${prefix}${alt}\nResult: ${answerDisp}`;
      }
      if (baseKana === 'ある') return `${header}\nRule: ある is irregular in the negative\nある → ${tail}\nResult: ${answerDisp}`;
      if (cls === 'ichidan') return `${header}\nRule: drop る + ${tail}\n${baseDisp} → ${stem}${tail}\nResult: ${answerDisp}`;
      const end = lastKana(baseDisp);
      const negStem = `${dropLastKana(baseDisp)}${end === 'う' ? 'わ' : aRow[end] ?? ''}`;
      return `${header}\nRule: change final kana to the a-row + ${tail} (う → わ)\n${baseDisp} → ${negStem}${tail}\nResult: ${answerDisp}`;
    }

    if (form === 'te' || form === 'past') {
      if (suruLike) {
        const prefix = dropSuruOrKuru(baseDisp);
        const tail = form === 'te' ? 'して' : 'した';
        return `${header}\nRule: する → ${tail} (compound: …する → …${tail})\n${baseDisp} → ${prefix}${tail}\nResult: ${answerDisp}`;
      }
      if (kuruLike || (baseKanji && baseKanji.endsWith('来る'))) {
        const prefix = dropSuruOrKuru(baseDisp);
        const tail = form === 'te' ? 'きて' : 'きた';
        return `${header}\nRule: くる → ${tail} (compound: …くる → …${tail})\n${baseDisp} → ${prefix}${tail}\nResult: ${answerDisp}`;
      }
      if (baseKana === 'いく') {
        return `${header}\nRule: 行く/いく is irregular for te/past\nいく → ${form === 'te' ? 'いって' : 'いった'}\nResult: ${answerDisp}`;
      }
      if (cls === 'ichidan') {
        return `${header}\nRule: drop る + ${form === 'te' ? 'て' : 'た'}\n${baseDisp} → ${stem}${form === 'te' ? 'て' : 'た'}\nResult: ${answerDisp}`;
      }
      const end = lastKana(baseDisp);
      const te: Record<string, string> = { う: 'って', つ: 'って', る: 'って', む: 'んで', ぶ: 'んで', ぬ: 'んで', く: 'いて', ぐ: 'いで', す: 'して' };
      const ta: Record<string, string> = { う: 'った', つ: 'った', る: 'った', む: 'んだ', ぶ: 'んだ', ぬ: 'んだ', く: 'いた', ぐ: 'いだ', す: 'した' };
      const suffix = form === 'te' ? te[end] : ta[end];
      return `${header}\nRule: godan te/past uses an ending pattern based on the last kana\n…${end} → …${suffix}\nResult: ${answerDisp}`;
    }

    if (form === 'progressive') {
      const te = seedConjugateVerb(baseDisp, baseKana, 'te' as any, cls as any);
      return `${header}\nRule: progressive is te-form + いる\n${baseDisp} → ${te} + いる\nResult: ${answerDisp}`;
    }

    if (form === 'want' || form === 'dont_want' || form === 'want_past' || form === 'dont_want_past') {
      const tail =
        form === 'want'
          ? 'たい'
          : form === 'dont_want'
            ? 'たくない'
            : form === 'want_past'
              ? 'たかった'
              : 'たくなかった';
      if (suruLike) {
        const prefix = dropSuruOrKuru(baseDisp);
        const t =
          form === 'want'
            ? 'したい'
            : form === 'dont_want'
              ? 'したくない'
              : form === 'want_past'
                ? 'したかった'
                : 'したくなかった';
        return `${header}\nRule: する → ${t} (compound: …する → …${t})\n${baseDisp} → ${prefix}${t}\nResult: ${answerDisp}`;
      }
      if (kuruLike || (baseKanji && baseKanji.endsWith('来る'))) {
        const prefix = dropSuruOrKuru(baseDisp);
        const t =
          form === 'want'
            ? 'きたい'
            : form === 'dont_want'
              ? 'きたくない'
              : form === 'want_past'
                ? 'きたかった'
                : 'きたくなかった';
        return `${header}\nRule: くる → ${t} (compound: …くる → …${t})\n${baseDisp} → ${prefix}${t}\nResult: ${answerDisp}`;
      }
      return `${header}\nRule: attach ${tail} to the verb stem (ます-stem)\n${baseDisp} → ${stem}${tail}\nNote: 〜たい behaves like an i-adjective.\nResult: ${answerDisp}`;
    }

    return `${header}\nRule: (no rule available)`;
  })();

  let ladderStep = 1;
  let ladderTotal = 1;
  if (showVerbLadder) {
    let start = idx;
    while (start > 0 && verbGroupKeyForCardId(queue[start - 1]) === verbGroupKey) start--;
    let end = idx;
    while (end + 1 < queue.length && verbGroupKeyForCardId(queue[end + 1]) === verbGroupKey) end++;
    ladderStep = idx - start + 1;
    ladderTotal = end - start + 1;
  }

  const wk = wkByCardId[card.id] ?? { status: 'idle' as const };
  const wkKanjiSlug = card.kanji && !kanjiLooksLikeSentence ? card.kanji.trim() : '';
  const wkKanaSlug = (promptIsJapanese ? card.prompt : card.answer).trim();
  const wkSlugs = [wkKanjiSlug, wkKanaSlug].filter(Boolean).join(',');
  const wkQ = wkKanjiSlug || wkKanaSlug;
  const wkEligible = card.type !== 'sentence' && !!wkQ;
  const wkUrl = wk.status === 'loaded' ? wkSubjectUrl(wk.subject) : undefined;

  const lookupWk = async () => {
    const token = state.wkApiToken;
    if (!token) {
      setWkByCardId((prev) => ({
        ...prev,
        [card.id]: { status: 'error', message: 'No WaniKani token saved. Add it in Manage to enable lookups.' },
      }));
      return;
    }

    if (!wkEligible) return;

    setWkByCardId((prev) => ({ ...prev, [card.id]: { status: 'loading' } }));

    try {
      const params = new URLSearchParams({
        types: 'vocabulary,kanji',
        slugs: wkSlugs,
      });
      const res = await fetch(`https://api.wanikani.com/v2/subjects?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Wanikani-Revision': '20170710',
        },
      });

      if (!res.ok) {
        const msg = res.status === 401 ? 'Unauthorized (bad/expired token).' : `WaniKani error: ${res.status}`;
        setWkByCardId((prev) => ({ ...prev, [card.id]: { status: 'error', message: msg } }));
        return;
      }

      const body = (await res.json()) as { data?: WkSubject[] };
      const data = Array.isArray(body.data) ? body.data : [];

      const exact = data.find((s) => (s.data.characters ?? '').trim() === wkKanjiSlug) ??
        data.find((s) => (s.data.characters ?? '').trim() === wkKanaSlug);

      const chosen =
        exact ??
        data.find((s) => s.object === 'vocabulary') ??
        data.find((s) => s.object === 'kanji') ??
        data[0];

      if (!chosen) {
        setWkByCardId((prev) => ({ ...prev, [card.id]: { status: 'error', message: 'No match found on WaniKani.' } }));
        return;
      }

      setWkByCardId((prev) => ({ ...prev, [card.id]: { status: 'loaded', subject: chosen } }));
    } catch (err) {
      console.info('WaniKani lookup failed', err);
      setWkByCardId((prev) => ({
        ...prev,
        [card.id]: { status: 'error', message: 'Network error while contacting WaniKani.' },
      }));
    }
  };

  const onSubmit = () => {
    if (checked) return;
    const committed = answerIsJapanese
      ? isKatakanaDeck
        ? toKatakana(value, { passRomaji: false })
        : toHiragana(value, { passRomaji: false })
      : value.trim();
    setValue(committed);
    const correct = answerIsJapanese
      ? isKatakanaDeck
        ? normalizeKatakana(committed) === normalizeKatakana(card.answer)
        : isCorrect(committed, card.answer)
      : isCorrectEnglish(committed, card.answer);
    setChecked({ correct, expected: card.answer, got: committed });
    setShowDetails(true);

    const now = nowMs();
    const prev = state.srs[card.id] ?? defaultSrs(card.id, now);
    const next = applySm2(prev, { correct }, now);

    const prevStats = state.stats?.[card.id] ?? { reviews: 0, correct: 0 };
    const nextStats = {
      reviews: prevStats.reviews + 1,
      correct: prevStats.correct + (correct ? 1 : 0),
    };

    setState({
      ...state,
      srs: {
        ...state.srs,
        [card.id]: next,
      },
      stats: {
        ...(state.stats ?? {}),
        [card.id]: nextStats,
      },
    });
  };

  const onNext = () => {
    if (!checked) return;
    if (idx + 1 >= queue.length) {
      onExit();
      return;
    }
    setIdx(idx + 1);
  };

  const skipToNextUnskipped = (startAt: number): number | null => {
    for (let j = startAt; j < queue.length; j += 1) {
      const k = verbGroupKeyForCardId(queue[j]);
      if (k && skippedVerbGroupKeys[k]) continue;
      return j;
    }
    return null;
  };

  const onSkipVerb = () => {
    if (!verbGroupKey) return;
    setSkippedVerbGroupKeys((prev) => (prev[verbGroupKey] ? prev : { ...prev, [verbGroupKey]: true }));

    let nextIdx: number | null = null;
    for (let j = idx + 1; j < queue.length; j += 1) {
      const k = verbGroupKeyForCardId(queue[j]);
      if (k === verbGroupKey) continue;
      if (k && skippedVerbGroupKeys[k]) continue;
      nextIdx = j;
      break;
    }

    if (nextIdx === null) {
      const fallback = skipToNextUnskipped(idx + 1);
      if (fallback === null) onExit();
      else setIdx(fallback);
      return;
    }

    setIdx(nextIdx);
  };

  useEffect(() => {
    if (!isVerbGroupSkipped) return;
    const nextIdx = skipToNextUnskipped(idx + 1);
    if (nextIdx === null) onExit();
    else setIdx(nextIdx);
  }, [idx, isVerbGroupSkipped, onExit, setIdx, skippedVerbGroupKeys, verbGroupKey]);

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.repeat) return;

      e.preventDefault();

      if (!checked) {
        onSubmit();
        return;
      }

      onNext();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [checked, onNext, onSubmit]);

  const questionAndHints = (
    <>
      {showVerbHeader ? (
        <div style={{ marginBottom: 10 }}>
          {verbTargetGloss ? <div className="verbLadderVerb">{verbTargetGloss}</div> : null}

          <div className="small" style={{ marginTop: 6, fontWeight: 800 }}>
            {verbBaseEnglish}
            {verbHeaderTarget.label ? <span style={{ opacity: 0.9 }}> · {verbHeaderTarget.label}</span> : null}
            {verbHeaderTarget.suffix ? (
              <button
                type="button"
                onClick={() => setShowVerbSuffixHint((s) => !s)}
                style={{ marginLeft: 8, padding: '2px 8px', fontSize: 12, fontWeight: 800 }}
                title="Show/hide conjugation suffix hint"
              >
                {showVerbSuffixHint ? verbHeaderTarget.suffix : 'Suffix'}
              </button>
            ) : null}
          </div>

          {verbHeaderClass.label ? (
            <div className="small" style={{ marginTop: 6 }}>
              Class: <b>{verbHeaderClass.label}</b>
              {verbHeaderClass.rules ? (
                <button
                  type="button"
                  onClick={() => setShowVerbClassRules((s) => !s)}
                  style={{ marginLeft: 8, padding: '2px 8px', fontSize: 12, fontWeight: 800 }}
                  title="Show/hide rule-of-thumb for this verb class"
                >
                  {showVerbClassRules ? 'Hide rules' : 'Rules'}
                </button>
              ) : null}
              {showVerbClassRules && verbHeaderClass.rules ? (
                <div className="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap', opacity: 0.9 }}>
                  {verbHeaderClass.rules}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="small" style={{ marginTop: 6 }}>
            {showVerbLadder ? (
              <>
                Step: <b>{ladderStep}/{ladderTotal}</b>
              </>
            ) : (
              <>
                Mode: <b>Mixed</b>
              </>
            )}
          </div>
        </div>
      ) : null}
      {!showVerbHeader ? <p className={`prompt ${promptIsJapanese ? 'jpText' : ''}`}>{card.prompt}</p> : null}
      {promptIsJapanese && card.kanji ? (
        <div className="jpKanji" style={{ marginTop: 6 }}>
          {card.kanji}
        </div>
      ) : null}

      {hintText ? (
        !isSentenceWriting ? (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setShowHint((s) => !s)}>{showHint ? 'Hide hint' : 'Show hint'}</button>
          {showHint ? (
            <div className="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
              {hintText}
            </div>
          ) : null}
        </div>
        ) : null
      ) : null}

      {wkEligible ? (
        <div style={{ marginTop: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <button
              onClick={lookupWk}
              disabled={wk.status === 'loading'}
              title={state.wkApiToken ? 'Fetch details from WaniKani' : 'Add a token in Manage to enable API lookup'}
            >
              {wk.status === 'loading' ? 'WK…' : 'WK Lookup'}
            </button>
            <a className="small" href={wkSearchUrl(wkQ)} target="_blank" rel="noreferrer">
              Search WK
            </a>
            {wkUrl ? (
              <a className="small" href={wkUrl} target="_blank" rel="noreferrer">
                Open
              </a>
            ) : null}
          </div>

          {wk.status === 'error' ? (
            <div className="small" style={{ marginTop: 6 }}>
              {wk.message}
            </div>
          ) : null}

          {wk.status === 'loaded' ? (
            <div style={{ marginTop: 8 }}>
              <div className="small">WaniKani</div>
              <div className="small" style={{ marginTop: 4 }}>
                Level: <b>{wk.subject.data.level}</b>
              </div>
              <div className="small" style={{ marginTop: 4 }}>
                Meaning:{' '}
                <b>
                  {wk.subject.data.meanings
                    .filter((m) => m.primary)
                    .map((m) => m.meaning)
                    .join(', ') ||
                    wk.subject.data.meanings
                      .slice(0, 2)
                      .map((m) => m.meaning)
                      .join(', ')}
                </b>
              </div>
              {wk.subject.data.readings?.length ? (
                <div className="small" style={{ marginTop: 4 }}>
                  Reading:{' '}
                  <b>
                    {wk.subject.data.readings
                      .filter((r) => r.primary)
                      .map((r) => r.reading)
                      .join(', ') ||
                      wk.subject.data.readings
                        .filter((r) => r.accepted_answer)
                        .slice(0, 2)
                        .map((r) => r.reading)
                        .join(', ')}
                  </b>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );

  const answerAndKey = (
    <>
      <div className="answerBox">
        <label>{answerIsJapanese ? 'Answer (kana)' : 'Answer (English)'}</label>
        <input
          value={value}
          autoFocus
          className={answerIsJapanese ? 'jpInput' : undefined}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            if (answerIsJapanese) {
              setValue(
                isKatakanaDeck
                  ? toKatakana(e.target.value, { passRomaji: false, IMEMode: true })
                  : toHiragana(e.target.value, { passRomaji: false, IMEMode: true }),
              );
              return;
            }
            setValue(e.target.value);
          }}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              e.preventDefault();
            }
          }}
          placeholder={answerIsJapanese ? 'type romaji…' : 'type meaning…'}
        />
        <div className="small" style={{ marginTop: 8 }}>
          <span>
            Enter to {checked ? 'continue' : 'submit'}. Normalized:{' '}
          </span>
          <b>{answerIsJapanese ? (isKatakanaDeck ? normalizeKatakana(value) : normalizeJapanese(value)) : normalizeEnglish(value)}</b>
        </div>
      </div>

      {checked ? (
        <div className={`feedback ${checked.correct ? 'good' : 'bad'}`}>
          <div style={{ fontWeight: 900, color: checked.correct ? 'var(--good)' : 'var(--bad)' }}>
            {checked.correct ? 'Correct' : 'Incorrect'}
          </div>

          <div className="small" style={{ marginTop: 6 }}>
            Attempts: <b>{state.stats?.[card.id]?.reviews ?? 0}</b> · Correct:{' '}
            <b>{state.stats?.[card.id]?.correct ?? 0}</b>
          </div>

          <div style={{ marginTop: 10 }} className="row">
            <button onClick={() => setShowDetails((s) => !s)}>{showDetails ? 'Hide details' : 'Show details'}</button>
          </div>

          {showDetails ? (
            <>
              <div style={{ marginTop: 8 }} className="small">
                Expected
              </div>
              <div className={`expected ${answerIsJapanese ? 'jpText' : ''}`}>{checked.expected}</div>
              <div style={{ marginTop: 8 }} className="small">
                You typed
              </div>
              <div className={answerIsJapanese ? 'jpText' : undefined} style={{ fontWeight: 800 }}>
                {(answerIsJapanese
                  ? isKatakanaDeck
                    ? normalizeKatakana(checked.got)
                    : normalizeJapanese(checked.got)
                  : normalizeEnglish(checked.got)) || '—'}
              </div>
            </>
          ) : null}

          {infoKanji || card.pos || card.background || infoExamples?.length ? (
            <div style={{ marginTop: 12 }}>
              {infoKanji ? (
                <>
                  <div className="small">Kanji</div>
                  <div className="jpKanji" style={{ marginTop: 6 }}>
                    {infoKanji}
                  </div>
                </>
              ) : null}
              {card.pos ? (
                <>
                  <div className="small" style={{ marginTop: 10 }}>
                    Part of speech
                  </div>
                  <div style={{ marginTop: 6, fontWeight: 800 }}>{card.pos}</div>
                </>
              ) : null}
              {card.background ? (
                <>
                  <div className="small">{card.type === 'sentence' ? 'Breakdown' : card.type === 'verb' ? 'Explanation' : 'Background'}</div>
                  <div style={{ marginTop: 6, fontWeight: 700, whiteSpace: 'pre-wrap' }}>{breakdownText}</div>
                </>
              ) : null}
              {verbRuleText ? (
                <>
                  <div className="small" style={{ marginTop: 10 }}>
                    Conjugation rule
                  </div>
                  <div style={{ marginTop: 6, fontWeight: 700, whiteSpace: 'pre-wrap' }}>{verbRuleText}</div>
                </>
              ) : null}
              {infoExamples?.length ? (
                <>
                  <div style={{ marginTop: 10 }} className="small">
                    Examples
                  </div>
                  <div style={{ marginTop: 6 }}>
                    {infoExamples.map((ex, i) => {
                      return (
                        <div key={`${card.id}_ex_${i}`} style={{ marginTop: i === 0 ? 0 : 10 }}>
                          <div className="jpText" style={{ fontWeight: 800 }}>
                            {ex.ja}
                          </div>
                          {ex.kana ? (
                            <div className="jpText" style={{ fontWeight: 700, opacity: 0.85 }}>
                              {ex.kana}
                            </div>
                          ) : null}
                          {ex.en ? (
                            <div className="small" style={{ marginTop: 2, fontWeight: 700 }}>
                              {ex.en}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <div style={{ marginTop: 12 }} className="row">
            <button className="primary" onClick={onNext}>
              {idx + 1 >= queue.length ? 'Finish' : 'Next'}
            </button>
            {isVerbConjugationDeck && card.type === 'verb' ? (
              <button onClick={onSkipVerb} disabled={!verbGroupKey}>
                Skip this verb
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12 }} className="row">
          <button className="primary" onClick={onSubmit}>
            Check
          </button>
          {isVerbConjugationDeck && card.type === 'verb' ? (
            <button onClick={onSkipVerb} disabled={!verbGroupKey}>
              Skip this verb
            </button>
          ) : null}
        </div>
      )}
    </>
  );

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <div className="logo" />
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Review</div>
            <div className="small">
              Remaining: <b>{remaining}</b>
            </div>
          </div>
        </div>
        <div className="row">
          <button onClick={onExit}>Exit</button>
        </div>
      </div>

      <div className="reviewShell">
        <div className="reviewBanner" />
        <div className="reviewBody">
          {isSentenceWriting ? (
            <div className="small" style={{ marginBottom: 10 }}>
              Expected formality: <b>casual / plain</b>. Use kana. Avoid <b>です/ます</b> unless the English prompt implies polite
              speech.

              {hintText || sentenceStructure ? (
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => setShowHint((s) => !s)}>{showHint ? 'Hide hint' : 'Show hint'}</button>
                  {showHint ? (
                    <div className="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
                      {hintText ? `${hintText}\n` : ''}
                      {sentenceStructure ? `Structure: ${sentenceStructure}` : ''}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {showVerbHeader ? (
            <div className="reviewTwoCol">
              <div className="reviewTwoColLeft">{questionAndHints}</div>
              <div className="reviewTwoColRight">{answerAndKey}</div>
            </div>
          ) : (
            <>
              {questionAndHints}
              {answerAndKey}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ManageScreen(props: {
  state: AppState;
  setState: (s: AppState) => void;
  onBack: () => void;
  onReset: () => void;
}) {
  const { state, setState, onBack, onReset } = props;

  const deckList = useMemo<Deck[]>(
    () => {
      const vals = Object.values(state.decks) as Deck[];
      return [...vals].sort((a, b) => a.name.localeCompare(b.name));
    },
    [state.decks],
  );
  const [deckId, setDeckId] = useState<DeckId>(deckList[0]?.id ?? '');

  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [note, setNote] = useState('');
  const [pos, setPos] = useState('');
  const [kanji, setKanji] = useState('');
  const [background, setBackground] = useState('');
  const [examples, setExamples] = useState('');
  const [io, setIo] = useState('');
  const [wkTokenDraft, setWkTokenDraft] = useState(state.wkApiToken ?? '');
  const [wkTokenVisible, setWkTokenVisible] = useState(false);
  const [includeTokenInExport, setIncludeTokenInExport] = useState(false);
  const [wkImportBusy, setWkImportBusy] = useState(false);
  const [wkImportMsg, setWkImportMsg] = useState<string | null>(null);
  const [wkImportAlsoConjugate, setWkImportAlsoConjugate] = useState(true);

  useEffect(() => {
    if (!deckId && deckList[0]?.id) setDeckId(deckList[0].id);
  }, [deckId, deckList]);

  useEffect(() => {
    setWkTokenDraft(state.wkApiToken ?? '');
  }, [state.wkApiToken]);

  const wkFetchAll = async (token: string, url: string): Promise<WkSubject[]> => {
    const out: WkSubject[] = [];
    let next: string | null = url;
    let guard = 0;
    while (next) {
      guard += 1;
      if (guard > 50) throw new Error('Too many pages while importing WaniKani subjects.');

      const res = await fetch(next, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Wanikani-Revision': '20170710',
        },
      });

      if (!res.ok) {
        const msg = res.status === 401 ? 'Unauthorized (bad/expired token).' : `WaniKani error: ${res.status}`;
        throw new Error(msg);
      }

      const body = (await res.json()) as {
        data?: WkSubject[];
        pages?: { next_url?: string | null };
      };

      const data = Array.isArray(body.data) ? body.data : [];
      out.push(...data);
      next = body.pages?.next_url ?? null;
    }
    return out;
  };

  const wkPrimaryMeaning = (s: WkSubject): string => {
    const ms = s.data.meanings ?? [];
    return ms.find((m) => m.primary)?.meaning ?? ms[0]?.meaning ?? '';
  };

  const wkVerbCueMeaning = (s: WkSubject): string => {
    const ms = s.data.meanings ?? [];
    const list = ms.map((m) => (m.meaning ?? '').trim()).filter(Boolean);
    const toMeaning = list.find((m) => m.toLowerCase().startsWith('to '));
    return toMeaning ?? wkPrimaryMeaning(s);
  };

  const wkMeaningSummary = (s: WkSubject): string => {
    const ms = s.data.meanings ?? [];
    const list = ms.map((m) => m.meaning).filter(Boolean);
    const uniq = [...new Set(list)];
    return uniq.join('; ');
  };

  const wkPrimaryReading = (s: WkSubject): string => {
    const rs = s.data.readings ?? [];
    return rs.find((r) => r.primary)?.reading ?? rs.find((r) => r.accepted_answer)?.reading ?? rs[0]?.reading ?? '';
  };

  const onImportWkVerbs = async () => {
    const token = state.wkApiToken;
    if (!token) {
      setWkImportMsg('No WaniKani token saved. Save one above first.');
      return;
    }

    setWkImportMsg(null);
    setWkImportBusy(true);
    try {
      const levels = [1, 2, 3, 4, 5, 6];
      const params = new URLSearchParams({
        types: 'vocabulary',
        levels: levels.join(','),
      });
      const url = `https://api.wanikani.com/v2/subjects?${params.toString()}`;
      const subjects = await wkFetchAll(token, url);

      const vocabs = subjects.filter((s) => s.object === 'vocabulary');
      const verbsOnly = vocabs.filter((s) => (s.data.parts_of_speech ?? []).some((p) => /\bverb\b/.test(p.toLowerCase())));

      const wkVerbDeckName = 'WaniKani Verbs (L1–6)';
      const wkVerbDeckDesc = 'Imported from WaniKani API (levels 1–6) — English → Japanese (kana)';
      const existingWkVerbDeck = Object.values(state.decks).find((d) => d.name === wkVerbDeckName);
      const wkVerbDeckId = existingWkVerbDeck?.id ?? makeId('deck');

      const verbConjDeck = Object.values(state.decks).find((d) => d.name.toLowerCase().includes('verb conjugation'));
      const verbConjDeckId = verbConjDeck?.id;

      const existingKeys = new Set<string>();
      for (const c of Object.values(state.cards)) {
        const k = `${c.deckId}||${c.type}||${normalizeEnglish(c.prompt)}||${normalizeJapanese(c.answer)}||${(c.kanji ?? '').trim()}`;
        existingKeys.add(k);
      }

      const nextCards: Record<string, Card> = { ...state.cards };
      const nextDecks: AppState['decks'] = { ...state.decks };
      let addedVocab = 0;
      let addedConj = 0;

      if (!nextDecks[wkVerbDeckId]) {
        nextDecks[wkVerbDeckId] = {
          id: wkVerbDeckId,
          name: wkVerbDeckName,
          description: wkVerbDeckDesc,
          direction: 'en-ja',
          cardIds: [],
        };
      }

      const ensureDeckCardList = (did: DeckId) => {
        if (!nextDecks[did]) return;
        if (!Array.isArray(nextDecks[did].cardIds)) nextDecks[did] = { ...nextDecks[did], cardIds: [] };
      };
      ensureDeckCardList(wkVerbDeckId);
      if (verbConjDeckId) ensureDeckCardList(verbConjDeckId);

      const makeExampleSentences = (s: WkSubject): ExampleSentence[] | undefined => {
        const ctx = s.data.context_sentences ?? [];
        const ex = ctx
          .map((c) => ({ ja: (c.ja ?? '').trim(), en: (c.en ?? '').trim() }))
          .filter((e) => e.ja);
        return ex.length ? ex : undefined;
      };

      for (const s of verbsOnly) {
        const kana = wkPrimaryReading(s).trim();
        if (!kana) continue;
        const kanji = (s.data.characters ?? '').trim() || undefined;
        const english = wkVerbCueMeaning(s).trim();
        if (!english) continue;

        const pos = (s.data.parts_of_speech ?? []).join(', ') || 'verb';
        const meanings = wkMeaningSummary(s);
        const bg = `Source: WaniKani L${s.data.level}. Meanings: ${meanings}`;
        const ex = makeExampleSentences(s);

        const vocabCard: Card = {
          id: makeId('card'),
          deckId: wkVerbDeckId,
          type: 'vocab',
          pos,
          prompt: english,
          answer: normalizeJapanese(kana),
          note: toRomaji(kana),
          kanji,
          background: bg,
          exampleSentences: ex,
        };

        const vocabKey = `${vocabCard.deckId}||${vocabCard.type}||${normalizeEnglish(vocabCard.prompt)}||${normalizeJapanese(vocabCard.answer)}||${(vocabCard.kanji ?? '').trim()}`;
        if (!existingKeys.has(vocabKey)) {
          existingKeys.add(vocabKey);
          nextCards[vocabCard.id] = vocabCard;
          nextDecks[wkVerbDeckId] = {
            ...nextDecks[wkVerbDeckId],
            cardIds: [...nextDecks[wkVerbDeckId].cardIds, vocabCard.id],
          };
          addedVocab += 1;
        }

        if (wkImportAlsoConjugate && verbConjDeckId) {
          const forms: Array<
            | 'dictionary'
            | 'polite_present'
            | 'polite_negative'
            | 'te'
            | 'progressive'
            | 'past'
            | 'negative'
            | 'past_negative'
            | 'want'
            | 'dont_want'
            | 'want_past'
            | 'dont_want_past'
          > = [
            'dictionary',
            'polite_present',
            'polite_negative',
            'te',
            'progressive',
            'past',
            'negative',
            'past_negative',
            'want',
            'dont_want',
            'want_past',
            'dont_want_past',
          ];

          const cls = classifyVerb(kana, kanji);
          for (const form of forms) {
            const answerKana = seedConjugateVerb(kana, kana, form as any, cls as any);
            const answerKanji = kanji ? seedConjugateVerb(kanji, kana, form as any, cls as any) : undefined;
            const fromDisp = kanji || kana;
            const toDisp = answerKanji || answerKana;
            const conjBg = `Conjugation: ${fromDisp} → ${toDisp} (${seedVerbFormLabel(form as any)}). Source: WaniKani L${s.data.level}.`;

            const verbCard: Card = {
              id: makeId('card'),
              deckId: verbConjDeckId,
              type: 'verb',
              pos,
              prompt: english,
              answer: normalizeJapanese(answerKana),
              note: verbConjugationHintText(form as any, kana, cls as any, answerKana),
              kanji: answerKanji,
              background: conjBg,
              exampleSentences: ex,
              verbBaseKana: kana,
              verbBaseKanji: kanji,
              verbForm: form,
            };

            const verbKey = `${verbCard.deckId}||${verbCard.type}||${normalizeEnglish(verbCard.prompt)}||${normalizeJapanese(verbCard.answer)}||${(verbCard.kanji ?? '').trim()}`;
            if (existingKeys.has(verbKey)) continue;
            existingKeys.add(verbKey);
            nextCards[verbCard.id] = verbCard;
            nextDecks[verbConjDeckId] = {
              ...nextDecks[verbConjDeckId],
              cardIds: [...nextDecks[verbConjDeckId].cardIds, verbCard.id],
            };
            addedConj += 1;
          }
        }
      }

      setState({
        ...state,
        cards: nextCards,
        decks: nextDecks,
      });

      setWkImportMsg(
        `Imported WK L1–6 verbs. Added ${addedVocab} vocab card(s) to “WaniKani Verbs (L1–6)”.` +
          (wkImportAlsoConjugate && verbConjDeckId ? ` Added ${addedConj} conjugation card(s) to Verb Conjugation.` : ''),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error.';
      setWkImportMsg(msg);
    } finally {
      setWkImportBusy(false);
    }
  };

  const inferType = (d: string): Card['type'] => {
    const n = state.decks[d]?.name.toLowerCase() ?? '';
    if (n.includes('verb')) return 'verb';
    if (n.includes('sentence')) return 'sentence';
    return 'vocab';
  };

  const onAdd = () => {
    if (!deckId) return;
    const direction = state.decks[deckId]?.direction ?? 'en-ja';
    const isJaEn = direction === 'ja-en';

    const p = isJaEn ? normalizeJapanese(prompt) : prompt.trim();
    const a = isJaEn ? answer.trim() : normalizeJapanese(answer);
    if (!p || !a) {
      alert('Prompt and answer are required.');
      return;
    }

    const ex = examples
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line): ExampleSentence | undefined => {
        const parts = line.split('|').map((s) => s.trim());
        const ja = parts[0] ?? '';
        if (!ja) return undefined;
        const kana = parts[1] || undefined;
        const en = parts[2] || undefined;
        return { ja, kana, en };
      })
      .filter(Boolean) as ExampleSentence[];

    const exDeduped = dedupeExamples(ex);

    const newCard: Card = {
      id: makeId('card'),
      deckId,
      type: inferType(deckId),
      pos: pos.trim() || undefined,
      prompt: p,
      answer: a,
      note: note.trim() || undefined,
      kanji: kanji.trim() || undefined,
      background: background.trim() || undefined,
      exampleSentences: exDeduped.length ? exDeduped : undefined,
    };

    setState({
      ...state,
      cards: {
        ...state.cards,
        [newCard.id]: newCard,
      },
      decks: {
        ...state.decks,
        [deckId]: {
          ...state.decks[deckId],
          cardIds: [...state.decks[deckId].cardIds, newCard.id],
        },
      },
    });

    setPrompt('');
    setAnswer('');
    setNote('');
    setPos('');
    setKanji('');
    setBackground('');
    setExamples('');
  };

  const onExport = () => {
    const exportState: AppState = includeTokenInExport ? state : { ...state, wkApiToken: undefined };
    setIo(JSON.stringify(exportState, null, 2));
  };

  const onImport = () => {
    try {
      const parsed = JSON.parse(io) as AppState;
      if (!parsed || parsed.version !== 1) {
        alert('Invalid import.');
        return;
      }
      setState(parsed);
      alert('Imported.');
    } catch {
      alert('Invalid JSON.');
    }
  };

  const deck = state.decks[deckId];
  const direction = deck?.direction ?? 'en-ja';
  const isJaEn = direction === 'ja-en';
  const lastCards = deck ? deck.cardIds.slice(-12).map((id) => state.cards[id]).filter(Boolean) : [];

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <div className="logo" />
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Manage</div>
            <div className="small">Add cards, export/import, reset.</div>
          </div>
        </div>
        <div className="row">
          <button onClick={onBack}>Back</button>
          <button className="danger" onClick={onReset}>
            Reset
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 900 }}>WaniKani</div>
        <div className="small" style={{ marginTop: 6 }}>
          Optional: store your WaniKani API token locally (in your browser). Export redacts it by default.
        </div>
        <div style={{ marginTop: 12 }}>
          <label>API token</label>
          <input
            value={wkTokenDraft}
            type={wkTokenVisible ? 'text' : 'password'}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setWkTokenDraft(e.target.value)}
            placeholder="paste token…"
            autoComplete="off"
          />
        </div>
        <div style={{ marginTop: 10 }} className="row">
          <button onClick={() => setWkTokenVisible((v: boolean) => !v)}>{wkTokenVisible ? 'Hide' : 'Show'}</button>
          <button
            className="primary"
            onClick={() => setState({ ...state, wkApiToken: wkTokenDraft.trim() || undefined })}
            disabled={(wkTokenDraft.trim() || '') === (state.wkApiToken ?? '')}
          >
            Save token
          </button>
          <button
            className="danger"
            onClick={() => {
              setWkTokenDraft('');
              setState({ ...state, wkApiToken: undefined });
            }}
            disabled={!state.wkApiToken && !wkTokenDraft}
          >
            Clear
          </button>
          <div style={{ flex: 1 }} />
          <a
            className="small"
            href="https://www.wanikani.com/settings/personal_access_tokens"
            target="_blank"
            rel="noreferrer"
          >
            Get token
          </a>
        </div>
        {state.wkApiToken ? (
          <div className="small" style={{ marginTop: 8 }}>
            Saved token: <b>{`…${state.wkApiToken.slice(-4)}`}</b>
          </div>
        ) : (
          <div className="small" style={{ marginTop: 8 }}>No token saved.</div>
        )}

        <hr />
        <div style={{ fontWeight: 900 }}>Import</div>
        <div className="small" style={{ marginTop: 6 }}>
          Import verbs from WaniKani levels 1–6 using your saved token. Data source: WaniKani API.
        </div>
        <div style={{ marginTop: 10 }} className="row">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
            <input
              type="checkbox"
              checked={wkImportAlsoConjugate}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setWkImportAlsoConjugate(e.target.checked)}
              style={{ width: 'auto' }}
            />
            Also add conjugation ladders to Verb Conjugation
          </label>
        </div>
        <div style={{ marginTop: 10 }} className="row">
          <button className="primary" onClick={() => void onImportWkVerbs()} disabled={!state.wkApiToken || wkImportBusy}>
            {wkImportBusy ? 'Importing…' : 'Import WK verbs (L1–6)'}
          </button>
        </div>
        {wkImportMsg ? (
          <div className="small" style={{ marginTop: 8, fontWeight: 700 }}>
            {wkImportMsg}
          </div>
        ) : null}
      </div>

      <div className="card">
        <div style={{ fontWeight: 900 }}>Add Card</div>
        <div style={{ marginTop: 12 }} className="row">
          <div style={{ flex: 1, minWidth: 240 }}>
            <label>Deck</label>
            <select value={deckId} onChange={(e: ChangeEvent<HTMLSelectElement>) => setDeckId(e.target.value)}>
              {deckList.map((d: Deck) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 12 }} className="row">
          <div style={{ flex: 1, minWidth: 240 }}>
            <label>{isJaEn ? 'Prompt (Japanese)' : 'Prompt (English)'}</label>
            <input
              value={prompt}
              className={isJaEn ? 'jpInput' : undefined}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                if (isJaEn) {
                  setPrompt(toHiragana(e.target.value, { passRomaji: false, IMEMode: true }));
                  return;
                }
                setPrompt(e.target.value);
              }}
              placeholder={isJaEn ? 'e.g. もつ' : 'e.g. I want to go'}
            />
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label>{isJaEn ? 'Answer (English meaning)' : 'Answer (kana)'}</label>
            <input
              value={answer}
              className={!isJaEn ? 'jpInput' : undefined}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                if (isJaEn) {
                  setAnswer(e.target.value);
                  return;
                }
                setAnswer(toHiragana(e.target.value, { passRomaji: false, IMEMode: true }));
              }}
              placeholder={isJaEn ? 'e.g. to hold; to have' : 'e.g. いきたい'}
            />
            <div className="small" style={{ marginTop: 6 }}>
              Normalized: <b>{isJaEn ? normalizeEnglish(answer) : normalizeJapanese(answer)}</b>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label>Part of speech (optional)</label>
          <input
            value={pos}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPos(e.target.value)}
            placeholder="e.g. verb (transitive), i-adjective"
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <label>Kanji (optional)</label>
          <input
            value={kanji}
            className="jpInput"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setKanji(e.target.value)}
            placeholder="e.g. 持つ"
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <label>Note (optional)</label>
          <input
            value={note}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNote(e.target.value)}
            placeholder="e.g. romaji / hint"
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <label>Background (optional)</label>
          <textarea
            rows={3}
            value={background}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setBackground(e.target.value)}
            placeholder="mnemonic / usage notes"
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <label>Example sentences (optional)</label>
          <textarea
            rows={4}
            value={examples}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setExamples(e.target.value)}
            placeholder={'one per line\nFormat: ja | kana | en (kana/en optional)\n例: 日本語は楽しい。 | にほんごはたのしい。 | Japanese is fun.'}
          />
        </div>

        <div style={{ marginTop: 12 }} className="row">
          <button className="primary" onClick={onAdd}>
            Add
          </button>
          {deck ? (
            <div className="small">
              Deck cards: <b>{deck.cardIds.length}</b>
            </div>
          ) : null}
        </div>

        {lastCards.length ? (
          <div style={{ marginTop: 14 }}>
            <div className="small">Recently added</div>
            <div style={{ marginTop: 8 }} className="grid">
              {lastCards.map((c) => (
                <div key={c.id} className="card" style={{ padding: 12 }}>
                  <div style={{ fontWeight: 900 }}>{c.prompt}</div>
                  <div style={{ marginTop: 6, fontWeight: 800 }}>{c.answer}</div>
                  {c.pos ? <div className="small" style={{ marginTop: 6 }}>{c.pos}</div> : null}
                  {c.kanji ? (
                    <div className="jpKanji" style={{ marginTop: 6 }}>
                      {c.kanji}
                    </div>
                  ) : null}
                  {c.note ? <div className="small" style={{ marginTop: 6 }}>{c.note}</div> : null}
                  {c.background ? <div className="small" style={{ marginTop: 6 }}>{c.background}</div> : null}
                  {c.exampleSentences?.length ? (
                    <div className="small" style={{ marginTop: 6 }}>
                      Examples: <b>{c.exampleSentences.length}</b>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 12 }} className="card">
        <div style={{ fontWeight: 900 }}>Export / Import</div>
        <div className="small" style={{ marginTop: 6 }}>
          Export JSON to back up your cards and progress.
        </div>
        <div style={{ marginTop: 10 }} className="row">
          <input
            type="checkbox"
            checked={includeTokenInExport}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setIncludeTokenInExport(e.target.checked)}
          />
          <div className="small">Include WaniKani token in export</div>
        </div>
        <div style={{ marginTop: 12 }} className="row">
          <button onClick={onExport}>Export</button>
          <button onClick={onImport} className="primary">
            Import
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          <textarea
            rows={12}
            value={io}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setIo(e.target.value)}
            placeholder="Export will appear here…"
          />
        </div>
      </div>
    </div>
  );
}
function VocabBrowserScreen(props: { state: AppState; onBack: () => void }) {
  const { state, onBack } = props;
  const [q, setQ] = useState('');
  const [wkByKey, setWkByKey] = useState<Record<string, WkLookupState>>({});

  const lookupWk = async (entry: { key: string; ja: string; kanji?: string }) => {
    const token = state.wkApiToken;
    if (!token) {
      setWkByKey((prev) => ({
        ...prev,
        [entry.key]: { status: 'error', message: 'No WaniKani token saved. Add it in Manage to enable lookups.' },
      }));
      return;
    }

    setWkByKey((prev) => ({ ...prev, [entry.key]: { status: 'loading' } }));

    const slugA = (entry.kanji ?? '').trim();
    const slugB = (entry.ja ?? '').trim();
    const slugs = [slugA, slugB].filter(Boolean).join(',');

    try {
      const params = new URLSearchParams({
        types: 'vocabulary,kanji',
        slugs,
      });
      const res = await fetch(`https://api.wanikani.com/v2/subjects?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Wanikani-Revision': '20170710',
        },
      });

      if (!res.ok) {
        const msg = res.status === 401 ? 'Unauthorized (bad/expired token).' : `WaniKani error: ${res.status}`;
        setWkByKey((prev) => ({ ...prev, [entry.key]: { status: 'error', message: msg } }));
        return;
      }

      const body = (await res.json()) as { data?: WkSubject[] };
      const data = Array.isArray(body.data) ? body.data : [];

      const targetA = slugA;
      const targetB = slugB;

      const exact = data.find((s) => (s.data.characters ?? '').trim() === targetA) ??
        data.find((s) => (s.data.characters ?? '').trim() === targetB);

      const chosen =
        exact ??
        data.find((s) => s.object === 'vocabulary') ??
        data.find((s) => s.object === 'kanji') ??
        data[0];

      if (!chosen) {
        setWkByKey((prev) => ({ ...prev, [entry.key]: { status: 'error', message: 'No match found on WaniKani.' } }));
        return;
      }

      setWkByKey((prev) => ({ ...prev, [entry.key]: { status: 'loaded', subject: chosen } }));
    } catch (err) {
      console.info('WaniKani lookup failed', err);
      setWkByKey((prev) => ({
        ...prev,
        [entry.key]: { status: 'error', message: 'Network error while contacting WaniKani.' },
      }));
    }
  };

  const entries = useMemo(() => {
    const vocabCards = Object.values(state.cards).filter((c) => c.type === 'vocab');

    const byKey = new Map<
      string,
      {
        key: string;
        ja: string;
        en: string;
        kanji?: string;
        pos?: string;
        background?: string;
        examples?: ExampleSentence[];
        statsEnJa: { reviews: number; correct: number };
        statsJaEn: { reviews: number; correct: number };
      }
    >();

    for (const c of vocabCards) {
      const deck = state.decks[c.deckId];
      const direction = deck?.direction ?? 'en-ja';
      const ja = direction === 'ja-en' ? c.prompt : c.answer;
      const en = direction === 'ja-en' ? c.answer : c.prompt;
      const key = `${ja}||${en}`;

      const kanjiLooksLikeSentence = !!c.kanji && /[。？！\n\s]/.test(c.kanji);

      const normalizedExamples = dedupeExamples(
        normalizeExamples((c as unknown as { exampleSentences?: unknown }).exampleSentences),
      );

      const s = state.stats?.[c.id] ?? { reviews: 0, correct: 0 };

      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          ja,
          en,
          kanji: !kanjiLooksLikeSentence ? c.kanji : undefined,
          pos: c.pos,
          background: c.background,
          examples:
            kanjiLooksLikeSentence && c.kanji
              ? dedupeExamples([...normalizedExamples, { ja: c.kanji }])
              : normalizedExamples,
          statsEnJa: { reviews: 0, correct: 0 },
          statsJaEn: { reviews: 0, correct: 0 },
        });
      }

      const agg = byKey.get(key);
      if (!agg) continue;

      if (!agg.kanji && c.kanji && !kanjiLooksLikeSentence) agg.kanji = c.kanji;
      if (!agg.pos && c.pos) agg.pos = c.pos;
      if (!agg.background && c.background) agg.background = c.background;
      if ((!agg.examples || agg.examples.length === 0) && normalizedExamples.length) agg.examples = normalizedExamples;
      if ((!agg.examples || agg.examples.length === 0) && kanjiLooksLikeSentence && c.kanji) agg.examples = [{ ja: c.kanji }];

      if (direction === 'ja-en') {
        agg.statsJaEn.reviews += s.reviews;
        agg.statsJaEn.correct += s.correct;
      } else {
        agg.statsEnJa.reviews += s.reviews;
        agg.statsEnJa.correct += s.correct;
      }
    }

    const list = [...byKey.values()];
    list.sort((a, b) => a.en.localeCompare(b.en));
    return list;
  }, [state.cards, state.decks, state.stats]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return entries;
    return entries.filter((e) => {
      if (e.en.toLowerCase().includes(qq)) return true;
      if (e.ja.includes(qq)) return true;
      if (e.kanji && e.kanji.includes(qq)) return true;
      if (e.pos && e.pos.toLowerCase().includes(qq)) return true;
      return false;
    });
  }, [entries, q]);

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <div className="logo" />
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Vocab Browser</div>
            <div className="small">All vocab loaded (seed + your cards), with per-direction history.</div>
          </div>
        </div>
        <div className="row">
          <button onClick={onBack}>Back</button>
        </div>
      </div>

      <div className="card">
        <label>Search</label>
        <input
          value={q}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          placeholder="type English, kana, or kanji…"
        />
        <div className="small" style={{ marginTop: 8 }}>
          Showing <b>{filtered.length}</b> of <b>{entries.length}</b>
        </div>
      </div>

      <div style={{ marginTop: 12 }} className="grid">
        {filtered.map((e) => {
          const enJaAcc = e.statsEnJa.reviews ? Math.round((e.statsEnJa.correct / e.statsEnJa.reviews) * 100) : 0;
          const jaEnAcc = e.statsJaEn.reviews ? Math.round((e.statsJaEn.correct / e.statsJaEn.reviews) * 100) : 0;
          const wk = wkByKey[e.key] ?? { status: 'idle' as const };
          const wkQ = e.kanji ?? e.ja;
          const wkUrl = wk.status === 'loaded' ? wkSubjectUrl(wk.subject) : undefined;

          return (
            <div className="card" key={e.key}>
              <div style={{ fontWeight: 900 }}>{e.en}</div>
              <div className="jpText" style={{ marginTop: 6, fontWeight: 800 }}>
                {e.ja}
              </div>
              {e.kanji ? (
                <div className="jpKanji" style={{ marginTop: 6 }}>
                  {e.kanji}
                </div>
              ) : null}
              {e.pos ? <div className="small" style={{ marginTop: 6 }}>{e.pos}</div> : null}
              {e.background ? (
                <div className="small" style={{ marginTop: 6 }}>
                  Usage: <b>{e.background}</b>
                </div>
              ) : null}

              <div className="small" style={{ marginTop: 10 }}>
                EN→JA: <b>{e.statsEnJa.correct}</b>/<b>{e.statsEnJa.reviews}</b>
                {e.statsEnJa.reviews ? <span> ({enJaAcc}%)</span> : null}
              </div>
              <div className="small" style={{ marginTop: 4 }}>
                JP→EN: <b>{e.statsJaEn.correct}</b>/<b>{e.statsJaEn.reviews}</b>
                {e.statsJaEn.reviews ? <span> ({jaEnAcc}%)</span> : null}
              </div>

              <div className="row" style={{ marginTop: 10, gap: 8 }}>
                <button
                  onClick={() => lookupWk({ key: e.key, ja: e.ja, kanji: e.kanji })}
                  disabled={wk.status === 'loading'}
                  title={state.wkApiToken ? 'Fetch details from WaniKani' : 'Add a token in Manage to enable API lookup'}
                >
                  {wk.status === 'loading' ? 'WK…' : 'WK Lookup'}
                </button>
                <a className="small" href={wkSearchUrl(wkQ)} target="_blank" rel="noreferrer">
                  Search WK
                </a>
                {wkUrl ? (
                  <a className="small" href={wkUrl} target="_blank" rel="noreferrer">
                    Open
                  </a>
                ) : null}
              </div>

              {wk.status === 'error' ? (
                <div className="small" style={{ marginTop: 6 }}>
                  {wk.message}
                </div>
              ) : null}

              {wk.status === 'loaded' ? (
                <div style={{ marginTop: 8 }}>
                  <div className="small">WaniKani</div>
                  <div className="small" style={{ marginTop: 4 }}>
                    Level: <b>{wk.subject.data.level}</b>
                  </div>
                  <div className="small" style={{ marginTop: 4 }}>
                    Meaning:{' '}
                    <b>
                      {wk.subject.data.meanings
                        .filter((m) => m.primary)
                        .map((m) => m.meaning)
                        .join(', ') ||
                        wk.subject.data.meanings
                          .slice(0, 2)
                          .map((m) => m.meaning)
                          .join(', ')}
                    </b>
                  </div>
                  {wk.subject.data.readings?.length ? (
                    <div className="small" style={{ marginTop: 4 }}>
                      Reading:{' '}
                      <b>
                        {wk.subject.data.readings
                          .filter((r) => r.primary)
                          .map((r) => r.reading)
                          .join(', ') ||
                          wk.subject.data.readings
                            .filter((r) => r.accepted_answer)
                            .slice(0, 2)
                            .map((r) => r.reading)
                            .join(', ')}
                      </b>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {e.examples?.length ? (
                <div style={{ marginTop: 10 }}>
                  <div className="small">Example</div>
                  <div className="jpText" style={{ marginTop: 6, fontWeight: 800 }}>
                    {e.examples[0].ja}
                  </div>
                  {e.examples[0].kana ? (
                    <div className="jpText" style={{ marginTop: 2, fontWeight: 700, opacity: 0.85 }}>
                      {e.examples[0].kana}
                    </div>
                  ) : null}
                  {e.examples[0].en ? (
                    <div className="small" style={{ marginTop: 2, fontWeight: 700 }}>
                      {e.examples[0].en}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
