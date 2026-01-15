import { toRomaji } from 'wanakana';
import type { AppState, Card, Deck, ExampleSentence } from './models';

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

const id = (prefix: string) => `${prefix}_${safeRandomUUID()}`;

const makeDeck = (name: string, description?: string, direction?: Deck['direction']): Deck => ({
  id: id('deck'),
  name,
  description,
  direction,
  cardIds: [],
});

const makeCard = (
  deckId: string,
  type: Card['type'],
  prompt: string,
  answer: string,
  note?: string,
  background?: string,
  exampleSentences?: ExampleSentence[],
  kanji?: string,
  pos?: string,
): Card => ({
  id: id('card'),
  deckId,
  type,
  pos,
  prompt,
  answer,
  note,
  kanji,
  background,
  exampleSentences,
});

export type VerbForm =
  | 'dictionary'
  | 'polite_present'
  | 'te'
  | 'past'
  | 'negative'
  | 'past_negative'
  | 'want'
  | 'dont_want'
  | 'want_past'
  | 'dont_want_past';
export type VerbClass = 'ichidan' | 'godan';

export const verbFormLabel = (form: VerbForm): string => {
  switch (form) {
    case 'dictionary':
      return 'Present indicative (plain)';
    case 'polite_present':
      return 'Present indicative (polite) (〜ます)';
    case 'te':
      return 'Te-form (connective) (〜て)';
    case 'past':
      return 'Past indicative (plain) (〜た)';
    case 'negative':
      return 'Present negative (plain) (〜ない)';
    case 'past_negative':
      return 'Past negative (plain) (〜なかった)';
    case 'want':
      return 'Desiderative (want) (〜たい)';
    case 'dont_want':
      return 'Desiderative negative (〜たくない)';
    case 'want_past':
      return 'Desiderative (past) (〜たかった)';
    case 'dont_want_past':
      return 'Desiderative past negative (〜たくなかった)';
  }
};

export const verbConjugationHintText = (form: VerbForm, answerKana?: string): string => {
  const romaji = answerKana ? toRomaji(answerKana).trim() : '';
  const header = `Target: ${verbFormLabel(form)}`;
  const romajiLine = romaji ? `Romaji: ${romaji}` : '';
  return [
    header,
    romajiLine,
    '',
    'Forms:',
    '- Present indicative (plain): dictionary form',
    '- Present indicative (polite): 〜ます',
    '- Te-form (connective): 〜て',
    '- Past indicative (plain): 〜た',
    '- Present negative (plain): 〜ない',
    '- Past negative (plain): 〜なかった',
    '- Desiderative (want): 〜たい',
    '- Desiderative negative: 〜たくない',
    '- Desiderative (past): 〜たかった',
    '- Desiderative past negative: 〜たくなかった',
    '',
    'Reminders:',
    '- Ichidan: drop る, then add the ending',
    '- Godan: change the last kana (pattern depends on the ending)',
    '- する / くる are irregular (and compounds like …する / …くる)',
    '- 行く te/past: いって / いった (irregular)',
    '- ある negative: ない / なかった (irregular)',
  ]
    .join('\n');
};

const lastKana = (s: string): string => (s ? s.slice(-1) : '');
const dropLastKana = (s: string): string => (s ? s.slice(0, -1) : '');

