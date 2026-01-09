import { useEffect, useMemo, useState } from 'react';
import { toHiragana } from 'wanakana';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { AppState, Card, CardId, Deck, DeckId, ExampleSentence } from './lib/models';
import { isCorrect, isCorrectEnglish, normalizeEnglish, normalizeJapanese } from './lib/grading';
import { countDueForDeck, getDueCardIdsForDeck, getPracticeCardIdsForDeck } from './lib/queue';
import { applySm2, defaultSrs } from './lib/srs';
import { loadState, resetState, saveState } from './lib/storage';

type Screen =
  | { name: 'home' }
  | { name: 'review'; deckId: DeckId; queue: CardId[]; idx: number }
  | { name: 'manage' }
  | { name: 'vocab' };

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
type WkSubject = {
  id: number;
  object: 'kanji' | 'vocabulary' | 'radical' | string;
  data: {
    characters: string | null;
    level: number;
    meanings: WkMeaning[];
    readings?: WkReading[];
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

  useEffect(() => {
    (async () => {
      const st = await loadState();
      setState(st);
    })();
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
        <div className="card">Loading…</div>
      </div>
    );
  }

  const onStartReview = (deckId: DeckId) => {
    const now = nowMs();
    const queue = getDueCardIdsForDeck(state, deckId, now);
    if (queue.length === 0) {
      alert('No cards due right now for this deck.');
      return;
    }
    setScreen({ name: 'review', deckId, queue, idx: 0 });
  };

  const onStartPractice = (deckId: DeckId) => {
    const now = nowMs();
    const queue = getPracticeCardIdsForDeck(state, deckId, now, 20);
    if (queue.length === 0) {
      alert('No cards found in this deck.');
      return;
    }
    setScreen({ name: 'review', deckId, queue, idx: 0 });
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
        setIdx={(idx) => setScreen({ ...screen, idx })}
        onExit={() => setScreen({ name: 'home' })}
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
                <button onClick={() => onStartPractice(d.id)} disabled={d.cardIds.length === 0}>
                  Practice
                </button>
              </div>
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

function ReviewScreen(props: {
  state: AppState;
  setState: (s: AppState) => void;
  deckId: DeckId;
  queue: CardId[];
  idx: number;
  setIdx: (idx: number) => void;
  onExit: () => void;
}) {
  const { state, setState, deckId, queue, idx, setIdx, onExit } = props;
  const cardId = queue[idx];
  const card = state.cards[cardId];
  const deck = state.decks[deckId];
  const direction = deck?.direction ?? 'en-ja';
  const answerIsJapanese = direction !== 'ja-en';
  const promptIsJapanese = direction === 'ja-en';

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

  const [value, setValue] = useState('');
  const [checked, setChecked] = useState<null | { correct: boolean; expected: string; got: string }>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [wkByCardId, setWkByCardId] = useState<Record<string, WkLookupState>>({});

  useEffect(() => {
    setValue('');
    setChecked(null);
    setShowDetails(false);
    setShowHint(false);
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
    const committed = answerIsJapanese ? toHiragana(value, { passRomaji: false }) : value.trim();
    setValue(committed);
    const correct = answerIsJapanese ? isCorrect(committed, card.answer) : isCorrectEnglish(committed, card.answer);
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

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.repeat) return;

      e.preventDefault();

      if (!checked && hintText && !showHint) {
        setShowHint(true);
        return;
      }

      if (!checked) {
        onSubmit();
        return;
      }

      onNext();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [checked, hintText, onNext, onSubmit, showHint]);

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
          {card.type === 'sentence' && direction === 'en-ja' ? (
            <div className="small" style={{ marginBottom: 10 }}>
              Expected formality: <b>casual / plain</b>. Use kana. Avoid <b>です/ます</b> unless the English prompt implies polite
              speech.
            </div>
          ) : null}
          <p className={`prompt ${promptIsJapanese ? 'jpText' : ''}`}>{card.prompt}</p>
          {promptIsJapanese && card.kanji ? (
            <div className="jpKanji" style={{ marginTop: 6 }}>
              {card.kanji}
            </div>
          ) : null}

          {hintText ? (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setShowHint((s) => !s)}>{showHint ? 'Hide hint' : 'Show hint'}</button>
              {showHint ? (
                <div className="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
                  {hintText}
                </div>
              ) : null}
            </div>
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

          <div className="answerBox">
            <label>{answerIsJapanese ? 'Answer (kana)' : 'Answer (English)'}</label>
            <input
              value={value}
              autoFocus
              className={answerIsJapanese ? 'jpInput' : undefined}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                if (answerIsJapanese) {
                  setValue(toHiragana(e.target.value, { passRomaji: false, IMEMode: true }));
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
                Enter to {checked ? 'continue' : hintText && !showHint ? 'show hint' : 'submit'}. Normalized:{' '}
              </span>
              <b>{answerIsJapanese ? normalizeJapanese(value) : normalizeEnglish(value)}</b>
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
                <button onClick={() => setShowDetails((s) => !s)}>
                  {showDetails ? 'Hide details' : 'Show details'}
                </button>
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
                    {(answerIsJapanese ? normalizeJapanese(checked.got) : normalizeEnglish(checked.got)) || '—'}
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
                      <div className="small">
                        {card.type === 'sentence' ? 'Breakdown' : card.type === 'verb' ? 'Explanation' : 'Background'}
                      </div>
                      <div style={{ marginTop: 6, fontWeight: 700, whiteSpace: 'pre-wrap' }}>{card.background}</div>
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
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12 }} className="row">
              <button className="primary" onClick={onSubmit}>
                Check
              </button>
            </div>
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

  useEffect(() => {
    if (!deckId && deckList[0]?.id) setDeckId(deckList[0].id);
  }, [deckId, deckList]);

  useEffect(() => {
    setWkTokenDraft(state.wkApiToken ?? '');
  }, [state.wkApiToken]);

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
      id: `card_${crypto.randomUUID()}`,
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
