import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import { toHiragana } from 'wanakana';
import { importProgress, syncContent } from '../lib/wk/api';
import { clearWkProgress, loadWkContent, loadWkProgress, saveWkContent, saveWkProgress } from '../lib/wk/db';
import {
  applyReview,
  effectiveMaxLevel,
  emptyProgress,
  forecast,
  isPassed,
  lessonQueue,
  levelKanjiProgress,
  primaryMeaning,
  primaryReading,
  questionsFor,
  recordStats,
  refreshUnlocks,
  reviewQueue,
  srsFor,
  stageCounts,
  stageName,
  startAssignment,
  subjectsByLevel,
} from '../lib/wk/engine';
import { grade, acceptedMeanings } from '../lib/wk/grading';
import type { GradeResult } from '../lib/wk/grading';
import type { QuestionKind, WkContent, WkItemStats, WkNotes, WkProgress, WkSubject } from '../lib/wk/types';
import { WkMarkup } from './markup';

type View =
  | { name: 'dash' }
  | { name: 'lessons'; ids: number[] }
  | { name: 'session'; mode: 'review' | 'quiz'; ids: number[] }
  | { name: 'browse' }
  | { name: 'subject'; id: number };

type UpdateProgress = (fn: (p: WkProgress) => WkProgress) => void;

const TYPE_LABEL: Record<WkSubject['object'], string> = {
  radical: 'Radical',
  kanji: 'Kanji',
  vocabulary: 'Vocabulary',
  kana_vocabulary: 'Vocabulary',
};

const typeClass = (s: WkSubject) => (s.object === 'kana_vocabulary' ? 'vocabulary' : s.object);

const shuffle = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const fmtWhen = (t: number | undefined, now: number): string => {
  if (t == null) return '—';
  if (t <= now) return 'now';
  const h = (t - now) / 3_600_000;
  if (h < 24) return `in ${Math.max(1, Math.round(h))} h`;
  const d = h / 24;
  return d < 60 ? `in ${Math.round(d)} d` : new Date(t).toLocaleDateString();
};

