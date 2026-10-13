import { describe, expect, it } from 'vitest';
import { gradeMeaning, gradeReading, kanaAnswer } from './grading';
import type { WkSubject } from './types';

const kanji: WkSubject = {
  id: 440,
  object: 'kanji',
  data: {
    characters: '一',
    level: 1,
    slug: '一',
    lesson_position: 2,
    hidden_at: null,
    meanings: [{ meaning: 'One', primary: true, accepted_answer: true }],
    auxiliary_meanings: [
      { meaning: 'one thing', type: 'blacklist' },
      { meaning: 'Flat', type: 'whitelist' },
    ],
    meaning_mnemonic: '',
    readings: [
      { type: 'onyomi', primary: true, accepted_answer: true, reading: 'いち' },
      { type: 'kunyomi', primary: false, accepted_answer: false, reading: 'ひと' },
    ],
    spaced_repetition_system_id: 2,
  },
};

const vocab: WkSubject = {
  ...kanji,
  id: 9000,
  object: 'vocabulary',
  data: {
    ...kanji.data,
    characters: '大人',
    meanings: [{ meaning: 'Adult', primary: true, accepted_answer: true }],
    auxiliary_meanings: [{ meaning: 'Grown Up', type: 'whitelist' }],
    readings: [{ primary: true, accepted_answer: true, reading: 'おとな' }],
  },
};

describe('meaning grading', () => {
  it('accepts primary, whitelist and user synonyms case-insensitively', () => {
    expect(gradeMeaning(kanji, ' one ')).toMatchObject({ status: 'correct' });
    expect(gradeMeaning(kanji, 'flat')).toMatchObject({ status: 'correct' });
    expect(gradeMeaning(vocab, 'grown-up')).toMatchObject({ status: 'correct' });
    expect(gradeMeaning(vocab, 'big person', { synonyms: ['big person'] })).toMatchObject({ status: 'correct' });
  });

  it('tolerates small typos but rejects blacklisted answers', () => {
    expect(gradeMeaning(vocab, 'adlut')).toMatchObject({ status: 'correct', close: true });
    expect(gradeMeaning(kanji, 'one thing')).toEqual({ status: 'incorrect' });
    expect(gradeMeaning(kanji, 'two')).toEqual({ status: 'incorrect' });
  });

  it('asks again when kana is typed for a meaning', () => {
    expect(gradeMeaning(kanji, 'いち').status).toBe('retry');
  });
});

describe('reading grading', () => {
  it('accepts kana and romaji, including a trailing n', () => {
    expect(gradeReading(vocab, 'おとな')).toMatchObject({ status: 'correct' });
    expect(gradeReading(vocab, 'otona')).toMatchObject({ status: 'correct' });
    expect(kanaAnswer('hon')).toBe('ほん');
  });

  it("shakes instead of failing for the kanji's other reading", () => {
    expect(gradeReading(kanji, 'ひと')).toMatchObject({ status: 'retry' });
    expect(gradeReading(kanji, 'に')).toEqual({ status: 'incorrect' });
  });
});
