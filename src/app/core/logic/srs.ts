import { Rating, RevisionSchedule, SrsStatus, StoredStatus } from '../models';
import { addDays, daysBetween } from '../util';

/** Interval ladder in days. step 0 = learning (review tomorrow). */
export const LADDER = [1, 3, 7, 14, 30, 60];

export function ratingFromScore(score: number): Rating {
  if (score >= 85) return 'easy';
  if (score >= 65) return 'good';
  if (score >= 40) return 'hard';
  return 'again';
}
export const RATING_SCORE: Record<Rating, number> = { again: 20, hard: 50, good: 75, easy: 95 };

export function storedStatus(s: Pick<RevisionSchedule, 'step' | 'lapses' | 'streak' | 'lastRating' | 'reps' | 'confidence'>): StoredStatus {
  if (s.lastRating === 'again' || (s.lapses >= 2 && s.streak < 2) || ((s.confidence ?? 3) <= 1 && s.reps >= 2)) return 'Weak';
  if (s.step >= 4 && s.streak >= 3 && (s.confidence ?? 4) >= 4) return 'Mastered';
  if (s.step >= 3) return 'Strong';
  return 'Learning';
}

/** Applies one review to a schedule (or creates one) and returns the next schedule. Pure. */
export function review(prev: RevisionSchedule | null, q: { questionId: string; categoryId: string; topicId: string }, rating: Rating, today: string, confidence?: number, ladder: number[] = LADDER): RevisionSchedule {
  const LADDER_ = ladder.length >= 3 ? ladder : LADDER;
  const init: RevisionSchedule = { ...q, step: -1, intervalDays: 0, dueDate: today, reps: 0, lapses: 0, streak: 0, status: 'Learning', correct: 0, incorrect: 0 };
  const base: RevisionSchedule = prev ? { ...prev, correct: prev.correct ?? 0, incorrect: prev.incorrect ?? 0 } : init;
  let step = base.step;
  let lapses = base.lapses;
  let streak = base.streak;
  let interval: number;
  switch (rating) {
    case 'again':
      lapses += base.reps > 0 ? 1 : 0;
      streak = 0;
      step = 0;
      interval = 1;
      break;
    case 'hard':
      streak = 0;
      step = Math.max(0, Math.min(step, 1)); // hold at (at most) 3 days
      interval = step <= 0 ? 1 : Math.max(2, Math.round(LADDER_[step] * 0.6));
      break;
    case 'good':
      streak += 1;
      step = Math.min(step + 1, LADDER_.length - 1);
      interval = LADDER_[step];
      break;
    case 'easy':
      streak += 1;
      step = Math.min(step + 2, LADDER_.length - 1);
      interval = LADDER_[step];
      break;
  }
  const next: RevisionSchedule = {
    ...base,
    categoryId: q.categoryId || base.categoryId,
    topicId: q.topicId || base.topicId,
    step,
    intervalDays: interval,
    dueDate: addDays(today, interval),
    reps: base.reps + 1,
    lapses,
    streak,
    lastRating: rating,
    correct: base.correct + (rating === 'good' || rating === 'easy' ? 1 : 0),
    incorrect: base.incorrect + (rating === 'again' ? 1 : 0),
    confidence: confidence ?? base.confidence,
    lastReviewed: today,
    status: 'Learning',
  };
  next.status = storedStatus(next);
  return next;
}

/** Full status including time-dependent Due / Overdue. */
export function statusOf(s: RevisionSchedule | null | undefined, today: string): SrsStatus {
  if (!s) return 'New';
  const d = daysBetween(s.dueDate, today); // >0 means past due
  if (d > 0) return 'Overdue';
  if (d === 0) return 'Due';
  return s.status;
}

export function isDue(s: RevisionSchedule, today: string): boolean {
  return s.dueDate <= today;
}

/** Sort for revision queue: most overdue first, then weakest. */
export function revisionOrder(a: RevisionSchedule, b: RevisionSchedule): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  const w = (s: RevisionSchedule) => (s.status === 'Weak' ? 0 : s.status === 'Learning' ? 1 : 2);
  return w(a) - w(b) || b.lapses - a.lapses;
}