export function WkApp(props: { token?: string; onBack: () => void; onOpenManage: () => void }) {
  const { token, onBack, onOpenManage } = props;
  const [content, setContent] = useState<WkContent | null>(null);
  const [progress, setProgress] = useState<WkProgress | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: 'dash' });
  const [now, setNow] = useState(Date.now());
  const history = useRef<View[]>([]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [c, p] = await Promise.all([loadWkContent(), loadWkProgress()]);
        setContent(c ?? null);
        setProgress(c ? refreshUnlocks(c, p ?? emptyProgress(), Date.now()) : (p ?? emptyProgress()));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setProgress(emptyProgress());
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (loaded && progress) void saveWkProgress(progress).catch((e) => setError(String(e)));
  }, [loaded, progress]);

  const update: UpdateProgress = useCallback(
    (fn) => setProgress((p) => (p && content ? refreshUnlocks(content, fn(p), Date.now()) : p)),
    [content],
  );

  const go = (v: View) => {
    history.current.push(view);
    setView(v);
  };
  const back = () => setView(history.current.pop() ?? { name: 'dash' });
  const home = () => {
    history.current = [];
    setNow(Date.now());
    setView({ name: 'dash' });
  };

  const run = async (label: string, fn: (msg: (m: string) => void) => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn((m) => setBusy(`${label} ${m}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const onSync = () =>
    run('Downloading content…', async (msg) => {
      if (!token) throw new Error('Add your WaniKani API token in Manage first.');
      const c = await syncContent(token, content ?? undefined, msg);
      await saveWkContent(c);
      setContent(c);
      setProgress((p) => refreshUnlocks(c, p ?? emptyProgress(), Date.now()));
    });

  const onImport = () => {
    if (!token) return setError('Add your WaniKani API token in Manage first.');
    if (progress && Object.keys(progress.assignments).length && !confirm('Replace local progress with your current WaniKani progress?')) return;
    void run('Importing progress…', async (msg) => {
      const p = await importProgress(token, progress ?? undefined, msg);
      setProgress(content ? refreshUnlocks(content, p, Date.now()) : p);
    });
  };

  const onResetProgress = async () => {
    if (!confirm('Reset all local WK progress back to level 1? (Content stays downloaded.)')) return;
    await clearWkProgress();
    const p = emptyProgress();
    setProgress(content ? refreshUnlocks(content, { ...p, settings: progress?.settings ?? p.settings }, Date.now()) : p);
  };

  if (!loaded || !progress) return <Shell title="WK Path" onBack={onBack}><div className="card">Loading…</div></Shell>;

  if (!content || !Object.keys(content.subjects).length) {
    return (
      <Shell title="WK Path" subtitle="WaniKani radicals, kanji and vocabulary, studied locally" onBack={onBack}>
        <div className="card">
          <div style={{ fontWeight: 900 }}>Download the WaniKani curriculum</div>
          <div className="small" style={{ marginTop: 6 }}>
            Fetches every radical, kanji and vocabulary item (meanings, readings, mnemonics, hints, context sentences, audio links,
            component relationships) with your API token and stores it in this browser only. After that, lessons and reviews run
            entirely offline using WaniKani's SRS rules.
          </div>
          {token ? null : (
            <div className="small" style={{ marginTop: 8 }}>
              No token yet. <button onClick={onOpenManage}>Add token in Manage</button>
            </div>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" disabled={!token || !!busy} onClick={() => void onSync()}>
              Download content
            </button>
          </div>
          <Status busy={busy} error={error} />
        </div>
      </Shell>
    );
  }

  const notesFor = (id: number) => progress.notes[id];

  if (view.name === 'lessons') {
    return (
      <LessonScreen
        content={content}
        progress={progress}
        ids={view.ids}
        onExit={home}
        onOpen={(id) => go({ name: 'subject', id })}
        onQuiz={() => setView({ name: 'session', mode: 'quiz', ids: view.ids })}
      />
    );
  }

  if (view.name === 'session') {
    return (
      <SessionScreen
        key={view.ids.join(',') + view.mode}
        content={content}
        progress={progress}
        mode={view.mode}
        ids={view.ids}
        update={update}
        notesFor={notesFor}
        onExit={home}
        onMoreLessons={() => {
          const next = lessonQueue(content, progress).slice(0, progress.settings.lessonBatchSize);
          if (next.length) setView({ name: 'lessons', ids: next.map((s) => s.id) });
          else home();
        }}
      />
    );
  }

  if (view.name === 'browse') {
    return <BrowseScreen content={content} progress={progress} onBack={back} onOpen={(id) => go({ name: 'subject', id })} />;
  }

  if (view.name === 'subject') {
    const s = content.subjects[view.id];
    return (
      <Shell title={s ? `${TYPE_LABEL[s.object]} · ${primaryMeaning(s)}` : 'Subject'} onBack={back}>
        {s ? (
          <SubjectInfo
            content={content}
            progress={progress}
            subject={s}
            now={now}
            onOpen={(id) => go({ name: 'subject', id })}
            onNotes={(n) => update((p) => ({ ...p, notes: { ...p.notes, [s.id]: n } }))}
          />
        ) : (
          <div className="card">Unknown subject.</div>
        )}
      </Shell>
    );
  }

  const lessons = lessonQueue(content, progress);
  const reviews = reviewQueue(content, progress, now);
  const counts = stageCounts(progress);
  const kanjiProg = levelKanjiProgress(content, progress, progress.level);
  const levelSubjects = subjectsByLevel(content).get(progress.level) ?? [];
  const radicals = levelSubjects.filter((s) => s.object === 'radical' && !s.data.hidden_at);
  const radicalsPassed = radicals.filter((s) => isPassed(progress.assignments[s.id], srsFor(content, s))).length;
  const fc = forecast(progress, now, 24).filter((b) => b.count > 0);
  const maxLevel = effectiveMaxLevel(content, progress);
  const settings = progress.settings;
  const setSettings = (patch: Partial<WkProgress['settings']>) => update((p) => ({ ...p, settings: { ...p.settings, ...patch } }));

  return (
    <Shell title="WK Path" subtitle={`Level ${progress.level} of ${maxLevel}`} onBack={onBack}>
      <div className="wkHeroRow">
        <button
          className="wkHero wkHero-lessons"
          disabled={!lessons.length}
          onClick={() => go({ name: 'lessons', ids: lessons.slice(0, settings.lessonBatchSize).map((s) => s.id) })}
        >
          <div className="wkHeroCount">{lessons.length}</div>
          <div>Lessons</div>
        </button>
        <button
          className="wkHero wkHero-reviews"
          disabled={!reviews.length}
          onClick={() => go({ name: 'session', mode: 'review', ids: shuffle(reviews.map((s) => s.id)) })}
        >
          <div className="wkHeroCount">{reviews.length}</div>
          <div>Reviews</div>
        </button>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 900 }}>Level {progress.level} progress</div>
          <button onClick={() => go({ name: 'browse' })}>Browse levels &amp; search</button>
        </div>
        <ProgressBar label="Radicals passed" value={radicalsPassed} total={radicals.length} cls="radical" />
        <ProgressBar label={`Kanji passed (need ${kanjiProg.needed} to level up)`} value={kanjiProg.passed} total={kanjiProg.total} cls="kanji" />
        <div className="wkStageRow">
          {(['apprentice', 'guru', 'master', 'enlightened', 'burned'] as const).map((g) => (
            <div key={g} className={`wkStage wkStage-${g}`}>
              <div className="wkStageCount">{counts[g]}</div>
              <div>{g}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 900 }}>Review forecast (next 24 h)</div>
        {fc.length ? (
          <div className="wkForecast">
            {fc.map((b) => (
              <div key={b.at} className="row" style={{ gap: 8 }}>
                <span className="small" style={{ width: 90 }}>
                  {new Date(b.at).toLocaleTimeString([], { weekday: 'short', hour: 'numeric' })}
                </span>
                <span className="wkForecastBar" style={{ width: `${Math.min(100, b.count * 4)}%` }} />
                <b>+{b.count}</b>
                <span className="small">({b.cumulative + reviews.length})</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="small" style={{ marginTop: 6 }}>Nothing scheduled in the next 24 hours.</div>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 900 }}>Settings &amp; data</div>
        <div className="row" style={{ marginTop: 10 }}>
          <div style={{ minWidth: 160 }}>
            <label>Lesson batch size</label>
            <input type="number" min={1} max={50} value={settings.lessonBatchSize} onChange={(e) => setSettings({ lessonBatchSize: Math.max(1, Math.min(50, Number(e.target.value) || 5)) })} />
          </div>
          <div style={{ minWidth: 160 }}>
            <label>Max level (cap {content.maxLevelGranted})</label>
            <input type="number" min={1} max={60} value={settings.maxLevel} onChange={(e) => setSettings({ maxLevel: Math.max(1, Math.min(60, Number(e.target.value) || 60)) })} />
          </div>
          <div style={{ minWidth: 160 }}>
            <label>Voice</label>
            <select value={settings.voice} onChange={(e) => setSettings({ voice: e.target.value as 'female' | 'male' })}>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={settings.autoplayAudio} onChange={(e) => setSettings({ autoplayAudio: e.target.checked })} />
            Autoplay vocab audio
          </label>
        </div>
        <div className="small" style={{ marginTop: 10 }}>
          {Object.keys(content.subjects).length} subjects stored locally · last synced {content.syncedAt ? new Date(content.syncedAt).toLocaleString() : 'never'}
          {progress.importedAt ? ` · progress imported ${new Date(progress.importedAt).toLocaleString()}` : ''}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button disabled={!token || !!busy} onClick={() => void onSync()}>Refresh content</button>
          <button disabled={!token || !!busy} onClick={onImport}>Import my WaniKani progress</button>
          <button className="danger" disabled={!!busy} onClick={() => void onResetProgress()}>Reset local progress</button>
        </div>
        <Status busy={busy} error={error} />
      </div>
    </Shell>
  );
}

function Shell(props: { title: string; subtitle?: string; onBack: () => void; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <div className="logo" />
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>{props.title}</div>
            {props.subtitle ? <div className="small">{props.subtitle}</div> : null}
          </div>
        </div>
        <div className="row">
          {props.right}
          <button onClick={props.onBack}>Back</button>
        </div>
      </div>
      {props.children}
    </div>
  );
}

function Status({ busy, error }: { busy: string | null; error: string | null }) {
  if (!busy && !error) return null;
  return (
    <div className="small" style={{ marginTop: 8, color: error ? 'var(--bad)' : undefined }}>
      {error ?? busy}
    </div>
  );
}

function ProgressBar({ label, value, total, cls }: { label: string; value: number; total: number; cls: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="small">
        {label}: <b>{value}</b> / {total}
      </div>
      <div className="wkBar">
        <div className={`wkBarFill wkBg-${cls}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Characters({ content, subject, size }: { content: WkContent; subject: WkSubject; size?: number }) {
  if (subject.data.characters) return <span lang="ja">{subject.data.characters}</span>;
  const svg = content.radicalSvgs?.[subject.id];
  const src = svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : subject.data.character_images?.[0]?.url;
  return src ? <img className="wkRadicalImg" src={src} alt={primaryMeaning(subject)} style={{ height: size ?? '1em' }} /> : <span>?</span>;
}

function Chip({ content, progress, subject, onOpen }: { content: WkContent; progress?: WkProgress; subject?: WkSubject; onOpen: (id: number) => void }) {
  if (!subject) return null;
  const a = progress?.assignments[subject.id];
  return (
    <button className={`wkChip wkBg-${typeClass(subject)}`} onClick={() => onOpen(subject.id)} title={a ? stageName(a.burnedAt ? 9 : a.stage) : 'Locked'}>
      <span className="wkChipChars">
        <Characters content={content} subject={subject} />
      </span>
      <span className="wkChipText">
        <span>{primaryMeaning(subject)}</span>
        {subject.object !== 'radical' ? <span lang="ja">{primaryReading(subject)}</span> : null}
      </span>
    </button>
  );
}

const pickAudio = (s: WkSubject, voice: 'female' | 'male') => {
  const audios = s.data.pronunciation_audios ?? [];
  const pref = (a: (typeof audios)[number]) => (a.metadata.gender === voice ? 0 : 2) + (a.content_type === 'audio/mpeg' ? 0 : 1);
  return [...audios].sort((a, b) => pref(a) - pref(b));
};

export const playAudio = (s: WkSubject, voice: 'female' | 'male', pronunciation?: string) => {
  const list = pickAudio(s, voice).filter((a) => !pronunciation || !a.metadata.pronunciation || a.metadata.pronunciation === pronunciation);
  const a = list[0] ?? pickAudio(s, voice)[0];
  if (a) void new Audio(a.url).play().catch(() => undefined);
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="wkSection">
      <div className="wkSectionTitle">{title}</div>
      {children}
    </div>
  );
}

type InfoTab = 'composition' | 'meaning' | 'reading' | 'context' | 'progress';

const tabsFor = (s: WkSubject): InfoTab[] =>
  s.object === 'radical'
    ? ['meaning', 'context']
    : s.object === 'kanji'
      ? ['composition', 'meaning', 'reading', 'context']
      : s.object === 'kana_vocabulary'
        ? ['meaning', 'context']
        : ['composition', 'meaning', 'reading', 'context'];

const TAB_LABEL: Record<InfoTab, (s: WkSubject) => string> = {
  composition: (s) => (s.object === 'kanji' ? 'Radicals' : 'Kanji composition'),
  meaning: (s) => (s.object === 'radical' ? 'Name' : 'Meaning'),
  reading: () => 'Reading',
  context: (s) => (s.object === 'radical' ? 'Found in kanji' : s.object === 'kanji' ? 'Found in vocabulary' : 'Context'),
  progress: () => 'Progress',
};

function SubjectHeader({ content, subject }: { content: WkContent; subject: WkSubject }) {
  return (
    <div className={`wkSubjectHeader wkBg-${typeClass(subject)}`}>
      <div className="wkSubjectChars">
        <Characters content={content} subject={subject} size={72} />
      </div>
      <div>
        <div className="wkSubjectMeaning">{primaryMeaning(subject)}</div>
        <div className="small" style={{ color: 'rgba(255,255,255,0.85)' }}>
          {TYPE_LABEL[subject.object]} · Level {subject.data.level}
          {subject.object !== 'radical' && primaryReading(subject) ? <span lang="ja"> · {primaryReading(subject)}</span> : null}
        </div>
      </div>
    </div>
  );
}

function InfoTabBody(props: {
  tab: InfoTab;
  content: WkContent;
  progress: WkProgress;
  subject: WkSubject;
  onOpen: (id: number) => void;
}) {
  const { tab, content, progress, subject: s, onOpen } = props;
  const notes = progress.notes[s.id];
  const voice = progress.settings.voice;
  const sub = (id: number) => content.subjects[id];

  if (tab === 'composition') {
    const comps = s.data.component_subject_ids ?? [];
    return (
      <Section title={TAB_LABEL.composition(s)}>
        <div className="wkChips">{comps.map((id) => <Chip key={id} content={content} progress={progress} subject={sub(id)} onOpen={onOpen} />)}</div>
        {!comps.length ? <div className="small">No components.</div> : null}
      </Section>
    );
  }

  if (tab === 'meaning') {
    const alts = s.data.meanings.filter((m) => !m.primary).map((m) => m.meaning);
    const white = s.data.auxiliary_meanings.filter((m) => m.type === 'whitelist').map((m) => m.meaning);
    return (
      <>
        <Section title={TAB_LABEL.meaning(s)}>
          <div>
            <b>Primary:</b> {primaryMeaning(s)}
          </div>
          {alts.length ? (
            <div>
              <b>Alternatives:</b> {alts.join(', ')}
            </div>
          ) : null}
          {white.length ? <div className="small">Also accepted: {white.join(', ')}</div> : null}
          {notes?.synonyms?.length ? <div className="small">Your synonyms: {notes.synonyms.join(', ')}</div> : null}
          {s.data.parts_of_speech?.length ? <div className="small">Word type: {s.data.parts_of_speech.join(', ')}</div> : null}
        </Section>
        <Section title="Mnemonic">
          <WkMarkup text={s.data.meaning_mnemonic} />
          {s.data.meaning_hint ? (
            <div className="wkHint">
              <b>Hint</b>
              <WkMarkup text={s.data.meaning_hint} />
            </div>
          ) : null}
          {notes?.meaningNote ? <div className="wkNote"><b>Your note:</b> {notes.meaningNote}</div> : null}
        </Section>
      </>
    );
  }

  if (tab === 'reading') {
    const rs = s.data.readings ?? [];
    return (
      <>
        <Section title="Readings">
          {s.object === 'kanji' ? (
            <div className="wkReadingGrid">
              {(['onyomi', 'kunyomi', 'nanori'] as const).map((t) => {
                const list = rs.filter((r) => r.type === t);
                return (
                  <div key={t} className={list.some((r) => r.accepted_answer) ? 'wkReadingCol wkReadingCol-on' : 'wkReadingCol'}>
                    <div className="small">{t === 'onyomi' ? "On'yomi" : t === 'kunyomi' ? "Kun'yomi" : 'Nanori'}</div>
                    <div lang="ja" className="jpText">{list.map((r) => r.reading).join('、') || '—'}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="row">
              {rs.map((r) => (
                <button key={r.reading} className="wkReadingBtn" onClick={() => playAudio(s, voice, r.reading)} title="Play audio">
                  <span lang="ja" className="jpText">{r.reading}</span> ▶
                </button>
              ))}
            </div>
          )}
        </Section>
        <Section title="Mnemonic">
          <WkMarkup text={s.data.reading_mnemonic} />
          {s.data.reading_hint ? (
            <div className="wkHint">
              <b>Hint</b>
              <WkMarkup text={s.data.reading_hint} />
            </div>
          ) : null}
          {notes?.readingNote ? <div className="wkNote"><b>Your note:</b> {notes.readingNote}</div> : null}
        </Section>
      </>
    );
  }

  if (tab === 'context') {
    if (s.object === 'radical' || s.object === 'kanji') {
      const ids = s.data.amalgamation_subject_ids ?? [];
      const similar = s.data.visually_similar_subject_ids ?? [];
      return (
        <>
          <Section title={TAB_LABEL.context(s)}>
            <div className="wkChips">{ids.map((id) => <Chip key={id} content={content} progress={progress} subject={sub(id)} onOpen={onOpen} />)}</div>
            {!ids.length ? <div className="small">None.</div> : null}
          </Section>
          {similar.length ? (
            <Section title="Visually similar kanji">
              <div className="wkChips">{similar.map((id) => <Chip key={id} content={content} progress={progress} subject={sub(id)} onOpen={onOpen} />)}</div>
            </Section>
          ) : null}
        </>
      );
    }
    return (
      <>
        <Section title="Context sentences">
          {(s.data.context_sentences ?? []).map((c, i) => (
            <div key={i} className="wkSentence">
              <div lang="ja" className="jpText" style={{ fontSize: 20 }}>{c.ja}</div>
              <div className="small">{c.en}</div>
            </div>
          ))}
          {s.object === 'kana_vocabulary' && s.data.pronunciation_audios?.length ? (
            <button className="wkReadingBtn" onClick={() => playAudio(s, voice)}>▶ Play audio</button>
          ) : null}
        </Section>
      </>
    );
  }
  return null;
}

function SubjectInfo(props: {
  content: WkContent;
  progress: WkProgress;
  subject: WkSubject;
  now: number;
  onOpen: (id: number) => void;
  onNotes?: (n: WkNotes) => void;
  compact?: boolean;
}) {
  const { content, progress, subject: s, now, onOpen, onNotes, compact } = props;
  const a = progress.assignments[s.id];
  const st = progress.stats[s.id];
  const tabs = tabsFor(s);
  const total = st ? st.meaningCorrect + st.meaningIncorrect + st.readingCorrect + st.readingIncorrect : 0;
  const correct = st ? st.meaningCorrect + st.readingCorrect : 0;
  return (
    <div className="card wkInfo">
      {compact ? null : <SubjectHeader content={content} subject={s} />}
      {tabs.map((t) => (
        <InfoTabBody key={t} tab={t} content={content} progress={progress} subject={s} onOpen={onOpen} />
      ))}
      <Section title="Your progression">
        <div className="small">
          Stage: <b>{a ? stageName(a.burnedAt ? 9 : a.stage) : 'Locked'}</b>
          {a?.availableAt ? <> · next review {fmtWhen(a.availableAt, now)}</> : null}
          {a?.passedAt ? <> · passed {new Date(a.passedAt).toLocaleDateString()}</> : null}
          {total ? <> · {Math.round((correct / total) * 100)}% correct over {total} answers</> : null}
        </div>
        {s.data.document_url ? (
          <div className="small" style={{ marginTop: 4 }}>
            <a href={s.data.document_url} target="_blank" rel="noreferrer">Open on wanikani.com</a>
          </div>
        ) : null}
      </Section>
      {onNotes ? <NotesEditor subject={s} notes={progress.notes[s.id]} onSave={onNotes} /> : null}
    </div>
  );
}

function NotesEditor({ subject, notes, onSave }: { subject: WkSubject; notes?: WkNotes; onSave: (n: WkNotes) => void }) {
  const [meaningNote, setMeaningNote] = useState(notes?.meaningNote ?? '');
  const [readingNote, setReadingNote] = useState(notes?.readingNote ?? '');
  const [synonyms, setSynonyms] = useState((notes?.synonyms ?? []).join(', '));
  useEffect(() => {
    setMeaningNote(notes?.meaningNote ?? '');
    setReadingNote(notes?.readingNote ?? '');
    setSynonyms((notes?.synonyms ?? []).join(', '));
  }, [subject.id, notes]);
  const save = () =>
    onSave({
      meaningNote: meaningNote.trim() || undefined,
      readingNote: readingNote.trim() || undefined,
      synonyms: synonyms.split(',').map((x) => x.trim()).filter(Boolean),
    });
  return (
    <Section title="Your notes & synonyms">
      <label>Meaning note</label>
      <textarea rows={2} value={meaningNote} onChange={(e) => setMeaningNote(e.target.value)} />
      {subject.object === 'kanji' || subject.object === 'vocabulary' ? (
        <>
          <label style={{ marginTop: 8 }}>Reading note</label>
          <textarea rows={2} value={readingNote} onChange={(e) => setReadingNote(e.target.value)} />
        </>
      ) : null}
      <label style={{ marginTop: 8 }}>Extra accepted meanings (comma-separated)</label>
      <input value={synonyms} onChange={(e) => setSynonyms(e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={save}>Save notes</button>
      </div>
    </Section>
  );
}

function LessonScreen(props: {
  content: WkContent;
  progress: WkProgress;
  ids: number[];
  onExit: () => void;
  onOpen: (id: number) => void;
  onQuiz: () => void;
}) {
  const { content, progress, ids, onExit, onOpen, onQuiz } = props;
  const subjects = ids.map((id) => content.subjects[id]).filter(Boolean);
  const [idx, setIdx] = useState(0);
  const [tabIdx, setTabIdx] = useState(0);
  const s = subjects[idx];
  const tabs = s ? tabsFor(s) : [];
  const tab = tabs[Math.min(tabIdx, tabs.length - 1)];
  const isLast = idx === subjects.length - 1 && tabIdx >= tabs.length - 1;

  const next = useCallback(() => {
    if (!s) return;
    if (tabIdx < tabs.length - 1) setTabIdx(tabIdx + 1);
    else if (idx < subjects.length - 1) {
      setIdx(idx + 1);
      setTabIdx(0);
    } else onQuiz();
  }, [s, tabIdx, tabs.length, idx, subjects.length, onQuiz]);
  const prev = () => {
    if (tabIdx > 0) setTabIdx(tabIdx - 1);
    else if (idx > 0) {
      setIdx(idx - 1);
      setTabIdx(tabsFor(subjects[idx - 1]).length - 1);
    }
  };

  useEffect(() => {
    if (s && tab === 'reading' && s.object === 'vocabulary' && progress.settings.autoplayAudio) playAudio(s, progress.settings.voice);
  }, [s, tab, progress.settings.autoplayAudio, progress.settings.voice]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || (e.key === 'Enter' && tag !== 'BUTTON')) next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!s) return <Shell title="Lessons" onBack={onExit}><div className="card">No lessons.</div></Shell>;

  return (
    <Shell title="Lessons" subtitle={`${idx + 1} / ${subjects.length}`} onBack={onExit} right={<button onClick={onQuiz}>Skip to quiz</button>}>
      <div className="wkLessonStrip">
        {subjects.map((x, i) => (
          <button key={x.id} className={`wkLessonDot wkBg-${typeClass(x)} ${i === idx ? 'active' : ''}`} onClick={() => { setIdx(i); setTabIdx(0); }}>
            <Characters content={content} subject={x} />
          </button>
        ))}
      </div>
      <div className="card wkInfo" style={{ marginTop: 12 }}>
        <SubjectHeader content={content} subject={s} />
        <div className="wkTabs">
          {tabs.map((t, i) => (
            <button key={t} className={i === tabIdx ? 'active' : ''} onClick={() => setTabIdx(i)}>
              {TAB_LABEL[t](s)}
            </button>
          ))}
        </div>
        {tab ? <InfoTabBody tab={tab} content={content} progress={progress} subject={s} onOpen={onOpen} /> : null}
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <button onClick={prev} disabled={idx === 0 && tabIdx === 0}>← Previous</button>
          <button className="primary" onClick={next}>{isLast ? 'Start quiz' : 'Next →'}</button>
        </div>
      </div>
    </Shell>
  );
}

type Question = { id: number; kind: QuestionKind };
type Tally = { mi: number; ri: number; doneM: boolean; doneR: boolean; stats?: WkItemStats };
type Answered = { q: Question; input: string; result: GradeResult; prev: { queue: Question[]; tally: Record<number, Tally> } };
type Done = { id: number; from: number; to: number; perfect: boolean };

function SessionScreen(props: {
  content: WkContent;
  progress: WkProgress;
  mode: 'review' | 'quiz';
  ids: number[];
  update: UpdateProgress;
  notesFor: (id: number) => WkNotes | undefined;
  onExit: () => void;
  onMoreLessons: () => void;
}) {
  const { content, progress, mode, ids, update, notesFor, onExit, onMoreLessons } = props;
  const initial = useMemo(() => {
    const qs: Question[] = [];
    for (const id of ids) {
      const s = content.subjects[id];
      if (s) for (const kind of questionsFor(s)) qs.push({ id, kind });
    }
    return shuffle(qs);
  }, [content, ids]);
  const [queue, setQueue] = useState<Question[]>(initial);
  const [tally, setTally] = useState<Record<number, Tally>>({});
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [done, setDone] = useState<Done[]>([]);
  const [wrapUp, setWrapUp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = queue[0];
  const s = q ? content.subjects[q.id] : undefined;

  useEffect(() => {
    inputRef.current?.focus();
  }, [q, answered]);

  const finishSubject = (id: number, t: Tally) => {
    const subj = content.subjects[id];
    if (!subj) return;
    const sys = srsFor(content, subj);
    const now = Date.now();
    const a = progress.assignments[id] ?? { subjectId: id, stage: 0 };
    const next = mode === 'quiz' ? startAssignment(sys, a, now) : applyReview(sys, a, t.mi, t.ri, now);
    update((p) => {
      const stats = mode === 'review' && t.stats ? addStats(p.stats[id], t.stats) : p.stats[id];
      return { ...p, assignments: { ...p.assignments, [id]: next }, stats: stats ? { ...p.stats, [id]: stats } : p.stats };
    });
    setDone((d) => [...d, { id, from: a.stage, to: next.stage, perfect: t.mi + t.ri === 0 }]);
  };

  const submit = () => {
    if (!q || !s || answered) return;
    const res = grade(s, q.kind, value, notesFor(q.id));
    if (res.status === 'retry') {
      setRetryMsg(res.message);
      return;
    }
    setRetryMsg(null);
    const prev = { queue, tally };
    const t: Tally = { ...(tally[q.id] ?? { mi: 0, ri: 0, doneM: false, doneR: false }) };
    t.stats = recordStats(t.stats, q.kind, res.status === 'correct');
    let nextQueue = queue.slice(1);
    if (res.status === 'correct') {
      if (q.kind === 'meaning') t.doneM = true;
      else t.doneR = true;
      if (q.kind === 'reading' && s.object === 'vocabulary' && progress.settings.autoplayAudio) playAudio(s, progress.settings.voice, res.matched);
    } else {
      if (q.kind === 'meaning') t.mi += 1;
      else t.ri += 1;
      const pos = Math.min(nextQueue.length, 3 + Math.floor(Math.random() * Math.max(1, nextQueue.length - 3)));
      nextQueue = [...nextQueue.slice(0, pos), q, ...nextQueue.slice(pos)];
    }
    setTally({ ...tally, [q.id]: t });
    setAnswered({ q, input: value, result: res, prev });
    setShowInfo(false);
    setQueue(nextQueue);
  };

  const advance = () => {
    if (!answered) return;
    const t = tally[answered.q.id];
    const subj = content.subjects[answered.q.id];
    const needed = subj ? questionsFor(subj) : [];
    const complete = t && needed.every((k) => (k === 'meaning' ? t.doneM : t.doneR));
    if (complete && !done.some((d) => d.id === answered.q.id)) finishSubject(answered.q.id, t);
    setAnswered(null);
    setValue('');
    if (wrapUp) setQueue((qs) => qs.filter((x) => tally[x.id]));
  };

  const undo = () => {
    if (!answered) return;
    setQueue(answered.prev.queue);
    setTally(answered.prev.tally);
    setValue(answered.input);
    setAnswered(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (answered) advance();
    else submit();
  };

  useEffect(() => {
    if (!answered) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') setShowInfo((x) => !x);
      if (e.key === 'Backspace' && answered.result.status !== 'correct') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const total = ids.length;
  const finished = done.length;
  const correctQs = Object.values(tally).reduce((n, t) => n + (t.stats ? t.stats.meaningCorrect + t.stats.readingCorrect : 0), 0);
  const allQs = Object.values(tally).reduce((n, t) => n + (t.stats ? t.stats.meaningCorrect + t.stats.readingCorrect + t.stats.meaningIncorrect + t.stats.readingIncorrect : 0), 0);

  const shown = answered ? content.subjects[answered.q.id] : s;
  const shownQ = answered?.q ?? q;

  if (!shown || !shownQ) {
    return (
      <Shell title={mode === 'quiz' ? 'Lesson quiz complete' : 'Review summary'} onBack={onExit}>
        <div className="card">
          <div style={{ fontWeight: 900 }}>
            {finished} item{finished === 1 ? '' : 's'} {mode === 'quiz' ? 'learned' : 'reviewed'} · {allQs ? Math.round((correctQs / allQs) * 100) : 100}% correct
          </div>
          {mode === 'review' ? (
            <>
              <SummaryGroup title="Answered correctly" items={done.filter((d) => d.perfect)} content={content} />
              <SummaryGroup title="Answered incorrectly" items={done.filter((d) => !d.perfect)} content={content} />
            </>
          ) : (
            <div className="small" style={{ marginTop: 6 }}>These items are now Apprentice 1 and will come up for review in a few hours.</div>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={onExit}>Dashboard</button>
            {mode === 'quiz' ? <button onClick={onMoreLessons}>More lessons</button> : null}
          </div>
        </div>
      </Shell>
    );
  }

  const isReading = shownQ.kind === 'reading';
  const r = answered?.result;
  const feedback = r ? (r.status === 'correct' ? (r.close ? 'close' : 'good') : 'bad') : '';
  const typeName = TYPE_LABEL[shown.object];

  return (
    <Shell
      title={mode === 'quiz' ? 'Lesson quiz' : 'Reviews'}
      subtitle={`${finished} / ${total} done · ${allQs ? Math.round((correctQs / allQs) * 100) : 100}% · ${queue.length} question${queue.length === 1 ? '' : 's'} left`}
      onBack={onExit}
      right={
        mode === 'review' ? (
          <button
            className={wrapUp ? 'primary' : undefined}
            onClick={() => {
              if (!wrapUp) setQueue((qs) => qs.filter((x, i) => i === 0 || tally[x.id] || x.id === qs[0]?.id));
              setWrapUp(!wrapUp);
            }}
          >
            {wrapUp ? 'Wrapping up' : 'Wrap up'}
          </button>
        ) : null
      }
    >
      <div className={`wkQuizChars wkBg-${typeClass(shown)}`}>
        <Characters content={content} subject={shown} size={96} />
      </div>
      <div className={`wkQuizPrompt ${isReading ? 'reading' : 'meaning'}`}>
        {typeName} <b>{isReading ? 'Reading' : shown.object === 'radical' ? 'Name' : 'Meaning'}</b>
      </div>
      <input
        ref={inputRef}
        className={`wkAnswer ${feedback} ${isReading ? 'jpInput' : ''} ${retryMsg ? 'shake' : ''}`}
        value={answered ? answered.input : value}
        readOnly={!!answered}
        lang={isReading ? 'ja' : 'en'}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        placeholder={isReading ? '答え' : 'Your response'}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          setRetryMsg(null);
          setValue(isReading ? toHiragana(e.target.value, { IMEMode: true }) : e.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      {retryMsg ? <div className="wkRetry">{retryMsg}</div> : null}
      {r ? (
        <div className="wkAfter">
          {r.status === 'correct' ? (
            <span>
              {r.close ? 'Close enough — the answer was ' : 'Correct: '}
              <b>{r.matched}</b>
            </span>
          ) : (
            <span>
              Incorrect. Answer:{' '}
              <b lang={isReading ? 'ja' : undefined}>
                {isReading ? (shown.data.readings ?? []).filter((x) => x.accepted_answer).map((x) => x.reading).join(', ') : acceptedMeanings(shown, notesFor(shown.id)).join(', ')}
              </b>
            </span>
          )}
          <div className="row" style={{ marginTop: 8, justifyContent: 'center' }}>
            <button onClick={() => setShowInfo((x) => !x)}>{showInfo ? 'Hide' : 'Item info'} (F)</button>
            {r.status !== 'correct' ? <button onClick={undo}>Undo — I mistyped (⌫)</button> : null}
            <button className="primary" onClick={advance}>Next (Enter)</button>
          </div>
        </div>
      ) : (
        <div className="row" style={{ marginTop: 10, justifyContent: 'center' }}>
          <button className="primary" onClick={submit}>Submit (Enter)</button>
        </div>
      )}
      {answered && showInfo ? (
        <div style={{ marginTop: 12 }}>
          <SubjectInfo content={content} progress={progress} subject={shown} now={Date.now()} onOpen={() => undefined} compact />
        </div>
      ) : null}
    </Shell>
  );
}

const addStats = (a: WkItemStats | undefined, b: WkItemStats): WkItemStats => ({
  meaningCorrect: (a?.meaningCorrect ?? 0) + b.meaningCorrect,
  meaningIncorrect: (a?.meaningIncorrect ?? 0) + b.meaningIncorrect,
  readingCorrect: (a?.readingCorrect ?? 0) + b.readingCorrect,
  readingIncorrect: (a?.readingIncorrect ?? 0) + b.readingIncorrect,
});

function SummaryGroup({ title, items, content }: { title: string; items: Done[]; content: WkContent }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="small" style={{ fontWeight: 800 }}>{title} ({items.length})</div>
      <div className="wkChips" style={{ marginTop: 6 }}>
        {items.map((d) => {
          const s = content.subjects[d.id];
          if (!s) return null;
          return (
            <span key={d.id} className={`wkChip wkBg-${typeClass(s)}`} title={`${stageName(d.from)} → ${stageName(d.to)}`}>
              <span className="wkChipChars"><Characters content={content} subject={s} /></span>
              <span className="wkChipText">
                <span>{primaryMeaning(s)}</span>
                <span>{d.to > d.from ? '▲' : d.to < d.from ? '▼' : '■'} {stageName(d.to)}</span>
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function BrowseScreen(props: { content: WkContent; progress: WkProgress; onBack: () => void; onOpen: (id: number) => void }) {
  const { content, progress, onBack, onOpen } = props;
  const [level, setLevel] = useState(progress.level);
  const [q, setQ] = useState('');
  const byLevel = useMemo(() => subjectsByLevel(content), [content]);

  const results = useMemo(() => {
    const raw = q.trim().toLowerCase();
    if (!raw) return null;
    const kana = toHiragana(raw);
    return Object.values(content.subjects)
      .filter((s) => {
        if (s.data.characters?.includes(q.trim())) return true;
        if (s.data.meanings.some((m) => m.meaning.toLowerCase().includes(raw))) return true;
        if (s.data.auxiliary_meanings.some((m) => m.type === 'whitelist' && m.meaning.toLowerCase().includes(raw))) return true;
        return (s.data.readings ?? []).some((r) => r.reading === kana || r.reading.startsWith(kana)) || (s.object === 'kana_vocabulary' && !!s.data.characters?.includes(kana));
      })
      .sort((a, b) => a.data.level - b.data.level || a.id - b.id)
      .slice(0, 200);
  }, [content, q]);

  const list = results ?? (byLevel.get(level) ?? []);
  const groups: Array<[string, WkSubject[]]> = [
    ['Radicals', list.filter((s) => s.object === 'radical')],
    ['Kanji', list.filter((s) => s.object === 'kanji')],
    ['Vocabulary', list.filter((s) => s.object === 'vocabulary' || s.object === 'kana_vocabulary')],
  ];

  return (
    <Shell title="Browse" subtitle={results ? `${results.length} result(s)` : `Level ${level}`} onBack={onBack}>
      <div className="card">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search kanji, meaning, or reading (romaji ok)…" />
        {!results ? (
          <div className="wkLevels">
            {Array.from({ length: 60 }, (_, i) => i + 1).map((l) => (
              <button key={l} className={`${l === level ? 'active' : ''} ${l <= progress.level ? 'reached' : ''}`} onClick={() => setLevel(l)}>
                {l}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {groups.map(([title, items]) =>
        items.length ? (
          <div key={title} className="card" style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 900 }}>
              {title} <span className="small">({items.length})</span>
            </div>
            <div className="wkTiles">
              {items.map((s) => {
                const a = progress.assignments[s.id];
                const stage = a ? (a.burnedAt ? 9 : a.stage) : -1;
                return (
                  <button key={s.id} className={`wkTile wkBg-${typeClass(s)} ${stage < 0 ? 'locked' : ''}`} onClick={() => onOpen(s.id)} title={stage < 0 ? 'Locked' : stageName(stage)}>
                    <div className="wkTileChars"><Characters content={content} subject={s} size={28} /></div>
                    {s.object !== 'radical' ? <div className="wkTileSub" lang="ja">{primaryReading(s)}</div> : null}
                    <div className="wkTileSub">{primaryMeaning(s)}</div>
                    <div className="wkTileStage" style={{ width: `${Math.max(0, stage) * (100 / 9)}%` }} />
                  </button>
                );
              })}
            </div>
          </div>
        ) : null,
      )}
    </Shell>
  );
}
