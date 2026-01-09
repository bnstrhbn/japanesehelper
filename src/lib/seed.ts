import type { AppState, Card, Deck, ExampleSentence } from './models';

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

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
      [{ ja: 'おかねがある。' }, { ja: 'じかんがある。' }],
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
      [{ ja: 'ねこがいる。' }, { ja: 'ともだちがいる。' }],
      undefined,
      'verb (intransitive)',
    ),
  );
  add(makeCard(vocab.id, 'vocab', 'necessary; need', 'ひつよう', 'hitsuyou', undefined, [{ ja: 'ひつようです。' }], '必要', 'na-adjective / noun'));
  add(makeCard(vocab.id, 'vocab', 'to need (a thing); to require', 'いる', 'iru', undefined, [{ ja: 'おかねがいる。' }], '要る', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'to hold; to have/own', 'もつ', 'motsu', undefined, [{ ja: 'かばんをもつ。' }], '持つ', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'to eat', 'たべる', 'taberu', undefined, [{ ja: 'ごはんをたべる。' }], '食べる', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'to drink', 'のむ', 'nomu', undefined, [{ ja: 'みずをのむ。' }], '飲む', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'to buy', 'かう', 'kau', undefined, [{ ja: 'パンをかう。' }], '買う', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'to use', 'つかう', 'tsukau', undefined, [{ ja: 'ペンをつかう。' }], '使う', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'to live (reside)', 'すむ', 'sumu', undefined, [{ ja: 'とうきょうにすむ。' }], '住む', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'to work', 'はたらく', 'hataraku', undefined, [{ ja: 'まいにちはたらく。' }], '働く', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'to sleep', 'ねる', 'neru', undefined, [{ ja: 'よるにねる。' }], '寝る', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'to wake up', 'おきる', 'okiru', undefined, [{ ja: 'あさはやくおきる。' }], '起きる', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'to enter', 'はいる', 'hairu', undefined, [{ ja: 'へやにはいる。' }], '入る', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'to leave/exit', 'でる', 'deru', undefined, [{ ja: 'いえをでる。' }], '出る', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'to listen; to ask', 'きく', 'kiku', undefined, [{ ja: 'おんがくをきく。' }], '聞く', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'to speak/talk', 'はなす', 'hanasu', undefined, [{ ja: 'にほんごをはなす。' }], '話す', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'to read', 'よむ', 'yomu', undefined, [{ ja: 'ほんをよむ。' }], '読む', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'to write', 'かく', 'kaku', undefined, [{ ja: 'なまえをかく。' }], '書く', 'verb (transitive)'));
  add(makeCard(vocab.id, 'vocab', 'can do; be able to', 'できる', 'dekiru', undefined, [{ ja: 'にほんごができる。' }], '出来る', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'want (a thing)', 'ほしい', 'hoshii', undefined, [{ ja: 'あたらしいくつがほしい。' }], '欲しい', 'i-adjective'));
  add(makeCard(vocab.id, 'vocab', 'want to (do)', '〜たい', '~tai', undefined, [{ ja: 'たべたい。' }], undefined, 'auxiliary / suffix'));
  add(makeCard(vocab.id, 'vocab', 'please (request)', 'おねがいします', 'onegaishimasu', undefined, [{ ja: 'みずをおねがいします。' }], 'お願いします', 'expression'));
  add(makeCard(vocab.id, 'vocab', 'okay; alright; no problem', 'だいじょうぶ', 'daijoubu', undefined, [{ ja: 'だいじょうぶです。' }], '大丈夫', 'na-adjective'));
  add(makeCard(vocab.id, 'vocab', 'and; and then', 'そして', 'soshite', undefined, [{ ja: 'パンをかって、そしてたべる。' }], undefined, 'conjunction'));
  add(makeCard(vocab.id, 'vocab', 'after that; then', 'それから', 'sorekara', undefined, [{ ja: 'それから、いえにかえる。' }], undefined, 'conjunction'));
  add(makeCard(vocab.id, 'vocab', 'but; however', 'でも', 'demo', undefined, [{ ja: 'いきたい。でも、じかんがない。' }], undefined, 'conjunction'));
  add(makeCard(vocab.id, 'vocab', 'so; therefore', 'だから', 'dakara', undefined, [{ ja: 'あめだ。だから、いえにいる。' }], undefined, 'conjunction'));
  add(makeCard(vocab.id, 'vocab', 'who', 'だれ', 'dare', undefined, [{ ja: 'だれですか。' }], undefined, 'pronoun'));
  add(makeCard(vocab.id, 'vocab', 'where', 'どこ', 'doko', undefined, [{ ja: 'どこにいきますか。' }], undefined, 'pronoun'));
  add(makeCard(vocab.id, 'vocab', 'how', 'どう', 'dou', undefined, [{ ja: 'どうですか。' }], undefined, 'adverb'));
  add(makeCard(vocab.id, 'vocab', 'why', 'どうして', 'doushite', undefined, [{ ja: 'どうして？' }], undefined, 'adverb'));
  add(makeCard(vocab.id, 'vocab', 'why', 'なぜ', 'naze', undefined, [{ ja: 'なぜ？' }], undefined, 'adverb'));
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
  add(makeCard(vocab.id, 'vocab', 'time', 'じかん', 'jikan', undefined, [{ ja: 'じかんがない。' }], '時間', 'noun'));
  add(makeCard(vocab.id, 'vocab', 'store; shop', 'みせ', 'mise', undefined, [{ ja: 'みせにいく。' }], '店', 'noun'));
  add(makeCard(vocab.id, 'vocab', 'bread', 'ぱん', 'pan', undefined, [{ ja: 'ぱんをたべる。' }], 'パン', 'noun'));

  add(makeCard(vocab.id, 'vocab', 'to go', 'いく', 'iku', undefined, [{ ja: 'みせにいく。' }], '行く', 'verb (intransitive)'));
  add(makeCard(vocab.id, 'vocab', 'to return; to go home', 'かえる', 'kaeru', undefined, [{ ja: 'いえにかえる。' }], '帰る', 'verb (intransitive)'));

  add(makeCard(vocab.id, 'vocab', 'because; since (casual)', 'から', 'kara', undefined, [{ ja: 'あめだから、いえにいる。' }], undefined, 'particle / conjunction'));
  add(makeCard(vocab.id, 'vocab', 'if (suppose)', 'もし', 'moshi', undefined, [{ ja: 'もしひまなら、いきます。' }], undefined, 'adverb'));
  add(makeCard(vocab.id, 'vocab', 'if; if that’s the case…', 'なら', 'nara', undefined, [{ ja: 'ひまなら、いきます。' }], undefined, 'particle / conditional'));
  add(makeCard(vocab.id, 'vocab', 'because; since (polite/neutral)', 'ので', 'node', undefined, [{ ja: 'じかんがあるので、いきます。' }], undefined, 'particle / conjunction'));
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
    if (!src.pos || !src.pos.toLowerCase().includes('verb')) continue;

    const key = `${src.prompt.trim()}||${src.answer.trim()}`;
    if (addedVerbKeys.has(key)) continue;
    addedVerbKeys.add(key);

    add(
      makeCard(
        verbs.id,
        'verb',
        src.prompt,
        src.answer,
        src.note,
        'Dictionary form (same verb as in Common Vocab).',
        src.exampleSentences,
        src.kanji,
        src.pos,
      ),
    );
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