export const classifyVerb = (baseKana: string, baseKanji?: string): VerbClass => {
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

const conjugateGodan = (base: string, form: VerbForm): string => {
  const end = lastKana(base);
  const stem = dropLastKana(base);

  const iRow: Record<string, string> = { う: 'い', く: 'き', ぐ: 'ぎ', す: 'し', つ: 'ち', ぬ: 'に', ぶ: 'び', む: 'み', る: 'り' };
  const aRow: Record<string, string> = { う: 'わ', く: 'か', ぐ: 'が', す: 'さ', つ: 'た', ぬ: 'な', ぶ: 'ば', む: 'ま', る: 'ら' };

  if (form === 'polite_present') return `${stem}${iRow[end] ?? ''}ます`;
  if (form === 'negative') return `${stem}${end === 'う' ? 'わ' : aRow[end] ?? ''}ない`;
  if (form === 'past_negative') return `${stem}${end === 'う' ? 'わ' : aRow[end] ?? ''}なかった`;

  if (form === 'te' || form === 'past') {
    if (base === 'いく') return form === 'te' ? 'いって' : 'いった';

    const te: Record<string, string> = { う: 'って', つ: 'って', る: 'って', む: 'んで', ぶ: 'んで', ぬ: 'んで', く: 'いて', ぐ: 'いで', す: 'して' };
    const ta: Record<string, string> = { う: 'った', つ: 'った', る: 'った', む: 'んだ', ぶ: 'んだ', ぬ: 'んだ', く: 'いた', ぐ: 'いだ', す: 'した' };
    const suffix = form === 'te' ? te[end] : ta[end];
    return `${stem}${suffix ?? ''}`;
  }

  return base;
};

export const conjugateVerb = (base: string, baseKana: string, form: VerbForm, cls: VerbClass): string => {
  const b = base.trim();
  if (!b) return b;
  if (form === 'dictionary') return b;

  const kana = baseKana.trim();
  if (kana.endsWith('する')) {
    const prefix = b.endsWith('する') ? b.slice(0, -2) : b;
    if (form === 'polite_present') return `${prefix}します`;
    if (form === 'te') return `${prefix}して`;
    if (form === 'past') return `${prefix}した`;
    if (form === 'negative') return `${prefix}しない`;
    if (form === 'past_negative') return `${prefix}しなかった`;
    if (form === 'want') return `${prefix}したい`;
    if (form === 'dont_want') return `${prefix}したくない`;
    if (form === 'want_past') return `${prefix}したかった`;
    if (form === 'dont_want_past') return `${prefix}したくなかった`;
  }

  if (kana.endsWith('くる')) {
    const prefix = b.endsWith('くる') || b.endsWith('来る') ? b.slice(0, -2) : b;
    if (form === 'polite_present') return `${prefix}きます`;
    if (form === 'te') return `${prefix}きて`;
    if (form === 'past') return `${prefix}きた`;
    if (form === 'negative') return `${prefix}こない`;
    if (form === 'past_negative') return `${prefix}こなかった`;
    if (form === 'want') return `${prefix}きたい`;
    if (form === 'dont_want') return `${prefix}きたくない`;
    if (form === 'want_past') return `${prefix}きたかった`;
    if (form === 'dont_want_past') return `${prefix}きたくなかった`;
  }

  if (form === 'want' || form === 'dont_want' || form === 'want_past' || form === 'dont_want_past') {
    let stem = '';
    if (cls === 'ichidan') {
      stem = dropLastKana(b);
    } else {
      const end = lastKana(b);
      const baseStem = dropLastKana(b);
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
      stem = `${baseStem}${iRow[end] ?? ''}`;
    }
    const tail =
      form === 'want'
        ? 'たい'
        : form === 'dont_want'
          ? 'たくない'
          : form === 'want_past'
            ? 'たかった'
            : 'たくなかった';
    return `${stem}${tail}`;
  }

  if (baseKana.trim() === 'いく' && (form === 'te' || form === 'past')) {
    const stem = dropLastKana(b);
    return `${stem}${form === 'te' ? 'って' : 'った'}`;
  }

  if (baseKana.trim() === 'ある') {
    if (form === 'polite_present') return b.replace(/る$/, 'ります');
    if (form === 'te') return b.replace(/る$/, 'って');
    if (form === 'past') return b.replace(/る$/, 'った');
    if (form === 'negative') return 'ない';
    if (form === 'past_negative') return 'なかった';
  }

  if (cls === 'ichidan') {
    const stem = dropLastKana(b);
    if (form === 'polite_present') return `${stem}ます`;
    if (form === 'te') return `${stem}て`;
    if (form === 'past') return `${stem}た`;
    if (form === 'negative') return `${stem}ない`;
    if (form === 'past_negative') return `${stem}なかった`;
    return b;
  }

  return conjugateGodan(b, form);
};

export const transformExamples = (
  examples: ExampleSentence[] | undefined,
  fromKana: string,
  fromKanji: string | undefined,
  toKana: string,
  toKanji: string | undefined,
): ExampleSentence[] | undefined => {
  const src = examples?.length ? examples : undefined;
  if (!src) return undefined;

  const fk = fromKana.trim();
  const fK = fromKanji?.trim();
  const tk = toKana.trim();
  const tK = toKanji?.trim();

  if (!fk || !tk) return undefined;

  return src.map((ex) => {
    const ja = ex.ja;

    if (fK && tK && ja.includes(fK)) {
      const idx = ja.lastIndexOf(fK);
      return { ...ex, ja: `${ja.slice(0, idx)}${tK}${ja.slice(idx + fK.length)}` };
    }

    if (ja.includes(fk)) {
      const idx = ja.lastIndexOf(fk);
      return { ...ex, ja: `${ja.slice(0, idx)}${tk}${ja.slice(idx + fk.length)}` };
    }

    return ex;
  });
};

export const makeSeedState = (): AppState => {
  const vocab = makeDeck('Common Vocab (Non-WK)', 'English → Japanese (kana)', 'en-ja');
  const vocabJaEn = makeDeck('Common Vocab (Non-WK) — JP→EN', 'Japanese → English (type meaning)', 'ja-en');
  const verbs = makeDeck('Verb Conjugation', 'English cue → Japanese conjugation (kana)', 'en-ja');
  const sentences = makeDeck('Sentence Writing', 'English → Japanese (kana)', 'en-ja');

  const decks: AppState['decks'] = {
    [vocab.id]: vocab,
    [vocabJaEn.id]: vocabJaEn,
    [verbs.id]: verbs,
    [sentences.id]: sentences,
  };

  const cards: AppState['cards'] = {};

  const add = (card: Card) => {
    cards[card.id] = card;
    decks[card.deckId].cardIds.push(card.id);
  };

  add(
    makeCard(
      vocab.id,
      'vocab',
      'to exist (inanimate); to have',
      'ある',
      'aru',
      'Used for non-living things (objects). Often appears as ~がある (there is/are).',
      [{ ja: 'おかねがある。' }, { ja: 'じかんがある。' }, { ja: 'ここにペンがある。' }],
      undefined,
      'verb (intransitive)',
    ),
  );
  add(
    makeCard(
      vocab.id,
      'vocab',
      'to exist (animate); to be (someone/animal)',
      'いる',
      'iru',
      'Used for living things (people/animals). Often appears as ~がいる (someone is there).',
      [{ ja: 'ねこがいる。' }, { ja: 'ともだちがいる。' }, { ja: 'ここにだれかがいる。' }],
      undefined,
      'verb (intransitive)',
    ),
  );
  add(makeCard(vocab.id, 'vocab', 'necessary; need', 'ひつよう', 'hitsuyou', undefined, [{ ja: 'ひつようです。' }], '必要', 'na-adjective / noun'));
  add(makeCard(vocab.id, 'vocab', 'to need (a thing); to require', 'いる', 'iru', undefined, [{ ja: 'おかねがいる。' }], '要る', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'to hold; to have/own', 'もつ', 'motsu', undefined, [{ ja: 'かばんをもつ。' }], '持つ', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'to eat', 'たべる', 'taberu', undefined, [{ ja: 'ごはんをたべる。' }, { ja: 'ぱんをたべる。' }], '食べる', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'to drink', 'のむ', 'nomu', undefined, [{ ja: 'みずをのむ。' }, { ja: 'おちゃをのむ。' }], '飲む', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'to buy', 'かう', 'kau', undefined, [{ ja: 'パンをかう。' }, { ja: 'みせでパンをかう。' }, { ja: 'これをかう。' }], '買う', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'to use', 'つかう', 'tsukau', undefined, [{ ja: 'ペンをつかう。' }, { ja: 'これをつかう。' }], '使う', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'to live (reside)', 'すむ', 'sumu', undefined, [{ ja: 'とうきょうにすむ。' }, { ja: 'にほんにすむ。' }, { ja: 'ここにすむ。' }], '住む', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'to work', 'はたらく', 'hataraku', undefined, [{ ja: 'まいにちはたらく。' }, { ja: 'みせではたらく。' }], '働く', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'to sleep', 'ねる', 'neru', undefined, [{ ja: 'よるにねる。' }, { ja: 'つかれたからねる。' }, { ja: 'いまねる。' }], '寝る', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'to wake up', 'おきる', 'okiru', undefined, [{ ja: 'あさはやくおきる。' }, { ja: 'まいあさおきる。' }], '起きる', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'to enter', 'はいる', 'hairu', undefined, [{ ja: 'へやにはいる。' }, { ja: 'いえにはいる。' }], '入る', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'to leave/exit', 'でる', 'deru', undefined, [{ ja: 'いえをでる。' }, { ja: 'へやをでる。' }], '出る', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'to listen; to ask', 'きく', 'kiku', undefined, [{ ja: 'おんがくをきく。' }, { ja: 'ともだちにきく。' }, { ja: 'せんせいにきく。' }], '聞く', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'to speak/talk', 'はなす', 'hanasu', undefined, [{ ja: 'にほんごをはなす。' }, { ja: 'ともだちとはなす。' }], '話す', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'to read', 'よむ', 'yomu', undefined, [{ ja: 'ほんをよむ。' }, { ja: 'しんぶんをよむ。' }], '読む', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'to write', 'かく', 'kaku', undefined, [{ ja: 'なまえをかく。' }, { ja: 'てがみをかく。' }, { ja: 'ここにかく。' }], '書く', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'can do; be able to', 'できる', 'dekiru', undefined, [{ ja: 'にほんごができる。' }], '出来る', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'want (a thing)', 'ほしい', 'hoshii', undefined, [{ ja: 'あたらしいくつがほしい。' }], '欲しい', 'i-adjective'));
  add(makeCard(vocab.id, 'vocab', 'want to (do)', '〜たい', '~tai', undefined, [{ ja: 'たべたい。' }], undefined, 'auxiliary / suffix'));
  add(makeCard(vocab.id, 'vocab', 'please (request)', 'おねがいします', 'onegaishimasu', undefined, [{ ja: 'みずをおねがいします。' }], 'お願いします', 'expression'));
  add(makeCard(vocab.id, 'vocab', 'okay; alright; no problem', 'だいじょうぶ', 'daijoubu', undefined, [{ ja: 'だいじょうぶです。' }], '大丈夫', 'na-adjective'));
  add(makeCard(vocab.id, 'vocab', 'and; and then', 'そして', 'soshite', undefined, [{ ja: 'パンをかって、そしてたべる。' }, { ja: 'みせにいって、そしてかえる。' }], undefined, 'conjunction'));
  add(makeCard(vocab.id, 'vocab', 'after that; then', 'それから', 'sorekara', undefined, [{ ja: 'それから、いえにかえる。' }], undefined, 'conjunction'));
  add(makeCard(vocab.id, 'vocab', 'but; however', 'でも', 'demo', undefined, [{ ja: 'いきたい。でも、じかんがない。' }], undefined, 'conjunction'));
  add(makeCard(vocab.id, 'vocab', 'so; therefore', 'だから', 'dakara', undefined, [{ ja: 'あめだ。だから、いえにいる。' }], undefined, 'conjunction'));
  add(makeCard(vocab.id, 'vocab', 'who', 'だれ', 'dare', undefined, [{ ja: 'だれですか。' }], undefined, 'pronoun'));
  add(makeCard(vocab.id, 'vocab', 'where', 'どこ', 'doko', undefined, [{ ja: 'どこにいきますか。' }], undefined, 'pronoun'));
  add(makeCard(vocab.id, 'vocab', 'how', 'どう', 'dou', undefined, [{ ja: 'どうですか。' }], undefined, 'adverb'));
  add(
    makeCard(
      vocab.id,
      'vocab',
      'why',
      'どうして',
      'doushite',
      'Usually casual/spoken. Often like “how come?” when asking for a reason.',
      [{ ja: 'どうして？' }],
      undefined,
      'adverb',
    ),
  );
  add(
    makeCard(
      vocab.id,
      'vocab',
      'why',
      'なぜ',
      'naze',
      'More formal/bookish. Common in writing and rhetorical questions (“for what reason?”).',
      [{ ja: 'なぜ？' }],
      undefined,
      'adverb',
    ),
  );
  add(makeCard(vocab.id, 'vocab', 'how much', 'いくら', 'ikura', undefined, [{ ja: 'これはいくらですか。' }], undefined, 'noun'));
  add(makeCard(vocab.id, 'vocab', 'which (before a noun)', 'どの', 'dono', undefined, [{ ja: 'どのぱんがいい？' }], undefined, 'determiner'));
  add(makeCard(vocab.id, 'vocab', 'what kind of', 'どんな', 'donna', undefined, [{ ja: 'どんなぱんがいい？' }], undefined, 'determiner'));
  add(makeCard(vocab.id, 'vocab', 'a little; (soft refusal)', 'ちょっと', 'chotto', undefined, [{ ja: 'ちょっとまって。' }], undefined, 'adverb'));
  add(makeCard(vocab.id, 'vocab', 'really; truly', 'ほんとうに', 'hontouni', undefined, [{ ja: 'ほんとうに？' }], undefined, 'adverb'));
  add(makeCard(vocab.id, 'vocab', 'maybe; probably', 'たぶん', 'tabun', undefined, [{ ja: 'たぶんいく。' }], '多分', 'adverb'));
  add(makeCard(vocab.id, 'vocab', 'good', 'いい', 'ii', undefined, [{ ja: 'きょうはいいてんきだ。' }], undefined, 'i-adjective'));
  add(makeCard(vocab.id, 'vocab', 'bad', 'わるい', 'warui', undefined, [{ ja: 'きょうはきぶんがわるい。' }], undefined, 'i-adjective'));
  add(makeCard(vocab.id, 'vocab', 'busy', 'いそがしい', 'isogashii', undefined, [{ ja: 'きょうはいそがしい。' }], undefined, 'i-adjective'));
  add(makeCard(vocab.id, 'vocab', 'free time; not busy', 'ひま', 'hima', undefined, [{ ja: 'きょうはひまだ。' }], '暇', 'na-adjective / noun'));
  add(makeCard(vocab.id, 'vocab', 'fun', 'たのしい', 'tanoshii', undefined, [{ ja: 'にほんごはたのしい。' }], undefined, 'i-adjective'));
  add(makeCard(vocab.id, 'vocab', 'difficult', 'むずかしい', 'muzukashii', undefined, [{ ja: 'かんじはむずかしい。' }], undefined, 'i-adjective'));
  add(makeCard(vocab.id, 'vocab', 'easy; simple', 'かんたん', 'kantan', undefined, [{ ja: 'かんたんです。' }], '簡単', 'na-adjective'));
  add(makeCard(vocab.id, 'vocab', 'hot (things)', 'あつい', 'atsui', undefined, [{ ja: 'おちゃがあつい。' }], '熱い', 'i-adjective'));
  add(makeCard(vocab.id, 'vocab', 'cold (weather)', 'さむい', 'samui', undefined, [{ ja: 'きょうはさむい。' }], '寒い', 'i-adjective'));
  add(makeCard(vocab.id, 'vocab', 'delicious', 'おいしい', 'oishii', undefined, [{ ja: 'ぱんがおいしい。' }], undefined, 'i-adjective'));
  add(makeCard(vocab.id, 'vocab', 'very', 'とても', 'totemo', undefined, [{ ja: 'とてもおいしい。' }], undefined, 'adverb'));
  add(makeCard(vocab.id, 'vocab', 'often; well', 'よく', 'yoku', undefined, [{ ja: 'よくねる。' }], undefined, 'adverb'));
  add(makeCard(vocab.id, 'vocab', 'today', 'きょう', 'kyou', undefined, [{ ja: 'きょうはいいてんきだ。' }], '今日', 'noun'));
  add(makeCard(vocab.id, 'vocab', 'now', 'いま', 'ima', undefined, [{ ja: 'いまいきます。' }], '今', 'noun / adverb'));
  add(makeCard(vocab.id, 'vocab', 'tomorrow', 'あした', 'ashita', undefined, [{ ja: 'あしたいきます。' }], undefined, 'noun'));
  add(makeCard(vocab.id, 'vocab', 'yesterday', 'きのう', 'kinou', undefined, [{ ja: 'きのう、ねこをみた。' }], undefined, 'noun'));
  add(makeCard(vocab.id, 'vocab', 'morning', 'あさ', 'asa', undefined, [{ ja: 'あさはコーヒーをのむ。' }], undefined, 'noun'));
  add(makeCard(vocab.id, 'vocab', 'daytime/noon', 'ひる', 'hiru', undefined, [{ ja: 'ひるごはんをたべる。' }], undefined, 'noun'));
  add(makeCard(vocab.id, 'vocab', 'night', 'よる', 'yoru', undefined, [{ ja: 'よるにねる。' }], '夜', 'noun'));
  add(makeCard(vocab.id, 'vocab', 'week', 'しゅう', 'shuu', undefined, [{ ja: 'いっしゅうかん。' }], '週', 'noun'));
  add(makeCard(vocab.id, 'vocab', 'break/rest (noun)', 'きゅうけい', 'kyuukei', undefined, [{ ja: 'きゅうけいする。' }], '休憩', 'noun'));

  add(makeCard(vocab.id, 'vocab', 'rain', 'あめ', 'ame', undefined, [{ ja: 'あめです。' }], '雨', 'noun'));
  add(makeCard(vocab.id, 'vocab', 'house; home', 'いえ', 'ie', undefined, [{ ja: 'いえにかえる。' }], '家', 'noun'));
  add(makeCard(vocab.id, 'vocab', 'time', 'じかん', 'jikan', undefined, [{ ja: 'じかんがない。' }, { ja: 'じかんがある。' }, { ja: 'じかんがいる。' }], '時間', 'noun'));
  add(makeCard(vocab.id, 'vocab', 'store; shop', 'みせ', 'mise', undefined, [{ ja: 'みせにいく。' }, { ja: 'みせでぱんをかう。' }], '店', 'noun'));
  add(makeCard(vocab.id, 'vocab', 'bread', 'ぱん', 'pan', undefined, [{ ja: 'ぱんをたべる。' }], 'パン', 'noun'));

  add(makeCard(vocab.id, 'vocab', 'to go', 'いく', 'iku', undefined, [{ ja: 'みせにいく。' }, { ja: 'いまいく。' }, { ja: 'あしたいく。' }], '行く', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'to return; to go home', 'かえる', 'kaeru', undefined, [{ ja: 'いえにかえる。' }, { ja: 'よるにいえにかえる。' }], '帰る', 'verb (intransitive)'));

  add(makeCard(vocab.id, 'vocab', 'because; since (casual)', 'から', 'kara', undefined, [{ ja: 'あめだから、いえにいる。' }, { ja: 'じかんがないから、いかない。' }], undefined, 'particle / conjunction'));
  add(makeCard(vocab.id, 'vocab', 'if (suppose)', 'もし', 'moshi', undefined, [{ ja: 'もしひまなら、いきます。' }], undefined, 'adverb'));
  add(makeCard(vocab.id, 'vocab', 'if; if that’s the case…', 'なら', 'nara', undefined, [{ ja: 'ひまなら、いきます。' }, { ja: 'あしたなら、いきます。' }], undefined, 'particle / conditional'));
  add(makeCard(vocab.id, 'vocab', 'because; since (polite/neutral)', 'ので', 'node', undefined, [{ ja: 'じかんがあるので、いきます。' }, { ja: 'あめなので、いえにいます。' }], undefined, 'particle / conjunction'));
  add(makeCard(vocab.id, 'vocab', 'so; therefore (polite)', 'なので', 'nanode', undefined, [{ ja: 'あめなので、いえにいます。' }], undefined, 'conjunction'));

  add(makeCard(vocab.id, 'vocab', 'but; though (casual)', 'けど', 'kedo', undefined, [{ ja: 'いきたいけど、じかんがない。' }], undefined, 'conjunction'));
  add(makeCard(vocab.id, 'vocab', 'but; though (neutral)', 'けれど', 'keredo', undefined, [{ ja: 'いきたいけれど、じかんがない。' }], undefined, 'conjunction'));
  add(makeCard(vocab.id, 'vocab', 'but; although (more formal)', 'けれども', 'keredomo', undefined, [{ ja: 'いきたいけれども、じかんがない。' }], undefined, 'conjunction'));
  add(makeCard(vocab.id, 'vocab', 'however; but (formal)', 'しかし', 'shikashi', undefined, [{ ja: 'いきたい。しかし、じかんがない。' }], undefined, 'conjunction'));

  add(makeCard(vocab.id, 'vocab', 'and so; then', 'それで', 'sorede', undefined, [{ ja: 'それで、いえにかえる。' }], undefined, 'conjunction'));
  add(makeCard(vocab.id, 'vocab', 'besides; and also', 'それに', 'soreni', undefined, [{ ja: 'それに、じかんがない。' }], undefined, 'conjunction'));

  add(makeCard(vocab.id, 'vocab', 'well then; in that case (casual)', 'じゃあ', 'jaa', undefined, [{ ja: 'じゃあ、いえにかえる。' }], undefined, 'interjection'));
  add(makeCard(vocab.id, 'vocab', 'well then (more formal)', 'では', 'dewa', undefined, [{ ja: 'では、いえにかえります。' }], undefined, 'interjection'));

  const addedVerbKeys = new Set<string>();
  for (const srcId of decks[vocab.id].cardIds) {
    const src = cards[srcId];
    if (!src || src.type !== 'vocab') continue;
    const pos = (src.pos ?? '').toLowerCase();
    if (!pos || !/\bverb\b/.test(pos)) continue;

    const key = `${src.prompt.trim()}||${src.answer.trim()}`;
    if (addedVerbKeys.has(key)) continue;
    addedVerbKeys.add(key);

    const baseKana = src.answer.trim();
    const baseKanji = src.kanji?.trim();
    const cls = classifyVerb(baseKana, baseKanji);

    const forms: VerbForm[] = [
      'dictionary',
      'polite_present',
      'te',
      'past',
      'negative',
      'past_negative',
      'want',
      'dont_want',
      'want_past',
      'dont_want_past',
    ];
    for (const form of forms) {
      const answerKana = conjugateVerb(baseKana, baseKana, form, cls);
      const answerKanji = baseKanji ? conjugateVerb(baseKanji, baseKana, form, cls) : undefined;
      const examples = transformExamples(src.exampleSentences, baseKana, baseKanji, answerKana, answerKanji);

      const fromDisp = baseKanji || baseKana;
      const toDisp = answerKanji || answerKana;
      const bg = `Conjugation: ${fromDisp} → ${toDisp} (${verbFormLabel(form)}).`;

      const c = makeCard(
        verbs.id,
        'verb',
        src.prompt,
        answerKana,
        verbConjugationHintText(form, answerKana),
        bg,
        examples,
        answerKanji,
        src.pos,
      );

      add({
        ...c,
        verbBaseKana: baseKana,
        verbBaseKanji: baseKanji,
        verbForm: form,
      });
    }
  }

  add(
    makeCard(
      verbs.id,
      'verb',
      'want to go',
      'いきたい',
      'ik i tai',
      'Conjugation: いく → いき + たい (want to...). たい attaches to the verb stem and behaves like an i-adjective.',
      undefined,
      '行きたい',
    ),
  );
  add(
    makeCard(
      verbs.id,
      'verb',
      'don’t want to go',
      'いきたくない',
      'ik i ta ku nai',
      'Conjugation: いく → いき + たくない (don’t want to...). たくない is the negative of たい.',
      undefined,
      '行きたくない',
    ),
  );
  add(
    makeCard(
      verbs.id,
      'verb',
      'want to eat',
      'たべたい',
      'ta be tai',
      'Conjugation: たべる → たべ + たい (want to...). たい attaches to the verb stem and behaves like an i-adjective.',
      undefined,
      '食べたい',
    ),
  );
  add(
    makeCard(
      verbs.id,
      'verb',
      'don’t want to eat',
      'たべたくない',
      'ta be ta ku nai',
      'Conjugation: たべる → たべ + たくない (don’t want to...). たくない is the negative of たい.',
      undefined,
      '食べたくない',
    ),
  );
  add(
    makeCard(
      verbs.id,
      'verb',
      'went (casual past of いく)',
      'いった',
      'it ta',
      'Conjugation: いく → いった (casual past). This past form is irregular (not *いきた).',
      undefined,
      '行った',
    ),
  );
  add(
    makeCard(
      verbs.id,
      'verb',
      'drank (casual past of のむ)',
      'のんだ',
      'non da',
      'Conjugation: のむ → のんだ (casual past). んだ is a common past ending for む/ぶ/ぬ verbs.',
      undefined,
      '飲んだ',
    ),
  );

  add(
    makeCard(
      sentences.id,
      'sentence',
      'Because it’s raining, I stay home.',
      'あめだからいえにいる',
      'ame da kara ie ni iru',
      'あめ = rain\nだから = so / because\nいえ = house / home\nに = location particle\nいる = to exist (animate)\n\nStructure: [reason] + だから + [location] + に + いる',
      undefined,
      '雨だから家にいる',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'I want to go, but I don’t have time.',
      'いきたいけどじかんがない',
      'ikitai kedo jikan ga nai',
      'いきたい = want to go\nけど = but / though\nじかん = time\nが = subject particle\nない = not exist (casual)\n\nStructure: [X] けど [Y] ("X, but Y")',
      undefined,
      '行きたいけど時間がない',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'Tomorrow, I will go to the store and buy bread.',
      'あしたみせにいってぱんをかう',
      'ashita mise ni itte pan o kau',
      'あした = tomorrow\nみせ = store\nに = destination particle\nいって = te-form of いく (go)\nぱん = bread\nを = object particle\nかう = to buy\n\nStructure: [place] に [go (te-form)] + [object] を [buy]',
      undefined,
      '明日店に行ってパンを買う',
    ),
  );

  add(
    makeCard(
      sentences.id,
      'sentence',
      'Because I have time, I will go to the store.',
      'じかんがあるのでみせにいく',
      'jikan ga aru node mise ni iku',
      'じかん = time\nが = subject particle\nある = to exist (inanimate)\nので = because / since\nみせ = store\nに = destination particle\nいく = to go\n\nStructure: [reason] ので [destination] に [go]',
      undefined,
      '時間があるので店に行く',
    ),
  );

  add(
    makeCard(
      sentences.id,
      'sentence',
      'It’s raining, but I will go.',
      'あめだけどいく',
      'ame da kedo iku',
      'あめ = rain\nだ = copula (casual)\nけど = but / though\nいく = to go\n\nStructure: [X] けど [Y] ("X, but Y")',
      undefined,
      '雨だけど行く',
    ),
  );

  add(
    makeCard(
      sentences.id,
      'sentence',
      'Well then, I will go home.',
      'じゃあいえにかえる',
      'jaa ie ni kaeru',
      'じゃあ = well then\nいえ = home\nに = destination particle\nかえる = to return / go home\n\nStructure: じゃあ + [destination] に + [go home]',
      undefined,
      'じゃあ家に帰る',
    ),
  );

  add(
    makeCard(
      sentences.id,
      'sentence',
      'If I’m free, I will go.',
      'ひまならいく',
      'hima nara iku',
      'ひま = free time\nなら = if (if that’s the case)\nいく = to go\n\nStructure: [condition] なら [result]',
      undefined,
      '暇なら行く',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'I need time.',
      'じかんがいる',
      'jikan ga iru',
      'じかん = time\nが = subject particle\nいる = to need (要る)\n\nStructure: [thing] が いる (need X)',
      undefined,
      '時間が要る',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'Because it’s cold today, I will sleep.',
      'きょうはさむいからねる',
      'kyou wa samui kara neru',
      'きょう = today\nは = topic particle\nさむい = cold (weather)\nから = because\nねる = to sleep\n\nStructure: [reason] から [action]',
      undefined,
      '今日は寒いから寝る',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'Bread is very delicious.',
      'ぱんはとてもおいしい',
      'pan wa totemo oishii',
      'ぱん = bread\nは = topic particle\nとても = very\nおいしい = delicious\n\nStructure: [topic] は [adverb] [i-adjective]',
      undefined,
      'パンはとてもおいしい',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'I will take a break now.',
      'いまきゅうけいする',
      'ima kyuukei suru',
      'いま = now\nきゅうけい = break / rest\nする = to do\n\nStructure: [time] + [noun] + する',
      undefined,
      '今休憩する',
    ),
  );

  add(
    makeCard(
      sentences.id,
      'sentence',
      'Now, I will go to the store.',
      'いまみせにいく',
      'ima mise ni iku',
      'いま = now\nみせ = store\nに = destination particle\nいく = to go\n\nStructure: [time] + [place] に + [go]',
      undefined,
      '今店に行く',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'In the morning, I eat bread.',
      'あさぱんをたべる',
      'asa pan o taberu',
      'あさ = morning\nぱん = bread\nを = object particle\nたべる = to eat\n\nStructure: [time] + [object] を + [eat]',
      undefined,
      '朝パンを食べる',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'At night, I sleep.',
      'よるにねる',
      'yoru ni neru',
      'よる = night\nに = time particle\nねる = to sleep\n\nStructure: [time] に + [sleep]',
      undefined,
      '夜に寝る',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'Yesterday, I went home.',
      'きのういえにかえった',
      'kinou ie ni kaetta',
      'きのう = yesterday\nいえ = home\nに = destination particle\nかえった = past of かえる (go home)\n\nStructure: [time] + [destination] に + [go home (past)]',
      undefined,
      '昨日家に帰った',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'Because I don’t have time, I won’t go.',
      'じかんがないのでいかない',
      'jikan ga nai node ikanai',
      'じかん = time\nが = subject particle\nない = not exist (casual)\nので = because / since\nいかない = negative of いく (go)\n\nStructure: [reason] ので + [result]',
      undefined,
      '時間がないので行かない',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'Because it’s busy, I won’t go.',
      'いそがしいからいかない',
      'isogashii kara ikanai',
      'いそがしい = busy\nから = because\nいかない = negative of いく (go)\n\nStructure: [reason] から + [result]',
      undefined,
      '忙しいから行かない',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'Because it’s free, I want to go.',
      'ひまだからいきたい',
      'hima da kara ikitai',
      'ひま = free time\nだ = copula (casual)\nから = because\nいきたい = want to go\n\nStructure: [reason] だから + [result]',
      undefined,
      '暇だから行きたい',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'If it’s raining, I stay home.',
      'あめならいえにいる',
      'ame nara ie ni iru',
      'あめ = rain\nなら = if (if that’s the case)\nいえ = home\nに = location particle\nいる = to exist (animate)\n\nStructure: [condition] なら + [location] に + いる',
      undefined,
      '雨なら家にいる',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'Maybe I will go tomorrow.',
      'たぶんあしたいく',
      'tabun ashita iku',
      'たぶん = maybe / probably\nあした = tomorrow\nいく = to go\n\nStructure: たぶん + [time] + [action]',
      undefined,
      '多分明日行く',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'I will buy bread and go home.',
      'ぱんをかっていえにかえる',
      'pan o katte ie ni kaeru',
      'ぱん = bread\nを = object particle\nかって = te-form of かう (buy)\nいえ = home\nに = destination particle\nかえる = to return / go home\n\nStructure: [object] を [buy (te-form)] + [destination] に [go home]',
      undefined,
      'パンを買って家に帰る',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'First I take a break, and then I work.',
      'きゅうけいしてそれからはたらく',
      'kyuukei shite sorekara hataraku',
      'きゅうけい = break / rest\nして = te-form of する (do)\nそれから = after that\nはたらく = to work\n\nStructure: [do (te-form)] それから [action]',
      undefined,
      '休憩してそれから働く',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'Because bread is delicious, I eat bread.',
      'ぱんがおいしいからぱんをたべる',
      'pan ga oishii kara pan o taberu',
      'ぱん = bread\nが = subject particle\nおいしい = delicious\nから = because\nぱん = bread\nを = object particle\nたべる = to eat\n\nStructure: [reason] から + [action]',
      undefined,
      'パンがおいしいからパンを食べる',
    ),
  );
  add(
    makeCard(
      sentences.id,
      'sentence',
      'I will go to the store, and then buy bread.',
      'みせにいってそれからぱんをかう',
      'mise ni itte sorekara pan o kau',
      'みせ = store\nに = destination particle\nいって = te-form of いく (go)\nそれから = after that\nぱん = bread\nを = object particle\nかう = to buy\n\nStructure: [place] に [go (te-form)] それから [object] を [buy]',
      undefined,
      '店に行ってそれからパンを買う',
    ),
  );

  add(
    makeCard(
      sentences.id,
      'sentence',
      'If I have time, I will go tomorrow.',
      'じかんがあるならあしたいく',
      'jikan ga aru nara ashita iku',
      'じかん = time\nが = subject particle\nある = to exist (inanimate)\nなら = if (if that’s the case)\nあした = tomorrow\nいく = to go\n\nStructure: [condition] なら [time] [action]',
      undefined,
      '時間があるなら明日行く',
    ),
  );

  add(
    makeCard(
      sentences.id,
      'sentence',
      'Because I’m busy, I can’t go.',
      'いそがしいのでいけない',
      'isogashii node ikenai',
      'いそがしい = busy\nので = because / since\nいけない = can’t go (negative potential of いく)\n\nStructure: [reason] ので [result]',
      undefined,
      '忙しいので行けない',
    ),
  );

  add(
    makeCard(
      sentences.id,
      'sentence',
      'I listened to music and went to sleep.',
      'おんがくをきいてねた',
      'ongaku o kiite neta',
      'おんがく = music\nを = object particle\nきいて = te-form of きく (listen)\nねた = past of ねる (sleep)\n\nStructure: [X] を [do (te-form)] [Y (past)]',
      undefined,
      '音楽を聞いて寝た',
    ),
  );

  add(
    makeCard(
      sentences.id,
      'sentence',
      'Now I will go home, but tomorrow I will go to the store.',
      'いまはいえにかえるけどあしたはみせにいく',
      'ima wa ie ni kaeru kedo ashita wa mise ni iku',
      'いま = now\nは = topic particle\nいえ = home\nに = destination particle\nかえる = to go home\nけど = but / though\nあした = tomorrow\nみせ = store\nいく = to go\n\nStructure: [X] けど [Y] ("X, but Y")',
      undefined,
      '今は家に帰るけど明日は店に行く',
    ),
  );

  for (const srcId of decks[vocab.id].cardIds) {
    const src = cards[srcId];
    if (!src || src.type !== 'vocab') continue;
    add({
      id: id('card'),
      deckId: vocabJaEn.id,
      type: 'vocab',
      pos: src.pos,
      prompt: src.answer,
      answer: src.prompt,
      note: src.note,
      kanji: src.kanji,
      background: src.background,
      exampleSentences: src.exampleSentences,
    });
  }

  return {
    version: 1,
    decks,
    cards,
    srs: {},
  };
};
