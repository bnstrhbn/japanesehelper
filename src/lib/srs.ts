import type { CardSrs } from './models';

export type ReviewResult = {
  correct: boolean;
};

export const defaultSrs = (cardId: string, now: number): CardSrs => ({
  cardId,
  due: now,
  intervalDays: 0,
  easeFactor: 2.5,
  repetitions: 0,
  lapses: 0,
  lastReviewed: undefined,
});

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export const applySm2 = (prev: CardSrs, result: ReviewResult, now: number): CardSrs => {
  const quality = result.correct ? 4 : 2;

  let easeFactor = prev.easeFactor;
  let repetitions = prev.repetitions;
  let intervalDays = prev.intervalDays;
  let lapses = prev.lapses;

  if (quality < 3) {
    repetitions = 0;
    intervalDays = 1;
    lapses += 1;
  } else {
    repetitions += 1;

    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * easeFactor);

    easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    easeFactor = clamp(easeFactor, 1.3, 3.0);
  }

  const due = now + intervalDays * 24 * 60 * 60 * 1000;

  return {
    ...prev,
    easeFactor,
    repetitions,
    intervalDays,
    lapses,
    due,
    lastReviewed: now,
  };
};
